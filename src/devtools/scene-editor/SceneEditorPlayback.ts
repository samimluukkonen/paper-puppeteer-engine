import { equalJsonData, sceneActorDepth, sceneLayer, SceneRunner } from '../../engine/core.js';
import type { SceneAudioOptions, SceneRunnerOptions } from '../../engine/data.js';
import { notifySubscribers } from '../shared/subscriberNotifications.js';
import type { ReadonlyScene } from './SceneEditorDocument.js';

/** View-only playback session. Phaser binds the isolated Actor factory and supplies deltas.
 * No document commands, history entries, or animation edits originate here.
 */
export class SceneEditorPlayback {
  private runner: SceneRunner | undefined;
  private source: ReadonlyScene | null = null;
  private factory: SceneRunnerOptions['createActor'] | undefined;
  private revision = 0;
  private rate = 1;
  private message = '';
  private audioOptions: SceneAudioOptions | undefined;
  private transportGeneration = 0;
  private seekFrame: number | undefined;
  private pendingSeek: number | undefined;
  private muted = false;
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
  private notify(): void {
    this.revision++;
    notifySubscribers(this.listeners, 'Scene playback subscribers failed.');
  }
  get time(): number {
    return this.runner?.time ?? 0;
  }
  get status(): string {
    return this.runner?.status ?? 'loading';
  }
  get ready(): boolean {
    return !!this.runner && this.runner.status !== 'disposed';
  }
  get error(): string {
    return this.message;
  }
  get audioStatus(): string {
    return this.runner?.audio?.status ?? 'disabled';
  }
  get audioError(): string {
    return this.runner?.audio?.error ?? '';
  }
  get audioMuted(): boolean {
    return this.muted;
  }
  get speed(): number {
    return this.rate;
  }
  get previewing(): boolean {
    return !!this.runner && this.runner.status !== 'stopped';
  }
  get actors() {
    return this.previewing ? this.runner?.actors : undefined;
  }
  get dialogue() {
    return this.runner?.dialogue;
  }
  get dialogueHoldPlayback() {
    return this.runner?.dialogueHoldPlayback;
  }
  advanceDialogue(): void {
    this.command(() => this.runner?.advanceDialogue());
  }

