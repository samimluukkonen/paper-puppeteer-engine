import { z } from 'zod';
import { isFullyFrozen, type DeepReadonly } from './readonlyData.js';
import type { SceneActorDefinition } from './SceneDefinition.js';
import { latestSceneInterval } from './sceneIntervals.js';
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

const lineIndices = new WeakMap<readonly Readonly<SceneDialogueLine>[], readonly Readonly<SceneDialogueLine>[]>();
type DialogueActors = readonly DeepReadonly<SceneActorDefinition>[];
const actorIndices = new WeakMap<DialogueActors, ReadonlyMap<string, DeepReadonly<SceneActorDefinition>>>();

function getDialogueActor(actors: DialogueActors | undefined, id: string) {
  if (!actors) return undefined;
  let index = actorIndices.get(actors);
  if (!index) {
    if (!isFullyFrozen(actors)) return actors.find((actor) => actor.id === id);
    index = new Map(actors.map((actor) => [actor.id, actor]));
    actorIndices.set(actors, index);
  }
  return index.get(id);
}

/** Single-subtitle policy: validated lines never overlap; intervals are [time, time + duration). */
export function getDialogueLineAtTime(
  scene: { readonly dialogue?: readonly Readonly<SceneDialogueLine>[] },
  time: number,
): Readonly<SceneDialogueLine> | undefined {
  const lines = scene.dialogue;
  if (!lines || !Number.isFinite(time)) return undefined;
  let sorted = lineIndices.get(lines);
  if (!sorted) {
    if (!isFullyFrozen(lines)) return lines.find((line) => time >= line.time && time < line.time + line.duration);
    sorted = [...lines].sort((a, b) => a.time - b.time);
    lineIndices.set(lines, sorted);
  }
  const line = latestSceneInterval(sorted, time);
  return line && time < line.time + line.duration ? line : undefined;
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
    actor: line.actorId ? getDialogueActor(scene.actors, line.actorId) : undefined,
  };
}

/** An explicit label overrides the Actor ID. Unassociated lines are narration. */
export function dialogueSpeaker(line: Readonly<SceneDialogueLine>): string {
  return line.speakerName || line.actorId || 'Narrator';
}
