import { z } from 'zod';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneActorDefinition } from './SceneDefinition.js';
import { identifierSchema } from './schemas.js';
import { assertFinite } from './types.js';

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

export interface ActiveSceneDialogue {
  readonly line: Readonly<SceneDialogueLine>;
  /** Explicit label, then scene-local Actor ID; undefined for unlabelled narration. */
  readonly speaker: string | undefined;
  /** Authored speaker metadata, never a temporary runtime Actor instance. */
  readonly actor: DeepReadonly<SceneActorDefinition> | undefined;
}

/** Render state, including passive seeks. This is not a gameplay/event callback. */
export interface SceneDialogueTarget {
  setDialogue(dialogue: ActiveSceneDialogue | undefined): void;
}

/** Pure half-open interval evaluation. Missing Actors still display their authored ID;
 * complete scene validation rejects dangling speaker references before playback.
 */
export function getDialogueAtTime(
  scene: {
    readonly dialogue?: readonly Readonly<SceneDialogueLine>[];
    readonly actors?: readonly DeepReadonly<SceneActorDefinition>[];
  },
  time: number,
): ActiveSceneDialogue | undefined {
  assertFinite(time, 'Dialogue sample time');
  const line = getDialogueLineAtTime(scene, time);
  if (!line) return undefined;
  return {
    line,
    speaker: line.speakerName || line.actorId,
    actor: line.actorId ? scene.actors?.find((actor) => actor.id === line.actorId) : undefined,
  };
}

/** An explicit label overrides the Actor ID. Unassociated lines are narration. */
export function dialogueSpeaker(line: Readonly<SceneDialogueLine>): string {
  return line.speakerName || line.actorId || 'Narrator';
}
