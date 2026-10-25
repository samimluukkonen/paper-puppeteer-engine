import { z } from 'zod';
import { AUDIO_CATEGORIES } from './AudioAsset.js';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneDefinition } from './SceneDefinition.js';
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
/** Pure half-open intervals; no loading, cues, audio nodes or browser interaction.
 * Optional decoded durations override authored metadata at runtime. All times are milliseconds.
 */
export function getActiveAudioClipsAtTime(
  scene: DeepReadonly<SceneDefinition>,
  time: number,
  durations?: ReadonlyMap<string, number>,
): readonly ActiveSceneAudioClip[] {
  if (!Number.isFinite(time) || time < 0 || time >= scene.duration) return [];
  const assets = new Map(scene.audioAssets?.map((asset) => [asset.id, asset]));
  return (scene.audioClips ?? []).flatMap((clip) => {
    const elapsed = time - clip.time;
    if (elapsed < 0 || elapsed >= clip.duration) return [];
    const duration = durations?.get(clip.assetId) ?? (assets.get(clip.assetId)?.durationSeconds ?? Infinity) * 1000;
    const window = duration - clip.sourceOffset;
    if (window <= 0 || (!clip.loop && elapsed >= window)) return [];
    const remaining = Math.min(clip.duration - elapsed, clip.loop ? Infinity : window - elapsed);
    const fadeIn = clip.fadeIn ? Math.min(1, elapsed / clip.fadeIn) : 1;
    const fadeOut = clip.fadeOut ? Math.min(1, (clip.duration - elapsed) / clip.fadeOut) : 1;
    return [
      {
        clip,
        elapsed,
        remaining,
        sourcePosition: clip.sourceOffset + (clip.loop ? elapsed % window : elapsed),
        volume: clip.volume * fadeIn * fadeOut,
      },
    ];
  });
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
