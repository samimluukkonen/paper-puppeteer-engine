import type { AnimationClip } from '../../engine/AnimationClip.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip } from '../../engine/externalData.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { freezeData, isFullyFrozen } from '../shared/editorData.js';

type AnimationData = DeepReadonly<AnimationClip>;
const validated = new WeakMap<AnimationData, WeakSet<Rig>>();

/** Reuse validation only after checking both the file and its deep immutability against this rig. */
export function getValidatedEditorAnimation(animation: AnimationData, rig: Rig): AnimationData {
  if (validated.get(animation)?.has(rig)) return animation;
  const parsed = parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...animation }, rig);
  if (isFullyFrozen(animation)) {
    let rigs = validated.get(animation);
    if (!rigs) {
      rigs = new WeakSet();
      validated.set(animation, rigs);
    }
    rigs.add(rig);
    return animation;
  }
  return parsed;
}

/** New edit branches are owned; shared branches may only be frozen when the source already is immutable. */
export function validateEditedAnimation<Animation extends AnimationData>(
  next: Animation,
  source: AnimationData,
  rig: Rig,
): Animation {
  if (validated.get(source)?.has(rig)) freezeData(next);
  getValidatedEditorAnimation(next, rig);
  return next;
}
