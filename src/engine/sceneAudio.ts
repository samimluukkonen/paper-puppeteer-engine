import { z } from 'zod';
import { AUDIO_CATEGORIES } from './AudioAsset.js';
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
