import { copyPropertyCurve, assertFinite, type PropertyCurve, type TransformProperty } from '../../engine/core.js';
import type { AnimationClip, DeepReadonly, Rig } from '../../engine/data.js';
import { freezeData } from '../shared/editorData.js';
import { setBonePropertyKeyframes } from './keyframeEdits.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import type { KeyframeSelection } from './timelineTracks.js';
import { type Milliseconds, toMilliseconds, toSeconds } from './timeUnits.js';

export interface KeyframeClipboardEntry {
  readonly boneId: string;
  readonly property: TransformProperty;
  /** Authored milliseconds relative to the earliest copied key. */
  readonly relativeTimeMs: Milliseconds;
  readonly value: number;
  readonly curve?: PropertyCurve;
}

export interface KeyframeClipboard {
  readonly entries: readonly KeyframeClipboardEntry[];
  readonly anchorTimeMs: Milliseconds;
}

/** Snapshot authored values and their outgoing controls without sampling runtime poses. */
export function copyKeyframeSelection(
  animation: DeepReadonly<AnimationClip>,
  keys: readonly KeyframeSelection[],
): KeyframeClipboard | null {
  const resolved = keys.flatMap(({ boneId, property, time }) => {
    const sample = findBonePropertyKeyframe(animation, boneId, property, toMilliseconds(time));
    return sample ? [{ boneId, property, ...sample }] : [];
  });
  const samples = [
    ...new Map(
      resolved.map((sample) => [JSON.stringify([sample.boneId, sample.property, sample.time]), sample]),
    ).values(),
  ];
  if (!samples.length) return null;
  samples.sort((a, b) => a.time - b.time);
  const anchorTimeMs = samples[0]!.time;
  return freezeData({
    anchorTimeMs,
    entries: samples.map(({ boneId, property, time, value, curve }) => ({
      boneId,
      property,
      relativeTimeMs: time - anchorTimeMs,
      value,
      ...(curve ? { curve: copyPropertyCurve(curve) } : {}),
    })),
  });
}

/** Reject invalid groups before installation. Like group moves, multi-key paste preserves exact spacing
 * and only replaces external collisions. Single-key paste keeps canonical destination-time behavior.
 */
export function pasteKeyframeClipboard<Animation extends DeepReadonly<AnimationClip>>(
  animation: Animation,
  rig: Rig,
  clipboard: KeyframeClipboard,
  anchorTimeMs: Milliseconds,
): { animation: Animation; keys: readonly KeyframeSelection[] } {
  assertFinite(anchorTimeMs, 'Clipboard paste anchor');
  if (anchorTimeMs < 0) throw new Error('Clipboard paste anchor must be nonnegative.');
  const edits = clipboard.entries.map(({ boneId, property, relativeTimeMs, value, curve }) => {
    assertFinite(relativeTimeMs, 'Clipboard relative time');
    if (relativeTimeMs < 0) throw new Error('Clipboard relative time must be nonnegative.');
    return { boneId, property, timeMs: anchorTimeMs + relativeTimeMs, value, curve: curve ?? null };
  });
  const next = setBonePropertyKeyframes(animation, rig, edits, {
    extendDuration: true,
    preserveTiming: edits.length > 1,
  });
  const keys = edits.map(({ boneId, property, timeMs }) => ({
    boneId,
    property,
    time: toSeconds(findBonePropertyKeyframe(next, boneId, property, timeMs)!.time),
  }));
  keys.sort((a, b) => a.time - b.time);
  return { animation: next, keys };
}
