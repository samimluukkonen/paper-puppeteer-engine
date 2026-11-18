import { AnimationPlayer, Joint, meshDeformationIssues } from '../../engine/core.js';
import type { IKAnimationPose, Rig, JointTransform } from '../../engine/data.js';
import type { PoseSource, Puppet } from '../../engine/runtime.js';
import { CHARACTER_PREVIEW_ORIGIN } from '../shared/previewPlacement.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { motionPreviewSampleTime } from './motionPreview.js';
import type { MotionPreviewController } from './MotionPreviewController.js';
import { getCompiledPreviewClip } from './previewClip.js';
import { evaluateWorldDisplacement } from './worldDisplacement.js';

/** Editor-owned runtime player samples the working copy; the puppet still owns rendering and IK. */
export class AnimationEditorPreview {
  private disposed = false;
  private readonly origin: { x: number; y: number };
  private player: AnimationPlayer | undefined;
  private rig: Rig | undefined;
  private joints: Map<string, Joint> | undefined;
  private animation: ReadonlyAnimation | null | undefined;
  private sampledTime: number | undefined;
  private draft: Readonly<Partial<JointTransform>> | undefined;
  private ikDraft: AnimationEditorState['ik']['ikTargetDraft'] | undefined;
  private ikId: string | null | undefined;
  private libraryPose: AnimationEditorState['previews']['previewedPose'] | undefined;
  private detachPoseSource: (() => void) | undefined;
  private readonly unsubscribe: () => void;
  private readonly releasePlacement: (() => void) | undefined;
  private readonly releaseMotion: (() => void) | undefined;

  constructor(
    private readonly state: AnimationEditorState,
    private readonly puppet: Pick<Puppet, 'rig' | 'getBone' | 'attachPoseSource' | 'editPose'> &
      Partial<Pick<Puppet, 'container'>>,
    private readonly motion?: MotionPreviewController,
  ) {
    this.origin = motion
      ? CHARACTER_PREVIEW_ORIGIN
      : { x: puppet.container?.x ?? CHARACTER_PREVIEW_ORIGIN.x, y: puppet.container?.y ?? CHARACTER_PREVIEW_ORIGIN.y };
    this.releasePlacement = motion?.attachPlacement(() => puppet.container!.getWorldTransformMatrix());
    this.refresh();
    this.unsubscribe = state.subscribe(() => this.refresh());
    this.releaseMotion = motion?.subscribe(() => this.refresh());
  }

