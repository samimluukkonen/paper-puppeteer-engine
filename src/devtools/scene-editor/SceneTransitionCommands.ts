import type { SceneTransition } from '../../engine/sceneTransitions.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

type CommandState = Pick<SceneEditorDocument, 'replaceScene' | 'selectTransition' | 'workingScene'>;

/** Build transition proposals; the document retains validation, selection and the sole scene history. */
export class SceneTransitionCommands {
  constructor(
    private readonly state: CommandState,
    private readonly finishGestures: () => void,
  ) {}

  addTransition(input: Omit<SceneTransition, 'id'>): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene) return false;
    let index = 1;
    while (scene.transitions?.some((effect) => effect.id === `transition-${index}`)) index++;
    const id = `transition-${index}`;
    if (!this.state.replaceScene({ ...scene, transitions: [...(scene.transitions ?? []), { ...input, id }] }))
      return false;
    this.state.selectTransition(id);
    return true;
  }
  updateTransition(id: string, patch: Partial<Omit<SceneTransition, 'id'>>): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.transitions?.some((effect) => effect.id === id)) return false;
    return this.state.replaceScene({
      ...scene,
      transitions: scene.transitions.map((effect) => (effect.id === id ? { ...effect, ...patch, id } : effect)),
    });
  }
  removeTransition(id: string): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.transitions?.some((effect) => effect.id === id)) return false;
    return this.state.replaceScene({ ...scene, transitions: scene.transitions.filter((effect) => effect.id !== id) });
  }
}
