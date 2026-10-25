import { z } from 'zod';
import { identifierSchema } from './schemas.js';

const dialogueIdentifier = identifierSchema.regex(/\S/, 'Must contain a non-whitespace character.');

/** Plain text only; time and duration are milliseconds. Actor IDs are scene-local instances. */
export const sceneDialogueLineSchema = z.strictObject({
  id: dialogueIdentifier,
  actorId: dialogueIdentifier.exactOptional(),
  speakerName: z.string().max(1000).exactOptional(),
  text: z.string().max(100000),
  time: z.number().nonnegative(),
  duration: z.number().positive(),
  /** Organizational metadata only. The audio timeline remains the sole playback owner. */
  voiceClipId: dialogueIdentifier.exactOptional(),
});
export type SceneDialogueLine = z.infer<typeof sceneDialogueLineSchema>;

/** Single-subtitle policy: validated lines never overlap; intervals are [time, time + duration). */
export function getDialogueLineAtTime(
  scene: { readonly dialogue?: readonly Readonly<SceneDialogueLine>[] },
  time: number,
): Readonly<SceneDialogueLine> | undefined {
  return scene.dialogue?.find((line) => time >= line.time && time < line.time + line.duration);
}

/** An explicit label overrides the Actor ID. Unassociated lines are narration. */
export function dialogueSpeaker(line: Readonly<SceneDialogueLine>): string {
  return line.speakerName || line.actorId || 'Narrator';
}
