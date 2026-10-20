import type { SceneEditorDocument } from '../../scene-editor/SceneEditorDocument.js';
import type { GuideLaunchHost } from './GuideLauncher.js';
import type { GuideCapability } from './types.js';

/** Read authored selection facts only; guides never execute scene commands or playback. */
export function sceneGuideHost(document: SceneEditorDocument): GuideLaunchHost {
  return {
    getContext: () => {
      const scene = document.workingScene;
      const capabilities: GuideCapability[] = [];
      if (scene) capabilities.push('tool:scene');
      if (document.selectedActorId) capabilities.push('tool:scene-actor');
      if (document.selectedActionId) capabilities.push('tool:scene-action');
      if (scene?.actors.length) capabilities.push('tool:scene-actors');
      return { editor: 'scene', capabilities };
    },
    getNavigationAvailability: (editor) =>
      editor === 'scene'
        ? { available: true }
        : {
            available: false,
            reason: 'Open the character editor from Views to use its guides. Download unsaved scenes before leaving.',
          },
    navigate: (editor) => editor === 'scene',
  };
}
