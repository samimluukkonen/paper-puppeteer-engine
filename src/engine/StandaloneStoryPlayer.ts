import type Phaser from 'phaser';
import type { CameraViewport } from './cinematicCamera.js';
import { DialogueKeyboardInput } from './DialogueKeyboardInput.js';
import type { LoadedScene } from './SceneLoader.js';
import type { AdvanceResult } from './ScenePlayback.js';
import { StoryPlayer, type StoryPlayerOptions, type StoryPlayerStatus } from './StoryPlayer.js';

export interface StandaloneStorySource extends Omit<StoryPlayerOptions, 'loadScene'> {
  readonly definition: unknown;
  /** Use SceneLoader.fromDefinition, load or loadPackage with context.signal. */
  readonly loadScene: (...args: Parameters<StoryPlayerOptions['loadScene']>) => Promise<LoadedScene>;
}
export interface StandaloneStoryPlayerOptions {
  /** Resolve a project story ID into validated story/scene data and its asset loader. */
  readonly loadStory: (storyId: string, signal: AbortSignal) => Promise<StandaloneStorySource>;
  readonly advanceKeys?: readonly string[];
  readonly advanceLabel?: string;
  readonly viewport?: CameraViewport;
}

/** React-free viewer on a host-owned Phaser scene. Phaser supplies the only frame loop.
 * The host owns its game, focusable target and shared hosted textures.
 */
