import type { AnimationClip, Keyframe } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { identifierSchema } from '../../engine/schemas.js';
import { assertFinite, type TransformProperty, transformProperties } from '../../engine/types.js';

export type AnimationData = DeepReadonly<AnimationClip>;

/** One nanosecond expressed in the external format's milliseconds; never an FPS snap. */
export const KEYFRAME_TIME_TOLERANCE_MS = 1e-6;

export function keyframeTimesMatch(time: number, other: number): boolean {
  return Number.isFinite(time) && Number.isFinite(other) && Math.abs(time - other) <= KEYFRAME_TIME_TOLERANCE_MS;
}

/** Choose the nearest matching row, breaking ties in stored order. Property queries ignore unkeyed rows. */
export function matchingRow(keys: readonly Keyframe[], time: number, property?: TransformProperty): number {
  let match = -1;
  let distance = Infinity;
  for (const [index, key] of keys.entries()) {
    if (property !== undefined && key[property] === undefined) continue;
    const nextDistance = Math.abs(key.time - time);
    if (keyframeTimesMatch(key.time, time) && nextDistance < distance) {
      match = index;
      distance = nextDistance;
    }
  }
  return match;
}

export function assertTarget(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  property: TransformProperty | undefined,
  timeMs: number,
): number {
  identifierSchema.parse(boneId);
  rig.getBone(boneId);
  if (property !== undefined && !transformProperties.includes(property))
    throw new Error(`Unknown transform property "${property}".`);
  assertFinite(timeMs, 'Keyframe time');
  if (
    (timeMs < 0 && !keyframeTimesMatch(timeMs, 0)) ||
    (timeMs > animation.duration && !keyframeTimesMatch(timeMs, animation.duration))
  )
    throw new Error('Keyframe time must stay within the animation duration.');
  return Math.max(0, Math.min(timeMs, animation.duration));
}
