import type { AnimationClip } from '../../engine/AnimationClip.js';
import { normalizeKeyframeTime } from '../../engine/keyframeAuthoring.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { identifierSchema } from '../../engine/schemas.js';
import { type TransformProperty, transformProperties } from '../../engine/types.js';
import { type Milliseconds } from './timeUnits.js';

export type AnimationData = DeepReadonly<AnimationClip>;

export { KEYFRAME_TIME_TOLERANCE_MS, keyframeTimesMatch, matchingRow } from '../../engine/keyframeAuthoring.js';

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