export class StandaloneStoryPlayer {
  private player: StoryPlayer | undefined;
  private loaded: LoadedScene | undefined;
  private controller: AbortController | undefined;
  private readonly keyboard: DialogueKeyboardInput;
  private readonly indicator: HTMLParagraphElement;
  private readonly audioButton: HTMLButtonElement;
  private generation = 0;
  private ticking: number | undefined;
  private closed = false;
  private loading = false;
  private failure: unknown;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly target: HTMLElement,
    private readonly options: StandaloneStoryPlayerOptions,
  ) {
    const doc = target.ownerDocument;
    this.indicator = doc.createElement('p');
    this.indicator.setAttribute('role', 'status');
    this.indicator.style.cssText = 'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:8px 0';
    this.audioButton = doc.createElement('button');
    this.audioButton.type = 'button';
    this.audioButton.textContent = 'Enable story audio';
    this.audioButton.addEventListener('click', this.enableAudio);
    target.append(this.indicator, this.audioButton);
    this.keyboard = new DialogueKeyboardInput(target, {
      ...(options.advanceKeys ? { keys: options.advanceKeys } : {}),
      waiting: () => this.waitingForDialogue,
      advanceDialogue: () => {
        // This deliberate press belongs exclusively to audio activation, never to a line as well.
        if (this.audioLocked) this.enableAudio();
        else {
          try {
            this.advanceDialogue();
          } catch {
            // StoryPlayer retains the runtime error and releases the failed session.
            this.publish();
          }
        }
      },
    });
    scene.events.on('update', this.tick);
    scene.events.once('shutdown', this.dispose);
    scene.events.once('destroy', this.dispose);
    this.publish();
  }

  get status(): StoryPlayerStatus | 'empty' {
    if (this.closed) return 'disposed';
    if (this.loading) return 'loading';
    if (this.failure) return 'failed';
    return this.player?.status ?? 'empty';
  }
  get error(): unknown {
    return this.failure ?? this.player?.error;
  }
  get index(): number {
    return this.player?.index ?? -1;
  }
  get waitingForDialogue(): boolean {
    return this.player?.status === 'playing' && this.loaded?.runner.status === 'waiting-for-dialogue-advance';
  }
  private get audioLocked(): boolean {
    return ['locked', 'error'].includes(this.loaded?.runner.audio?.status ?? 'disabled');
  }

  /** Prepare a story without starting playback or consuming viewer input. */
  async load(storyId: string): Promise<void> {
    this.assertActive();
    this.stop();
    this.player?.dispose();
    this.player = undefined;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.loading = true;
    this.publish();
    try {
      const source = await this.options.loadStory(storyId, controller.signal);
      if (generation !== this.generation) return;
      this.player = new StoryPlayer(source.definition, {
        ...source,
        loadScene: async (definition, context) => {
          const loaded = await source.loadScene(definition, context);
          try {
            context.signal.throwIfAborted();
            loaded.applyCamera(this.scene.cameras.main, this.options.viewport);
          } catch (error) {
            loaded.dispose();
            throw error;
          }
          this.loaded = loaded;
          return {
            runner: loaded.runner,
            dispose: () => {
              if (this.loaded === loaded) this.loaded = undefined;
              loaded.dispose();
            },
          };
        },
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.failure = error;
      throw error;
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.publish();
      }
    }
  }

  /** Start/restart at the first scene. Enter never starts playback implicitly. */
  async play(): Promise<void> {
    this.assertActive();
    if (!this.player || this.loading) throw new Error('Load a story before playing.');
    this.failure = undefined;
    try {
      await this.player.start();
    } finally {
      this.publish();
    }
  }
  advanceDialogue(): AdvanceResult {
    this.assertActive();
    try {
      return this.player?.advanceDialogue() ?? { advanced: false };
    } finally {
      this.publish();
    }
  }
  /** Invoke directly from a click/key handler to retain browser user activation. */
  async unlockAudio(): Promise<void> {
    this.assertActive();
    const loaded = this.loaded;
    try {
      await loaded?.runner.audio?.unlock();
      if (loaded === this.loaded) loaded?.runner.syncAudio();
    } finally {
      this.publish();
    }
  }
  private readonly enableAudio = (): void => {
    void this.unlockAudio().catch(() => this.publish());
    this.target.focus();
  };

  stop(): void {
    this.assertActive();
    ++this.generation;
    this.controller?.abort();
    this.controller = undefined;
    this.loading = false;
    this.failure = undefined;
    this.player?.stop();
    this.publish();
  }
  readonly dispose = (): void => {
    if (this.closed) return;
    this.closed = true;
    ++this.generation;
    this.controller?.abort();
    this.scene.events.off('update', this.tick);
    this.scene.events.off('shutdown', this.dispose);
    this.scene.events.off('destroy', this.dispose);
    this.keyboard.dispose();
    this.audioButton.removeEventListener('click', this.enableAudio);
    this.audioButton.remove();
    this.indicator.remove();
    this.player?.dispose();
    this.player = undefined;
  };

  private readonly tick = (_time: number, delta: number): void => {
    if (this.closed || this.ticking === this.generation || !this.player) return;
    const generation = this.generation;
    this.ticking = generation;
    void this.player
      .update(delta)
      .catch((error: unknown) => {
        if (generation === this.generation) this.failure = error;
      })
      .finally(() => {
        if (this.ticking === generation) this.ticking = undefined;
        this.publish();
      });
  };
  private publish(): void {
    if (this.closed) return;
    const label =
      this.options.advanceLabel ??
      (this.options.advanceKeys === undefined
        ? 'Enter'
        : this.options.advanceKeys.map((key) => (key === ' ' ? 'Space' : key)).join(' / ') || 'the advance control');
    this.audioButton.hidden = !this.audioLocked;
    const text = this.audioLocked
      ? 'Enable story audio to hear playback.'
      : this.waitingForDialogue
        ? `Press ${label} to continue`
        : this.status === 'completed'
          ? 'Story complete'
          : this.status === 'failed'
            ? `Story playback failed: ${this.error instanceof Error ? this.error.message : String(this.error)}`
            : '';
    if (this.indicator.textContent !== text) this.indicator.textContent = text;
    this.indicator.hidden = !text;
  }
  private assertActive(): void {
    if (this.closed) throw new Error('Standalone story player disposed.');
  }
}
