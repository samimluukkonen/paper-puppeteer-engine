import type { PropertyKeyframe } from '../../engine/AnimationClip.js';
import { type TransformProperty, transformProperties } from '../../engine/types.js';
import { isFullyFrozen } from '../shared/editorData.js';
import { type AnimationData, keyframeTimesMatch, matchingRow } from './keyframeTargets.js';
import { type Milliseconds } from './timeUnits.js';

/** Authored presence anywhere in a track, independent of the playhead and evaluated pose. */
export function getAuthoredBoneProperties(animation: AnimationData, boneId: string): TransformProperty[] {
  const keys = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  return transformProperties.filter((property) => keys.some((key) => key[property] !== undefined));
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
  timeMs: Milliseconds,
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
  timeMs: Milliseconds,
): boolean {
  return findBonePropertyKeyframe(animation, boneId, property, timeMs) !== undefined;
}

/** Strict successor for outgoing segments; nearby distinct authored times remain separate. */
export function findNextBonePropertyKeyframe(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  timeMs: Milliseconds,
): PropertyKeyframe | undefined {
  if (!transformProperties.includes(property) || !Number.isFinite(timeMs)) return undefined;
  const properties = propertyIndexes(animation, boneId);
  if (properties !== false) {
    const keys = properties.get(property) ?? [];
    let low = 0;
    let high = keys.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (keys[middle]!.time <= timeMs) low = middle + 1;
      else high = middle;
    }
    const key = keys[low];
    return key ? { time: key.time, value: key.value } : undefined;
  }
  const rows = Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
  const row = rows.find((key) => key.time > timeMs && key[property] !== undefined);
  return row ? { time: row.time, value: row[property]! } : undefined;
}

/** Find a strictly previous/next property key, skipping every time within the shared tolerance. */
export function findAdjacentBonePropertyKeyframe(
  animation: AnimationData,
  boneId: string,
  property: TransformProperty,
  timeMs: Milliseconds,
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
  timeMs: Milliseconds,
): TransformProperty[] {
  return transformProperties.filter((property) => hasKeyframeAtTime(animation, boneId, property, timeMs));
}
