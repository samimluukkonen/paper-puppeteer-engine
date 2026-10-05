import type Phaser from 'phaser';
import type { Facing, IKTarget, Puppet, SyncPoseOptions, TwoBoneIKConstraint } from '../engine/index.js';
import type { DemoCharacterProfile } from './demoCharacterProfiles.js';
import type { Katana, WeaponGripDefinition } from './Katana.js';
import { katanaGrips } from './Katana.js';
import {
  gripReachCorrection,
  type HeadBounds,
  horizontalEdgesAtY,
  type PalmPathState,
  palmClearanceCorrection,
  stepPalmAroundHead,
  translateGripTarget,
  updatePalmPath,
} from './katanaArmTarget.js';

/** Targets and adapters shared by the three correction phases of one solve. */
interface GripSolve {
  readonly primaryArm: TwoBoneIKConstraint;
  readonly secondaryArm: TwoBoneIKConstraint;
  readonly secondaryGrip: WeaponGripDefinition;
  readonly target: IKTarget;
  readonly rearPalm: () => IKTarget;
  readonly syncOptions: SyncPoseOptions;
}

/** Owns grip clearance, path continuity, and reach recovery independently of weapon presentation. */
export class DemoKatanaGripSolver {
  private rearPalmPath: PalmPathState = { side: 'right', overHead: false };
  private previousRearPalm: IKTarget | undefined;

  constructor(
    private readonly puppet: Puppet,
    private readonly katana: Katana,
    private readonly profile: DemoCharacterProfile,
  ) {}

  reset(direction: Facing): void {
    this.rearPalmPath = { side: direction, overHead: false };
    this.clear();
  }

  clear(): void {
    this.previousRearPalm = undefined;
  }

  solve(handTarget: IKTarget, primaryRight: boolean, syncOptions: SyncPoseOptions): void {
    const leftArm = this.puppet.getIK(this.profile.armIK.left);
    const rightArm = this.puppet.getIK(this.profile.armIK.right);
    const facing = this.puppet.facingDirection;
    const primaryArm = primaryRight ? rightArm : leftArm;
    const secondaryArm = primaryRight ? leftArm : rightArm;
    const secondaryGrip = primaryRight ? katanaGrips.secondary : katanaGrips.primary;
    const rearPalmBone = this.puppet.getBone(secondaryArm.endBone);
    const rearPalmOffset = secondaryArm.endOffset;
    const rearPalm = (): IKTarget =>
      rearPalmBone.container.getWorldTransformMatrix().transformPoint(rearPalmOffset.x, rearPalmOffset.y);
    const solve: GripSolve = {
      primaryArm,
      secondaryArm,
      secondaryGrip,
      target: { ...handTarget },
      rearPalm,
      syncOptions,
    };
    // Finite head bounds allow torso targets to return beneath the head.
    const head = this.puppet.getSlotImage(this.profile.katana.headSlot);
    // Corrections solve only arm/leg rotations. Body cutouts stay fixed within this pass;
    // rebuild lazily on the next frame so animation, facing, and skin changes remain visible.
    const bodyCorners = new Map<string, readonly IKTarget[] | undefined>();
    let headBounds: HeadBounds | undefined;
    if (head) {
      const corners = this.cutoutCorners(head);
      bodyCorners.set(this.profile.katana.headSlot, corners);
      headBounds = {
        left: Math.min(...corners.map((point) => point.x)),
        right: Math.max(...corners.map((point) => point.x)),
        top: Math.min(...corners.map((point) => point.y)),
        bottom: Math.max(...corners.map((point) => point.y)),
      };
      // Release the overhead lock when the cursor returns to the torso.
      this.rearPalmPath =
        handTarget.y > headBounds.bottom + this.profile.katana.headClearanceMargin
          ? { ...this.rearPalmPath, overHead: false }
          : updatePalmPath(
              this.rearPalmPath,
              rearPalm(),
              headBounds,
              facing === 'right' || secondaryArm.status === 'solved',
              this.profile.katana.headClearanceMargin,
            );
    }
    this.correctPalmClearance(solve, bodyCorners, headBounds);
    if (this.previousRearPalm && headBounds) {
      this.smoothPalmPath(solve, this.previousRearPalm, headBounds);
      this.recoverSecondaryReach(solve);
      // Smoothing and reach recovery must not carry the gripping hand through the body.
      this.correctPalmClearance(solve, bodyCorners, headBounds);
    }
    this.previousRearPalm = rearPalm();
  }

  private applyGripCorrection(solve: GripSolve, correction: IKTarget): boolean {
    if (!translateGripTarget(solve.target, correction)) return false;
    solve.primaryArm.setTarget(solve.target);
    this.puppet.syncIK(solve.syncOptions);
    return true;
  }

