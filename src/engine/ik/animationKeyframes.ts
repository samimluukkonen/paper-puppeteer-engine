import type { AnimationClip, PropertyKeyframe } from '../AnimationClip.js';
import { propertyKeyframe, withoutKeyframeProperty, type PropertyCurves } from '../animationCurves.js';
import { AnimationValidationError, shapeIssues } from '../externalData.js';
import { keyframeTimesMatch, matchingRow, normalizeKeyframeTime, replacePropertyAtTime } from '../keyframeAuthoring.js';
import { type DeepReadonly, isFullyFrozen } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import { ikKeyframeSchema } from '../schemas.js';
import { assertFinite } from '../types.js';
import { getValidatedAnimation } from '../validatedAnimation.js';

export const ikAnimationProperties = ['x', 'y', 'mix'] as const;
export type IKAnimationProperty = (typeof ikAnimationProperties)[number];

/** Sparse ordinary keyframe row. x/y are absolute puppet-local positions; mix is solver influence [0, 1]. */
export interface IKKeyframe {
  /** Milliseconds from clip start, like bone keyframes. */
  time: number;
  x?: number;
  y?: number;
  mix?: number;
  curves?: PropertyCurves<IKAnimationProperty>;
}

export type IKAnimationTrack = readonly IKKeyframe[];
type AnimationData = DeepReadonly<AnimationClip>;

function validate(animation: AnimationData, rig: Rig): void {
  getValidatedAnimation(animation, rig);
}

function assertConstraint(rig: Rig, constraintId: string): void {
  if (!rig.ik?.some((constraint) => constraint.name === constraintId))
    throw new AnimationValidationError([
      { severity: 'error', path: `ikTracks.${constraintId}`, message: `Unknown IK constraint "${constraintId}".` },
    ]);
}

function assertProperty(property: IKAnimationProperty): void {
  if (!ikAnimationProperties.includes(property))
    throw new AnimationValidationError([
      { severity: 'error', path: 'ikTracks', message: `Unknown IK animation property "${property}".` },
    ]);
}

const emptyRows: readonly IKKeyframe[] = Object.freeze([]);

function rows(animation: AnimationData, constraintId: string): readonly IKKeyframe[] {
  return animation.ikTracks && Object.hasOwn(animation.ikTracks, constraintId)
    ? animation.ikTracks[constraintId]!
    : emptyRows;
}

const propertyIndexes = new WeakMap<
  readonly IKKeyframe[],
  ReadonlyMap<IKAnimationProperty, readonly PropertyKeyframe[]>
>();

/** Index validated immutable rows once, sharing unchanged tracks across authored snapshots. */
function indexedProperties(animation: AnimationData, constraintId: string) {
  if (!isFullyFrozen(animation)) return undefined;
  const keys = rows(animation, constraintId);
  let properties = propertyIndexes.get(keys);
  if (!properties) {
    properties = new Map(
      ikAnimationProperties.map((property) => [
        property,
        keys.flatMap((key) => (key[property] === undefined ? [] : [propertyKeyframe(key, property)])),
      ]),
    );
    propertyIndexes.set(keys, properties);
  }
  return properties;
}

function indexedKeyframe(keys: readonly PropertyKeyframe[], time: number): PropertyKeyframe | undefined {
  if (!Number.isFinite(time)) return undefined;
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle]!.time < time) low = middle + 1;
    else high = middle;
  }
  // Earlier rows win equidistant ties, matching the ordinary authored-row query.
  let match: PropertyKeyframe | undefined;
  for (const key of [keys[low - 1], keys[low]]) {
    if (
      key &&
      keyframeTimesMatch(key.time, time) &&
      (!match || Math.abs(key.time - time) < Math.abs(match.time - time))
    )
      match = key;
  }
  return match;
}

function queryKeyframe(
  animation: AnimationData,
  constraintId: string,
  property: IKAnimationProperty,
  timeMs: number,
): PropertyKeyframe | undefined {
  const properties = indexedProperties(animation, constraintId);
  if (properties) {
    const key = indexedKeyframe(properties.get(property)!, timeMs);
    return key ? { ...key, ...(key.curve ? { curve: structuredClone(key.curve) } : {}) } : undefined;
  }
  const keys = rows(animation, constraintId);
  const key = keys[matchingRow(keys, timeMs, property)];
  return key ? propertyKeyframe(key, property) : undefined;
}

function install<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  constraintId: string,
  keys: readonly IKKeyframe[],
): Animation {
  const next = { ...animation, ikTracks: { ...animation.ikTracks, [constraintId]: keys } };
  validate(next, rig);
  return next;
}

/** Create an explicit empty placeholder. No target or influence defaults are authored. */
export function createIKAnimationTrack<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  constraintId: string,
): Animation {
  validate(animation, rig);
  assertConstraint(rig, constraintId);
  if (animation.ikTracks && Object.hasOwn(animation.ikTracks, constraintId)) return animation;
  return install(animation, rig, constraintId, []);
}

