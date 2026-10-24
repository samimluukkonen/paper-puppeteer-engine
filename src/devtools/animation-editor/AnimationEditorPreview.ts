import { AnimationPlayer } from '../../engine/AnimationPlayer.js';
import type { IKAnimationPose } from '../../engine/ik/AnimationIKPose.js';
import { Joint } from '../../engine/Joint.js';
import type { Puppet } from '../../engine/Puppet.js';
import type { Rig } from '../../engine/Rig.js';
import type { JointTransform } from '../../engine/types.js';
import { CHARACTER_PREVIEW_ORIGIN } from '../shared/previewPlacement.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { evaluatePreviewDisplacement, motionPreviewSampleTime } from './motionPreview.js';
import type { MotionPreviewController } from './MotionPreviewController.js';
import { getCompiledPreviewClip } from './previewClip.js';

/** Editor-owned runtime player samples the working copy; the puppet still owns rendering and IK. */
export class AnimationEditorPreview {
  private disposed = false;
  private player: AnimationPlayer | undefined;
  private rig: Rig | undefined;
  private joints: Map<string, Joint> | undefined;
  private animation: ReadonlyAnimation | null | undefined;
  private sampledTime: number | undefined;
  private draft: Readonly<Partial<JointTransform>> | undefined;
  private ikDraft: AnimationEditorState['ikTargetDraft'] | undefined;
  private ikId: string | null | undefined;
  private libraryPose: AnimationEditorState['previewedPose'] | undefined;
  private readonly ikSource: { ikAnimation: IKAnimationPose } = { ikAnimation: new Map() };
  private readonly unsubscribe: () => void;
  private readonly releaseMotion: (() => void) | undefined;

  constructor(
    private readonly state: AnimationEditorState,
    private readonly puppet: Pick<Puppet, 'rig' | 'getBone' | 'preparePose' | 'syncPose' | 'setIKAnimationSource'> &
      Partial<Pick<Puppet, 'container'>>,
    private readonly motion?: MotionPreviewController,
  ) {
    this.refresh();
    this.unsubscribe = state.subscribe(() => this.refresh());
    this.releaseMotion = motion?.subscribe(() => this.refresh());
  }

  refresh(force = false): void {
    if (this.disposed) return;
    const animation = this.state.previewAnimation;
    const time = animation ? this.state.previewTimeMilliseconds : 0;
    const sampledTime = motionPreviewSampleTime(animation, time);
    // The editor owns this top-level preview instance. Bone-local root keys remain untouched;
    // world offsets are never multiplied by puppet scale or facing and never accumulate.
    const container = this.puppet.container;
    if (this.motion && container) {
      const offset =
        this.state.animationAuthoringEnabled && animation
          ? evaluatePreviewDisplacement(this.motion.getSnapshot().settings, sampledTime)
          : { x: 0, y: 0 };
      const x = CHARACTER_PREVIEW_ORIGIN.x + offset.x;
      const y = CHARACTER_PREVIEW_ORIGIN.y + offset.y;
      if (container.x !== x || container.y !== y) {
        container.setPosition(x, y);
        force = true; // World-target IK and detached debug overlays must follow placement too.
      }
    }
    if (this.state.editorMode === 'rig') {
      this.puppet.setIKAnimationSource(undefined);
      if (force) this.puppet.syncPose();
      return;
    }
    const rig = this.state.rig ?? this.puppet.rig;
    // Keep the editor clock continuous while held playback frames reuse their projected pose.
    const draft = this.state.boneTransformDraft;
    const ikDraft = this.state.ikTargetDraft;
    const ikId = this.state.selectedIKConstraintId;
    const libraryPose = this.state.previewedPose;
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
      const next = animation
        ? new AnimationPlayer(
            rig,
            joints,
            // The editor clock owns wrapping; sampling must retain the exact stepped endpoint for scrubs.
            // Preview is pose-only, including initialization/recompilation at time-zero event markers.
            [getCompiledPreviewClip(animation, rig)],
          )
        : undefined;
      this.player?.dispose();
      // Reset sparse animation properties without clearing pose presets or disabling optional IK.
      this.puppet.preparePose();
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
    this.puppet.preparePose();
    for (const joint of this.joints?.values() ?? []) joint.reset();
    this.player?.sample(time, { mode: 'playback' });
    for (const joint of this.joints?.values() ?? []) Object.assign(this.puppet.getBone(joint.id).pose, joint.pose);
    if (this.state.selectedBoneId) Object.assign(this.puppet.getBone(this.state.selectedBoneId).pose, draft);
    // Reuse sparse absolute local values before the normal single IK solve.
    for (const [id, values] of Object.entries(libraryPose?.bones ?? {}))
      Object.assign(this.puppet.getBone(id).pose, values);
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
    this.puppet.setIKAnimationSource(this.ikSource);
    this.puppet.syncPose();
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
    if (this.motion) this.puppet.container?.setPosition(CHARACTER_PREVIEW_ORIGIN.x, CHARACTER_PREVIEW_ORIGIN.y);
    this.puppet.setIKAnimationSource(undefined);
    this.player?.dispose();
    this.player = undefined;
    this.rig = undefined;
    this.joints = undefined;
    this.animation = undefined;
    this.draft = undefined;
    this.ikDraft = undefined;
    this.ikId = undefined;
    this.libraryPose = undefined;
    this.ikSource.ikAnimation = new Map();
  }
}