  private correctPalmClearance(
    solve: GripSolve,
    bodyCorners: Map<string, readonly IKTarget[] | undefined>,
    headBounds: HeadBounds | undefined,
  ): void {
    for (let pass = 0; pass < 24; pass += 1) {
      if (solve.primaryArm.status === 'clamped') {
        // Recover the front wrist first, otherwise an unreachable mouse target can defeat body clearance.
        const correction = this.armReachCorrection(solve.primaryArm, solve.target);
        this.applyGripCorrection(solve, correction);
      }
      const grip = this.katana.getGripWorldPosition(solve.secondaryGrip);
      const reachCorrection =
        solve.secondaryArm.status === 'clamped' ? this.armReachCorrection(solve.secondaryArm, grip) : { x: 0, y: 0 };
      const palm = solve.rearPalm();
      const correction = palmClearanceCorrection(
        palm,
        reachCorrection,
        this.rearPalmPath,
        this.rearPalmPath.overHead ? undefined : this.bodyEdgesAt(palm.y, bodyCorners),
        headBounds,
        this.profile.katana.headClearanceMargin,
        this.profile.katana.bodyClearanceMargin,
      );
      if (Math.hypot(correction.x, correction.y) < 0.01) break;
      if (!this.applyGripCorrection(solve, correction)) break;
    }
  }

  private smoothPalmPath(solve: GripSolve, previousPalm: IKTarget, headBounds: HeadBounds): void {
    let palm = solve.rearPalm();
    const next = stepPalmAroundHead(
      previousPalm,
      palm,
      headBounds,
      this.profile.katana.headClearanceMargin,
      this.profile.katana.maximumPalmStep,
    );
    for (let pass = 0; pass < 6 && Math.hypot(next.x - palm.x, next.y - palm.y) > 0.01; pass += 1) {
      if (!this.applyGripCorrection(solve, { x: next.x - palm.x, y: next.y - palm.y })) break;
      palm = solve.rearPalm();
    }
  }

  private recoverSecondaryReach(solve: GripSolve): void {
    // The bounded path can leave the second arm's reach even when its endpoints are reachable.
    for (let pass = 0; pass < 12 && solve.secondaryArm.status === 'clamped'; pass += 1) {
      const correction = this.armReachCorrection(
        solve.secondaryArm,
        this.katana.getGripWorldPosition(solve.secondaryGrip),
      );
      if (Math.hypot(correction.x, correction.y) < 0.0001) break;
      if (!this.applyGripCorrection(solve, correction)) break;
    }
  }

  private armReachCorrection(arm: TwoBoneIKConstraint, grip: IKTarget): IKTarget {
    const shoulder = this.puppet.getBone(arm.rootBone).getWorldPosition();
    const elbow = this.puppet.getBone(arm.middleBone).getWorldPosition();
    const palm = this.puppet
      .getBone(arm.endBone)
      .container.getWorldTransformMatrix()
      .transformPoint(arm.endOffset.x, arm.endOffset.y);
    return gripReachCorrection(
      shoulder,
      grip,
      Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y),
      Math.hypot(palm.x - elbow.x, palm.y - elbow.y),
    );
  }

  private cutoutCorners(sprite: Phaser.GameObjects.Image): IKTarget[] {
    const matrix = sprite.getWorldTransformMatrix();
    const left = -sprite.originX * sprite.width;
    const top = -sprite.originY * sprite.height;
    return [
      matrix.transformPoint(left, top),
      matrix.transformPoint(left + sprite.width, top),
      matrix.transformPoint(left + sprite.width, top + sprite.height),
      matrix.transformPoint(left, top + sprite.height),
    ];
  }

  private bodyEdgesAt(
    y: number,
    bodyCorners: Map<string, readonly IKTarget[] | undefined>,
  ): { left: number; right: number } | undefined {
    let left: number | undefined;
    let right: number | undefined;
    for (const id of this.profile.katana.bodySlots) {
      if (!bodyCorners.has(id)) {
        const sprite = this.puppet.rig.slots.some((slot) => slot.id === id) ? this.puppet.getSlotImage(id) : undefined;
        bodyCorners.set(id, sprite ? this.cutoutCorners(sprite) : undefined);
      }
      const corners = bodyCorners.get(id);
      if (!corners) continue;
      const edges = horizontalEdgesAtY(corners, y);
      if (edges) {
        if (id === this.profile.katana.headSlot) {
          // The tunable body overlap applies to torso/legs; the head keeps its full safety margin.
          const extra = this.profile.katana.headClearanceMargin - this.profile.katana.bodyClearanceMargin;
          edges.left -= extra;
          edges.right += extra;
        }
        left = Math.min(left ?? Infinity, edges.left);
        right = Math.max(right ?? -Infinity, edges.right);
      }
    }
    return left === undefined || right === undefined ? undefined : { left, right };
  }
}
