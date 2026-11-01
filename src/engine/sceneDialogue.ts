import { z } from 'zod';
import { isFullyFrozen, type DeepReadonly } from './readonlyData.js';
import type { SceneActorDefinition } from './SceneDefinition.js';
import { latestSceneInterval } from './sceneIntervals.js';
import { identifierSchema } from './schemas.js';
import { assertFinite } from './types.js';

const dialogueIdentifier = identifierSchema.regex(/\S/, 'Must contain a non-whitespace character.');

/** Plain text only; time and duration are milliseconds. Actor IDs are scene-local instances. */
export const sceneDialogueLineSchema = z
  .strictObject({
    id: dialogueIdentifier,
    actorId: dialogueIdentifier.exactOptional(),
    speakerName: z.string().max(1000).exactOptional(),
    text: z.string().max(100000),
    time: z.number().nonnegative(),
    duration: z.number().nonnegative(),
    /** Omitted means timed. Hold duration controls passive preview only; zero is a point sample. */
    progression: z.enum(['timed', 'advance-required']).exactOptional(),
    /** Organizational metadata only. The audio timeline remains the sole playback owner. */
    voiceClipId: dialogueIdentifier.exactOptional(),
  })
  .refine((line) => line.duration > 0 || line.progression === 'advance-required', {
    path: ['duration'],
    message: 'Timed dialogue duration must be positive.',
  });
export type SceneDialogueLine = z.infer<typeof sceneDialogueLineSchema>;

type DialogueGroup = { readonly time: number; readonly lines: readonly Readonly<SceneDialogueLine>[] };
const lineIndices = new WeakMap<readonly Readonly<SceneDialogueLine>[], readonly DialogueGroup[]>();

/** Locale-independent stable order, including simultaneous holds. */
export function compareDialogueLines(a: Readonly<SceneDialogueLine>, b: Readonly<SceneDialogueLine>): number {
  return a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function dialogueGroups(lines: readonly Readonly<SceneDialogueLine>[]): readonly DialogueGroup[] {
  const groups: { time: number; lines: Readonly<SceneDialogueLine>[] }[] = [];
  for (const line of [...lines].sort(compareDialogueLines)) {
    const last = groups.at(-1);
    if (last?.time === line.time) last.lines.push(line);
    else groups.push({ time: line.time, lines: [line] });
  }
  return groups;
}
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

/** Pure preview: half-open intervals, with point holds visible exactly at their start.
 * Simultaneous holds preview the first active line in stable ID order, without waiting.
 */
export function getDialogueLineAtTime(
  scene: { readonly dialogue?: readonly Readonly<SceneDialogueLine>[] },
  time: number,
): Readonly<SceneDialogueLine> | undefined {
  const lines = scene.dialogue;
  if (!lines || !Number.isFinite(time)) return undefined;
  let sorted = lineIndices.get(lines);
  if (!sorted) {
    sorted = dialogueGroups(lines);
    if (isFullyFrozen(lines)) lineIndices.set(lines, sorted);
  }
  return latestSceneInterval(sorted, time)?.lines.find(
    (line) => time < line.time + line.duration || (line.duration === 0 && time === line.time),
  );
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

/** Pure interval/point evaluation. Missing Actors still display their authored ID;
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
