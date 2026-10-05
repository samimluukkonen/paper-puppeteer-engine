import { compileClip } from '../../engine/AnimationClip.js';
import { AnimationPlayer } from '../../engine/AnimationPlayer.js';
import type { Puppet } from '../../engine/Puppet.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';

/** Editor-owned runtime player samples the working copy; the puppet still owns rendering and IK. */
export class AnimationEditorPreview {
  private player: AnimationPlayer | undefined;
  private animation: ReadonlyAnimation | null | undefined;
  private sampledTime: number | undefined;
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
    const time = this.state.currentTime;
    if (animation === this.animation && time === this.sampledTime) return;
    if (animation !== this.animation) {
      // Compile before replacing the held preview. No data or interpolation lives in the timeline UI.
      const next = animation
        ? new AnimationPlayer(
            this.puppet.rig,
            new Map(this.puppet.rig.bones.map((bone) => [bone.id, this.puppet.getBone(bone.id)])),
            // The editor clock owns wrapping; sampling must retain the exact stepped endpoint for scrubs.
            // Preview is pose-only, including initialization/recompilation at time-zero event markers.
            [compileClip({ ...animation, loop: false, events: [] }, this.puppet.rig)],
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
    this.player?.sample(time * 1000, { mode: 'playback' }, () => this.puppet.preparePose());
    this.puppet.syncPose();
    this.sampledTime = time;
  }

  dispose(): void {
    this.unsubscribe();
    this.player?.dispose();
    this.player = undefined;
  }
}
