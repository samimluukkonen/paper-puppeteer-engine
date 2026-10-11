import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { AnimationPlayer } from '../../engine/AnimationPlayer.js';
import type { IKAnimationPose } from '../../engine/ik/AnimationIKPose.js';
import type { Puppet } from '../../engine/Puppet.js';
import type { JointTransform } from '../../engine/types.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { getCompiledPreviewClip } from './previewClip.js';

/** Editor-owned runtime player samples the working copy; the puppet still owns rendering and IK. */
export class AnimationEditorPreview {
  private disposed = false;
  private player: AnimationPlayer | undefined;
  private animation: ReadonlyAnimation | null | undefined;
  private sampledTime: number | undefined;
  private draft: Readonly<Partial<JointTransform>> | undefined;
  private ikDraft: AnimationEditorState['ikTargetDraft'] | undefined;
  private ikId: string | null | undefined;
  private readonly ikSource: { ikAnimation: IKAnimationPose } = { ikAnimation: new Map() };
  private readonly unsubscribe: () => void;

  constructor(
    private readonly state: AnimationEditorState,
    private readonly puppet: Pick<Puppet, 'rig' | 'getBone' | 'preparePose' | 'syncPose' | 'setIKAnimationSource'>,
  ) {
    this.refresh();
    this.unsubscribe = state.subscribe(() => this.refresh());
  }

  private refresh(): void {
    if (this.disposed) return;
    const animation = this.state.workingAnimation;
    const time = animation ? this.state.currentTimeMilliseconds : 0;
    // Keep the editor clock continuous while held playback frames reuse their projected pose.
    const sampledTime =
      animation && time !== animation.duration
        ? quantizePlaybackTime(time, animation.playback ?? { mode: 'smooth' })
        : time;
    const draft = this.state.boneTransformDraft;
    const ikDraft = this.state.ikTargetDraft;
    const ikId = this.state.selectedIKConstraintId;
    if (
      animation === this.animation &&
      sampledTime === this.sampledTime &&
      draft === this.draft &&
      ikDraft === this.ikDraft &&
      ikId === this.ikId
    )
      return;
    if (animation !== this.animation) {
      // Compile before replacing the held preview. No data or interpolation lives in the timeline UI.
      const next = animation
        ? new AnimationPlayer(
            this.puppet.rig,
            new Map(this.puppet.rig.bones.map((bone) => [bone.id, this.puppet.getBone(bone.id)])),
            // The editor clock owns wrapping; sampling must retain the exact stepped endpoint for scrubs.
            // Preview is pose-only, including initialization/recompilation at time-zero event markers.
            [getCompiledPreviewClip(animation, this.puppet.rig)],
          )
        : undefined;
      this.player?.dispose();
      // Reset sparse animation properties without clearing pose presets or disabling optional IK.
      this.puppet.preparePose();
      for (const bone of this.puppet.rig.bones) this.puppet.getBone(bone.id).reset();
      this.player = next;
      this.puppet.setIKAnimationSource(this.ikSource);
      this.animation = animation;
      if (next && animation) {
        next.play(animation.name);
        next.pause();
      }
    }
    // Restore even untracked temporary properties before sampling. Drafts belong before presets/IK/rendering.
    this.puppet.preparePose();
    for (const bone of this.puppet.rig.bones) this.puppet.getBone(bone.id).reset();
    this.player?.sample(time, { mode: 'playback' });
    if (this.state.selectedBoneId) Object.assign(this.puppet.getBone(this.state.selectedBoneId).pose, draft);
    // Overlay provisional channels without touching compiled clips, runtime targets or ownership.
    const pose = new Map(this.player?.ikAnimation);
    if (ikId && Object.keys(ikDraft).length) {
      const values = { ...pose.get(ikId) };
      for (const property of ['x', 'y', 'mix'] as const) {
        const value = ikDraft[property];
        if (value !== undefined) values[property] = Object.freeze({ value, weight: 1 });
      }
      pose.set(ikId, Object.freeze(values));
    }
    this.ikSource.ikAnimation = pose;
    this.puppet.syncPose();
    this.sampledTime = sampledTime;
    this.draft = draft;
    this.ikDraft = ikDraft;
    this.ikId = ikId;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.puppet.setIKAnimationSource(undefined);
    this.player?.dispose();
    this.player = undefined;
    this.animation = undefined;
    this.draft = undefined;
    this.ikDraft = undefined;
    this.ikId = undefined;
    this.ikSource.ikAnimation = new Map();
  }
}
