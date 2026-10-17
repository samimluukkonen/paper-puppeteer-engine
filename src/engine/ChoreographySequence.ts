import { Actor, type ActorPosition } from './Actor.js';
import type { ActorMoveOptions, ActorMovementResult, ActorWalkOptions } from './ActorMovement.js';
import type { QueueAnimationOptions } from './AnimationQueue.js';
import type { PlaybackWaitResult } from './PlaybackLifecycle.js';
import { assertFinite, type Facing } from './types.js';

export type ChoreographyMoveOptions = Readonly<Omit<ActorMoveOptions, 'signal'>>;
export type ChoreographyWalkOptions = Readonly<Omit<ActorWalkOptions, 'signal'>>;

/** Runtime-only commands. Points use Actor's existing coordinate contracts. */
export type ChoreographyStep =
  | { readonly kind: 'move'; readonly x: number; readonly y: number; readonly options?: ChoreographyMoveOptions }
  | { readonly kind: 'walk'; readonly x: number; readonly y: number; readonly options?: ChoreographyWalkOptions }
  | { readonly kind: 'lookAt'; readonly target: ActorPosition | Actor }
  | { readonly kind: 'face'; readonly facing: Facing }
  | { readonly kind: 'animation'; readonly name: string; readonly options?: Readonly<QueueAnimationOptions> }
  | { readonly kind: 'wait'; readonly duration: number }
  | { readonly kind: 'cue'; readonly callback: (actor: Actor) => undefined };

export type ChoreographyOutcome = 'completed' | 'cancelled' | 'interrupted' | 'failed' | 'disposed';
export type ChoreographyActionResult = ActorMovementResult | PlaybackWaitResult;

interface SequenceProgress {
  readonly completedSteps: number;
  /** Zero-based failing/active step; absent for successful or empty sequences. */
  readonly stepIndex?: number;
}

export type ChoreographyResult = SequenceProgress &
  (
    | { readonly status: 'failed'; readonly error: unknown }
    | {
        readonly status: Exclude<ChoreographyOutcome, 'failed'>;
        readonly stepResult?: ChoreographyActionResult;
      }
  );

class DisposedTargetError extends Error {}

function assertLive(actor: Actor): void {
  if (actor.isDisposed || actor.puppet.isDestroyed || actor.puppet.animationPlayer.isDisposed)
    throw new DisposedTargetError(`Choreography Actor "${actor.id}" is disposed.`);
}

function nonnegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) throw new Error(`${label} cannot be negative.`);
}

function validateOptions(options: unknown, keys: readonly string[]): void {
  if (options === undefined) return;
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid step options.');
  for (const key of Object.keys(options)) if (!keys.includes(key)) throw new Error(`Unsupported step option "${key}".`);
}

/** Copy command data while preserving live Actor and synchronous cue references. */
function snapshot(step: ChoreographyStep): ChoreographyStep {
  if (!step || typeof step !== 'object') return step; // run() reports malformed runtime input.
  switch (step.kind) {
    case 'move':
    case 'animation':
      return Object.freeze({ ...step, ...(step.options && { options: Object.freeze({ ...step.options }) }) });
    case 'walk':
      return Object.freeze({
        ...step,
        ...(step.options && {
          options: Object.freeze({
            ...step.options,
            ...(step.options.locomotion && { locomotion: Object.freeze({ ...step.options.locomotion }) }),
          }),
        }),
      });
    case 'lookAt':
      return Object.freeze({
        ...step,
        target: step.target instanceof Actor ? step.target : Object.freeze({ ...step.target }),
      });
    default:
      return Object.freeze({ ...step });
  }
}

/** Optional single-Actor, single-run orchestration over existing runtime operations.
 * Repeated run() calls return the same promise. No timers, scene subscriptions or evaluator.
 */
export class ChoreographySequence {
  private readonly steps: ChoreographyStep[] = [];
  private readonly cancellation = new AbortController();
  private promise: Promise<ChoreographyResult> | undefined;
  private resolve: ((result: ChoreographyResult) => void) | undefined;
  private requested: 'cancelled' | 'disposed' | undefined;
  private settled = false;
  private completedSteps = 0;
  private stepIndex: number | undefined;

