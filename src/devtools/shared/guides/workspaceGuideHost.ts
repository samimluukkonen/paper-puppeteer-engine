import type { AnimationEditorState, ReadonlyAnimation } from '../../animation-editor/AnimationEditorState.js';
import type { RigEditorState } from '../../rig-editor/RigEditorState.js';
import type { GuideLaunchHost } from './GuideLauncher.js';
import type { GuideCapability, GuideEditor } from './types.js';

/** Only this workspace adapter reads documents; the guide controller receives capability facts. */
export function workspaceGuideHost(options: {
  initialEditor: GuideEditor;
  getAnimation(): AnimationEditorState | undefined;
  getRig(): RigEditorState | undefined;
  getOnionEnabled?(): boolean;
  navigate(editor: GuideEditor): boolean | 'cancel';
}): GuideLaunchHost {
  // Refresh also runs during playback. Inspect authored keys only when the immutable clip changes.
  let inspectedClip: ReadonlyAnimation | null | undefined;
  let hasBoneKeys = false;
  let hasIKKeys = false;
  return {
    getContext: () => {
      const animation = options.getAnimation();
      const rig = options.getRig();
      const capabilities: GuideCapability[] = ['tool:new-character'];
      if (animation && rig) {
        capabilities.push('character');
        if (!rig.validationPending && !rig.validationIssues().some((issue) => issue.severity === 'error'))
          capabilities.push('valid-rig');
        const clip = animation.workingAnimation;
        if (clip !== inspectedClip) {
          inspectedClip = clip;
          hasBoneKeys =
            !!clip && Object.values(clip.tracks).some((rows) => rows.some((key) => Object.keys(key).length > 1));
          hasIKKeys =
            !!clip &&
            Object.values(clip.ikTracks ?? {}).some((rows) => rows.some((key) => Object.keys(key).length > 1));
        }
        if (clip) {
          capabilities.push('animation');
          if (hasBoneKeys) capabilities.push('bone-keyframes');
          if (hasIKKeys) capabilities.push('ik-keyframes');
        }
        if (animation.selectedBoneId) {
          capabilities.push('selected-bone');
          if (animation.hasKeyframeAtTime(animation.selectedBoneId, 'x')) capabilities.push('selected-x-key');
        }
        if (options.getOnionEnabled?.()) capabilities.push('onion-enabled');
        if (animation.selectedIKConstraintId) capabilities.push('tool:selected-ik');
        if (rig.workingCopy.bones.some((bone) => bone.sprite) || rig.workingCopy.attachments?.length)
          capabilities.push('rig-artwork');
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
      if (editor === 'scene')
        return {
          available: false,
          reason: 'Open Scene Editor from Views to use scene guides. Download unsaved character work before leaving.',
        };
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
