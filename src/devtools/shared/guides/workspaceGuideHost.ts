import type { AnimationEditorState } from '../../animation-editor/AnimationEditorState.js';
import type { RigEditorState } from '../../rig-editor/RigEditorState.js';
import type { GuideLaunchHost } from './GuideLauncher.js';
import type { GuideCapability, GuideEditor } from './types.js';

/** Only this workspace adapter reads documents; the guide controller receives capability facts. */
export function workspaceGuideHost(options: {
  initialEditor: GuideEditor;
  getAnimation(): AnimationEditorState | undefined;
  getRig(): RigEditorState | undefined;
  navigate(editor: GuideEditor): boolean | 'cancel';
}): GuideLaunchHost {
  return {
    getContext: () => {
      const animation = options.getAnimation();
      const rig = options.getRig();
      const capabilities: GuideCapability[] = ['tool:new-character'];
      if (animation && rig) {
        capabilities.push('character');
        if (!rig.validationPending && !rig.validationIssues().some((issue) => issue.severity === 'error'))
          capabilities.push('valid-rig');
        if (animation.workingAnimation) capabilities.push('animation');
        if (rig.workingCopy.ik?.length) capabilities.push('ik-constraints');
        capabilities.push('tool:rig-hierarchy', 'tool:animation-timeline');
        // Mode switching is a UI tool, unavailable while switching would discard a preview.
        if (!animation.hasPendingAnimationEdits) capabilities.push('tool:editor-navigation');
      }
      return {
        editor: animation ? (animation.editorMode === 'rig' ? 'rig' : 'animation') : options.initialEditor,
        capabilities,
      };
    },
    getNavigationAvailability: (editor) => {
      const animation = options.getAnimation();
      if (!animation)
        return editor === options.initialEditor
          ? { available: true }
          : { available: false, reason: 'The character workspace is not ready to switch editors.' };
      if (animation.editorMode !== editor && animation.hasPendingAnimationEdits)
        return {
          available: false,
          reason: 'Commit or revert uncommitted animation previews before starting a guide in another editor mode.',
        };
      return { available: true };
    },
    navigate: (editor) => options.navigate(editor),
  };
}
