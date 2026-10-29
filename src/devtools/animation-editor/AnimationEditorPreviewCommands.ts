import type { PoseDefinition } from '../../engine/Pose.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { createAnimationVariation, type AnimationVariationOptions } from './animationVariation.js';
import type { PropertyKeyframeTarget } from './keyframeEdits.js';
import { previewMotionCleanup, type MotionDiagnosticOptions } from './motionDiagnostics.js';
import type { Milliseconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

type PreviewState = Pick<
  AnimationEditorState,
  | 'animationAuthoringEnabled'
  | 'hasPendingAnimationEdits'
  | 'rootMotionEditing'
  | 'rootMotionVisible'
  | 'isPlaying'
  | 'currentTimeMilliseconds'
  | 'poseLibrary'
  | 'pause'
  | 'setWorldDisplacementView'
>;

interface PreviewActions {
  batch<Result>(command: () => Result): Result;
  install(animation: ReadonlyAnimation): boolean;
  notify(): void;
}

/** Own detached trajectory, cleanup, variation and pose comparisons outside authored document history. */
export class AnimationEditorPreviewCommands {
  constructor(
    private readonly state: PreviewState,
    private readonly document: AnimationEditorDocument,
    private readonly actions: PreviewActions,
  ) {}
  get trajectoryAnimation(): ReadonlyAnimation | undefined {
    return this.trajectoryCopyActive ? this.trajectoryCopy!.animation : undefined;
  }
  get cleanupAnimation(): ReadonlyAnimation | undefined {
    return this.cleanupPreviewActive ? this.cleanupPreview!.animation : undefined;
  }
  get variationAnimation(): ReadonlyAnimation | undefined {
    return this.variationPreview?.animation;
  }
  get hasIKPreview(): boolean {
    return !!this.variationPreview || this.cleanupPreviewActive;
  }
  clearPose(): void {
    this.posePreview = null;
  }
  reset(): void {
    this.trajectoryCopy = null;
    this.cleanupPreview = null;
    this.variationPreview = null;
    this.posePreview = null;
  }
  private trajectoryCopy: { base: ReadonlyAnimation; rig: Rig; animation: ReadonlyAnimation } | null = null;
  get trajectoryCopyActive(): boolean {
    return (
      !!this.trajectoryCopy &&
      this.trajectoryCopy.base === this.document.workingAnimation &&
      this.trajectoryCopy.rig === this.document.rig
    );
  }
  previewTrajectoryCopy(rootMotion: NonNullable<ReadonlyAnimation['rootMotion']>): boolean {
    if (
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.animationAuthoringEnabled ||
      this.state.hasPendingAnimationEdits
    )
      return false;
    const animation = validateEditedAnimation(
      { ...this.document.workingAnimation, rootMotion },
      this.document.workingAnimation,
      this.document.rig,
    );
    this.actions.batch(() => {
      this.state.pause();
      this.cancelCleanupPreview();
      this.cancelVariationPreview();
      this.state.rootMotionEditing = false;
      this.trajectoryCopy = { base: this.document.workingAnimation!, rig: this.document.rig!, animation };
      this.state.setWorldDisplacementView('authored');
      this.actions.notify();
    });
    return true;
  }
  cancelTrajectoryCopy(): boolean {
    if (!this.trajectoryCopy) return false;
    this.trajectoryCopy = null;
    this.actions.notify();
    return true;
  }
  commitTrajectoryCopy(): boolean {
    if (!this.trajectoryCopyActive || this.state.hasPendingAnimationEdits || !this.state.animationAuthoringEnabled)
      return false;
    return this.actions.batch(() => {
      const animation = this.trajectoryCopy!.animation;
      this.trajectoryCopy = null;
      this.state.pause();
      return this.actions.install(animation);
    });
  }

  private cleanupPreview: { base: ReadonlyAnimation; rig: Rig; animation: ReadonlyAnimation; timeMs: number } | null =
    null;

  get cleanupPreviewActive(): boolean {
    return (
      !!this.cleanupPreview &&
      this.cleanupPreview.base === this.document.workingAnimation &&
      this.cleanupPreview.rig === this.document.rig
    );
  }

  /** Pose-only comparison through the existing runtime canvas; events and authored data stay untouched. */
  previewCleanup(animation: ReadonlyAnimation, timeMs: number): void {
    if (
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.animationAuthoringEnabled ||
      this.state.hasPendingAnimationEdits
    )
      throw new Error('Commit or cancel temporary edits before cleanup preview.');
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > animation.duration) throw new Error('Invalid preview time.');
    getValidatedEditorAnimation(animation, this.document.rig);
    this.actions.batch(() => {
      this.state.pause();
      this.variationPreview = null;
      this.posePreview = null;
      this.cleanupPreview = { base: this.document.workingAnimation!, rig: this.document.rig!, animation, timeMs };
      this.actions.notify();
    });
  }
  cancelCleanupPreview(): boolean {
    if (!this.cleanupPreview) return false;
    this.cleanupPreview = null;
    this.actions.notify();
    return true;
  }
  applyMotionCleanup(
    targets: readonly PropertyKeyframeTarget[],
    options: Partial<MotionDiagnosticOptions> = {},
  ): boolean {
    if (
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.animationAuthoringEnabled ||
      this.state.hasPendingAnimationEdits ||
      !targets.length
    )
      return false;
    return this.actions.batch(() => {
      const result = previewMotionCleanup(this.document.workingAnimation!, this.document.rig!, targets, options);
      const next = this.document.inspect(result.animation);
      return !!next && this.actions.install(next);
    });
  }

  private variationPreview: {
    base: ReadonlyAnimation;
    rig: Rig;
    animation: ReadonlyAnimation;
    timeMs: number;
  } | null = null;

  get previewTimeMilliseconds(): Milliseconds {
    return (
      (this.cleanupPreviewActive ? this.cleanupPreview!.timeMs : undefined) ??
      this.variationPreview?.timeMs ??
      this.state.currentTimeMilliseconds
    );
  }

  /** Pose-only scrub in the existing preview; authored clocks, events and history stay untouched. */
  previewVariation(options: AnimationVariationOptions, progress: number): void {
    if (
      !this.state.animationAuthoringEnabled ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      this.state.hasPendingAnimationEdits
    )
      throw new Error('Commit or cancel temporary edits before previewing a variation.');
    if (!Number.isFinite(progress) || progress < 0 || progress > 1)
      throw new Error('Preview progress must be from 0 to 1.');
    const animation = createAnimationVariation(this.document.workingAnimation, this.document.rig, options);
    this.actions.batch(() => {
      this.state.pause();
      this.posePreview = null;
      this.cancelCleanupPreview();
      this.variationPreview = {
        base: this.document.workingAnimation!,
        rig: this.document.rig!,
        animation,
        timeMs: animation.duration * progress,
      };
      this.actions.notify();
    });
  }

  cancelVariationPreview(): boolean {
    if (!this.variationPreview) return false;
    this.variationPreview = null;
    this.actions.notify();
    return true;
  }

  private posePreview: { pose: DeepReadonly<PoseDefinition>; animation: ReadonlyAnimation; rig: Rig } | null = null;

  get previewedPose(): DeepReadonly<PoseDefinition> | null {
    return this.posePreview?.pose ?? null;
  }

  previewLibraryPose(id: string): boolean {
    if (
      !this.state.animationAuthoringEnabled ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      this.state.hasPendingAnimationEdits ||
      this.state.poseLibrary.compatibility(id, this.document.rig)
    )
      return false;
    return this.actions.batch(() => {
      this.state.pause();
      this.cancelCleanupPreview();
      this.cancelVariationPreview();
      this.posePreview = {
        pose: this.state.poseLibrary.get(id).pose,
        animation: this.document.workingAnimation!,
        rig: this.document.rig!,
      };
      this.actions.notify();
      return true;
    });
  }

  cancelPosePreview(): void {
    if (!this.posePreview) return;
    this.posePreview = null;
    this.actions.notify();
  }

  reconcile(): void {
    if (
      this.trajectoryCopy &&
      (!this.trajectoryCopyActive ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        !this.state.rootMotionVisible ||
        this.state.rootMotionEditing)
    )
      this.trajectoryCopy = null;
    if (
      this.cleanupPreview &&
      (!this.cleanupPreviewActive ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        this.state.isPlaying)
    )
      this.cleanupPreview = null;
    if (
      this.variationPreview &&
      (this.variationPreview.base !== this.document.workingAnimation ||
        this.variationPreview.rig !== this.document.rig ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        this.state.isPlaying)
    )
      this.variationPreview = null;
    if (
      this.posePreview &&
      (this.posePreview.animation !== this.document.workingAnimation ||
        this.posePreview.rig !== this.document.rig ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        this.state.isPlaying)
    )
      this.posePreview = null;
  }
}
