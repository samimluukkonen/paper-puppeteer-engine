import type { AnimationPlayer } from './AnimationPlayer.js';
import type { QueueAnimationOptions } from './AnimationQueue.js';
import type { PlaybackLifecycleEvent } from './PlaybackLifecycle.js';
import { assertFinite } from './types.js';

/** Structural playback host: both Puppet and renderer-independent AnimationPlayer satisfy it. */
export type AnimationStateHost = Pick<
  AnimationPlayer,
  'play' | 'hasAnimation' | 'getPlaybackStatus' | 'isPlaybackStopped' | 'onPlaybackLifecycle' | 'getQueue'
>;

export interface AnimationStateDefinition {
  readonly animation: string;
  /** Defaults to the registered clip's loop setting. playAction always overrides this to false. */
  readonly loop?: boolean;
  readonly options?: Readonly<QueueAnimationOptions>;
}

export interface AnimationStateControllerOptions {
  readonly initialState: string;
  readonly states: Readonly<Record<string, AnimationStateDefinition>>;
  /** Milliseconds; pair overrides take precedence over destination options, then this default. */
  readonly defaultFadeDuration?: number;
  readonly transitions?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface SetAnimationStateOptions {
  /** Explicitly restart even a matching state, or cancel its temporary action. */
  readonly restart?: boolean;
}

export interface AnimationActionOptions extends Readonly<QueueAnimationOptions> {
  /** Persistent destination after natural completion; defaults to currentState. */
  readonly returnTo?: string;
}

interface StateIntent {
  readonly animation: string;
  readonly action: string | undefined;
  playbackId: number | undefined;
}

function checkObject(value: unknown, keys: readonly string[], label: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unsupported ${label} field "${key}".`);
  }
}

function checkId(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string.`);
}

function checkNumber(value: number | undefined, label: string): void {
  if (value === undefined) return;
  assertFinite(value, label);
  if (value < 0) throw new Error(`${label} cannot be negative.`);
}

function checkPlaybackOptions(options: Readonly<QueueAnimationOptions>): void {
  checkNumber(options.fadeDuration, 'Fade duration');
  checkNumber(options.speed, 'Animation speed');
}

/** Named base-channel playback policy. Owns no evaluator, clock, update loop, or queue. */
export class AnimationStateController {
  private readonly states = new Map<string, AnimationStateDefinition>();
  private readonly transitions = new Map<string, ReadonlyMap<string, number>>();
  private readonly defaultFadeDuration: number;
  private persistentState: string;
  private intent: StateIntent | undefined;
  private unsubscribe: (() => void) | undefined;
  private disposed = false;

