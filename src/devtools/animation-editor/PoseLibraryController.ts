import { notifySubscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

/** Small React bridge; clock notifications do not reset forms or rerender a closed library. */
export class PoseLibraryController {
  state: AnimationEditorState | undefined;
  private release: (() => void) | undefined;
  private revision = 0;
  private facts = '';
  private poses: unknown;
  private rig: unknown;
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
  get selectedBoneIds(): string[] {
    const keys = this.state?.selectedKeys ?? [];
    return [
      ...new Set(
        keys.length ? keys.map((key) => key.boneId) : this.state?.selectedBoneId ? [this.state.selectedBoneId] : [],
      ),
    ];
  }
  get reason(): string {
    if (!this.state?.rig || !this.state.workingAnimation) return 'Select an animation first.';
    if (!this.state.animationAuthoringEnabled) return 'Switch to Animation mode to use poses.';
    if (this.state.hasPendingAnimationEdits) return 'Commit or cancel temporary edits first.';
    return '';
  }
  bind(state: AnimationEditorState): void {
    this.unbind();
    this.state = state;
    this.release = state.subscribe(() => this.refresh());
    this.refresh();
  }
  private refresh(): void {
    const state = this.state;
    const facts = JSON.stringify([
      this.reason,
      this.selectedBoneIds,
      state?.sessionRevision,
      state?.poseLibrary.canUndo,
      state?.poseLibrary.canRedo,
      state?.previewedPose?.library?.id ?? state?.previewedPose?.name,
    ]);
    // Immutable rig/library identities invalidate compatibility. Checking every pose here
    // would repeat the same work on every playback tick, even while the panel is closed.
    if (facts === this.facts && this.poses === state?.poseLibrary.poses && this.rig === state?.rig) return;
    this.facts = facts;
    this.poses = state?.poseLibrary.poses;
    this.rig = state?.rig;
    ++this.revision;
    notifySubscribers(this.listeners, 'Pose library subscribers failed.');
  }
  unbind(): void {
    this.release?.();
    this.release = undefined;
    this.state?.cancelPosePreview();
    this.state = undefined;
    this.refresh();
  }
  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
