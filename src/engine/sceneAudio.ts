import { z } from 'zod';
import { AUDIO_CATEGORIES } from './AudioAsset.js';
import { isFullyFrozen, type DeepReadonly } from './readonlyData.js';
import type { SceneDefinition } from './SceneDefinition.js';
import { compileSceneIntervals } from './sceneIntervals.js';
import { identifierSchema } from './schemas.js';

/** All scene/source timing uses milliseconds. Media metadata uses durationSeconds. */
export const sceneAudioTrackSchema = z.strictObject({
  id: identifierSchema.regex(/\S/),
  name: identifierSchema.regex(/\S/),
  category: z.enum(AUDIO_CATEGORIES),
});
export const sceneAudioClipSchema = z.strictObject({
  id: identifierSchema.regex(/\S/),
  assetId: identifierSchema.regex(/\S/),
  trackId: identifierSchema.regex(/\S/),
  time: z.number().nonnegative(),
  duration: z.number().positive(),
  sourceOffset: z.number().nonnegative(),
  volume: z.number().min(0).max(1),
  /** Repeat from sourceOffset to media end; the authored scene interval is always finite. */
  loop: z.boolean(),
  /** Dedicated hold-only music/ambience. Its scene interval selects eligible holds. */
  playback: z.enum(['scene', 'dialogue-hold']).exactOptional(),
  fadeIn: z.number().nonnegative().exactOptional(),
  fadeOut: z.number().nonnegative().exactOptional(),
});
export type SceneAudioTrack = z.infer<typeof sceneAudioTrackSchema>;
export type SceneAudioClip = z.infer<typeof sceneAudioClipSchema>;

export interface ActiveSceneAudioClip {
  readonly clip: DeepReadonly<SceneAudioClip>;
  readonly elapsed: number;
  readonly remaining: number;
  readonly sourcePosition: number;
  readonly volume: number;
}
type AudioAssets = NonNullable<DeepReadonly<SceneDefinition>['audioAssets']>;
type AudioClips = NonNullable<DeepReadonly<SceneDefinition>['audioClips']>;
const assetIndices = new WeakMap<AudioAssets, ReadonlyMap<string, number>>();
const clipIndices = new WeakMap<AudioClips, ReturnType<typeof compileAudioClips>>();
const emptyAssets: AudioAssets = Object.freeze([]);
const emptyClips: AudioClips = Object.freeze([]);

function compileAudioClips(clips: AudioClips) {
  const holds = clips.filter((clip) => clip.playback === 'dialogue-hold');
  return {
    at: compileSceneIntervals(
      clips.filter((clip) => clip.playback !== 'dialogue-hold'),
      (clip) => clip.time,
      (clip) => clip.time + clip.duration,
    ),
    holds,
    holdAt: compileSceneIntervals(
      holds,
      (clip) => clip.time,
      (clip) => clip.time + clip.duration,
    ),
    signatures: new Map(clips.map((clip) => [clip.id, JSON.stringify(clip)])),
  };
}

/** Compile once per authored snapshot; frozen branches share indices across unrelated edits.
 * Decoded durations remain live runtime inputs and never enter the authored cache.
 */
export function compileSceneAudio(scene: DeepReadonly<SceneDefinition>) {
  const assets = scene.audioAssets ?? emptyAssets;
  let assetDurations = assetIndices.get(assets);
  if (!assetDurations) {
    assetDurations = new Map(assets.map((asset) => [asset.id, (asset.durationSeconds ?? Infinity) * 1000]));
    if (isFullyFrozen(assets)) assetIndices.set(assets, assetDurations);
  }
  const clips = scene.audioClips ?? emptyClips;
  let index = clipIndices.get(clips);
  if (!index) {
    index = compileAudioClips(clips);
    if (isFullyFrozen(clips)) clipIndices.set(clips, index);
  }
  const durationsByAsset = assetDurations;
  const clipIndex = index;
  const endingHolds = clipIndex.holds.filter((clip) => clip.time + clip.duration === scene.duration);
  return {
    signature: (id: string): string => clipIndex.signatures.get(id)!,
    sampleHold(time: number, elapsed: number, durations: ReadonlyMap<string, number>): readonly ActiveSceneAudioClip[] {
      if (!Number.isFinite(time) || !Number.isFinite(elapsed) || elapsed < 0 || time < 0 || time > scene.duration)
        return [];
      const eligible = time === scene.duration ? endingHolds : clipIndex.holdAt(time);
      return eligible.flatMap((clip) => {
        const window = (durations.get(clip.assetId) ?? 0) - clip.sourceOffset;
        if (window <= 0) return [];
        return [
          {
            clip,
            elapsed,
            remaining: Infinity,
            sourcePosition: clip.sourceOffset + (elapsed % window),
            volume: clip.volume,
          },
        ];
      });
    },
    sample(time: number, durations?: ReadonlyMap<string, number>): readonly ActiveSceneAudioClip[] {
      if (!Number.isFinite(time) || time < 0 || time >= scene.duration) return [];
      const active: ActiveSceneAudioClip[] = [];
      for (const clip of clipIndex.at(time)) {
        const elapsed = time - clip.time;
        const duration = durations?.get(clip.assetId) ?? durationsByAsset.get(clip.assetId) ?? Infinity;
        const window = duration - clip.sourceOffset;
        if (window <= 0 || (!clip.loop && elapsed >= window)) continue;
        const remaining = Math.min(clip.duration - elapsed, clip.loop ? Infinity : window - elapsed);
        const fadeIn = clip.fadeIn ? Math.min(1, elapsed / clip.fadeIn) : 1;
        const fadeOut = clip.fadeOut ? Math.min(1, (clip.duration - elapsed) / clip.fadeOut) : 1;
        active.push({
          clip,
          elapsed,
          remaining,
          sourcePosition: clip.sourceOffset + (clip.loop ? elapsed % window : elapsed),
          volume: clip.volume * fadeIn * fadeOut,
        });
      }
      return active;
    },
  };
}

/** Pure half-open intervals; no loading, cues, audio nodes or browser interaction.
 * Optional decoded durations override authored metadata at runtime. All times are milliseconds.
 */
export function getActiveAudioClipsAtTime(
  scene: DeepReadonly<SceneDefinition>,
  time: number,
  durations?: ReadonlyMap<string, number>,
): readonly ActiveSceneAudioClip[] {
  if (!Number.isFinite(time) || time < 0 || time >= scene.duration) return [];
  return compileSceneAudio(scene).sample(time, durations);
}

/** Non-destructive trim. Left trimming advances the source offset and keeps the scene end fixed.
 * For loops this also changes the repeated source window (sourceOffset through media end).
 */
export function trimSceneAudioClip(
  clip: Readonly<SceneAudioClip>,
  edge: 'start' | 'end',
  time: number,
): SceneAudioClip {
  if (edge === 'end') return { ...clip, duration: time - clip.time };
  const delta = time - clip.time;
  return { ...clip, time, sourceOffset: clip.sourceOffset + delta, duration: clip.duration - delta };
}
