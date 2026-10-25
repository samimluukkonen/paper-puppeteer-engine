import { localToWorld, type Affine } from '../../engine/affineMath.js';
import { evaluateRootMotion, evaluateRootMotionAtElapsedTime, sampleRootMotion } from '../../engine/rootMotion.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { evaluatePreviewDisplacement, motionPreviewSampleTime, type MotionPreviewSettings } from './motionPreview.js';
import { rootMotionMatrix } from './rootMotionCoordinates.js';

export type WorldDisplacementMode = 'authored' | 'preview' | 'none';
export type RootLoopMode = 'reset' | 'continuous';

/** One absolute world offset shared by placement and follow camera. Never integrates frame deltas. */
export function evaluateWorldDisplacement(
  state: AnimationEditorState,
  settings: MotionPreviewSettings | undefined,
  placement: Affine,
): { x: number; y: number } {
  const animation = state.previewAnimation;
  if (!animation || !state.animationAuthoringEnabled) return { x: 0, y: 0 };
  const time = motionPreviewSampleTime(animation, state.previewTimeMilliseconds);
  if (state.worldDisplacementMode === 'preview')
    return settings ? evaluatePreviewDisplacement(settings, time) : { x: 0, y: 0 };
  if (state.worldDisplacementMode !== 'authored') return { x: 0, y: 0 };
  let root = evaluateRootMotion(animation, time);
  if (state.rootMotionDragActive) {
    const initial = sampleRootMotion(animation, 0);
    root = { x: state.rootPosition.x - initial.x, y: state.rootPosition.y - initial.y };
  } else if (state.rootLoopMode === 'continuous' && state.previewLoop && !state.rootMotionEditing) {
    // Keep the pose clock's exact held phase: summing unwrapped floating-point time can otherwise
    // quantize a root one frame ahead of the skeleton after many fractional updates.
    const cycles = Math.max(
      0,
      Math.round((state.previewElapsedTimeMilliseconds - state.previewTimeMilliseconds) / animation.duration),
    );
    const accumulated = evaluateRootMotionAtElapsedTime(animation, cycles * animation.duration, { loop: true });
    root = { x: root.x + accumulated.x, y: root.y + accumulated.y };
  }
  return localToWorld(root, rootMotionMatrix(placement, { x: 0, y: 0 }));
}