  constructor(
    readonly actor: Actor,
    steps: readonly ChoreographyStep[] = [],
  ) {
    for (const step of steps) this.add(step);
  }

  add(step: ChoreographyStep): this {
    if (this.promise) throw new Error('ChoreographySequence is single-run; create a new sequence to change steps.');
    this.steps.push(snapshot(step));
    return this;
  }

  moveTo(x: number, y: number, options?: ChoreographyMoveOptions): this {
    return this.add({ kind: 'move', x, y, ...(options && { options }) });
  }

  walkTo(x: number, y: number, options?: ChoreographyWalkOptions): this {
    return this.add({ kind: 'walk', x, y, ...(options && { options }) });
  }

  lookAt(target: ActorPosition | Actor): this {
    return this.add({ kind: 'lookAt', target });
  }

  setFacing(facing: Facing): this {
    return this.add({ kind: 'face', facing });
  }

  /** Always start a fresh, finite base-channel instance, even for a registered looping clip. */
  playAnimation(name: string, options?: Readonly<QueueAnimationOptions>): this {
    return this.add({ kind: 'animation', name, ...(options && { options }) });
  }

  wait(duration: number): this {
    return this.add({ kind: 'wait', duration });
  }

  /** A synchronous application cue; async functions and returned values are unsupported. */
  cue(callback: (actor: Actor) => undefined): this {
    return this.add({ kind: 'cue', callback });
  }

  run(): Promise<ChoreographyResult> {
    if (this.promise) return this.promise;
    // Publish before executing cues or starting playback, both of which can reenter run().
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
    void this.execute();
    return this.promise;
  }

  cancel(): void {
    this.requestStop('cancelled');
  }

  dispose(): void {
    this.requestStop('disposed');
  }

  private requestStop(status: 'cancelled' | 'disposed'): void {
    if (this.settled || this.requested) return;
    this.requested = status;
    this.cancellation.abort();
    if (!this.promise) {
      this.settled = true;
      this.promise = Promise.resolve({ status, completedSteps: 0 });
    }
  }

  private validate(step: ChoreographyStep): void {
    assertLive(this.actor);
    if (!step || typeof step !== 'object') throw new Error('Invalid choreography step.');
    switch (step.kind) {
      case 'move':
      case 'walk': {
        validateOptions(step.options, step.kind === 'move' ? ['speed'] : ['speed', 'locomotion', 'faceMovement']);
        assertFinite(step.x, 'Movement x');
        assertFinite(step.y, 'Movement y');
        const speed = step.options?.speed === undefined ? 120 : step.options.speed;
        assertFinite(speed, 'Movement speed');
        if (speed <= 0) throw new Error('Movement speed must be positive.');
        if (step.kind === 'walk') {
          if (step.options?.faceMovement !== undefined && typeof step.options.faceMovement !== 'boolean')
            throw new Error('faceMovement must be a boolean.');
          const mapping = step.options?.locomotion ?? this.actor.locomotion;
          if (!mapping) throw new Error('walkTo requires a locomotion mapping.');
          validateOptions(mapping, ['walk', 'idle', 'fadeDuration']);
          for (const name of [mapping.walk, mapping.idle]) this.validateAnimation(name);
          nonnegative(mapping.fadeDuration === undefined ? 0 : mapping.fadeDuration, 'Locomotion fade duration');
        }
        break;
      }
      case 'lookAt': {
        if (step.target instanceof Actor) {
          assertLive(step.target);
        }
        // Validate current transforms too; execution samples the target again.
        const position = step.target instanceof Actor ? step.target.worldPosition : step.target;
        if (!position) throw new Error('Missing look target.');
        assertFinite(position.x, 'Look target x');
        assertFinite(position.y, 'Look target y');
        break;
      }
      case 'face':
        if (step.facing !== 'left' && step.facing !== 'right') throw new Error('Invalid facing direction.');
        break;
      case 'animation':
        // Enforce the finite, fresh base-channel contract for untyped callers as well.
        validateOptions(step.options, ['speed', 'fadeDuration']);
        this.validateAnimation(step.name);
        nonnegative(step.options?.speed === undefined ? 1 : step.options.speed, 'Animation speed');
        nonnegative(step.options?.fadeDuration === undefined ? 0 : step.options.fadeDuration, 'Fade duration');
        break;
      case 'wait':
        nonnegative(step.duration, 'Wait duration');
        break;
      case 'cue':
        if (typeof step.callback !== 'function') throw new Error('Cue must be a synchronous function.');
        break;
      default:
        throw new Error('Unsupported choreography action.');
    }
  }

