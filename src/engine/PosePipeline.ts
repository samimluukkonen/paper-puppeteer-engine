import { type AnimationClip, type CompiledClip, compileClip } from './AnimationClip.js';
import { AnimationPlayer, type PoseHooks } from './AnimationPlayer.js';
import type { Bone } from './Bone.js';
import type { IKAnimationPose } from './ik/AnimationIKPose.js';
import { IKPoseState } from './ik/IKPoseState.js';
import type { TwoBoneIKConstraint } from './ik/TwoBoneIKConstraint.js';
import type { IKTransformContext } from './ik/types.js';
import type { MeshDeformationPose } from './meshDeformation.js';
import { applyPoseToJoints, type PoseDefinition, serializePose } from './Pose.js';
import type { Rig } from './Rig.js';
import type { RootMotionApplication } from './rootMotion.js';
import { assertFinite, type JointTransform } from './types.js';

export interface SyncPoseOptions {
  /** Defer overlays during repeated solves; call refreshDebugViews() after the final pass. */
  updateDebug?: boolean;
}

/** External pose channels attached for previews. Absent channels fall back to the runtime player. */
export interface PoseSource {
  /** Sampled bone-local pose keyed by bone id; projected after presets and before IK. */
  readonly pose?: ReadonlyMap<string, Readonly<JointTransform>> | undefined;
  readonly ikAnimation?: IKAnimationPose | undefined;
  readonly meshDeformation?: MeshDeformationPose | undefined;
}

interface PoseProjection {
  sync(deformMeshes?: boolean): void;
  syncBone(id: string): void;
  syncMeshes?(): void;
}

export interface PosePipelineOptions {
  readonly rig: Rig;
  readonly bones: ReadonlyMap<string, Bone>;
  readonly clips: readonly CompiledClip[];
  readonly ikConstraints: ReadonlyMap<string, TwoBoneIKConstraint>;
  readonly ikContext: IKTransformContext;
  readonly renderer: PoseProjection;
  readonly updateDebugViews: (constraints: readonly TwoBoneIKConstraint[]) => void;
  readonly rootMotion?: RootMotionApplication | undefined;
  /** Host-facing pose hooks; defaults to the pipeline's own prepare/synchronize. */
  readonly poseHooks?: PoseHooks | undefined;
}

/** @internal Owns the pose-sync protocol: player hooks, presets, IK passes, source swapping and revisions.
 * Puppet supplies bones, rendering, and overlays; callers use prepare → edit/sample → synchronize.
 */
export class PosePipeline {
  readonly player: AnimationPlayer;
  private readonly ikPose = new IKPoseState();
  private readonly sortedIK: TwoBoneIKConstraint[] = [];
  private activePose: { pose: PoseDefinition; mix: number } | undefined;
  private readonly poseUnderlying = new Map<string, Partial<JointTransform>>();
  private poseSource: PoseSource | undefined;
  private projectedPose: ReadonlyMap<string, Readonly<JointTransform>> | undefined;
  private poseRevision = 0;
  private synchronizedPoseRevision = -1;
  private destroyed = false;

  constructor(private readonly options: PosePipelineOptions) {
    this.player = new AnimationPlayer(options.rig, options.bones, options.clips, {
      rootMotion: options.rootMotion,
      poseHooks: options.poseHooks ?? {
        prepare: () => this.preparePose(),
        synchronize: () => this.syncPose(),
      },
    });
  }

  private get bones(): ReadonlyMap<string, Bone> {
    return this.options.bones;
  }

