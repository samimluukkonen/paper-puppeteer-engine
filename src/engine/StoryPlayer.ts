import { throwNotificationErrors } from './notifications.js';
import { freezeData, type DeepReadonly } from './readonlyData.js';
import { parseSceneDefinition, type SceneDefinition } from './SceneDefinition.js';
import type { AdvanceResult, ScenePlayback } from './ScenePlayback.js';
import { CLEAR_SCENE_TRANSITION, type SceneTransitionTarget } from './sceneTransitions.js';
import {
  parseStoryDefinition,
  type StoryDefinition,
  type StorySceneEntry,
  type StoryValidationOptions,
} from './StoryDefinition.js';
import { assertFinite } from './types.js';

/** LoadedScene and a host-created SceneRunner session both satisfy this contract. */
export interface StorySceneSession {
  readonly runner: ScenePlayback;
  /** Idempotently release this session's runtime objects and leases, never host-owned shared assets. */
  dispose(): void;
}
export interface StorySceneContext {
  readonly entry: DeepReadonly<StorySceneEntry>;
  readonly index: number;
  /** Fresh identity on every load, including repeated assets and story restarts. */
  readonly instanceId: string;
  readonly signal: AbortSignal;
}
export interface PreparedStoryScene {
  /** Construct runtime objects only when this entry becomes current. */
  activate(): Promise<StorySceneSession>;
  dispose(): void;
}
export interface StoryPlayerOptions {
  readonly scenes: ReadonlyMap<string, unknown>;
  /** Optional CPU/artwork/audio preparation for current + next only. Never start a runner here. */
  readonly prepareScene?: (
    definition: DeepReadonly<SceneDefinition>,
    context: StorySceneContext,
  ) => Promise<PreparedStoryScene>;
  /** Story-owned overlay, above each scene's own fades. Required for authored entry fades. */
  readonly transitionOverlay?: SceneTransitionTarget;
  readonly sceneOptions?: NonNullable<StoryValidationOptions['sceneOptions']>;
  /** Supply SceneLoader.fromDefinition or an existing host adapter. No React dependency. */
  readonly loadScene: (
    definition: DeepReadonly<SceneDefinition>,
    context: StorySceneContext,
  ) => Promise<StorySceneSession>;
}
export type StoryPlayerStatus =
  | 'stopped'
  | 'loading'
  | 'transitioning'
  | 'playing'
  | 'completed'
  | 'failed'
  | 'disposed';
let instanceSerial = 0;

/** A single exclusive scene session at a time. SceneRunner retains its own clock and evaluation. */
export class StoryPlayer {
  readonly definition: DeepReadonly<StoryDefinition>;
  private readonly scenes = new Map<string, DeepReadonly<SceneDefinition>>();
  private state: StoryPlayerStatus = 'stopped';
  private cursor = -1;
  private failure: unknown;
  private session: StorySceneSession | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private next: { index: number; controller: AbortController; promise: Promise<PreparedStoryScene> } | undefined;
  private fade: { index: number; phase: 'out' | 'in'; elapsed: number; duration: number; color: string } | undefined;

  constructor(
    input: unknown,
    private readonly options: StoryPlayerOptions,
  ) {
    this.definition = freezeData(parseStoryDefinition(input, options));
    if (this.definition.scenes.some((entry) => entry.transition?.type === 'fade') && !options.transitionOverlay)
      throw new Error('Story entry fades require a transitionOverlay.');
    for (const entry of this.definition.scenes)
      if (!this.scenes.has(entry.sceneAssetId))
        this.scenes.set(
          entry.sceneAssetId,
          freezeData(parseSceneDefinition(options.scenes.get(entry.sceneAssetId), options.sceneOptions)),
        );
  }
  get status(): StoryPlayerStatus {
    return this.state;
  }
  get error(): unknown {
    return this.failure;
  }
  get index(): number {
    return this.cursor;
  }
  get currentEntry(): DeepReadonly<StorySceneEntry> | undefined {
    return this.definition.scenes[this.cursor];
  }
  get currentSession(): StorySceneSession | undefined {
    return this.session;
  }

