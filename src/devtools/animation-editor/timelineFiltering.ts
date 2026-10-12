import { ikAnimationProperties } from '../../engine/ik/animationKeyframes.js';
import type { Rig } from '../../engine/Rig.js';
import { transformProperties } from '../../engine/types.js';
import type { IKKeyframeSelection } from './ikTimeline.js';
import { ikTrackKey } from './ikTimeline.js';
import { getAuthoredBoneProperties } from './keyframeQueries.js';
import type { AnimationData } from './keyframeTargets.js';
import type { KeyframeSelection, TimelineTrack } from './timelineTracks.js';
import { timelineTrackKey } from './timelineTracks.js';

export interface TimelineFilters {
  readonly search: string;
  readonly mode: 'all' | 'keyed' | 'selected';
  readonly showIK: boolean;
  readonly showEvents: boolean;
}

export const defaultTimelineFilters: TimelineFilters = Object.freeze({
  search: '',
  mode: 'all',
  showIK: true,
  showEvents: true,
});

export interface TimelineFilterSelection {
  readonly boneId: string | null;
  readonly property: KeyframeSelection['property'] | null;
  readonly keys: readonly KeyframeSelection[];
  readonly ikId: string | null;
  readonly ikProperty: IKKeyframeSelection['property'] | null;
  readonly ikKey: IKKeyframeSelection | null;
  readonly eventSelected: boolean;
}

export interface TimelineVisibility {
  /** References to the existing rows, including ancestors retained as context. */
  readonly rows: ReadonlySet<TimelineTrack>;
  readonly context: ReadonlySet<TimelineTrack>;
  readonly eventVisible: boolean;
  readonly hiddenKeyCount: number;
  readonly selectionHidden: boolean;
}

export const normalizedTrackSearch = (search: string): string => search.trim().toLowerCase();

function matches(search: string, ...labels: string[]): boolean {
  return !search || labels.some((label) => label.toLowerCase().includes(search));
}

function propertyLabel(property: string): string {
  return property === 'mix' ? 'mix (influence)' : property;
}

/** Search opens only matching groups, without writing to the user's expansion preferences. */
export function searchExpansion(rig: Rig | undefined, search: string): { bones: Set<string>; ik: Set<string> } {
  const query = normalizedTrackSearch(search);
  const bones = new Set<string>();
  const ik = new Set<string>();
  if (query) {
    for (const bone of rig?.bones ?? []) if (matches(query, bone.id, ...transformProperties)) bones.add(bone.id);
    for (const constraint of rig?.ik ?? [])
      if (matches(query, `IK: ${constraint.name}`, ...ikAnimationProperties.map(propertyLabel)))
        ik.add(constraint.name);
  }
  return { bones, ik };
}

/** Pure visual derivation. It never reconciles selection or touches authored data. */
export function filterTimelineTracks(
  rig: Rig | undefined,
  tracks: readonly TimelineTrack[],
  filters: TimelineFilters,
  selection: TimelineFilterSelection,
  animation: AnimationData | null,
): TimelineVisibility {
  const search = normalizedTrackSearch(filters.search);
  const direct = new Set<TimelineTrack>();
  for (const track of tracks) {
    const ik = 'constraintId' in track;
    const owner = ik ? track.constraintId : track.boneId;
    if (ik && !filters.showIK) continue;
    if (filters.mode === 'keyed' && !track.hasKeys) continue;
    if (filters.mode === 'selected' && owner !== (ik ? selection.ikId : selection.boneId)) continue;
    const label = ik ? `IK: ${owner}` : owner;
    const property = track.kind === 'property' || track.kind === 'ik-property' ? propertyLabel(track.property) : '';
    let collapsedLabels: readonly string[] = [];
    if ((track.kind === 'bone' || track.kind === 'ik') && !track.expanded) {
      if (filters.mode !== 'keyed')
        collapsedLabels = (ik ? ikAnimationProperties : transformProperties).map(propertyLabel);
      else if (!ik) collapsedLabels = animation ? getAuthoredBoneProperties(animation, owner) : [];
      else {
        const keys = animation?.ikTracks && Object.hasOwn(animation.ikTracks, owner) ? animation.ikTracks[owner]! : [];
        collapsedLabels = ikAnimationProperties
          .filter((property) => keys.some((key) => key[property] !== undefined))
          .map(propertyLabel);
      }
    }
    if (matches(search, label, ...(property ? [property] : collapsedLabels))) direct.add(track);
  }
  const rows = new Set(direct);
  const boneRows = new Map(tracks.filter((row) => row.kind === 'bone').map((row) => [row.boneId, row]));
  const ikRows = new Map(tracks.filter((row) => row.kind === 'ik').map((row) => [row.constraintId, row]));
  for (const track of direct) {
    if ('constraintId' in track) {
      const parent = ikRows.get(track.constraintId);
      if (parent) rows.add(parent);
    } else {
      let id: string | undefined = track.boneId;
      while (id !== undefined) {
        const parent = boneRows.get(id);
        if (parent) rows.add(parent);
        id = rig?.getBone(id).parent;
      }
    }
  }
  const eventVisible =
    filters.showEvents &&
    matches(search, 'Events') &&
    (filters.mode !== 'keyed' || (animation?.events?.length ?? 0) > 0) &&
    (filters.mode !== 'selected' || selection.eventSelected);
  const visibleBones = new Set(
    [...rows].flatMap((row) =>
      'boneId' in row ? [timelineTrackKey(row.boneId, row.kind === 'property' ? row.property : null)] : [],
    ),
  );
  const visibleConstraints = new Set(
    [...rows].flatMap((row) =>
      'constraintId' in row ? [ikTrackKey(row.constraintId, row.kind === 'ik-property' ? row.property : null)] : [],
    ),
  );
  const visibleBone = (id: string, property: KeyframeSelection['property'] | null): boolean =>
    visibleBones.has(timelineTrackKey(id, property));
  const visibleIK = (id: string, property: IKKeyframeSelection['property'] | null): boolean =>
    visibleConstraints.has(ikTrackKey(id, property));
  const hiddenKeyCount =
    selection.keys.filter((key) => !visibleBone(key.boneId, key.property)).length +
    (selection.ikKey && !visibleIK(selection.ikKey.constraintId, selection.ikKey.property) ? 1 : 0);
  const selectionHidden =
    hiddenKeyCount > 0 ||
    (!!selection.boneId && !visibleBone(selection.boneId, selection.property)) ||
    (!!selection.ikId && !visibleIK(selection.ikId, selection.ikProperty)) ||
    (selection.eventSelected && !eventVisible);
  return Object.freeze({
    rows: new Set(tracks.filter((row) => rows.has(row))),
    context: new Set(tracks.filter((row) => rows.has(row) && !direct.has(row))),
    eventVisible,
    hiddenKeyCount,
    selectionHidden,
  });
}