/** Insert/update one independently keyed channel; nearest tolerant row wins, like bone key editing. */
export function setIKPropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  constraintId: string,
  property: IKAnimationProperty,
  timeMs: number,
  value: number,
): Animation {
  validate(animation, rig);
  assertConstraint(rig, constraintId);
  assertProperty(property);
  timeMs = normalizeKeyframeTime(animation.duration, timeMs);
  const checked = ikKeyframeSchema.safeParse({ time: timeMs, [property]: value });
  if (!checked.success) throw new AnimationValidationError(shapeIssues(checked.error));
  const keys = rows(animation, constraintId);
  const propertyIndex = matchingRow(keys, timeMs, property);
  const index = propertyIndex >= 0 ? propertyIndex : matchingRow(keys, timeMs);
  if (index >= 0 && keys[index]![property] === value) return animation;
  const nextKeys = [...keys];
  if (index >= 0) nextKeys[index] = { ...keys[index]!, [property]: value };
  else nextKeys.push({ time: timeMs, [property]: value });
  nextKeys.sort((a, b) => a.time - b.time);
  return install(animation, rig, constraintId, nextKeys);
}

/** Delete one channel, retaining sibling channels. The final removal drops the empty track. */
export function removeIKPropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  constraintId: string,
  property: IKAnimationProperty,
  timeMs: number,
): Animation {
  validate(animation, rig);
  assertConstraint(rig, constraintId);
  assertProperty(property);
  timeMs = normalizeKeyframeTime(animation.duration, timeMs);
  const keys = rows(animation, constraintId);
  const index = matchingRow(keys, timeMs, property);
  if (index < 0) return animation;
  const row = withoutKeyframeProperty(keys[index]!, property);
  const nextKeys = keys.flatMap((key, current) =>
    current !== index ? [key] : ikAnimationProperties.some((entry) => row[entry] !== undefined) ? [row] : [],
  );
  if (nextKeys.length) return install(animation, rig, constraintId, nextKeys);
  const ikTracks = { ...animation.ikTracks };
  delete ikTracks[constraintId];
  const next = { ...animation, ikTracks };
  validate(next, rig);
  return next;
}

/** Move time only; clamp to the clip and replace tolerant destination collisions on this channel. */
export function moveIKPropertyKeyframe<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  constraintId: string,
  property: IKAnimationProperty,
  fromTime: number,
  toTime: number,
): Animation {
  validate(animation, rig);
  assertConstraint(rig, constraintId);
  assertProperty(property);
  fromTime = normalizeKeyframeTime(animation.duration, fromTime);
  assertFinite(toTime, 'Keyframe destination');
  toTime = Math.max(0, Math.min(toTime, animation.duration));
  const keys = rows(animation, constraintId);
  const source = matchingRow(keys, fromTime, property);
  const destination = matchingRow(keys, toTime, property);
  if (source < 0 || source === destination) return animation;
  const destinationTime = destination >= 0 ? keys[destination]!.time : toTime;
  return install(
    animation,
    rig,
    constraintId,
    replacePropertyAtTime(keys, property, destinationTime, keys[source]![property]!, source, ikAnimationProperties),
  );
}

/** Authored keys only; no runtime sampling, evaluated targets, or default values. */
export function getIKPropertyKeyframes(
  animation: AnimationData,
  rig: Rig,
  constraintId: string,
  property: IKAnimationProperty,
): PropertyKeyframe[] {
  validate(animation, rig);
  assertConstraint(rig, constraintId);
  assertProperty(property);
  const properties = indexedProperties(animation, constraintId);
  if (properties)
    return properties
      .get(property)!
      .map((key) => ({ ...key, ...(key.curve ? { curve: structuredClone(key.curve) } : {}) }));
  return rows(animation, constraintId).flatMap((key) =>
    key[property] === undefined ? [] : [propertyKeyframe(key, property)],
  );
}

export function findIKPropertyKeyframe(
  animation: AnimationData,
  rig: Rig,
  constraintId: string,
  property: IKAnimationProperty,
  timeMs: number,
): PropertyKeyframe | undefined {
  validate(animation, rig);
  assertConstraint(rig, constraintId);
  assertProperty(property);
  return queryKeyframe(animation, constraintId, property, timeMs);
}

/** Sparse channel presence at a time; nearby independently keyed rows retain their stored times in queries. */
export function getIKKeyedPropertiesAtTime(
  animation: AnimationData,
  rig: Rig,
  constraintId: string,
  timeMs: number,
): IKAnimationProperty[] {
  validate(animation, rig);
  assertConstraint(rig, constraintId);
  return ikAnimationProperties.filter(
    (property) => queryKeyframe(animation, constraintId, property, timeMs) !== undefined,
  );
}
