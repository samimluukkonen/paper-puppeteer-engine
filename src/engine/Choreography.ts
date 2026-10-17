import { Actor } from './Actor.js';
import { ChoreographyConflictError } from './choreographyOwnership.js';
import {
  ChoreographySequence,
  type ChoreographyOutcome,
  type ChoreographyResult,
  type ChoreographyStep,
} from './ChoreographySequence.js';
import {
  assertChoreographyActorLive,
  DisposedChoreographyActorError,
  snapshotChoreographyStep,
  validateChoreographyStep,
} from './choreographySteps.js';
import type { Puppet } from './Puppet.js';

/** Lazy, runtime-only descriptions. No Actor action starts until run() reaches its node. */
export type ChoreographyPlan =
  | { readonly kind: 'actor'; readonly actorId: string; readonly steps: readonly ChoreographyStep[] }
  | { readonly kind: 'sequence' | 'parallel'; readonly children: readonly ChoreographyPlan[] };

interface CoordinationProgress {
  /** Started children, in input order. Sequential children after a failure are absent. */
  readonly children: readonly ChoreographyCoordinationResult[];
  readonly actorId?: string;
  /** Original single-Actor progress and movement/playback outcome for an Actor leaf. */
  readonly sequenceResult?: ChoreographyResult;
}

export type ChoreographyCoordinationResult = CoordinationProgress &
  (
    | { readonly status: 'failed'; readonly error: unknown }
    | { readonly status: Exclude<ChoreographyOutcome, 'failed'> }
  );

type PreparedPlan = (
  | { readonly kind: 'actor'; readonly actorId: string; readonly sequence: ChoreographySequence }
  | { readonly kind: 'sequence' | 'parallel'; readonly children: readonly PreparedPlan[] }
) & { readonly puppets: ReadonlySet<Puppet> };

function validateArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}

function result(
  children: readonly ChoreographyCoordinationResult[],
  cause: { readonly status: ChoreographyOutcome; readonly error?: unknown } = { status: 'completed' },
): ChoreographyCoordinationResult {
  const progress = { children: Object.freeze([...children]) };
  return Object.freeze(
    cause.status === 'failed'
      ? { ...progress, status: 'failed', error: cause.error }
      : { ...progress, status: cause.status },
  );
}

/** One choreography context, Actor registry and single coordinated run. Owns no Actor or clock. */
export class Choreography {
  private readonly actors = new Map<string, Actor>();
  private readonly active = new Set<ChoreographySequence>();
  private promise: Promise<ChoreographyCoordinationResult> | undefined;
  private resolve: ((result: ChoreographyCoordinationResult) => void) | undefined;
  private requested: 'cancelled' | 'disposed' | undefined;
  private failure: ChoreographyCoordinationResult | undefined;
  private settled = false;

  constructor(actors: readonly Actor[] = []) {
    for (const actor of actors) this.register(actor);
  }

  /** IDs are unique within this context. Registration never takes lifecycle ownership. */
  register(actor: Actor): this {
    if (this.promise || this.requested)
      throw new Error('Choreography registration is closed after run or cancellation.');
    if (!(actor instanceof Actor)) throw new Error('Choreography registration requires an Actor.');
    assertChoreographyActorLive(actor);
    if (this.actors.has(actor.id)) throw new Error(`Duplicate choreography Actor ID "${actor.id}".`);
    this.actors.set(actor.id, actor);
    return this;
  }

  getActor(id: string): Actor {
    const actor = this.actors.get(id);
    if (!actor) throw new Error(`Missing choreography Actor "${id}".`);
    assertChoreographyActorLive(actor);
    return actor;
  }

  actor(actorId: string, steps: readonly ChoreographyStep[]): ChoreographyPlan {
    return Object.freeze({ kind: 'actor', actorId, steps: Object.freeze(steps.map(snapshotChoreographyStep)) });
  }

  sequence(children: readonly ChoreographyPlan[]): ChoreographyPlan {
    return Object.freeze({ kind: 'sequence', children: Object.freeze([...children]) });
  }

  parallel(children: readonly ChoreographyPlan[]): ChoreographyPlan {
    return Object.freeze({ kind: 'parallel', children: Object.freeze([...children]) });
  }

  /** Preflight the entire tree before starting any action. Repeated calls return the first run. */
  run(plan: ChoreographyPlan): Promise<ChoreographyCoordinationResult> {
    if (this.promise) return this.promise;
    // Publish before cues/playback callbacks can reenter run().
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
    void this.execute(plan);
    return this.promise;
  }

