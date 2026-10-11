import { assertFinite } from './types.js';

export type SparseKeyframe<Property extends string> = { readonly time: number } & Partial<Record<Property, number>>;

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
): SparseKeyframe<Property>[] {
  const nextKeys: SparseKeyframe<Property>[] = [];
  for (const [index, key] of keys.entries()) {
    if (index !== source && !(key[property] !== undefined && keyframeTimesMatch(key.time, time))) {
      nextKeys.push(key);
      continue;
    }
    const row = { ...key };
    delete row[property];
    if (properties.some((entry) => row[entry] !== undefined)) nextKeys.push(row);
  }
  // Nearby sibling properties must not shift the inserted property's time.
  const row = nextKeys.findIndex((key) => key.time === time);
  if (row >= 0) nextKeys[row] = { ...nextKeys[row]!, [property]: value };
  else nextKeys.push({ time, [property]: value } as SparseKeyframe<Property>);
  nextKeys.sort((a, b) => a.time - b.time);
  return nextKeys;
}
