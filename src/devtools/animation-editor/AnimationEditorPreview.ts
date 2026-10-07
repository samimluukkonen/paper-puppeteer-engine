import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { AnimationPlayer } from '../../engine/AnimationPlayer.js';
import type { Puppet } from '../../engine/Puppet.js';
import type { JointTransform } from '../../engine/types.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { getCompiledPreviewClip } from './previewClip.js';
import { toMilliseconds } from './timeUnits.js';

/** Editor-owned runtime player samples the working copy; the puppet still owns rendering and IK. */
export class AnimationEditorPreview {
  private player: AnimationPlayer | undefined;
  private animation: ReadonlyAnimation | null | undefined;
  private sampledTime: number | undefined;
  private draft: Readonly<Partial<JointTransform>> | undefined;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly state: AnimationEditorState,
    private readonly puppet: Pick<Puppet, 'rig' | 'getBone' | 'preparePose' | 'syncPose'>,
  ) {
    this.refresh();
    this.unsubscribe = state.subscribe(() => this.refresh());
  }

  private refresh(): void {
    const animation = this.state.workingAnimation;
    const time = animation
      ? this.state.currentTime === this.state.duration
        ? animation.duration
        : Math.min(toMilliseconds(this.state.currentTime), animation.duration)
      : 0;
    // Keep the editor clock continuous while held playback frames reuse their projected pose.
    const sampledTime =
      animation && time !== animation.duration
        ? quantizePlaybackTime(time, animation.playback ?? { mode: 'smooth' })
        : time;
    const draft = this.state.boneTransformDraft;
    if (animation === this.animation && sampledTime === this.sampledTime && draft === this.draft) return;
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
    this.puppet.syncPose();
    this.sampledTime = sampledTime;
    this.draft = draft;
  }

  dispose(): void {
    this.unsubscribe();
    this.player?.dispose();
    this.player = undefined;
  }
}
