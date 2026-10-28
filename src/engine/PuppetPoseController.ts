import type { Bone } from './Bone.js';
import type { IKAnimationPose } from './ik/AnimationIKPose.js';
import { IKPoseState } from './ik/IKPoseState.js';
import type { TwoBoneIKConstraint } from './ik/TwoBoneIKConstraint.js';
import type { IKTransformContext } from './ik/types.js';
import { applyPoseToJoints, type PoseDefinition, serializePose } from './Pose.js';
import type { JointTransform } from './types.js';

export interface SyncPoseOptions {
  /** Defer overlays during repeated solves; call refreshDebugViews() after the final pass. */
  updateDebug?: boolean;
}

interface PoseProjection {
  sync(deformMeshes?: boolean): void;
  syncBone(id: string): void;
  syncMeshes?(): void;
}

/** @internal Owns pose overrides and IK passes; Puppet supplies bones, rendering, and overlays. */
export class PuppetPoseController {
  private readonly ikPose = new IKPoseState();
  private readonly sortedIK: TwoBoneIKConstraint[] = [];
  private activePose: { pose: PoseDefinition; mix: number } | undefined;
  private readonly poseUnderlying = new Map<string, Partial<JointTransform>>();

  constructor(
    private readonly bones: ReadonlyMap<string, Bone>,
    private readonly ikConstraints: ReadonlyMap<string, TwoBoneIKConstraint>,
    private readonly ikContext: IKTransformContext,
    private readonly renderer: PoseProjection,
    private readonly updateDebugViews: (constraints: readonly TwoBoneIKConstraint[]) => void,
    private readonly getIKAnimation?: () => IKAnimationPose,
  ) {}

  private getBone(id: string): Bone {
    const bone = this.bones.get(id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
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

  preparePose(): void {
    this.ikPose.restore();
    for (const [id, values] of this.poseUnderlying) Object.assign(this.getBone(id).pose, values);
    this.poseUnderlying.clear();
  }

  getOrderedConstraints(reuse = false): TwoBoneIKConstraint[] {
    // Refill in registration order so priority changes retain stable ties.
    // Debug calls use their own list, including calls made by target providers.
    const constraints = reuse ? this.sortedIK : [];
    constraints.length = 0;
    for (const constraint of this.ikConstraints.values()) constraints.push(constraint);
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
    this.renderer.syncBone(bone.id);
  }

  /** Apply the evaluated pose, solve IK in priority order, then project rendering. */
  syncPose(options: SyncPoseOptions = {}): void {
    this.preparePose();
    if (this.activePose) applyPoseToJoints(this.activePose.pose, this.bones, this.activePose.mix, this.poseUnderlying);
    for (const bone of this.bones.values()) bone.syncTransform();
    this.renderer.sync(false);
    this.solveIK(options);
  }

  /** Rerun constraints after changing targets, mix, enabled state, offsets, bend direction, or priorities.
   * Use syncPose() first whenever authored poses or skeleton transforms have changed.
   * Retains active pose presets and projects only the restored/solved IK joints.
   */
  syncIK(options: SyncPoseOptions = {}): void {
    this.ikPose.restore((joint) => {
      const bone = this.getBone(joint.id);
      bone.syncTransform();
      this.renderer.syncBone(bone.id);
    });
    this.solveIK(options);
  }

  private solveIK(options: SyncPoseOptions): void {
    const constraints = this.getOrderedConstraints(true);
    const animation = this.getIKAnimation?.();
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
        constraint.apply(this.ikContext, animation?.get(constraint.name));
        // Later providers may read attachments in any descendant render mount.
        // Recompose render branches beneath each changed local transform.
        this.syncIKBone(root, rootRotation);
        this.syncIKBone(middle, middleRotation);
      }
    } finally {
      // Even a failing target provider must leave earlier IK passes restorable.
      this.ikPose.commit();
    }
    this.renderer.syncMeshes?.();
    if (options.updateDebug !== false) this.updateDebugViews(constraints);
  }

  destroy(): void {
    this.ikPose.restore();
    this.ikPose.clear();
    this.poseUnderlying.clear();
    this.activePose = undefined;
    this.sortedIK.length = 0;
  }
}
