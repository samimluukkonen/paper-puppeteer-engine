import { compileClip } from '../../engine/AnimationClip.js';
import { AnimationPlayer } from '../../engine/AnimationPlayer.js';
import type { Puppet } from '../../engine/Puppet.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';

/** Editor-owned runtime player samples the working copy; the puppet still owns rendering and IK. */
export class AnimationEditorPreview {
  private player: AnimationPlayer | undefined;
  private animation: ReadonlyAnimation | null | undefined;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly state: AnimationEditorState,
    private readonly puppet: Pick<Puppet, 'rig' | 'getBone' | 'preparePose' | 'syncPose' | 'resetToBindPose'>,
  ) {
    this.refresh();
    this.unsubscribe = state.subscribe(() => this.refresh());
  }

  private refresh(): void {
    const animation = this.state.workingAnimation;
    if (animation !== this.animation) {
      // Compile before replacing the held preview. No data or interpolation lives in the timeline UI.
      const next = animation
        ? new AnimationPlayer(
            this.puppet.rig,
            new Map(this.puppet.rig.bones.map((bone) => [bone.id, this.puppet.getBone(bone.id)])),
            // Editor playback is non-looping, including the evaluator's exact stepped endpoint.
            [compileClip({ ...animation, loop: false }, this.puppet.rig)],
          )
        : undefined;
      this.player?.dispose();
      this.puppet.resetToBindPose();
      this.player = next;
      this.animation = animation;
      if (animation) {
        next!.play(animation.name);
        next!.pause();
      }
    }
    this.player?.sample(this.state.currentTime * 1000, { mode: 'playback' }, () => this.puppet.preparePose());
    this.puppet.syncPose();
  }

  dispose(): void {
    this.unsubscribe();
    this.player?.dispose();
    this.player = undefined;
  }
}