  private getBone(id: string): Bone {
    const bone = this.bones.get(id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  /** Attach external pose channels; the returned function detaches them (restoring the runtime player). */
  attachPoseSource(source: PoseSource | undefined): () => void {
    if (this.destroyed) throw new Error('Puppet has been destroyed.');
    this.poseSource = source;
    this.projectedPose = undefined;
    this.markPoseDirty();
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      if (this.poseSource === source) this.poseSource = undefined;
      this.markPoseDirty();
    };
  }

  /** Preview a clip at milliseconds: prepare → sample → project, without moving runtime clocks. */
  previewClip(clip: AnimationClip | CompiledClip, timeMs: number): void {
    if (this.destroyed) throw new Error('Puppet has been destroyed.');
    assertFinite(timeMs, 'Preview time');
    const compiled = (
      Array.isArray(clip.tracks) ? clip : compileClip(clip as AnimationClip, this.options.rig)
    ) as CompiledClip;
    this.preparePose();
    const player = new AnimationPlayer(this.options.rig, this.bones, [compiled]);
    player.setPreviewMode(true);
    try {
      player.play(compiled.name);
      player.pause();
      player.sample(timeMs, { mode: 'playback' });
    } finally {
      player.dispose();
    }
    this.syncPose();
  }

  setActivePose(pose: PoseDefinition, mix: number): void {
    this.activePose = { pose, mix };
  }

  clearActivePose(): void {
    this.activePose = undefined;
  }

  commitPoseForEditing(): void {
    this.ikPose.restore();
    this.poseUnderlying.clear();
    this.activePose = undefined;
  }

  exportPose(name: string, options?: { epsilon?: number; onlyChanged?: boolean }): PoseDefinition {
    const authored = new Map(
      [...this.bones].map(([id, bone]) => [
        id,
        {
          bindPose: bone.bindPose,
          pose: { ...bone.pose, rotation: this.ikPose.authoredRotation(bone) },
        },
      ]),
    );
    return serializePose(name, authored, options);
  }

  getOrderedConstraints(reuse = false): TwoBoneIKConstraint[] {
    // Refill in registration order so priority changes retain stable ties.
    // Debug calls use their own list, including calls made by target providers.
    const constraints = reuse ? this.sortedIK : [];
    constraints.length = 0;
    for (const constraint of this.options.ikConstraints.values()) constraints.push(constraint);
    return constraints.sort((a, b) => a.priority - b.priority);
  }

  private syncIKBone(bone: Bone, rotationBefore: number): void {
    const { pose, container } = bone;
    if (
      pose.x === container.x &&
      pose.y === container.y &&
      // Phaser wraps container rotations, so compare the authored values directly.
      pose.rotation === rotationBefore &&
      pose.scaleX === container.scaleX &&
      pose.scaleY === container.scaleY
    )
      return;
    bone.syncTransform();
    this.options.renderer.syncBone(bone.id);
  }

  /** Restore the pre-IK pose before externally sampling animation or editing it. */
  preparePose(): void {
    this.markPoseDirty();
    this.ikPose.restore();
    for (const [id, values] of this.poseUnderlying) Object.assign(this.getBone(id).pose, values);
    this.poseUnderlying.clear();
  }

  /** Apply the evaluated pose, solve IK in priority order, then project rendering. */
  syncPose(options: SyncPoseOptions = {}): void {
    if (this.destroyed) return;
    const revision = this.poseRevision;
    try {
      this.ikPose.restore();
      for (const [id, values] of this.poseUnderlying) Object.assign(this.getBone(id).pose, values);
      this.poseUnderlying.clear();
      // Project a newly attached source pose once; later syncs keep direct bone edits and
      // only re-read the live IK/deformation channels.
      const sourcePose = this.poseSource?.pose;
      if (sourcePose && sourcePose !== this.projectedPose) {
        for (const [id, values] of sourcePose) Object.assign(this.getBone(id).pose, values);
        this.projectedPose = sourcePose;
      }
      if (this.activePose)
        applyPoseToJoints(this.activePose.pose, this.bones, this.activePose.mix, this.poseUnderlying);
      for (const bone of this.bones.values()) bone.syncTransform();
      this.options.renderer.sync(false);
      this.solveIK(options);
      this.synchronizedPoseRevision = revision;
    } catch (error) {
      // Retry incomplete projection even when this was an explicit sync of a clean pose.
      this.markPoseDirty();
      throw error;
    }
  }

  /** Rerun constraints after changing targets, mix, enabled state, offsets, bend direction, or priorities.
   * Use syncPose() first whenever authored poses or skeleton transforms have changed.
   * Retains active pose presets and projects only the restored/solved IK joints.
   */
  syncIK(options: SyncPoseOptions = {}): void {
    if (this.destroyed) return;
    try {
      this.ikPose.restore((joint) => {
        const bone = this.getBone(joint.id);
        bone.syncTransform();
        this.options.renderer.syncBone(bone.id);
      });
      this.solveIK(options);
    } catch (error) {
      this.markPoseDirty();
      throw error;
    }
  }

  private solveIK(options: SyncPoseOptions): void {
    const constraints = this.getOrderedConstraints(true);
    const animation = this.poseSource?.ikAnimation ?? this.player.ikAnimation;
    for (const constraint of constraints) {
      this.ikPose.captureJoint(this.getBone(constraint.rootBone));
      this.ikPose.captureJoint(this.getBone(constraint.middleBone));
    }
    try {
      for (const constraint of constraints) {
        const root = this.getBone(constraint.rootBone);
        const middle = this.getBone(constraint.middleBone);
        const rootRotation = root.pose.rotation;
        const middleRotation = middle.pose.rotation;
        constraint.apply(this.options.ikContext, animation?.get(constraint.name));
        // Later providers may read attachments in any descendant render mount.
        // Recompose render branches beneath each changed local transform.
        this.syncIKBone(root, rootRotation);
        this.syncIKBone(middle, middleRotation);
      }
    } finally {
      // Even a failing target provider must leave earlier IK passes restorable.
      this.ikPose.commit();
    }
    this.options.renderer.syncMeshes?.();
    if (options.updateDebug !== false) this.options.updateDebugViews(constraints);
  }

  /** Schedule one full synchronization on the next update in idleSync: 'dirty' mode. */
  markPoseDirty(): void {
    this.poseRevision += 1;
  }

  /** Idle sync is required while a pose source is attached or the pose revision is unsynchronized. */
  shouldSyncIdlePose(idleSync: 'always' | 'dirty'): boolean {
    if (idleSync === 'always' || this.poseRevision !== this.synchronizedPoseRevision || this.poseSource) return true;
    // Providers may change their result (including from undefined) without a host edit.
    for (const constraint of this.options.ikConstraints.values()) if (constraint.targetProvider) return true;
    return false;
  }

  get meshDeformation(): MeshDeformationPose {
    return this.poseSource?.meshDeformation ?? this.player.meshDeformation;
  }

  /** Live deformation channels for synchronous rendering; public reads remain immutable snapshots. */
  getMeshDeformationForRendering(): MeshDeformationPose {
    const source = this.poseSource;
    // An attached player exposes live channels only through the rendering read; its public
    // meshDeformation getter is the frozen snapshot and must not be consumed per frame.
    if (source instanceof AnimationPlayer) return source.getMeshDeformationForRendering();
    return source?.meshDeformation ?? this.player.getMeshDeformationForRendering();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.poseSource = undefined;
    this.projectedPose = undefined;
    this.player.dispose();
    this.ikPose.restore();
    this.ikPose.clear();
    this.poseUnderlying.clear();
    this.activePose = undefined;
    this.sortedIK.length = 0;
  }
}