  refresh(force = false): void {
    if (this.disposed) return;
    const animation = this.state.previewAnimation;
    const time = animation ? this.state.previews.previewTimeMilliseconds : 0;
    const sampledTime = motionPreviewSampleTime(animation, time);
    // The editor owns this top-level preview instance. Bone-local root keys remain untouched;
    // preview-only world offsets stay unscaled; authored root offsets use placement/facing once.
    const container = this.puppet.container;
    if (container) {
      const offset = evaluateWorldDisplacement(
        this.state,
        this.motion?.getSnapshot().settings,
        container.getWorldTransformMatrix(),
      );
      const x = this.origin.x + this.state.previewPlacementOffset.x + offset.x;
      const y = this.origin.y + this.state.previewPlacementOffset.y + offset.y;
      if (container.x !== x || container.y !== y) {
        container.setPosition(x, y);
        force = true; // World-target IK and detached debug overlays must follow placement too.
      }
    }
    if (this.state.editorMode === 'rig') {
      this.detachPoseSource?.();
      this.detachPoseSource = undefined;
      if (force) this.puppet.editPose();
      return;
    }
    const rig = this.state.rig ?? this.puppet.rig;
    // Keep the editor clock continuous while held playback frames reuse their projected pose.
    const draft = this.state.boneTransformDraft;
    const ikDraft = this.state.ik.ikTargetDraft;
    const ikId = this.state.ik.selectedIKConstraintId;
    const libraryPose = this.state.previews.previewedPose;
    if (
      !force &&
      rig === this.rig &&
      animation === this.animation &&
      sampledTime === this.sampledTime &&
      draft === this.draft &&
      ikDraft === this.ikDraft &&
      libraryPose === this.libraryPose &&
      ikId === this.ikId
    )
      return;
    if (animation !== this.animation || rig !== this.rig) {
      // Detached joints carry the current working bind pose. Runtime/source bind data stays immutable.
      const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
      // Compile before replacing the held preview. No data or interpolation lives in the timeline UI.
      // Incompatible topology remains authored and visibly flagged; preview only compatible tracks.
      const compatible = animation?.deformationTracks
        ? {
            ...animation,
            deformationTracks: Object.fromEntries(
              Object.entries(animation.deformationTracks).filter(
                ([id, keys]) => !meshDeformationIssues({ [id]: keys }, rig).length,
              ),
            ),
          }
        : animation;
      const next = animation
        ? new AnimationPlayer(
            rig,
            joints,
            // The editor clock owns wrapping; sampling must retain the exact stepped endpoint for scrubs.
            // Preview is pose-only, including initialization/recompilation at time-zero event markers.
            [getCompiledPreviewClip(compatible!, rig)],
          )
        : undefined;
      this.player?.dispose();
      // Reset sparse animation properties without clearing pose presets or disabling optional IK.
      for (const bone of this.puppet.rig.bones) this.puppet.getBone(bone.id).reset();
      this.player = next;
      this.rig = rig;
      this.joints = joints;
      this.animation = animation;
      if (next && animation) {
        next.play(animation.name);
        next.pause();
      }
    }
    // Restore even untracked temporary properties before sampling. Drafts belong before presets/IK/rendering.
    for (const joint of this.joints?.values() ?? []) joint.reset();
    // Build the pose source as live views over the detached preview joints and player.
    const joints = this.joints;
    const player = this.player;
    const source: PoseSource = {
      pose: joints ? new Map([...joints].map(([id, joint]) => [id, joint.pose])) : undefined,
      get ikAnimation(): IKAnimationPose {
        // Overlay provisional channels without touching compiled clips, runtime targets or ownership.
        const pose = new Map(player?.ikAnimation);
        if (ikId && Object.keys(ikDraft).length) {
          const values = { ...pose.get(ikId) };
          for (const property of ['x', 'y', 'mix'] as const) {
            const value = ikDraft[property];
            if (value !== undefined) values[property] = Object.freeze({ value, weight: 1 });
          }
          pose.set(ikId, Object.freeze(values));
        }
        return pose;
      },
      get meshDeformation() {
        return player?.meshDeformation;
      },
      // Rendering reads the player's live channels, not a per-sample snapshot copy.
      getMeshDeformationForRendering: () => player?.getMeshDeformationForRendering(),
    };
    // Sample the working copy into the detached joints, then attach: the pipeline owns
    // prepare → project, so there is no manual pose copying or prepare/sync call here.
    player?.sample(time, { mode: 'playback' });
    // Editor drafts overlay the sampled pose on the detached joints before projection.
    const selectedId = this.state.selectedBoneId;
    if (selectedId && draft) {
      const joint = joints?.get(selectedId);
      if (joint) Object.assign(joint.pose, draft);
    }
    for (const [id, values] of Object.entries(libraryPose?.bones ?? {})) {
      const joint = joints?.get(id);
      if (joint) Object.assign(joint.pose, values);
    }
    this.detachPoseSource?.();
    this.detachPoseSource = this.puppet.attachPoseSource(source);
    this.sampledTime = sampledTime;
    this.draft = draft;
    this.ikDraft = ikDraft;
    this.ikId = ikId;
    this.libraryPose = libraryPose;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.releaseMotion?.();
    this.releasePlacement?.();
    this.puppet.container?.setPosition(this.origin.x, this.origin.y);
    this.detachPoseSource?.();
    this.detachPoseSource = undefined;
    this.player?.dispose();
    this.player = undefined;
    this.rig = undefined;
    this.joints = undefined;
    this.animation = undefined;
    this.draft = undefined;
    this.ikDraft = undefined;
    this.ikId = undefined;
    this.libraryPose = undefined;
  }
}
