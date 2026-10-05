import { type AnimationClip, compileClip, type Keyframe, type PropertyKeyframe } from '../../engine/AnimationClip.js';
import { AnimationPlayer } from '../../engine/AnimationPlayer.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip } from '../../engine/externalData.js';
import { Joint } from '../../engine/Joint.js';
import type { Rig } from '../../engine/Rig.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import { identifierSchema } from '../../engine/schemas.js';
import { assertFinite, type TransformProperty, transformProperties } from '../../engine/types.js';

type AnimationData = DeepReadonly<AnimationClip>;

/** One nanosecond expressed in the external format's milliseconds; never an FPS snap. */
export const KEYFRAME_TIME_TOLERANCE_MS = 1e-6;

export function keyframeTimesMatch(time: number, other: number): boolean {
  return Number.isFinite(time) && Number.isFinite(other) && Math.abs(time - other) <= KEYFRAME_TIME_TOLERANCE_MS;
}

/** Choose the nearest matching row, breaking ties in stored order. Property queries ignore unkeyed rows. */
function matchingRow(keys: readonly Keyframe[], time: number, property?: TransformProperty): number {
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

export function findBonePropertyKeyframe(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): PropertyKeyframe | undefined {
  if (!transformProperties.includes(property)) return undefined;
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  const key = keys[matchingRow(keys, timeMs, property)];
  const value = key?.[property];
  return key && value !== undefined ? { time: key.time, value } : undefined;
}

export function hasKeyframeAtTime(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): boolean {
  return findBonePropertyKeyframe(animation, boneId, property, timeMs) !== undefined;
}

export function getKeyedPropertiesAtTime(
  animation: AnimationData,
  boneId: string,
  timeMs: number,
): TransformProperty[] {
  return transformProperties.filter((property) => hasKeyframeAtTime(animation, boneId, property, timeMs));
}

function assertTarget(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): number {
  identifierSchema.parse(boneId);
  rig.getBone(boneId);
  if (!transformProperties.includes(property)) throw new Error(`Unknown transform property "${property}".`);
  assertFinite(timeMs, 'Keyframe time');
  if (
    (timeMs < 0 && !keyframeTimesMatch(timeMs, 0)) ||
    (timeMs > animation.duration && !keyframeTimesMatch(timeMs, animation.duration))
  )
    throw new Error('Keyframe time must stay within the animation duration.');
  return Math.max(0, Math.min(timeMs, animation.duration));
}

function validate(animation: AnimationData, rig: Rig): void {
  // Use the file validator, including JSON event data and any supplied version.
  parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...animation }, rig);
}

/** Persistent authored edit in milliseconds: update a property row or merge into/create a sparse row.
 * Inputs are never mutated or frozen. Unchanged branches are shared; state owns/freeze-copies the result.
 */
export function setBonePropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
  value: number,
): Animation {
  timeMs = assertTarget(animation, rig, boneId, property, timeMs);
  assertFinite(value, `Keyframe ${boneId}.${property}`);
  validate(animation, rig);
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  const propertyIndex = matchingRow(keys, timeMs, property);
  const index = propertyIndex >= 0 ? propertyIndex : matchingRow(keys, timeMs);
  if (index >= 0 && keys[index]![property] === value) return animation;
  const nextKeys = [...keys];
  if (index >= 0) nextKeys[index] = { ...keys[index]!, [property]: value };
  else nextKeys.push({ time: timeMs, [property]: value });
  nextKeys.sort((a, b) => a.time - b.time);
  const next = { ...animation, tracks: { ...animation.tracks, [boneId]: nextKeys } };
  validate(next, rig);
  return next;
}

/** Remove only this property; drop the row/track only when no authored transform values remain. */
export function removeBonePropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): Animation {
  timeMs = assertTarget(animation, rig, boneId, property, timeMs);
  validate(animation, rig);
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  const index = matchingRow(keys, timeMs, property);
  if (index < 0) return animation;
  const row = { ...keys[index]! };
  delete row[property];
  const nextKeys = [...keys];
  if (transformProperties.some((entry) => row[entry] !== undefined)) nextKeys[index] = row;
  else nextKeys.splice(index, 1);
  const tracks = { ...animation.tracks };
  if (nextKeys.length) tracks[boneId] = nextKeys;
  else delete tracks[boneId];
  const next = { ...animation, tracks };
  validate(next, rig);
  return next;
}

/** Sample an absolute local value using the same event-free, nonlooping player as the preview.
 * Unkeyed properties fall back to the rig bind pose. No evaluated pose is retained or authored.
 */
export function getEvaluatedBonePropertyValue(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): number {
  timeMs = assertTarget(animation, rig, boneId, property, timeMs);
  validate(animation, rig);
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(rig, joints, [compileClip({ ...animation, loop: false, events: [] }, rig)]);
  try {
    player.play(animation.name);
    player.pause();
    player.sample(timeMs, { mode: 'playback' });
    return joints.get(boneId)!.pose[property];
  } finally {
    player.dispose();
  }
}
