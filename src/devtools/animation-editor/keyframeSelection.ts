import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import { findBonePropertyKeyframe } from './keyframes.js';
import type { KeyframeSelection, TimelineTrack } from './timelineTracks.js';

export interface KeyframeSelectionState {
  readonly selectedKeys: readonly KeyframeSelection[];
  readonly primaryKey: KeyframeSelection | null;
}

export interface KeyframeSelectionModifiers {
  readonly additive?: boolean;
  readonly range?: boolean;
}

/** Compare canonical authored references after resolving them with the shared time tolerance.
 * Exact canonical times preserve distinct authored keys even when they are closer than tolerance.
 */
export function sameKey(a: KeyframeSelection, b: KeyframeSelection): boolean {
  return a.boneId === b.boneId && a.property === b.property && a.time === b.time;
}

/** Canonical times stay exact; tuple encoding also keeps punctuation in bone ids unambiguous. */
export function keyIdentity(key: KeyframeSelection): string {
  return JSON.stringify([key.boneId, key.property, key.time]);
}

const selectionIndexes = new WeakMap<readonly KeyframeSelection[], ReadonlyMap<string, KeyframeSelection>>();

/** Retain first-occurrence order and reuse membership lookups for owned immutable selections. */
export function keyframeSelectionIndex(keys: readonly KeyframeSelection[]): ReadonlyMap<string, KeyframeSelection> {
  const cached = selectionIndexes.get(keys);
  if (cached) return cached;
  const index = new Map<string, KeyframeSelection>();
  for (const key of keys) {
    const id = keyIdentity(key);
    if (!index.has(id)) index.set(id, key);
  }
  if (Object.isFrozen(keys) && keys.every(Object.isFrozen)) selectionIndexes.set(keys, index);
  return index;
}

export function resolveKey(
  animation: DeepReadonly<AnimationClip> | null,
  ref: KeyframeSelection,
): KeyframeSelection | undefined {
  const key = animation && findBonePropertyKeyframe(animation, ref.boneId, ref.property, ref.time * 1000);
  return key ? (key.time / 1000 === ref.time ? ref : Object.freeze({ ...ref, time: key.time / 1000 })) : undefined;
}

/** Reusable reconciliation for mutations/history: resolve, deduplicate, retain primary or choose first survivor. */
export function reconcileKeyframeSelection(
  animation: DeepReadonly<AnimationClip> | null,
  state: KeyframeSelectionState,
): KeyframeSelectionState {
  const index = new Map<string, KeyframeSelection>();
  for (const ref of state.selectedKeys) {
    const key = resolveKey(animation, ref);
    if (key && !index.has(keyIdentity(key))) index.set(keyIdentity(key), key);
  }
  const selectedKeys = [...index.values()];
  const primary = state.primaryKey && resolveKey(animation, state.primaryKey);
  const primaryKey = (primary && index.get(keyIdentity(primary))) || selectedKeys[0] || null;
  if (
    primaryKey === state.primaryKey &&
    selectedKeys.length === state.selectedKeys.length &&
    selectedKeys.every((key, index) => key === state.selectedKeys[index])
  )
    return state;
  return Object.freeze({ selectedKeys: Object.freeze(selectedKeys), primaryKey });
}

export interface KeyframeMarquee {
  readonly startTime: number;
  readonly endTime: number;
  readonly firstRow: number;
  readonly lastRow: number;
}

/** Marker centers inside inclusive time/visible-row bounds. Bone rows contain no property keys. */
export function keysInMarquee(tracks: readonly TimelineTrack[], box: KeyframeMarquee): readonly KeyframeSelection[] {
  const minTime = Math.min(box.startTime, box.endTime);
  const maxTime = Math.max(box.startTime, box.endTime);
  const first = Math.min(box.firstRow, box.lastRow);
  const last = Math.max(box.firstRow, box.lastRow);
  return tracks.flatMap((track, index) =>
    track.kind === 'property' && index >= first && index <= last
      ? track.keyframes.filter((key) => key.time >= minTime && key.time <= maxTime)
      : [],
  );
}
