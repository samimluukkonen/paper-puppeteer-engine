import { Actor, type ActorPosition } from './Actor.js';
import type { ActorMoveOptions, ActorMovementResult, ActorWalkOptions } from './ActorMovement.js';
import type { QueueAnimationOptions } from './AnimationQueue.js';
import { claimChoreographyActor } from './choreographyOwnership.js';
import {
  assertChoreographyActorLive,
  DisposedChoreographyActorError,
  snapshotChoreographyStep,
  validateChoreographyStep,
} from './choreographySteps.js';
import type { PlaybackWaitResult } from './PlaybackLifecycle.js';
import type { Facing } from './types.js';

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
    this.steps.push(snapshotChoreographyStep(step));
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
      this.steps.length = 0;
      this.settled = true;
      this.promise = Promise.resolve(Object.freeze({ status, completedSteps: 0 }));
    }
  }

  private async execute(): Promise<void> {
    let releaseOwnership: (() => void) | undefined;
    let unsubscribeDispose: (() => void) | undefined;
    let result: ChoreographyResult;
    let stepResult: ChoreographyActionResult | undefined;
    try {
      if (!(this.actor instanceof Actor)) throw new Error('ChoreographySequence requires an Actor.');
      assertChoreographyActorLive(this.actor);
      // Preflight every instruction before allowing any visible side effects.
      for (const [index, step] of this.steps.entries()) {
        this.stepIndex = index;
        validateChoreographyStep(this.actor, step);
      }
      this.stepIndex = undefined;
      releaseOwnership = claimChoreographyActor(this.actor);
      const onDispose = (): void => this.requestStop('disposed');
      this.actor.disposalSignal.addEventListener('abort', onDispose, { once: true });
      unsubscribeDispose = () => this.actor.disposalSignal.removeEventListener('abort', onDispose);
      for (const [index, step] of this.steps.entries()) {
        if (this.requested) break;
        this.stepIndex = index;
        validateChoreographyStep(this.actor, step); // Actors/targets can be disposed and transforms changed between steps.
        stepResult = await this.executeStep(step);
        if (this.requested || (stepResult && stepResult.status !== 'completed')) break;
        this.completedSteps++;
      }
      const status = this.requested ?? (stepResult ? this.outcome(stepResult) : 'completed');
      result = { status, ...this.progress(status), ...(stepResult && { stepResult }) };
    } catch (error) {
      result =
        error instanceof DisposedChoreographyActorError
          ? { status: 'disposed', ...this.progress('disposed') }
          : { status: 'failed', error, ...this.progress('failed') };
    } finally {
      unsubscribeDispose?.();
      releaseOwnership?.();
      // Completed scripts no longer retain cue closures or look-target Actors.
      this.steps.length = 0;
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
