import {
  compileValidatedClip,
  advanceAnimationTime,
  AnimationEventBudget,
  collectAnimationEvents,
  type CompiledClip,
} from '../../engine/core.js';
import type { Rig } from '../../engine/data.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import { toMilliseconds, type Milliseconds, type Seconds } from './timeUnits.js';
import { getValidatedEditorAnimation } from './validatedAnimation.js';

const clips = new WeakMap<ReadonlyAnimation, WeakMap<Rig, CompiledClip>>();

/** Event-only projection of validated working data. Pose sampling remains a separate, silent consumer. */
export function getEditorEventClip(animation: ReadonlyAnimation, rig: Rig, loop: boolean): CompiledClip {
  let rigs = clips.get(animation);
  let clip = rigs?.get(rig);
  if (!clip) {
    const source = getValidatedEditorAnimation(animation, rig);
    clip = compileValidatedClip({ ...source, tracks: {} });
    // Like pose-preview compilation, only trusted frozen snapshots may bypass validation on reuse.
    if (source === animation) {
      if (!rigs) {
        rigs = new WeakMap();
        clips.set(animation, rigs);
      }
      rigs.set(rig, clip);
    }
  }
  return clip.loop === loop ? clip : { ...clip, loop };
}

/** Preflight runtime crossings before the editor clock changes; never reduce a delta before event traversal. */
export function collectEditorPlaybackEvents(
  clip: CompiledClip,
  previous: Milliseconds,
  delta: Seconds,
  speed: number,
  listeners = 1,
) {
  const start = previous;
  // Clamp non-looping updates before unit conversion to retain safe endpoint behavior for huge finite deltas.
  const end =
    !clip.loop && delta * speed >= (clip.duration - previous) / 1000
      ? clip.duration
      : advanceAnimationTime({ clip, time: start, speed: 1 }, toMilliseconds(delta), speed);
  new AnimationEventBudget().addCrossings(clip, start, end, listeners);
  return collectAnimationEvents(clip, start, end, 'base');
}
