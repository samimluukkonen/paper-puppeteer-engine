import type { PoseDefinition, DeepReadonly, Rig } from '../../engine/data.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { createAnimationVariation, type AnimationVariationOptions } from './animationVariation.js';
import type { PropertyKeyframeTarget } from './keyframeEdits.js';
import { previewMotionCleanup, type MotionDiagnosticOptions } from './motionDiagnostics.js';
import type { Milliseconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

type PreviewState = Pick<
  AnimationEditorState,
  | 'animationAuthoringEnabled'
  | 'hasPendingAnimationEdits'
  | 'rootMotion'
  | 'playback'
  | 'currentTimeMilliseconds'
  | 'poseLibrary'
>;

/**
 * The public `state.previews` domain handle. The facade alone composes the preview animation from the
 * preview snapshots, clears the pose preview around history and pose apply, and resets or reconciles
 * previews for a new session or notification.
 */
export type AnimationEditorPreviewHandle = Omit<
  AnimationEditorPreviewCommands,
  | 'reset'
  | 'clearPose'
  | 'reconcile'
  | 'trajectoryAnimation'
  | 'cleanupAnimation'
  | 'variationAnimation'
  | 'hasIKPreview'
>;

/** Own detached trajectory, cleanup, variation and pose comparisons outside authored document history. */
export class AnimationEditorPreviewCommands {
  constructor(
    private readonly state: PreviewState,
    private readonly document: AnimationEditorDocument,
    private readonly session: AnimationEditActions,
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
    this.session.batch(() => {
      this.session.stopPlayback();
      this.cancelCleanupPreview();
      this.cancelVariationPreview();
      this.state.rootMotion.rootMotionEditing = false;
      this.trajectoryCopy = { base: this.document.workingAnimation!, rig: this.document.rig!, animation };
      this.state.rootMotion.setWorldDisplacementView('authored');
      this.session.notify();
    });
    return true;
  }
  cancelTrajectoryCopy(): boolean {
    if (!this.trajectoryCopy) return false;
    this.trajectoryCopy = null;
    this.session.notify();
    return true;
  }
  commitTrajectoryCopy(): boolean {
    if (!this.trajectoryCopyActive || this.state.hasPendingAnimationEdits || !this.state.animationAuthoringEnabled)
      return false;
    return this.session.batch(() => {
      const animation = this.trajectoryCopy!.animation;
      this.trajectoryCopy = null;
      return this.session.commit(() => animation);
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
    this.session.batch(() => {
      this.session.stopPlayback();
      this.variationPreview = null;
      this.posePreview = null;
      this.cleanupPreview = { base: this.document.workingAnimation!, rig: this.document.rig!, animation, timeMs };
      this.session.notify();
    });
  }
  cancelCleanupPreview(): boolean {
    if (!this.cleanupPreview) return false;
    this.cleanupPreview = null;
    this.session.notify();
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
    return this.session.batch(() => {
      const result = previewMotionCleanup(this.document.workingAnimation!, this.document.rig!, targets, options);
      const next = this.document.inspect(result.animation);
      return !!next && this.session.commit(() => next, { pause: false });
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
    this.session.batch(() => {
      this.session.stopPlayback();
      this.posePreview = null;
      this.cancelCleanupPreview();
      this.variationPreview = {
        base: this.document.workingAnimation!,
        rig: this.document.rig!,
        animation,
        timeMs: animation.duration * progress,
      };
      this.session.notify();
    });
  }

  cancelVariationPreview(): boolean {
    if (!this.variationPreview) return false;
    this.variationPreview = null;
    this.session.notify();
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
    return this.session.batch(() => {
      this.session.stopPlayback();
      this.cancelCleanupPreview();
      this.cancelVariationPreview();
      this.posePreview = {
        pose: this.state.poseLibrary.get(id).pose,
        animation: this.document.workingAnimation!,
        rig: this.document.rig!,
      };
      this.session.notify();
      return true;
    });
  }

  cancelPosePreview(): void {
    if (!this.posePreview) return;
    this.posePreview = null;
    this.session.notify();
  }

  reconcile(): void {
    if (
      this.trajectoryCopy &&
      (!this.trajectoryCopyActive ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        !this.state.rootMotion.rootMotionVisible ||
        this.state.rootMotion.rootMotionEditing)
    )
      this.trajectoryCopy = null;
    if (
      this.cleanupPreview &&
      (!this.cleanupPreviewActive ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        this.state.playback.isPlaying)
    )
      this.cleanupPreview = null;
    if (
      this.variationPreview &&
      (this.variationPreview.base !== this.document.workingAnimation ||
        this.variationPreview.rig !== this.document.rig ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        this.state.playback.isPlaying)
    )
      this.variationPreview = null;
    if (
      this.posePreview &&
      (this.posePreview.animation !== this.document.workingAnimation ||
        this.posePreview.rig !== this.document.rig ||
        !this.state.animationAuthoringEnabled ||
        this.state.hasPendingAnimationEdits ||
        this.state.playback.isPlaying)
    )
      this.posePreview = null;
  }
}
