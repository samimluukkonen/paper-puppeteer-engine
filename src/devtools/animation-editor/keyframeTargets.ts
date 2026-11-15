import {
  normalizeKeyframeTime,
  identifierSchema,
  transformProperties,
  type TransformProperty,
} from '../../engine/core.js';
import type { AnimationClip, DeepReadonly, Rig } from '../../engine/data.js';
import { type Milliseconds } from './timeUnits.js';

export type AnimationData = DeepReadonly<AnimationClip>;

export { KEYFRAME_TIME_TOLERANCE_MS, keyframeTimesMatch, matchingRow } from '../../engine/core.js';

export function assertTarget(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  property: TransformProperty | undefined,
  timeMs: Milliseconds,
): Milliseconds {
  identifierSchema.parse(boneId);
  rig.getBone(boneId);
  if (property !== undefined && !transformProperties.includes(property))
    throw new Error(`Unknown transform property "${property}".`);
  return normalizeKeyframeTime(animation.duration, timeMs);
}