  /** Resolve once the first scene is loaded, playing or revealing. Calling while active is harmless. */
  async start(): Promise<void> {
    this.assertActive();
    if (['playing', 'loading', 'transitioning'].includes(this.state)) return;
    parseStoryDefinition(this.definition, { requirePlayable: true });
    this.failure = undefined;
    await this.arrive(0);
  }

  /** Host ticks once per frame. During loading, elapsed time is ignored. At a boundary,
   * dispose the completed scene and await the next load; excess frame time is discarded.
   * Await/catch this Promise so loader/runtime failures are observable by the host.
   */
  async update(deltaMilliseconds: number): Promise<void> {
    this.assertActive();
    assertFinite(deltaMilliseconds, 'Story delta');
    if (deltaMilliseconds < 0) throw new Error('Story delta cannot be negative.');
    if (this.state === 'transitioning' && this.fade) {
      const fade = this.fade;
      try {
        fade.elapsed = Math.min(fade.duration, fade.elapsed + deltaMilliseconds);
        const progress = fade.elapsed / fade.duration;
        this.options.transitionOverlay!.setTransition({
          color: fade.color,
          opacity: fade.phase === 'out' ? progress : 1 - progress,
        });
        if (progress === 1) {
          if (fade.phase === 'out') await this.open(fade.index);
          else {
            this.fade = undefined;
            this.state = 'playing';
            this.session!.runner.play();
            this.preload(this.cursor + 1);
          }
        }
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    if (this.state !== 'playing' || !this.session) return;
    const generation = this.generation;
    try {
      const session = this.session;
      session.runner.update(deltaMilliseconds);
      if (generation !== this.generation) return;
      if (session.runner.status === 'completed') await this.arrive(this.cursor + 1);
      else if (!['playing', 'waiting-for-dialogue-advance', 'paused'].includes(session.runner.status))
        throw session.runner.error ?? new Error(`Story scene stopped unexpectedly (${session.runner.status}).`);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw error;
    }
  }

  /** Forward one explicit command to the current scene. Scene completion transitions on the next update. */
  advanceDialogue(): AdvanceResult {
    this.assertActive();
    if (this.state !== 'playing') return { advanced: false };
    try {
      return this.session?.runner.advanceDialogue?.() ?? { advanced: false };
    } catch (error) {
      return this.fail(error);
    }
  }

  stop(): void {
    this.assertActive();
    this.state = 'stopped';
    this.cursor = -1;
    this.failure = undefined;
    this.release();
  }
  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.cursor = -1;
    this.release();
  }

  private release(): number {
    const generation = ++this.generation;
    const controller = this.controller;
    const session = this.session;
    this.controller = undefined;
    this.session = undefined;
    const next = this.next;
    this.next = undefined;
    next?.controller.abort();
    if (next)
      void next.promise.then(
        (prepared) => prepared.dispose(),
        () => {},
      );
    this.fade = undefined;
    const errors: unknown[] = [];
    for (const release of [
      () => this.options.transitionOverlay?.setTransition(CLEAR_SCENE_TRANSITION),
      () => controller?.abort(),
      () => session?.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    throwNotificationErrors(errors, 'Story resource cleanup failed.');
    return generation;
  }
  private fail(error: unknown): never {
    this.failure = error;
    this.state = 'failed';
    try {
      this.release();
    } catch (cleanupError) {
      this.failure = new AggregateError([error, cleanupError], 'Story playback and cleanup failed.');
    }
    throw this.failure;
  }
  private context(index: number, signal: AbortSignal): StorySceneContext {
    return { entry: this.definition.scenes[index]!, index, instanceId: `story-scene-${++instanceSerial}`, signal };
  }
  private preload(index: number): void {
    if (!this.options.prepareScene || index >= this.definition.scenes.length || this.next) return;
    const controller = new AbortController();
    const context = this.context(index, controller.signal);
    const promise = Promise.resolve().then(() =>
      this.options.prepareScene!(this.scenes.get(context.entry.sceneAssetId)!, context),
    );
    // Retain failures for the boundary without producing unhandled background rejections.
    void promise.catch(() => {});
    this.next = { index, controller, promise };
  }
  private async arrive(index: number): Promise<void> {
    const transition = this.definition.scenes[index]?.transition;
    if (transition?.type === 'fade') {
      this.fade = { index, phase: 'out', elapsed: 0, duration: transition.duration / 2, color: transition.color };
      this.state = 'transitioning';
      if (!this.session) {
        this.options.transitionOverlay!.setTransition({ color: transition.color, opacity: 1 });
        await this.open(index);
      }
    } else await this.open(index);
  }
  private async open(index: number): Promise<void> {
    const arrival = this.definition.scenes[index]?.transition;
    const next = this.next?.index === index ? this.next : undefined;
    if (next) {
      // Keep outgoing leases until the next preparation has retained shared resources.
      // Its completed runner is never ticked during this loading interval.
      this.state = 'loading';
      this.options.transitionOverlay?.setTransition({
        color: arrival?.type === 'fade' ? arrival.color : '#000000',
        opacity: 1,
      });
      const observed = this.generation;
      try {
        await next.promise;
      } catch (error) {
        if (observed !== this.generation) return;
        this.fail(error);
      }
      if (observed !== this.generation) return;
      this.next = undefined;
    }
    this.state = 'loading';
    let generation: number;
    try {
      generation = this.release();
    } catch (error) {
      next?.controller.abort();
      if (next)
        void next.promise.then(
          (prepared) => prepared.dispose(),
          () => {},
        );
      this.fail(error);
    }
    if (generation !== this.generation) {
      next?.controller.abort();
      if (next)
        void next.promise.then(
          (prepared) => prepared.dispose(),
          () => {},
        );
      return;
    }
    // The opaque midpoint spans disposal and all asynchronous activation work.
    this.options.transitionOverlay?.setTransition({
      color: arrival?.type === 'fade' ? arrival.color : '#000000',
      opacity: 1,
    });
    this.cursor = index;
    if (index === this.definition.scenes.length) {
      this.options.transitionOverlay?.setTransition(CLEAR_SCENE_TRANSITION);
      this.state = 'completed';
      return;
    }
    const controller = next?.controller ?? new AbortController();
    this.controller = controller;
    const context = this.context(index, controller.signal);
    let session: StorySceneSession;
    let prepared: PreparedStoryScene | undefined;
    try {
      if (this.options.prepareScene) {
        prepared = await (next?.promise ??
          this.options.prepareScene(this.scenes.get(context.entry.sceneAssetId)!, context));
        if (generation !== this.generation) {
          prepared.dispose();
          return;
        }
        session = await prepared.activate();
      } else session = await this.options.loadScene(this.scenes.get(context.entry.sceneAssetId)!, context);
    } catch (error) {
      prepared?.dispose();
      if (generation !== this.generation) return;
      this.fail(error);
    }
    if (generation !== this.generation) {
      session.dispose();
      prepared?.dispose();
      return;
    }
    const active = session;
    this.session = prepared
      ? {
          runner: active.runner,
          dispose: () => {
            try {
              active.dispose();
            } finally {
              prepared.dispose();
            }
          },
        }
      : active;
    try {
      if (arrival?.type === 'fade') {
        this.fade = { index, phase: 'in', elapsed: 0, duration: arrival.duration / 2, color: arrival.color };
        this.state = 'transitioning';
      } else {
        this.options.transitionOverlay?.setTransition(CLEAR_SCENE_TRANSITION);
        this.state = 'playing';
        session.runner.play();
        this.preload(index + 1);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
    }
  }
  private assertActive(): void {
    if (this.state === 'disposed') throw new Error('Story player disposed.');
  }
}
