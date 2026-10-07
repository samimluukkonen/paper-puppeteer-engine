import {
  type AnimationClip,
  type CompiledClip,
  type Keyframe,
  type PropertyKeyframe,
} from '../../engine/AnimationClip.js';
import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { ClipPoseBuffer } from '../../engine/AnimationPose.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { identifierSchema } from '../../engine/schemas.js';
import {
  assertFinite,
  createTransform,
  type JointTransform,
  type TransformProperty,
  transformProperties,
} from '../../engine/types.js';
import { isFullyFrozen } from '../shared/editorData.js';
import { getCompiledPreviewClip } from './previewClip.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

type AnimationData = DeepReadonly<AnimationClip>;

/** Authored presence anywhere in a track, independent of the playhead and evaluated pose. */
export function getAuthoredBoneProperties(animation: AnimationData, boneId: string): TransformProperty[] {
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  return transformProperties.filter((property) => keys.some((key) => key[property] !== undefined));
}

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
function propertyIndexes(animation: AnimationData, boneId: string): Map<TransformProperty, IndexedKeyframe[]> | false {
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
  return properties;
}

function indexedKeyframe(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  time: number,
): IndexedKeyframe | undefined | false {
  const properties = propertyIndexes(animation, boneId);
  if (properties === false) return false;
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

/** Find a strictly previous/next property key, skipping every time within the shared tolerance. */
export function findAdjacentBonePropertyKeyframe(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
  direction: -1 | 1,
): PropertyKeyframe | undefined {
  if (!transformProperties.includes(property) || !Number.isFinite(timeMs)) return undefined;
  const properties = propertyIndexes(animation, boneId);
  if (properties !== false) {
    const keys = properties.get(property) ?? [];
    let low = 0;
    let high = keys.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const time = keys[middle]!.time;
      const before =
        direction === 1
          ? time <= timeMs || keyframeTimesMatch(time, timeMs)
          : time < timeMs && !keyframeTimesMatch(time, timeMs);
      if (before) low = middle + 1;
      else high = middle;
    }
    const key = keys[direction === 1 ? low : low - 1];
    return key ? { time: key.time, value: key.value } : undefined;
  }
  // Mutable authored tracks stay fresh and retain their stored order without copying arrays.
  const rows = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  for (let index = direction === 1 ? 0 : rows.length - 1; index >= 0 && index < rows.length; index += direction) {
    const row = rows[index]!;
    const value = row[property];
    if (value !== undefined && direction * (row.time - timeMs) > 0 && !keyframeTimesMatch(row.time, timeMs))
      return { time: row.time, value };
  }
  return undefined;
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

/** Persistent authored edit in milliseconds: update a property row or merge into/create a sparse row.
 * Inputs are never mutated or frozen. New branches inherit immutable source ownership; unchanged branches are shared.
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
  getValidatedEditorAnimation(animation, rig);
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  const propertyIndex = matchingRow(keys, timeMs, property);
  const index = propertyIndex >= 0 ? propertyIndex : matchingRow(keys, timeMs);
  if (index >= 0 && keys[index]![property] === value) return animation;
  const nextKeys = [...keys];
  if (index >= 0) nextKeys[index] = { ...keys[index]!, [property]: value };
  else nextKeys.push({ time: timeMs, [property]: value });
  nextKeys.sort((a, b) => a.time - b.time);
  const next = { ...animation, tracks: { ...animation.tracks, [boneId]: nextKeys } };
  return validateEditedAnimation(next, animation, rig);
}

/** Remove only this property; drop the row/track only when no authored transform values remain. */
export function removeBonePropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: number,
): Animation {
  return removeBonePropertyKeyframes(animation, rig, [{ boneId, property, timeMs }]);
}

export interface PropertyKeyframeTarget {
  readonly boneId: string;
  readonly property: TransformProperty;
  /** Milliseconds, matching authored keyframe times. */
  readonly timeMs: number;
}

export interface PropertyKeyframeEdit extends PropertyKeyframeTarget {
  readonly value: number;
}

/** Shared move/paste replacement: remove all tolerant property matches, retaining sparse siblings. */
function replacePropertyAtTime(
  keys: readonly Keyframe[],
  property: TransformProperty,
  time: number,
  value: number,
  source = -1,
): Keyframe[] {
  const nextKeys: Keyframe[] = [];
  for (const [index, key] of keys.entries()) {
    if (index !== source && !(key[property] !== undefined && keyframeTimesMatch(key.time, time))) {
      nextKeys.push(key);
      continue;
    }
    const row = { ...key };
    delete row[property];
    if (transformProperties.some((entry) => row[entry] !== undefined)) nextKeys.push(row);
  }
  // Nearby sibling properties must not shift the inserted property's time.
  const row = nextKeys.findIndex((key) => key.time === time);
  if (row >= 0) nextKeys[row] = { ...nextKeys[row]!, [property]: value };
  else nextKeys.push({ time, [property]: value });
  nextKeys.sort((a, b) => a.time - b.time);
  return nextKeys;
}

