import { findIKPropertyKeyframe, ikAnimationProperties } from '../../engine/ik/animationKeyframes.js';
import {
  normalizeKeyframeTime,
  setTrackPropertyKeyframes,
  type SparseKeyframe,
} from '../../engine/keyframeAuthoring.js';
import type { Rig } from '../../engine/Rig.js';
import { assertFinite, transformProperties } from '../../engine/types.js';
import type { IKKeyframeSelection } from './ikTimeline.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import { type AnimationData, assertTarget } from './keyframeTargets.js';
import type { KeyframeSelection } from './timelineTracks.js';
import { type Milliseconds, toMilliseconds, toSeconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

/** Reuse the editor's distinct bone and IK identities; events are deliberately excluded. */
export type RetimeKeySelection = KeyframeSelection | IKKeyframeSelection;
export interface RetimeOptions {
  readonly scale: number;
  readonly anchor: 'earliest' | 'playhead';
  /** Required for playhead anchoring. Pure API times use authored milliseconds. */
  readonly playheadTimeMs?: Milliseconds;
}
export interface RetimeChange {
  readonly before: RetimeKeySelection;
  readonly beforeTimeMs: Milliseconds;
  readonly afterTimeMs: Milliseconds;
  readonly after: RetimeKeySelection;
}
export interface RetimeResult<Animation extends AnimationData> {
  readonly animation: Animation;
  readonly keys: readonly RetimeKeySelection[];
  readonly changes: readonly RetimeChange[];
  readonly anchorTimeMs: Milliseconds;
  readonly replacedKeys: number;
}

function identity(key: RetimeKeySelection): string {
  return JSON.stringify([
    'kind' in key ? 'ik' : 'bone',
    'kind' in key ? key.constraintId : key.boneId,
    key.property,
    key.time,
  ]);
}

/** Remove the full source group before the shared batch writer checks external collisions. */
function retimeTrack<Property extends string>(
  rows: readonly SparseKeyframe<Property>[],
  changes: readonly RetimeChange[],
  properties: readonly Property[],
): { rows: SparseKeyframe<Property>[]; replacedKeys: number } {
  const removals = new Map<number, Set<Property>>();
  const indexedRows = new Map(rows.map((row) => [row.time, row]));
  const edits = changes.map(({ before, beforeTimeMs, afterTimeMs }) => {
    const property = before.property as Property;
    const time = beforeTimeMs;
    const selected = removals.get(time) ?? new Set<Property>();
    selected.add(property);
    removals.set(time, selected);
    return { property, timeMs: afterTimeMs, value: indexedRows.get(time)![property]! };
  });
  const remaining = rows.flatMap((row) => {
    const selected = removals.get(row.time);
    if (!selected) return [row];
    const next = { ...row };
    for (const property of selected) delete next[property];
    return properties.some((property) => next[property] !== undefined) ? [next] : [];
  });
  const next = setTrackPropertyKeyframes(remaining, edits, properties, true);
  const count = (keys: readonly SparseKeyframe<Property>[]) =>
    keys.reduce((total, row) => total + properties.filter((property) => row[property] !== undefined).length, 0);
  return { rows: next, replacedKeys: count(rows) - count(next) };
}

/** Pure atomic time-only scaling. No frame snapping, duration expansion, pose sampling, or event changes.
 * All references and destinations validate first. External property collisions use the existing
 * group-move replacement policy; selected keys retain exact proportional times, including nearby keys.
 * Unrepresentable duplicate destinations reject the entire operation. Inputs are never mutated/frozen.
 */
export function retimeSelectedKeys<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  selectedKeys: readonly RetimeKeySelection[],
  options: RetimeOptions,
): RetimeResult<Animation> {
  assertFinite(options.scale, 'Retiming scale');
  if (options.scale <= 0) throw new Error('Retiming scale must be greater than zero.');
  if (options.anchor !== 'earliest' && options.anchor !== 'playhead') throw new Error('Unknown retiming anchor.');
  getValidatedEditorAnimation(animation, rig);
  const sources = new Map<string, { ref: RetimeKeySelection; timeMs: Milliseconds }>();
  for (const ref of selectedKeys) {
    const timeMs = toMilliseconds(ref.time);
    if ('kind' in ref && ref.kind !== 'ik') throw new Error('Only bone and IK keyframes can be retimed.');
    const key =
      'kind' in ref
        ? findIKPropertyKeyframe(animation, rig, ref.constraintId, ref.property, timeMs)
        : findBonePropertyKeyframe(
            animation,
            ref.boneId,
            ref.property,
            assertTarget(animation, rig, ref.boneId, ref.property, timeMs),
          );
    normalizeKeyframeTime(animation.duration, timeMs);
    if (!key) throw new Error('Cannot retime a missing keyframe. Select existing authored keys.');
    const canonical: RetimeKeySelection =
      'kind' in ref
        ? { kind: 'ik', constraintId: ref.constraintId, property: ref.property, time: toSeconds(key.time) }
        : { boneId: ref.boneId, property: ref.property, time: toSeconds(key.time) };
    sources.set(identity(canonical), { ref: canonical, timeMs: key.time });
  }
  const resolved = [...sources.values()];
  const keys = resolved.map(({ ref }) => ref);
  const anchorTimeMs =
    options.anchor === 'playhead'
      ? normalizeKeyframeTime(animation.duration, options.playheadTimeMs ?? NaN)
      : resolved.reduce((earliest, key) => Math.min(earliest, key.timeMs), animation.duration);
  const destinations = new Set<string>();
  const changes = resolved.map(({ ref: before, timeMs: beforeTimeMs }): RetimeChange => {
    const proposed = options.scale === 1 ? beforeTimeMs : anchorTimeMs + (beforeTimeMs - anchorTimeMs) * options.scale;
    let timeMs: number;
    try {
      timeMs = normalizeKeyframeTime(animation.duration, proposed);
    } catch {
      throw new Error(
        'Retiming would place keys outside the animation duration. Choose a smaller scale or another anchor.',
      );
    }
    const after = { ...before, time: toSeconds(timeMs) };
    const id = identity(after);
    if (destinations.has(id)) throw new Error('Retiming cannot preserve distinct keys at this time precision.');
    destinations.add(id);
    return { before, after, beforeTimeMs, afterTimeMs: timeMs };
  });
  if (changes.every(({ beforeTimeMs, afterTimeMs }) => beforeTimeMs === afterTimeMs))
    return { animation, keys, changes, anchorTimeMs, replacedKeys: 0 };
  const boneGroups = new Map<string, RetimeChange[]>();
  const ikGroups = new Map<string, RetimeChange[]>();
  for (const change of changes) {
    const ref = change.before;
    const groups = 'kind' in ref ? ikGroups : boneGroups;
    const id = 'kind' in ref ? ref.constraintId : ref.boneId;
    const group = groups.get(id) ?? [];
    group.push(change);
    groups.set(id, group);
  }
  const tracks = { ...animation.tracks };
  const ikTracks = { ...animation.ikTracks };
  let replacedKeys = 0;
  for (const [id, group] of boneGroups) {
    const result = retimeTrack(animation.tracks[id]!, group, transformProperties);
    tracks[id] = result.rows;
    replacedKeys += result.replacedKeys;
  }
  for (const [id, group] of ikGroups) {
    const result = retimeTrack(animation.ikTracks![id]!, group, ikAnimationProperties);
    ikTracks[id] = result.rows;
    replacedKeys += result.replacedKeys;
  }
  const next = {
    ...animation,
    ...(boneGroups.size ? { tracks } : {}),
    ...(ikGroups.size ? { ikTracks } : {}),
  };
  return {
    animation: validateEditedAnimation(next, animation, rig),
    keys: changes.map(({ after }) => after),
    changes,
    anchorTimeMs,
    replacedKeys,
  };
}
