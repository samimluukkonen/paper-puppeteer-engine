import { Actor } from './Actor.js';
import type { ChoreographyStep } from './ChoreographySequence.js';
import { assertFinite } from './types.js';

export class DisposedChoreographyActorError extends Error {}

export function assertChoreographyActorLive(actor: Actor): void {
  if (actor.isDisposed || actor.puppet.isDestroyed || actor.puppet.animationPlayer.isDisposed)
    throw new DisposedChoreographyActorError(`Choreography Actor "${actor.id}" is disposed.`);
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
export function snapshotChoreographyStep(step: ChoreographyStep): ChoreographyStep {
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

export function validateChoreographyStep(actor: Actor, step: ChoreographyStep): void {
  assertChoreographyActorLive(actor);
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
        const mapping = step.options?.locomotion ?? actor.locomotion;
        if (!mapping) throw new Error('walkTo requires a locomotion mapping.');
        validateOptions(mapping, ['walk', 'idle', 'fadeDuration']);
        for (const name of [mapping.walk, mapping.idle]) validateAnimation(actor, name);
        nonnegative(mapping.fadeDuration === undefined ? 0 : mapping.fadeDuration, 'Locomotion fade duration');
      }
      break;
    }
    case 'lookAt': {
      if (step.target instanceof Actor) {
        assertChoreographyActorLive(step.target);
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
      validateOptions(step.options, ['speed', 'fadeDuration', 'rootMotion']);
      if (
        step.options?.rootMotion !== undefined &&
        step.options.rootMotion !== 'ignore' &&
        step.options.rootMotion !== 'apply'
      )
        throw new Error('Invalid root motion policy.');
      validateAnimation(actor, step.name);
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

function validateAnimation(actor: Actor, name: string): void {
  if (typeof name !== 'string' || !name.trim() || !actor.puppet.hasAnimation(name))
    throw new Error(`Unknown animation "${name}".`);
}
