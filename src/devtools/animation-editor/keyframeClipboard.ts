import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { assertFinite, type TransformProperty } from '../../engine/types.js';
import { freezeData } from '../shared/editorData.js';
import { setBonePropertyKeyframes } from './keyframeEdits.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import type { KeyframeSelection } from './timelineTracks.js';

export interface KeyframeClipboardEntry {
  readonly boneId: string;
  readonly property: TransformProperty;
  /** Authored milliseconds relative to the earliest copied key. */
  readonly relativeTimeMs: number;
  readonly value: number;
}

export interface KeyframeClipboard {
  readonly entries: readonly KeyframeClipboardEntry[];
  readonly anchorTimeMs: number;
}

/** Snapshot only authored property samples. Interpolation is clip-level; no per-key metadata exists. */
export function copyKeyframeSelection(
  animation: DeepReadonly<AnimationClip>,
  keys: readonly KeyframeSelection[],
): KeyframeClipboard | null {
  const resolved = keys.flatMap(({ boneId, property, time }) => {
    const sample = findBonePropertyKeyframe(animation, boneId, property, time * 1000);
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
    entries: samples.map(({ boneId, property, time, value }) => ({
      boneId,
      property,
      relativeTimeMs: time - anchorTimeMs,
      value,
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
  anchorTimeMs: number,
): { animation: Animation; keys: readonly KeyframeSelection[] } {
  assertFinite(anchorTimeMs, 'Clipboard paste anchor');
  if (anchorTimeMs < 0) throw new Error('Clipboard paste anchor must be nonnegative.');
  const edits = clipboard.entries.map(({ boneId, property, relativeTimeMs, value }) => {
    assertFinite(relativeTimeMs, 'Clipboard relative time');
    if (relativeTimeMs < 0) throw new Error('Clipboard relative time must be nonnegative.');
    return { boneId, property, timeMs: anchorTimeMs + relativeTimeMs, value };
  });
  const next = setBonePropertyKeyframes(animation, rig, edits, {
    extendDuration: true,
    preserveTiming: edits.length > 1,
  });
  const keys = edits.map(({ boneId, property, timeMs }) => ({
    boneId,
    property,
    time: findBonePropertyKeyframe(next, boneId, property, timeMs)!.time / 1000,
  }));
  keys.sort((a, b) => a.time - b.time);
  return { animation: next, keys };
}
