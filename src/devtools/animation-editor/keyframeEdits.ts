import type { Keyframe } from '../../engine/AnimationClip.js';
import type { Rig } from '../../engine/Rig.js';
import { assertFinite, type TransformProperty, transformProperties } from '../../engine/types.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import {
  type AnimationData,
  assertTarget,
  KEYFRAME_TIME_TOLERANCE_MS,
  keyframeTimesMatch,
  matchingRow,
} from './keyframeTargets.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

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

/** Index nearby rows while editing one track; publish and sort its array only once. */
function setTrackPropertyKeyframes(
  keys: readonly Keyframe[],
  edits: readonly PropertyKeyframeEdit[],
  preserveTiming = false,
): Keyframe[] {
  const rows = new Map<number, Keyframe>();
  const buckets = new Map<number, Set<number>>();
  const bucketOf = (time: number): number => Math.floor(time / (2 * KEYFRAME_TIME_TOLERANCE_MS));
  const add = (key: Keyframe): void => {
    rows.set(key.time, key);
    const bucket = bucketOf(key.time);
    let times = buckets.get(bucket);
    if (!times) {
      times = new Set();
      buckets.set(bucket, times);
    }
    times.add(key.time);
  };
  const remove = (time: number): void => {
    rows.delete(time);
    const bucket = bucketOf(time);
    const times = buckets.get(bucket)!;
    times.delete(time);
    if (!times.size) buckets.delete(bucket);
  };
  for (const key of keys) add(key);
  const matches = (time: number, property: TransformProperty): Keyframe[] => {
    const bucket = bucketOf(time);
    const found: Keyframe[] = [];
    // Deduplicate neighboring buckets when large timestamps round to the same number.
    for (const nearby of new Set([bucket - 1, bucket, bucket + 1])) {
      for (const candidate of buckets.get(nearby) ?? []) {
        const row = rows.get(candidate)!;
        if (row[property] !== undefined && keyframeTimesMatch(candidate, time)) found.push(row);
      }
    }
    return found;
  };
  const insertions: Pick<PropertyKeyframeEdit, 'property' | 'timeMs' | 'value'>[] = [];
  for (const { property, timeMs, value } of edits) {
    let time = timeMs;
    let distance = Infinity;
    for (const row of preserveTiming ? [] : matches(timeMs, property)) {
      const nextDistance = Math.abs(row.time - timeMs);
      if (nextDistance < distance || (nextDistance === distance && row.time < time)) {
        time = row.time;
        distance = nextDistance;
      }
    }
    // Collision removal is centered on the canonical destination, including matches
    // outside the original query's tolerance. Other properties retain their times.
    for (const key of matches(time, property)) {
      const row = { ...key };
      delete row[property];
      if (transformProperties.some((entry) => row[entry] !== undefined)) rows.set(row.time, row);
      else remove(row.time);
    }
    if (preserveTiming) insertions.push({ property, timeMs: time, value });
    else add({ ...rows.get(time), time, [property]: value });
  }
  // Group members never collide with each other. Replace external matches first,
  // then insert every translated time exactly, including distinct nearby keys.
  for (const { property, timeMs: time, value } of insertions) add({ ...rows.get(time), time, [property]: value });
  return [...rows.values()].sort((a, b) => a.time - b.time);
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
  const groups = new Map<string, PropertyKeyframeEdit[]>();
  for (const edit of normalized) {
    const group = groups.get(edit.boneId) ?? [];
    group.push(edit);
    groups.set(edit.boneId, group);
  }
  for (const [boneId, group] of groups) {
    const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
    tracks[boneId] = setTrackPropertyKeyframes(keys, group);
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

/** Constrain one delta using the group's extrema. All arguments use the same time unit. */
export function constrainKeyframeMoveDelta(times: readonly number[], delta: number, duration: number): number {
  assertFinite(delta, 'Keyframe delta');
  assertFinite(duration, 'Animation duration');
  let earliest = duration;
  let latest = 0;
  for (const time of times) {
    assertFinite(time, 'Keyframe time');
    earliest = Math.min(earliest, time);
    latest = Math.max(latest, time);
  }
  return times.length ? Math.max(-earliest, Math.min(delta, duration - latest)) : 0;
}

export interface PropertyKeyframeMove<Animation extends AnimationData> {
  readonly animation: Animation;
  readonly keys: readonly PropertyKeyframeTarget[];
}

/** Atomic time-only translation in milliseconds. Resolve/remove the entire source group
 * before replacing external property collisions. Group destinations retain exact translated
 * times rather than canonicalizing each collision independently and distorting spacing.
 * A single key retains the established canonical destination-time behavior.
 */
export function moveBonePropertyKeyframes<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  targets: readonly PropertyKeyframeTarget[],
  deltaMs: number,
): PropertyKeyframeMove<Animation> {
  getValidatedEditorAnimation(animation, rig);
  assertFinite(deltaMs, 'Keyframe delta');
  const sources = new Map<string, PropertyKeyframeEdit>();
  for (const target of targets) {
    assertTarget(animation, rig, target.boneId, target.property, target.timeMs);
    const key = findBonePropertyKeyframe(animation, target.boneId, target.property, target.timeMs);
    if (!key) throw new Error('Cannot move a missing keyframe.');
    const source = { ...target, timeMs: key.time, value: key.value };
    sources.set(JSON.stringify([source.boneId, source.property, source.timeMs]), source);
  }
  const keys = [...sources.values()];
  const delta = constrainKeyframeMoveDelta(
    keys.map((key) => key.timeMs),
    deltaMs,
    animation.duration,
  );
  if (!keys.length || delta === 0) return { animation, keys };
  if (keys.length === 1) {
    const key = keys[0]!;
    const next = moveBonePropertyKeyframe(animation, rig, key.boneId, key.property, key.timeMs, key.timeMs + delta);
    const moved = findBonePropertyKeyframe(
      next,
      key.boneId,
      key.property,
      next === animation ? key.timeMs : key.timeMs + delta,
    )!;
    return { animation: next, keys: [{ ...key, timeMs: moved.time }] };
  }
  const destinations = keys.map((key) => ({ ...key, timeMs: key.timeMs + delta }));
  // Validate every destination before building any result. Never clamp members independently.
  const identities = new Set<string>();
  for (const key of destinations) {
    assertTarget(animation, rig, key.boneId, key.property, key.timeMs);
    const identity = JSON.stringify([key.boneId, key.property, key.timeMs]);
    if (identities.has(identity)) throw new Error('Keyframe move cannot preserve spacing at this time precision.');
    identities.add(identity);
  }
  const removed = removeBonePropertyKeyframes(animation, rig, keys);
  const groups = new Map<string, PropertyKeyframeEdit[]>();
  for (const key of destinations) {
    const group = groups.get(key.boneId) ?? [];
    group.push(key);
    groups.set(key.boneId, group);
  }
  const tracks = { ...removed.tracks };
  for (const [boneId, group] of groups)
    tracks[boneId] = setTrackPropertyKeyframes(removed.tracks[boneId] ?? [], group, true);
  return { animation: validateEditedAnimation({ ...animation, tracks }, animation, rig), keys: destinations };
}
