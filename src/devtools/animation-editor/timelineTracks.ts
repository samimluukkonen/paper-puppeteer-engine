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

export interface BoneTimelineTrack extends TimelineTrackBase {
  readonly kind: 'bone';
  readonly expanded: boolean;
}

export interface PropertyTimelineTrack extends TimelineTrackBase {
  readonly kind: 'property';
  readonly property: TransformProperty;
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
        for (const property of transformProperties)
          rows.push(
            Object.freeze({
              kind: 'property',
              boneId,
              property,
              depth: depth + 1,
              hasKeys: authored.includes(property),
            }),
          );
    }
  return Object.freeze(rows);
}
