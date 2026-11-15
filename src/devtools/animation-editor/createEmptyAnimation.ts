import { ANIMATION_FORMAT_VERSION, AnimationValidationError } from '../../engine/core.js';
import type { Rig } from '../../engine/data.js';
import { AUTHORED_FPS_MAX, AUTHORED_FPS_MIN } from './AnimationEditorPlaybackCommands.js';
import { inspectEditorAnimation, type ReadonlyAnimation } from './validatedAnimation.js';

export interface NewAnimationOptions {
  /** The version-1 name is also the stable workspace/runtime identifier. */
  name: string;
  durationSeconds?: number;
  fps?: number;
  loop?: boolean;
}

/** Create ordinary version-1 authored data; no sampling, cloning or implicit bone/IK keys. */
export function createEmptyAnimation(rig: Rig | undefined, options: NewAnimationOptions): ReadonlyAnimation {
  if (!rig) throw new Error('Load a valid character rig before creating an animation.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.name))
    throw new Error('Animation name / ID must start with a letter or number and use only letters, numbers, - or _.');
  const fps = options.fps ?? 12;
  if (!Number.isFinite(fps) || fps < AUTHORED_FPS_MIN || fps > AUTHORED_FPS_MAX)
    throw new Error(`Animation FPS must be a finite number from ${AUTHORED_FPS_MIN} to ${AUTHORED_FPS_MAX}.`);
  const result = inspectEditorAnimation(
    {
      version: ANIMATION_FORMAT_VERSION,
      name: options.name,
      duration: (options.durationSeconds ?? 1) * 1000,
      loop: options.loop ?? true,
      playback: { mode: 'stepped', fps },
      tracks: {},
      events: [],
    },
    rig,
  );
  if (!result.data) throw new AnimationValidationError(result.issues);
  return result.data;
}
