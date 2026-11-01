import { freezeData, type DeepReadonly } from './readonlyData.js';
import { parseSceneDefinition, type SceneDefinition } from './SceneDefinition.js';
import type { ScenePlayback } from './ScenePlayback.js';
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
export interface StoryPlayerOptions {
  readonly scenes: ReadonlyMap<string, unknown>;
  readonly sceneOptions?: NonNullable<StoryValidationOptions['sceneOptions']>;
  /** Supply SceneLoader.fromDefinition or an existing host adapter. No React dependency. */
  readonly loadScene: (
    definition: DeepReadonly<SceneDefinition>,
    context: StorySceneContext,
  ) => Promise<StorySceneSession>;
}
export type StoryPlayerStatus = 'stopped' | 'loading' | 'playing' | 'completed' | 'failed' | 'disposed';
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

  constructor(
    input: unknown,
    private readonly options: StoryPlayerOptions,
  ) {
    this.definition = freezeData(parseStoryDefinition(input, options));
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

  /** Resolve once the first scene is loaded and playing. Calling while active is harmless. */
  async start(): Promise<void> {
    this.assertActive();
    if (this.state === 'playing' || this.state === 'loading') return;
    parseStoryDefinition(this.definition, { requirePlayable: true });
    this.failure = undefined;
    await this.open(0);
  }

  /** Host ticks once per frame. During loading, elapsed time is ignored. At a boundary,
   * dispose the completed scene and await the next load; excess frame time is discarded.
   * Await/catch this Promise so loader/runtime failures are observable by the host.
   */
  async update(deltaMilliseconds: number): Promise<void> {
    this.assertActive();
    assertFinite(deltaMilliseconds, 'Story delta');
    if (deltaMilliseconds < 0) throw new Error('Story delta cannot be negative.');
    if (this.state !== 'playing' || !this.session) return;
    const generation = this.generation;
    try {
      const session = this.session;
      session.runner.update(deltaMilliseconds);
      if (generation !== this.generation) return;
      if (session.runner.status === 'completed') await this.open(this.cursor + 1);
      else if (session.runner.status !== 'playing')
        throw session.runner.error ?? new Error(`Story scene stopped unexpectedly (${session.runner.status}).`);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw error;
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
    controller?.abort();
    session?.dispose();
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
  private async open(index: number): Promise<void> {
    // Invalidate even loaders which ignore AbortSignal; their eventual sessions are disposed below.
    this.state = 'loading';
    let generation: number;
    try {
      generation = this.release();
    } catch (error) {
      this.fail(error);
    }
    if (generation !== this.generation) return;
    this.cursor = index;
    if (index === this.definition.scenes.length) {
      this.state = 'completed';
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const entry = this.definition.scenes[index]!;
    let session: StorySceneSession;
    try {
      session = await this.options.loadScene(this.scenes.get(entry.sceneAssetId)!, {
        entry,
        index,
        instanceId: `story-scene-${++instanceSerial}`,
        signal: controller.signal,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
    }
    if (generation !== this.generation) {
      session.dispose();
      return;
    }
    this.session = session;
    this.state = 'playing';
    try {
      session.runner.play();
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
    }
  }
  private assertActive(): void {
    if (this.state === 'disposed') throw new Error('Story player disposed.');
  }
}
