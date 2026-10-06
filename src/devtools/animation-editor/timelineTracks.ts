import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { type TransformProperty, transformProperties } from '../../engine/types.js';
import { boneHierarchy } from '../shared/boneHierarchy.js';
import { getAuthoredBoneProperties } from './keyframes.js';

interface TimelineTrackBase {
  readonly boneId: string;
  readonly depth: number;
  readonly hasKeys: boolean;
}

/** Transient editor identity. Time is continuous seconds, as in the editor clock. */
export interface KeyframeSelection {
  readonly boneId: string;
  readonly property: TransformProperty;
  readonly time: number;
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

/** Flat visible rows in shared hierarchy order. Collapse hides properties, never descendant bones.
 * All runtime transform properties stay available, including those with no authored samples.
 */
export function buildTimelineTracks(
  rig: Rig | undefined,
  animation: DeepReadonly<AnimationClip> | null,
  expandedBones: ReadonlySet<string>,
): readonly TimelineTrack[] {
  const rows: TimelineTrack[] = [];
  if (rig)
    for (const { id: boneId, depth } of boneHierarchy(rig)) {
      const authored = animation ? getAuthoredBoneProperties(animation, boneId) : [];
      const expanded = expandedBones.has(boneId);
      rows.push(Object.freeze({ kind: 'bone', boneId, depth, expanded, hasKeys: authored.length > 0 }));
      if (expanded)
        for (const property of transformProperties) {
          const keys = animation && Object.hasOwn(animation.tracks, boneId) ? animation.tracks[boneId]! : [];
          const keyframes = keys.flatMap((key) =>
            key[property] === undefined
              ? []
              : [Object.freeze({ boneId, property, time: key.time / 1000, value: key[property] })],
          );
          rows.push(
            Object.freeze({
              kind: 'property',
              boneId,
              property,
              depth: depth + 1,
              hasKeys: authored.includes(property),
              keyframes: Object.freeze(keyframes),
            }),
          );
        }
    }
  return Object.freeze(rows);
}
