import type { SceneDialogueLine } from '../../engine/sceneDialogue.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

export type SceneDialoguePatch = Partial<Omit<SceneDialogueLine, 'id' | 'actorId' | 'speakerName' | 'voiceClipId'>> & {
  actorId?: string | null;
  speakerName?: string | null;
  voiceClipId?: string | null;
};

type State = Pick<SceneEditorDocument, 'workingScene' | 'replaceScene' | 'selectDialogueLine' | 'reportError'>;

/** Proposals use the shared scene validation/history boundary. Text is never normalized. */
export class SceneDialogueCommands {
  constructor(
    private readonly state: State,
    private readonly finishGestures: () => void,
  ) {}

  add(input: Omit<SceneDialogueLine, 'id'>): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene) return false;
    let index = 1;
    while (scene.dialogue?.some((line) => line.id === `dialogue-${index}`)) index++;
    const id = `dialogue-${index}`;
    if (!this.state.replaceScene({ ...scene, dialogue: [...(scene.dialogue ?? []), { ...input, id }] })) return false;
    this.state.selectDialogueLine(id);
    return true;
  }
  update(id: string, patch: SceneDialoguePatch): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.dialogue?.some((line) => line.id === id)) return false;
    return this.state.replaceScene({
      ...scene,
      dialogue: scene.dialogue.map((line) => {
        if (line.id !== id) return line;
        const { actorId, speakerName, voiceClipId, ...properties } = patch;
        const next = { ...line, ...properties, id };
        for (const [field, value] of [
          ['actorId', actorId],
          ['speakerName', speakerName],
          ['voiceClipId', voiceClipId],
        ] as const) {
          if (value === null) delete next[field];
          else if (value !== undefined) next[field] = value;
        }
        return next;
      }),
    });
  }
  remove(id: string): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.dialogue?.some((line) => line.id === id)) return false;
    return this.state.replaceScene({ ...scene, dialogue: scene.dialogue.filter((line) => line.id !== id) });
  }
  duplicate(id: string): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    const line = scene?.dialogue?.find((line) => line.id === id);
    if (!scene || !line) return false;
    let time = line.time + line.duration;
    for (const other of [...(scene.dialogue ?? [])].sort((a, b) => a.time - b.time)) {
      if (other.time + other.duration <= time) continue;
      if (time + line.duration <= other.time) break;
      time = other.time + other.duration;
    }
    if (time + line.duration > scene.duration)
      return this.state.reportError(
        new Error('No room after this dialogue line. Move or shorten lines, or extend the scene before duplicating.'),
      );
    return this.add({ ...line, time });
  }
}