  cancel(): void {
    this.stop('cancelled');
  }

  /** Cancels this context and releases its registry; registered Actors remain host-owned. */
  dispose(): void {
    this.stop('disposed');
    this.actors.clear();
  }

  private stop(status: 'cancelled' | 'disposed'): void {
    if (this.settled || this.requested) return;
    this.requested = status;
    for (const sequence of this.active) {
      if (status === 'disposed') sequence.dispose();
      else sequence.cancel();
    }
  }

  private prepare(plan: ChoreographyPlan, ancestors = new Set<ChoreographyPlan>()): PreparedPlan {
    if (!plan || typeof plan !== 'object') throw new Error('Invalid choreography plan.');
    if (ancestors.has(plan)) throw new Error('Choreography plans cannot contain cycles.');
    if (plan.kind === 'actor') {
      const actor = this.getActor(plan.actorId);
      validateArray(plan.steps, 'Actor choreography steps');
      // Reuse exactly the validation and snapshots used by the single-Actor runner.
      for (const step of plan.steps) validateChoreographyStep(actor, step);
      return {
        kind: 'actor',
        actorId: actor.id,
        sequence: new ChoreographySequence(actor, plan.steps),
        puppets: new Set([actor.puppet]),
      };
    }
    if (plan.kind !== 'sequence' && plan.kind !== 'parallel') throw new Error('Unsupported choreography group.');
    validateArray(plan.children, 'Choreography children');
    ancestors.add(plan);
    const children = plan.children.map((child) => this.prepare(child, ancestors));
    ancestors.delete(plan);
    const puppets = new Set<Puppet>();
    for (const child of children) {
      for (const puppet of child.puppets) {
        if (plan.kind === 'parallel' && puppets.has(puppet)) {
          const actor = [...this.actors.values()].find((candidate) => candidate.puppet === puppet)!;
          throw new ChoreographyConflictError(actor.id);
        }
        puppets.add(puppet);
      }
    }
    return { kind: plan.kind, children, puppets };
  }

  private halt(cause: ChoreographyCoordinationResult): void {
    if (cause.status === 'completed' || this.failure || this.requested) return;
    this.failure = cause;
    for (const sequence of this.active) sequence.cancel();
  }

  private async executeNode(plan: PreparedPlan): Promise<ChoreographyCoordinationResult> {
    if (this.requested || this.failure) return result([], { status: this.requested ?? 'cancelled' });
    if (plan.kind === 'actor') {
      this.active.add(plan.sequence);
      let sequenceResult: ChoreographyResult;
      try {
        sequenceResult = await plan.sequence.run();
      } finally {
        this.active.delete(plan.sequence);
      }
      const leaf = Object.freeze({
        ...result([], sequenceResult),
        actorId: plan.actorId,
        sequenceResult,
      });
      this.halt(leaf);
      return leaf;
    }
    const children: ChoreographyCoordinationResult[] = [];
    if (plan.kind === 'parallel') {
      children.push(...(await Promise.all(plan.children.map((child) => this.executeNode(child)))));
    } else {
      for (const child of plan.children) {
        if (this.requested || this.failure) break;
        const outcome = await this.executeNode(child);
        children.push(outcome);
        if (outcome.status !== 'completed') break;
      }
    }
    return result(children, this.failure ?? (this.requested ? { status: this.requested } : undefined));
  }

  private async execute(plan: ChoreographyPlan): Promise<void> {
    let outcome: ChoreographyCoordinationResult;
    try {
      outcome = this.requested ? result([], { status: this.requested }) : await this.executeNode(this.prepare(plan));
    } catch (error) {
      // Defensive cleanup also observes all waits if orchestration itself fails unexpectedly.
      const pending = [...this.active].map((sequence) => {
        sequence.cancel();
        return sequence.run();
      });
      await Promise.all(pending);
      outcome = result(
        [],
        error instanceof DisposedChoreographyActorError ? { status: 'disposed' } : { status: 'failed', error },
      );
    }
    if (this.requested && !this.failure) {
      outcome = Object.freeze({
        ...result(outcome.children, { status: this.requested }),
        ...(outcome.actorId !== undefined && { actorId: outcome.actorId }),
        ...(outcome.sequenceResult && { sequenceResult: outcome.sequenceResult }),
      });
    }
    this.settled = true;
    this.resolve!(outcome);
    this.resolve = undefined;
  }
}
