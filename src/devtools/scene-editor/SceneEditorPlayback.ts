import { equalJsonData } from '../../engine/equalJsonData.js';
import { sceneActorDepth, sceneLayer } from '../../engine/sceneLayers.js';
import type { SceneRunnerOptions } from '../../engine/SceneRunner.js';
import { SceneRunner } from '../../engine/SceneRunner.js';
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
  get speed(): number {
    return this.rate;
  }
  get previewing(): boolean {
    return !!this.runner && this.runner.status !== 'stopped';
  }
  get actors() {
    return this.previewing ? this.runner?.actors : undefined;
  }

  /** Selection notifications reuse the same immutable snapshot and keep playback running.
   * Artwork-only edits retain the current Actors and clock. Other authored edits/switches reset playback to initial placement; incomplete assets disable it.
   */
  sync(source: ReadonlyScene | null, ready: boolean, createActor: SceneRunnerOptions['createActor']): void {
    if (this.source === source && this.runner && ready) return;
    if (this.source && source && this.runner && ready) {
      const {
        images: _previousImages,
        layers: _previousLayers,
        camera: _previousCamera,
        cameraTracks: _previousTracks,
        transitions: _previousTransitions,
        ...previous
      } = this.source;
      const {
        images: _nextImages,
        layers: _nextLayers,
        camera: _nextCamera,
        cameraTracks: _nextTracks,
        transitions: _nextTransitions,
        ...next
      } = source;
      if (equalJsonData(previous, next)) {
        this.source = source;
        this.syncLayers();
        return;
      }
    }
    if (this.source === source && !this.runner && !ready) return;
    this.runner?.dispose();
    this.runner = undefined;
    this.source = source;
    this.factory = createActor;
    this.message = '';
    if (source && ready)
      this.command(() => {
        this.runner = new SceneRunner(source, { createActor });
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
    this.command(() => this.runner?.play());
  }
  pause(): void {
    this.command(() => this.runner?.pause());
  }
  restart(): void {
    this.command(() => this.runner?.restart());
  }
  stop(): void {
    this.command(() => {
      this.runner?.stop();
      this.showAuthoring();
    });
  }
  seek(time: number): void {
    this.command(() => this.runner?.seek(time));
  }
  setSpeed(speed: number): void {
    this.command(() => {
      if (this.runner) this.runner.speed = speed;
      this.rate = speed;
    });
  }
  update(delta: number): void {
    if (this.runner?.status !== 'playing') return;
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
    this.sync(source, true, this.factory);
  }
  dispose(): void {
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
