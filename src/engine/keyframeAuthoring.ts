import {
  copyPropertyCurve,
  withoutKeyframeProperty,
  type PropertyCurve,
  type PropertyCurves,
} from './animationCurves.js';
import { assertFinite } from './types.js';

export type SparseKeyframe<Property extends string> = {
  readonly time: number;
  readonly curves?: PropertyCurves<Property>;
} & Partial<Record<Property, number>>;

/** One nanosecond expressed in the external format's milliseconds; never an FPS snap. */
export const KEYFRAME_TIME_TOLERANCE_MS = 1e-6;

export function keyframeTimesMatch(time: number, other: number): boolean {
  return Number.isFinite(time) && Number.isFinite(other) && Math.abs(time - other) <= KEYFRAME_TIME_TOLERANCE_MS;
}

/** Choose the nearest matching row, breaking ties in stored order. Property queries ignore unkeyed rows. */
export function matchingRow<Property extends string>(
  keys: readonly SparseKeyframe<Property>[],
  time: number,
  property?: Property,
): number {
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

/** Editing boundary policy shared by bone and IK channels. */
export function normalizeKeyframeTime(duration: number, time: number): number {
  assertFinite(time, 'Keyframe time');
  if ((time < 0 && !keyframeTimesMatch(time, 0)) || (time > duration && !keyframeTimesMatch(time, duration)))
    throw new Error('Keyframe time must stay within the animation duration.');
  return Math.max(0, Math.min(time, duration));
}

/** Shared move/paste replacement: remove all tolerant property matches, retaining sparse siblings. */
export function replacePropertyAtTime<Property extends string>(
  keys: readonly SparseKeyframe<Property>[],
  property: Property,
  time: number,
  value: number,
  source = -1,
  properties: readonly Property[],
  curve: PropertyCurve | undefined = source >= 0 ? keys[source]?.curves?.[property] : undefined,
): SparseKeyframe<Property>[] {
  const nextKeys: SparseKeyframe<Property>[] = [];
  for (const [index, key] of keys.entries()) {
    if (index !== source && !(key[property] !== undefined && keyframeTimesMatch(key.time, time))) {
      nextKeys.push(key);
      continue;
    }
    const row = withoutKeyframeProperty(key, property);
    if (properties.some((entry) => row[entry] !== undefined)) nextKeys.push(row);
  }
  // Nearby sibling properties must not shift the inserted property's time.
  const row = nextKeys.findIndex((key) => key.time === time);
  const inserted = { ...(row >= 0 ? nextKeys[row] : {}), time, [property]: value } as SparseKeyframe<Property>;
  if (curve) Object.assign(inserted, { curves: { ...inserted.curves, [property]: copyPropertyCurve(curve) } });
  if (row >= 0) nextKeys[row] = inserted;
  else nextKeys.push(inserted);
  nextKeys.sort((a, b) => a.time - b.time);
  return nextKeys;
}

/** Validated authored property insertion used by batch edits, group moves and retiming. */
export interface PropertyKeyframeWrite<Property extends string> {
  readonly property: Property;
  readonly timeMs: number;
  readonly value: number;
  /** Omission preserves controls on a value update; null explicitly resets a copied/replaced segment. */
  readonly curve?: PropertyCurve | null;
}

/** Index nearby rows while editing one track; publish and sort its array only once. */
export function setTrackPropertyKeyframes<Property extends string>(
  keys: readonly SparseKeyframe<Property>[],
  edits: readonly PropertyKeyframeWrite<Property>[],
  properties: readonly Property[],
  preserveTiming = false,
): SparseKeyframe<Property>[] {
  const rows = new Map<number, SparseKeyframe<Property>>();
  const buckets = new Map<number, Set<number>>();
  const bucketOf = (time: number): number => Math.floor(time / (2 * KEYFRAME_TIME_TOLERANCE_MS));
  const add = (key: SparseKeyframe<Property>): void => {
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
  const matches = (time: number, property: Property): SparseKeyframe<Property>[] => {
    const bucket = bucketOf(time);
    const found: SparseKeyframe<Property>[] = [];
    // Deduplicate neighboring buckets when large timestamps round to the same number.
    for (const nearby of new Set([bucket - 1, bucket, bucket + 1])) {
      for (const candidate of buckets.get(nearby) ?? []) {
        const row = rows.get(candidate)!;
        if (row[property] !== undefined && keyframeTimesMatch(candidate, time)) found.push(row);
      }
    }
    return found;
  };
  const insertions: PropertyKeyframeWrite<Property>[] = [];
  const insert = (property: Property, time: number, value: number, curve: PropertyCurve | null | undefined): void => {
    const row = { ...rows.get(time), time, [property]: value } as SparseKeyframe<Property>;
    if (curve) Object.assign(row, { curves: { ...row.curves, [property]: copyPropertyCurve(curve) } });
    add(row);
  };
  for (const { property, timeMs, value, curve: authoredCurve } of edits) {
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
    const collisions = matches(time, property);
    const curve =
      authoredCurve === undefined ? collisions.find((key) => key.time === time)?.curves?.[property] : authoredCurve;
    for (const key of collisions) {
      const row = withoutKeyframeProperty(key, property);
      if (properties.some((entry) => row[entry] !== undefined)) rows.set(row.time, row);
      else remove(row.time);
    }
    if (preserveTiming) insertions.push({ property, timeMs: time, value, ...(curve ? { curve } : {}) });
    else insert(property, time, value, curve);
  }
  // Group members never collide with each other. Replace external matches first,
  // then insert every translated time exactly, including distinct nearby keys.
  for (const { property, timeMs: time, value, curve } of insertions) insert(property, time, value, curve);
  return [...rows.values()].sort((a, b) => a.time - b.time);
}
