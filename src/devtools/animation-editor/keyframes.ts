import {
  type AnimationClip,
  type CompiledClip,
  compileClip,
  type Keyframe,
  type PropertyKeyframe,
} from '../../engine/AnimationClip.js';
import { ClipPoseBuffer } from '../../engine/AnimationPose.js';
import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip } from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import { identifierSchema } from '../../engine/schemas.js';
import {
  assertFinite,
  createTransform,
  type JointTransform,
  type TransformProperty,
  transformProperties,
} from '../../engine/types.js';

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

interface IndexedKeyframe extends PropertyKeyframe {
  order: number;
}

const keyframeIndexes = new WeakMap<AnimationData, Map<string, Map<TransformProperty, IndexedKeyframe[]>>>();

function lowerBound(keys: readonly IndexedKeyframe[], time: number): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle]!.time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Immutable editor snapshots share sorted property indexes; caller-owned mutable data stays uncached. */
function indexedKeyframe(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  time: number,
): IndexedKeyframe | undefined | false {
  let tracks = keyframeIndexes.get(animation);
  if (!tracks) {
    if (!isFullyFrozen(animation)) return false;
    tracks = new Map();
    keyframeIndexes.set(animation, tracks);
  }
  let properties = tracks.get(boneId);
  if (!properties) {
    properties = new Map();
    const rows = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
    for (const [order, row] of rows.entries()) {
      for (const entry of transformProperties) {
        const value = row[entry];
        if (value === undefined || !Number.isFinite(row.time)) continue;
        let keys = properties.get(entry);
        if (!keys) {
          keys = [];
          properties.set(entry, keys);
        }
        keys.push({ time: row.time, value, order });
      }
    }
    for (const keys of properties.values()) keys.sort((a, b) => a.time - b.time || a.order - b.order);
    tracks.set(boneId, properties);
  }
  const keys = properties.get(property) ?? [];
  const index = lowerBound(keys, time);
  // A predecessor may be the last of several duplicate times. Preserve the original first-row tie rule.
  const before = index > 0 ? keys[lowerBound(keys, keys[index - 1]!.time)] : undefined;
  const after = keys[index];
  let match: IndexedKeyframe | undefined;
  for (const key of [before, after]) {
    if (!key || !keyframeTimesMatch(key.time, time)) continue;
    if (
      !match ||
      Math.abs(key.time - time) < Math.abs(match.time - time) ||
      (Math.abs(key.time - time) === Math.abs(match.time - time) && key.order < match.order)
    )
      match = key;
  }
  return match;
}

export function findBonePropertyKeyframe(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): PropertyKeyframe | undefined {
  if (!transformProperties.includes(property) || !Number.isFinite(timeMs)) return undefined;
  const indexed = indexedKeyframe(animation, boneId, property, timeMs);
  if (indexed !== false) return indexed ? { time: indexed.time, value: indexed.value } : undefined;
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

/** Reuses the runtime pose buffer and playback quantization without clocks, events, or IK. */
class AnimationValueSampler {
  private readonly clip: CompiledClip;
  private readonly buffer = new ClipPoseBuffer();
  private sampledTime: number | undefined;
  private pose: ReturnType<ClipPoseBuffer['evaluate']> | undefined;

  constructor(
    animation: AnimationData,
    private readonly rig: Rig,
  ) {
    const parsed = parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...animation }, rig);
    this.clip = compileClip({ ...parsed, loop: false, events: [] }, rig);
  }

  sample(boneId: string, timeMs: number): JointTransform {
    const time =
      timeMs === this.clip.duration ? timeMs : quantizePlaybackTime(timeMs, this.clip.playback ?? { mode: 'smooth' });
    // Repeated property queries at the same playback frame share one pose evaluation.
    if (time !== this.sampledTime) {
      this.pose = this.buffer.evaluate(this.clip, time);
      this.sampledTime = time;
    }
    return { ...createTransform(this.rig.getBone(boneId)), ...this.pose?.get(boneId) };
  }
}

const valueSamplers = new WeakMap<AnimationData, WeakMap<Rig, AnimationValueSampler>>();

/** Readonly types or a shallow freeze alone do not prevent edits to nested caller data. */
function isFullyFrozen(animation: AnimationData): boolean {
  const pending: object[] = [animation];
  const seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop()!;
    if (seen.has(value)) continue;
    seen.add(value);
    if (!Object.isFrozen(value)) return false;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      // Frozen getters can still expose changing values; do not invoke them while checking ownership.
      if (!Object.hasOwn(descriptor, 'value')) return false;
      const child: unknown = descriptor.value;
      if (child !== null && typeof child === 'object') pending.push(child);
    }
  }
  return true;
}

function valueSampler(animation: AnimationData, rig: Rig): AnimationValueSampler {
  const cached = valueSamplers.get(animation)?.get(rig);
  if (cached) return cached;
  // Validate before inspecting nested data for cache eligibility. Mutable inputs remain fresh on every call.
  const sampler = new AnimationValueSampler(animation, rig);
  if (isFullyFrozen(animation)) {
    let rigs = valueSamplers.get(animation);
    if (!rigs) {
      rigs = new WeakMap();
      valueSamplers.set(animation, rigs);
    }
    rigs.set(rig, sampler);
  }
  return sampler;
}

/** Sample all absolute local properties together; returned values cannot mutate the cached pose. */
export function getEvaluatedBoneTransform(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  timeMs: number,
): JointTransform {
  timeMs = assertTarget(animation, rig, boneId, undefined, timeMs);
  return valueSampler(animation, rig).sample(boneId, timeMs);
}

/** Unkeyed properties use the rig bind pose. Fully frozen snapshots share compilation and evaluation. */
export function getEvaluatedBonePropertyValue(
  animation: AnimationData,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): number {
  timeMs = assertTarget(animation, rig, boneId, property, timeMs);
  return valueSampler(animation, rig).sample(boneId, timeMs)[property];
}