  /** Selection notifications reuse the same immutable snapshot and keep playback running.
   * Artwork-only edits retain the current Actors and clock. Other authored edits/switches reset playback to initial placement; incomplete assets disable it.
   */
  sync(
    source: ReadonlyScene | null,
    ready: boolean,
    createActor: SceneRunnerOptions['createActor'],
    audio?: SceneAudioOptions,
  ): void {
    if (this.source === source && this.runner && ready) return;
    this.cancelSeek();
    if (this.source && source && this.runner && ready) {
      const {
        audioAssets: _previousAudioAssets,
        audioTracks: _previousAudioTracks,
        audioClips: _previousAudioClips,
        images: _previousImages,
        layers: _previousLayers,
        camera: _previousCamera,
        cameraTracks: _previousTracks,
        transitions: _previousTransitions,
        ...previous
      } = this.source;
      const {
        audioAssets: _nextAudioAssets,
        audioTracks: _nextAudioTracks,
        audioClips: _nextAudioClips,
        images: _nextImages,
        layers: _nextLayers,
        camera: _nextCamera,
        cameraTracks: _nextTracks,
        transitions: _nextTransitions,
        ...next
      } = source;
      if (equalJsonData(previous, next)) {
        this.source = source;
        this.transportGeneration++;
        this.runner.audio?.setScene(source);
        this.runner.syncAudio();
        this.syncLayers();
        this.notify();
        return;
      }
    }
    if (this.source === source && !this.runner && !ready) return;
    this.runner?.dispose();
    this.transportGeneration++;
    this.runner = undefined;
    this.source = source;
    this.factory = createActor;
    this.audioOptions = audio;
    this.message = '';
    if (source && ready)
      this.command(() => {
        this.runner = new SceneRunner(source, { createActor, ...(audio ? { audio } : {}) });
        if (this.runner.audio) this.runner.audio.muted = this.muted;
        this.runner.speed = this.rate;
        this.showAuthoring();
      });
    else this.notify();
  }
  private syncLayers(): void {
    const source = this.source;
    if (!source || !this.runner) return;
    const visible = this.previewing && sceneLayer(source, 'actors').visible;
    source.actors.forEach((actor, index) => {
      const container = this.runner?.actors.get(actor.id)?.puppet.container;
      if (!container) return;
      const depth = sceneActorDepth(source, index);
      // Phaser queues a display-list sort even when setDepth receives the current value.
      if (container.depth !== depth) container.setDepth(depth);
      if (container.visible !== visible) container.setVisible(visible);
    });
  }
  private showAuthoring(): void {
    if (this.runner?.status === 'stopped')
      for (const actor of this.runner.actors.values()) actor.puppet.container.setVisible(false);
  }
  private command(operation: () => void): void {
    this.message = '';
    try {
      operation();
      this.syncLayers();
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
    }
    this.notify();
  }
  play(): void {
    this.start(false);
  }
  pause(): void {
    this.cancelSeek();
    this.transportGeneration++;
    this.command(() => this.runner?.pause());
  }
  restart(): void {
    this.start(true);
  }
  private start(restart: boolean): void {
    if (restart) this.cancelSeek();
    else this.flushSeek();
    const runner = this.runner;
    if (!runner) return;
    const generation = ++this.transportGeneration;
    const operation = () => (restart ? runner.restart() : runner.play());
    const audio = runner.audio;
    if (!audio || audio.muted || audio.status === 'disabled' || audio.status === 'ready') {
      this.command(operation);
      return;
    }
    // unlock() resumes synchronously here, inside the Play gesture.
    const pending = audio.unlock();
    this.notify();
    void pending.then(
      () => {
        if (this.runner === runner && generation === this.transportGeneration) this.command(operation);
      },
      () => {
        if (this.runner === runner) this.notify();
      },
    );
  }
  enableAudio(): void {
    const runner = this.runner;
    if (!runner?.audio) return;
    const pending = runner.audio.unlock();
    this.notify();
    void pending.then(
      () => {
        if (this.runner === runner) this.command(() => runner.syncAudio());
      },
      () => {
        if (this.runner === runner) this.notify();
      },
    );
  }
  setAudioMuted(muted: boolean): void {
    this.muted = muted;
    this.command(() => {
      if (this.runner?.audio) {
        this.runner.audio.muted = muted;
        this.runner.syncAudio();
      }
    });
  }
  stop(): void {
    this.cancelSeek();
    this.transportGeneration++;
    this.command(() => {
      this.runner?.stop();
      this.showAuthoring();
    });
  }
  seek(time: number): void {
    this.cancelSeek();
    this.transportGeneration++;
    this.command(() => this.runner?.seek(time));
  }
  /** Pointer scrubbing samples only the latest position once per display frame. */
  queueSeek(time: number): void {
    if (this.status === 'playing') this.pause();
    this.transportGeneration++;
    this.pendingSeek = time;
    this.seekFrame ??= requestAnimationFrame(() => this.flushSeek());
  }
  /** Pointer release commits the last sample even before its scheduled frame. */
  flushSeek(): void {
    const time = this.pendingSeek;
    this.cancelSeek();
    if (time !== undefined) this.seek(time);
  }
  cancelSeek(): void {
    if (this.seekFrame !== undefined) cancelAnimationFrame(this.seekFrame);
    this.seekFrame = undefined;
    this.pendingSeek = undefined;
  }
  setSpeed(speed: number): void {
    this.command(() => {
      if (this.runner) this.runner.speed = speed;
      this.rate = speed;
    });
  }
  update(delta: number): void {
    if (this.runner?.status !== 'playing' && this.runner?.status !== 'waiting-for-dialogue-advance') return;
    this.command(() => {
      this.runner!.update(delta);
      if (this.runner!.error) throw this.runner!.error;
    });
  }
  /** A failed preview can be retried after correcting/loading assets. */
  retry(): void {
    if (!this.source || !this.factory) return;
    const source = this.source;
    this.source = null;
    this.sync(source, true, this.factory, this.audioOptions);
  }
  dispose(): void {
    this.cancelSeek();
    this.transportGeneration++;
    const runner = this.runner;
    this.runner = undefined;
    this.source = null;
    this.factory = undefined;
    try {
      runner?.dispose();
    } finally {
      this.notify();
    }
  }
}
