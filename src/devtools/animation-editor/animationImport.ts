import { compileClip, type AnimationClip, type CompiledClip } from '../../engine/AnimationClip.js';
import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { evaluateClip } from '../../engine/AnimationPose.js';
import { inspectAnimationDefinition, type ValidationIssue } from '../../engine/externalData.js';
import { assertJsonInputSize } from '../../engine/jsonInput.js';
import type { Rig } from '../../engine/Rig.js';
import { transformProperties } from '../../engine/types.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import { serializeAnimation } from './animationSerialization.js';
import { inspectEditorAnimation } from './validatedAnimation.js';

export type AnimationImportResult =
  | { success: true; data: ReadonlyAnimation; issues: readonly ValidationIssue[] }
  | { success: false; issues: readonly ValidationIssue[] };

/** Shared paste/file boundary: unknown JSON becomes an owned snapshot only after strict file/rig validation. */
export function importAnimationJson(json: string, rig?: Rig): AnimationImportResult {
  let input: unknown;
  try {
    assertJsonInputSize(json);
    if (!json.trim()) return { success: false, issues: [{ severity: 'error', message: 'Animation JSON is empty.' }] };
    input = JSON.parse(json);
  } catch (error) {
    return {
      success: false,
      issues: [
        { severity: 'error', message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` },
      ],
    };
  }
  if (!rig)
    return {
      success: false,
      issues: [{ severity: 'error', message: 'Load a character before importing an animation.' }],
    };
  const result = inspectEditorAnimation(input, rig);
  if (!result.data) return { success: false, issues: result.issues };
  return {
    success: true,
    data: result.data,
    issues: result.issues,
  };
}

export type AnimationRoundTripResult =
  | {
      success: true;
      equivalent: boolean;
      posesEquivalent: boolean;
      playbackEquivalent: boolean;
      /** Representative evaluator times in authored milliseconds. */
      sampleTimes: readonly number[];
      json: string;
      reexportedJson: string;
      data: ReadonlyAnimation;
    }
  | { success: false; issues: readonly ValidationIssue[] };

/** Dev/test comparison reuses the runtime compiler, evaluator and FPS quantization. No events are dispatched. */
export function compareEvaluatedAnimationPoses(original: AnimationClip, reloaded: AnimationClip, rig: Rig) {
  const before = compileClip(original, rig);
  const after = compileClip(reloaded, rig);
  const times = new Set([
    0,
    before.duration,
    after.duration,
    ...[original, reloaded].flatMap((clip) =>
      Object.values(clip.tracks).flatMap((keys) => keys.map((key) => key.time)),
    ),
  ]);
  const keys = [...times].sort((a, b) => a - b);
  for (let index = 1; index < keys.length; ++index) times.add(keys[index - 1]! + (keys[index]! - keys[index - 1]!) / 2);
  for (const clip of [before, after]) {
    times.add(clip.duration - Math.min(1e-6, clip.duration / 1000));
    if (clip.playback?.mode !== 'stepped') continue;
    const step = 1000 / clip.playback.fps;
    if (!Number.isFinite(step)) continue;
    // Probe frame holds/boundaries near keys and endpoints, without iterating every frame of a long clip.
    for (const key of keys) {
      const frame = Math.floor(key / step) * step;
      for (const time of [frame, frame + step / 2, frame + step])
        if (Number.isFinite(time) && time >= 0 && time <= clip.duration) times.add(time);
    }
  }
  const sampleTimes = [...times].sort((a, b) => a - b);
  const playbackTime = (clip: CompiledClip, time: number): number =>
    time === clip.duration ? time : quantizePlaybackTime(time, clip.playback ?? { mode: 'smooth' });
  const compare = (playback: boolean): boolean =>
    sampleTimes.every((time) => {
      const left = evaluateClip(before, playback ? playbackTime(before, time) : time);
      const right = evaluateClip(after, playback ? playbackTime(after, time) : time);
      if (left.size !== right.size) return false;
      for (const [bone, values] of left) {
        const other = right.get(bone);
        if (!other) return false;
        for (const property of transformProperties) {
          const a = values[property];
          const b = other[property];
          if (a === b) continue;
          if (a === undefined || b === undefined || Math.abs(a - b) > 1e-10 * Math.max(1, Math.abs(a), Math.abs(b)))
            return false;
        }
      }
      return true;
    });
  return { posesEquivalent: compare(false), playbackEquivalent: compare(true), sampleTimes };
}

/** Canonical stability plus original/reloaded raw and playback pose equivalence at representative times. */
export function verifyAnimationRoundTrip(input: unknown, rig: Rig): AnimationRoundTripResult {
  const original = inspectAnimationDefinition(input, rig);
  if (!original.data) return { success: false, issues: original.issues };
  const exported = serializeAnimation(input, rig);
  if (!exported.success) return exported;
  const imported = importAnimationJson(exported.json, rig);
  if (!imported.success) return imported;
  const reexported = serializeAnimation(imported.data, rig);
  if (!reexported.success) return reexported;
  const comparison = compareEvaluatedAnimationPoses(original.data, imported.data, rig);
  return {
    success: true,
    equivalent: exported.json === reexported.json && comparison.posesEquivalent && comparison.playbackEquivalent,
    ...comparison,
    json: exported.json,
    reexportedJson: reexported.json,
    data: imported.data,
  };
}