/** Atomically validate a group, preserve move collision semantics, and optionally extend authored duration. */
export function setBonePropertyKeyframes<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  edits: readonly PropertyKeyframeEdit[],
  options: { extendDuration?: boolean } = {},
): Animation {
  getValidatedEditorAnimation(animation, rig);
  if (!edits.length) return animation;
  let duration = animation.duration;
  for (const edit of edits) {
    assertFinite(edit.timeMs, 'Keyframe time');
    assertFinite(edit.value, `Keyframe ${edit.boneId}.${edit.property}`);
    if (options.extendDuration) duration = Math.max(duration, edit.timeMs);
  }
  const target = duration === animation.duration ? animation : { ...animation, duration };
  const normalized = edits.map((edit) => ({
    ...edit,
    timeMs: assertTarget(target, rig, edit.boneId, edit.property, edit.timeMs),
  }));
  const tracks = { ...animation.tracks };
  for (const { boneId, property, timeMs, value } of normalized) {
    const keys = Object.hasOwn(tracks, boneId) ? tracks[boneId]! : [];
    const destination = matchingRow(keys, timeMs, property);
    const time = destination >= 0 ? keys[destination]!.time : timeMs;
    tracks[boneId] = replacePropertyAtTime(keys, property, time, value);
  }
  return validateEditedAnimation({ ...animation, duration, tracks }, animation, rig);
}

/** Resolve against the original snapshot, copy each changed track once, then validate the whole batch. */
export function removeBonePropertyKeyframes<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  targets: readonly PropertyKeyframeTarget[],
): Animation {
  const normalized = targets.map((target) => ({
    ...target,
    timeMs: assertTarget(animation, rig, target.boneId, target.property, target.timeMs),
  }));
  getValidatedEditorAnimation(animation, rig);
  const removals = new Map<string, Map<number, Set<TransformProperty>>>();
  for (const { boneId, property, timeMs } of normalized) {
    const key = findBonePropertyKeyframe(animation, boneId, property, timeMs);
    if (!key) continue;
    let rows = removals.get(boneId);
    if (!rows) {
      rows = new Map();
      removals.set(boneId, rows);
    }
    let properties = rows.get(key.time);
    if (!properties) {
      properties = new Set();
      rows.set(key.time, properties);
    }
    properties.add(property);
  }
  if (!removals.size) return animation;
  const tracks = { ...animation.tracks };
  for (const [boneId, removalsByTime] of removals) {
    const nextKeys = animation.tracks[boneId]!.flatMap((key) => {
      const properties = removalsByTime.get(key.time);
      if (!properties) return [key];
      const row = { ...key };
      for (const property of properties) delete row[property];
      return transformProperties.some((property) => row[property] !== undefined) ? [row] : [];
    });
    if (nextKeys.length) tracks[boneId] = nextKeys;
    else delete tracks[boneId];
  }
  const next = { ...animation, tracks };
  return validateEditedAnimation(next, animation, rig);
}

/** Move time only (milliseconds), replacing all destination matches on this property.
 * Sparse-row siblings retain their original times. Interpolation is clip-level and stays unchanged.
 */
export function moveBonePropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  fromTime: number,
  toTime: number,
): Animation {
  fromTime = assertTarget(animation, rig, boneId, property, fromTime);
  assertFinite(toTime, 'Keyframe destination');
  toTime = Math.max(0, Math.min(toTime, animation.duration));
  getValidatedEditorAnimation(animation, rig);
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  const source = matchingRow(keys, fromTime, property);
  const destination = matchingRow(keys, toTime, property);
  if (source < 0 || destination === source) return animation;
  const value = keys[source]![property]!;
  // Retain the existing canonical row time on collision, like the setter's tolerance policy.
  const destinationTime = destination >= 0 ? keys[destination]!.time : toTime;
  const nextKeys = replacePropertyAtTime(keys, property, destinationTime, value, source);
  const next = { ...animation, tracks: { ...animation.tracks, [boneId]: nextKeys } };
  return validateEditedAnimation(next, animation, rig);
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
    this.clip = getCompiledPreviewClip(animation, rig);
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
