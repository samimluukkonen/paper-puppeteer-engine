import type { AnimationClip, Keyframe } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import { isFullyFrozen } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { type TransformProperty, transformProperties } from '../../engine/types.js';
import { boneHierarchy } from '../shared/boneHierarchy.js';
import { getAuthoredBoneProperties } from './keyframeQueries.js';
import { type Seconds, toSeconds } from './timeUnits.js';

interface TimelineTrackBase {
  readonly boneId: string;
  readonly depth: number;
  readonly hasKeys: boolean;
}

/** Transient editor identity. Time is continuous seconds, as in the editor clock. */
export interface KeyframeSelection {
  readonly boneId: string;
  readonly property: TransformProperty;
  readonly time: Seconds;
}

export interface TimelineKeyframe extends KeyframeSelection {
  readonly value: number;
}

export interface BoneTimelineTrack extends TimelineTrackBase {
  readonly kind: 'bone';
  readonly expanded: boolean;
}

export interface PropertyTimelineTrack extends TimelineTrackBase {
  readonly kind: 'property';
  readonly property: TransformProperty;
  readonly keyframes: readonly TimelineKeyframe[];
}

export type TimelineTrack = BoneTimelineTrack | PropertyTimelineTrack;

export function timelineTrackKey(boneId: string, property: TransformProperty | null = null): string {
  return JSON.stringify([boneId, property]);
}

const emptyKeys: readonly Keyframe[] = Object.freeze([]);
const emptyKeyframes: readonly TimelineKeyframe[] = Object.freeze([]);
const keyframesByTrack = new WeakMap<readonly Keyframe[], Map<string, readonly TimelineKeyframe[]>>();

/** Share marker data only when the authored track cannot change in place. */
function propertyKeys(
  keys: readonly Keyframe[],
  boneId: string,
  property: TransformProperty,
): readonly TimelineKeyframe[] {
  if (!keys.length) return emptyKeyframes;
  const id = timelineTrackKey(boneId, property);
  const cached = keyframesByTrack.get(keys)?.get(id);
  if (cached) return cached;
  const result = Object.freeze(
    keys.flatMap((key) =>
      key[property] === undefined
        ? []
        : [Object.freeze({ boneId, property, time: toSeconds(key.time), value: key[property] })],
    ),
  );
  if (isFullyFrozen(keys)) {
    let tracks = keyframesByTrack.get(keys);
    if (!tracks) {
      tracks = new Map();
      keyframesByTrack.set(keys, tracks);
    }
    tracks.set(id, result);
  }
  return result;
}

/** Flat visible rows in shared hierarchy order. Collapse hides properties, never descendant bones.
 * All runtime transform properties stay available, including those with no authored samples.
 */
export function buildTimelineTracks(
  rig: Rig | undefined,
  animation: DeepReadonly<AnimationClip> | null,
  expandedBones: ReadonlySet<string>,
  previous: readonly TimelineTrack[] = [],
): readonly TimelineTrack[] {
  const rows: TimelineTrack[] = [];
  const previousRows = new Map(
    previous.map((row) => [timelineTrackKey(row.boneId, row.kind === 'property' ? row.property : null), row]),
  );
  if (rig)
    for (const { id: boneId, depth } of boneHierarchy(rig)) {
      const authored = animation ? getAuthoredBoneProperties(animation, boneId) : [];
      const expanded = expandedBones.has(boneId);
      const before = previousRows.get(timelineTrackKey(boneId));
      const hasKeys = authored.length > 0;
      rows.push(
        before?.kind === 'bone' && before.depth === depth && before.expanded === expanded && before.hasKeys === hasKeys
          ? before
          : Object.freeze({ kind: 'bone', boneId, depth, expanded, hasKeys }),
      );
      if (expanded)
        for (const property of transformProperties) {
          const keys = animation && Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : emptyKeys;
          const keyframes = propertyKeys(keys, boneId, property);
          const before = previousRows.get(timelineTrackKey(boneId, property));
          rows.push(
            before?.kind === 'property' && before.depth === depth + 1 && before.keyframes === keyframes
              ? before
              : Object.freeze({
                  kind: 'property',
                  boneId,
                  property,
                  depth: depth + 1,
                  hasKeys: authored.includes(property),
                  keyframes,
                }),
          );
        }
    }
  return Object.freeze(rows);
}