  constructor(
    private readonly host: AnimationStateHost,
    options: AnimationStateControllerOptions,
  ) {
    checkObject(options, ['initialState', 'states', 'defaultFadeDuration', 'transitions'], 'state controller options');
    if (!options.states || typeof options.states !== 'object' || Array.isArray(options.states))
      throw new Error('States must be an object.');
    for (const [id, state] of Object.entries(options.states)) {
      checkId(id, 'State ID');
      checkObject(state, ['animation', 'loop', 'options'], 'state');
      checkId(state.animation, 'Animation ID');
      if (!host.hasAnimation(state.animation))
        throw new Error(`Unknown animation "${state.animation}" in state "${id}".`);
      if (state.loop !== undefined && typeof state.loop !== 'boolean') throw new Error('State loop must be a boolean.');
      if (state.options !== undefined) {
        checkObject(state.options, ['speed', 'fadeDuration'], 'state playback options');
        checkPlaybackOptions(state.options);
      }
      this.states.set(
        id,
        Object.freeze({
          animation: state.animation,
          ...(state.loop === undefined ? {} : { loop: state.loop }),
          ...(state.options === undefined ? {} : { options: Object.freeze({ ...state.options }) }),
        }),
      );
    }
    this.getState(options.initialState);
    checkNumber(options.defaultFadeDuration, 'Default fade duration');
    this.defaultFadeDuration = options.defaultFadeDuration ?? 0;
    if (options.transitions !== undefined) {
      if (!options.transitions || typeof options.transitions !== 'object' || Array.isArray(options.transitions))
        throw new Error('Transitions must be an object.');
      for (const [from, destinations] of Object.entries(options.transitions)) {
        this.getState(from);
        if (!destinations || typeof destinations !== 'object' || Array.isArray(destinations))
          throw new Error('Transition destinations must be an object.');
        const pairs = new Map<string, number>();
        for (const [to, duration] of Object.entries(destinations)) {
          this.getState(to);
          // A present transition must supply a number, including when JavaScript bypasses the types.
          assertFinite(duration, 'Transition duration');
          checkNumber(duration, 'Transition duration');
          pairs.set(to, duration);
        }
        this.transitions.set(from, pairs);
      }
    }
    this.persistentState = options.initialState;
    this.unsubscribe = host.onPlaybackLifecycle((event) => this.onLifecycle(event), { completionPhase: 'settled' });
    try {
      this.start(options.initialState);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Last requested persistent state, retained while an action or imperative playback takes control. */
  get currentState(): string {
    return this.persistentState;
  }

  get currentAction(): string | undefined {
    return this.intent?.action;
  }

  /** Whether the selected base playback still belongs to this controller (including a held completion). */
  get isActive(): boolean {
    const status = this.host.getPlaybackStatus();
    return (
      !this.disposed &&
      !this.host.isPlaybackStopped() &&
      this.intent?.playbackId !== undefined &&
      status?.playbackId === this.intent.playbackId &&
      (status.status === 'playing' || status.status === 'paused' || status.status === 'completed')
    );
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  setState(id: string, options: SetAnimationStateOptions = {}): this {
    this.assertActive();
    this.getState(id);
    checkObject(options, ['restart'], 'state request options');
    if (options.restart !== undefined && typeof options.restart !== 'boolean')
      throw new Error('State restart must be a boolean.');
    if (
      !options.restart &&
      id === this.persistentState &&
      (this.isActive || (this.intent !== undefined && this.intent.playbackId === undefined))
    )
      return this;
    this.start(id);
    return this;
  }

  /** Play a named state once; only its natural, unclaimed completion can return to the persistent state. */
  playAction(id: string, options: AnimationActionOptions = {}): this {
    this.assertActive();
    this.getState(id);
    checkObject(options, ['returnTo', 'speed', 'fadeDuration'], 'action options');
    checkPlaybackOptions(options);
    const returnTo = options.returnTo === undefined ? this.persistentState : options.returnTo;
    this.getState(returnTo);
    const playbackOptions: QueueAnimationOptions = {
      ...(options.fadeDuration === undefined ? {} : { fadeDuration: options.fadeDuration }),
      ...(options.speed === undefined ? {} : { speed: options.speed }),
    };
    this.start(returnTo, id, playbackOptions);
    return this;
  }

  /** Release subscriptions and pending returns; leave host playback and queues untouched. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.intent = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.states.clear();
    this.transitions.clear();
  }

  private getState(id: string): AnimationStateDefinition {
    checkId(id, 'State ID');
    const state = this.states.get(id);
    if (!state) throw new Error(`Unknown animation state "${id}".`);
    return state;
  }

  private start(persistent: string, action?: string, options: Readonly<QueueAnimationOptions> = {}): void {
    const id = action ?? persistent;
    const state = this.getState(id);
    const previousIntent = this.intent;
    const previousState = this.persistentState;
    const previousPlayback = this.host.getPlaybackStatus()?.playbackId;
    const from = previousIntent ? (previousIntent.action ?? previousState) : undefined;
    const fadeDuration =
      options.fadeDuration ??
      (from === undefined ? undefined : this.transitions.get(from)?.get(id)) ??
      state.options?.fadeDuration ??
      this.defaultFadeDuration;
    const intent: StateIntent = { animation: state.animation, action, playbackId: undefined };
    this.persistentState = persistent;
    this.intent = intent;
    try {
      this.host.play(state.animation, {
        ...state.options,
        ...options,
        fadeDuration,
        restart: true,
        layer: 'base',
        ...(action === undefined ? (state.loop === undefined ? {} : { loop: state.loop }) : { loop: false }),
      });
    } catch (error) {
      // Preflight failures preserve intent. Listener errors after a committed start keep the new identity.
      if (this.intent === intent && this.host.getPlaybackStatus()?.playbackId === previousPlayback) {
        this.persistentState = previousState;
        this.intent = previousIntent;
      }
      throw error;
    } finally {
      // Starts requested inside lifecycle delivery commit before their notifications are drained.
      if (this.intent === intent && intent.playbackId === undefined) {
        const status = this.host.getPlaybackStatus();
        if (status?.clip === state.animation && status.playbackId !== previousPlayback)
          intent.playbackId = status.playbackId;
      }
    }
  }

  private onLifecycle(event: PlaybackLifecycleEvent): void {
    if (this.disposed) return;
    if (event.type === 'disposed') {
      this.dispose();
      return;
    }
    if (event.layer !== 'base') return;
    const intent = this.intent;
    if (!intent) return;
    if (event.type === 'started') {
      const current = this.host.getPlaybackStatus();
      if (intent.playbackId === undefined && event.clip === intent.animation) intent.playbackId = event.playbackId;
      else if (intent.playbackId !== event.playbackId && current?.playbackId === event.playbackId)
        this.intent = undefined;
      return;
    }
    if (event.playbackId !== intent.playbackId) return;
    if (event.type === 'interrupted' || event.type === 'stopped') {
      this.intent = undefined;
    } else if (event.type === 'completed' && intent.action !== undefined) {
      const current = this.host.getPlaybackStatus();
      if (
        current?.playbackId !== event.playbackId ||
        current.status !== 'completed' ||
        this.host.isPlaybackStopped() ||
        this.host.getQueue().length
      ) {
        this.intent = undefined;
        return;
      }
      // Reuse ordinary playback and crossfades. Pending FIFO requests always keep precedence.
      this.start(this.persistentState);
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('AnimationStateController has been disposed.');
  }
}
