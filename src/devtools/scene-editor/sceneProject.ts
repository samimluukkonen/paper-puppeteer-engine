import { useProjectContext } from '../../ui/projectContext.js';
import type { SceneEditorContext } from '../project/projectBridge.js';

/** The project scene host, or undefined when the scene editor runs standalone. */
export function useSceneProject(): SceneEditorContext | undefined {
  const project = useProjectContext();
  return project?.kind === 'scene' ? project : undefined;
}
