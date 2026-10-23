import { withoutKeyframeProperty, type PropertyCurve } from '../../engine/animationCurves.js';
import { replacePropertyAtTime, setTrackPropertyKeyframes } from '../../engine/keyframeAuthoring.js';
import type { Rig } from '../../engine/Rig.js';
import { assertFinite, type TransformProperty, transformProperties } from '../../engine/types.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import { type AnimationData, assertTarget, matchingRow } from './keyframeTargets.js';
import { type Milliseconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

/** Persistent authored edit in milliseconds: update a property row or merge into/create a sparse row.
 * Inputs are never mutated or frozen. New branches inherit immutable source ownership; unchanged branches are shared.
 */
export function setBonePropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  timeMs: Milliseconds,
  value: number,
): Animation {
  timeMs = assertTarget(animation, rig, boneId, property, timeMs);
  assertFinite(value, `Keyframe ${boneId}.${property}`);
  getValidatedEditorAnimation(animation, rig);
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  const propertyIndex = matchingRow(keys, timeMs, property);
  const index = propertyIndex >= 0 ? propertyIndex : matchingRow<TransformProperty>(keys, timeMs);
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
  timeMs: Milliseconds,
): Animation {
  return removeBonePropertyKeyframes(animation, rig, [{ boneId, property, timeMs }]);
}

export interface PropertyKeyframeTarget {
  readonly boneId: string;
  readonly property: TransformProperty;
  /** Milliseconds, matching authored keyframe times. */
  readonly timeMs: Milliseconds;
}

export interface PropertyKeyframeEdit extends PropertyKeyframeTarget {
  readonly value: number;
  readonly curve?: PropertyCurve | null;
}

/** Atomically validate a group and optionally extend authored duration. By default each edit canonicalizes
 * tolerant collisions sequentially. preserveTiming replaces external collisions before inserting all
 * group members at their exact times, matching group moves and rejecting duplicate destinations.
 */
export function setBonePropertyKeyframes<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  edits: readonly PropertyKeyframeEdit[],
  options: { extendDuration?: boolean; preserveTiming?: boolean } = {},
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
  if (options.preserveTiming) {
    const identities = new Set<string>();
    for (const { boneId, property, timeMs } of normalized) {
      const identity = JSON.stringify([boneId, property, timeMs]);
      if (identities.has(identity)) throw new Error('Keyframe paste cannot preserve spacing at this time precision.');
      identities.add(identity);
    }
  }
  const tracks = { ...animation.tracks };
  const groups = new Map<string, PropertyKeyframeEdit[]>();
  for (const edit of normalized) {
    const group = groups.get(edit.boneId) ?? [];
    group.push(edit);
    groups.set(edit.boneId, group);
  }
  for (const [boneId, group] of groups) {
    const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
    tracks[boneId] = setTrackPropertyKeyframes(keys, group, transformProperties, options.preserveTiming);
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
      let row = key;
      for (const property of properties) row = withoutKeyframeProperty(row, property);
      return transformProperties.some((property) => row[property] !== undefined) ? [row] : [];
    });
    if (nextKeys.length) tracks[boneId] = nextKeys;
    else delete tracks[boneId];
  }
  const next = { ...animation, tracks };
  return validateEditedAnimation(next, animation, rig);
}

/** Move time only (milliseconds), replacing all destination matches on this property.
 * Sparse-row siblings retain their original times. Outgoing controls travel with the property.
 */
export function moveBonePropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  boneId: string,
  property: TransformProperty,
  fromTime: Milliseconds,
  toTime: Milliseconds,
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
  const nextKeys = replacePropertyAtTime(keys, property, destinationTime, value, source, transformProperties);
  const next = { ...animation, tracks: { ...animation.tracks, [boneId]: nextKeys } };
  return validateEditedAnimation(next, animation, rig);
}

/** Constrain one delta using the group's extrema. All arguments use the same time unit. */
export function constrainKeyframeMoveDelta(
  times: readonly Milliseconds[],
  delta: Milliseconds,
  duration: Milliseconds,
): Milliseconds {
  assertFinite(delta, 'Keyframe delta');
  assertFinite(duration, 'Animation duration');
  let earliest: number = duration;
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
  deltaMs: Milliseconds,
): PropertyKeyframeMove<Animation> {
  getValidatedEditorAnimation(animation, rig);
  assertFinite(deltaMs, 'Keyframe delta');
  const sources = new Map<string, PropertyKeyframeEdit>();
  for (const target of targets) {
    assertTarget(animation, rig, target.boneId, target.property, target.timeMs);
    const key = findBonePropertyKeyframe(animation, target.boneId, target.property, target.timeMs);
    if (!key) throw new Error('Cannot move a missing keyframe.');
    const source = { ...target, timeMs: key.time, value: key.value, curve: key.curve ?? null };
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
  for (const [boneId, group] of groups) {
    const remaining = Object.hasOwn(removed.tracks, boneId) ? removed.tracks[boneId]! : [];
    tracks[boneId] = setTrackPropertyKeyframes(remaining, group, transformProperties, true);
  }
  return { animation: validateEditedAnimation({ ...animation, tracks }, animation, rig), keys: destinations };
}