  private validateAnimation(name: string): void {
    if (typeof name !== 'string' || !name.trim() || !this.actor.puppet.hasAnimation(name))
      throw new Error(`Unknown animation "${name}".`);
  }

  private async execute(): Promise<void> {
    let unsubscribeDispose: (() => void) | undefined;
    let result: ChoreographyResult;
    let stepResult: ChoreographyActionResult | undefined;
    try {
      if (!(this.actor instanceof Actor)) throw new Error('ChoreographySequence requires an Actor.');
      assertLive(this.actor);
      // Preflight every instruction before allowing any visible side effects.
      for (const [index, step] of this.steps.entries()) {
        this.stepIndex = index;
        this.validate(step);
      }
      this.stepIndex = undefined;
      const onDispose = (): void => this.requestStop('disposed');
      this.actor.disposalSignal.addEventListener('abort', onDispose, { once: true });
      unsubscribeDispose = () => this.actor.disposalSignal.removeEventListener('abort', onDispose);
      for (const [index, step] of this.steps.entries()) {
        if (this.requested) break;
        this.stepIndex = index;
        this.validate(step); // Actors/targets can be disposed and transforms changed between steps.
        stepResult = await this.executeStep(step);
        if (this.requested || (stepResult && stepResult.status !== 'completed')) break;
        this.completedSteps++;
      }
      const status = this.requested ?? (stepResult ? this.outcome(stepResult) : 'completed');
      result = { status, ...this.progress(status), ...(stepResult && { stepResult }) };
    } catch (error) {
      result =
        error instanceof DisposedTargetError
          ? { status: 'disposed', ...this.progress('disposed') }
          : { status: 'failed', error, ...this.progress('failed') };
    } finally {
      unsubscribeDispose?.();
    }
    this.settled = true;
    this.resolve!(Object.freeze(result));
    this.resolve = undefined;
  }

  private progress(status: ChoreographyOutcome): SequenceProgress {
    return {
      completedSteps: this.completedSteps,
      ...(status !== 'completed' && this.stepIndex !== undefined && { stepIndex: this.stepIndex }),
    };
  }

  private outcome(result: ChoreographyActionResult): Exclude<ChoreographyOutcome, 'failed'> {
    return result.status === 'stopped' ? 'interrupted' : result.status;
  }

  private async executeStep(step: ChoreographyStep): Promise<ChoreographyActionResult | undefined> {
    const signal = this.cancellation.signal;
    switch (step.kind) {
      case 'move':
        return this.actor.moveTo(step.x, step.y, { ...step.options, signal });
      case 'walk':
        return this.actor.walkTo(step.x, step.y, { ...step.options, signal });
      case 'lookAt':
        this.actor.lookAt(step.target);
        break;
      case 'face':
        this.actor.setFacing(step.facing);
        break;
      case 'animation':
        return this.actor.puppet.playAndWait(step.name, {
          ...step.options,
          loop: false,
          restart: true,
          stopOnAbort: true,
          signal,
        });
      case 'wait':
        await this.waitForDuration(step.duration);
        break;
      case 'cue': {
        const returned: unknown = step.callback(this.actor);
        if (returned !== undefined) {
          // Defensively observe an accidentally returned promise to avoid unhandled rejections.
          void Promise.resolve(returned).catch(() => {});
          throw new Error('Choreography cues must be synchronous and return undefined.');
        }
        break;
      }
    }
  }

  private async waitForDuration(duration: number): Promise<void> {
    const signal = this.cancellation.signal;
    if (duration === 0 || signal.aborted) return;
    return new Promise((resolve) => {
      let elapsed = 0;
      const finish = (): void => {
        unsubscribe();
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const unsubscribe = this.actor.puppet.onUpdate((delta) => {
        if (signal.aborted) return;
        elapsed += delta;
        if (elapsed >= duration) finish();
      });
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
