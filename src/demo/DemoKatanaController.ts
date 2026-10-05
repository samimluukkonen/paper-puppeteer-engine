import type Phaser from 'phaser';
import type { Facing, IKTarget, Puppet, SyncPoseOptions, TwoBoneIKConstraint } from '../engine/index.js';
import { type DemoCharacterProfile, demoPuppetProfile } from './demoCharacterProfiles.js';
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

/** Owns the single visible weapon and the rear hand's continuous path around the body. */
export class DemoKatanaController {
  enabled = true;
  private attached = false;
  private slotKatana = false;
  private swordAngle = -0.65;
  private rearPalmPath: PalmPathState = { side: 'right', overHead: false };
  private previousRearPalm: IKTarget | undefined;
  private readonly hiltSlot: string | undefined;
  private hiltBehind = false;

  constructor(
    private readonly puppet: Puppet,
    private readonly katana: Katana,
    private readonly profile: DemoCharacterProfile = demoPuppetProfile,
  ) {
    katana.container.setVisible(false);
    this.hiltSlot = puppet.rig.slots.find((slot) => slot.id === profile.katana.hiltSlot)?.id;
  }

  rotate(delta: number): void {
    this.swordAngle += delta;
  }

  resetRearPalm(direction: Facing): void {
    this.rearPalmPath = { side: direction, overHead: false };
    this.previousRearPalm = undefined;
  }

  reattach(): void {
    if (this.attached) {
      this.attachKatana();
      this.aimKatana(this.swordAngle);
    }
    if (this.slotKatana) this.aimSlotKatana(this.swordAngle);
    this.syncHiltLayer();
  }

  syncVisualOverride(): void {
    if (this.slotKatana) this.puppet.setAttachment(this.profile.katana.itemSlot, this.profile.katana.attachment);
    else this.puppet.clearAttachment(this.profile.katana.itemSlot);
    this.syncHiltLayer();
  }

  resetPosition(): void {
    this.katana.container.setPosition(0, 0);
  }

  setInitialRotation(): void {
    this.katana.container.setRotation(this.swordAngle);
  }

  solveGrip(handTarget: IKTarget, handIK: boolean, upperBody: boolean, syncOptions: SyncPoseOptions = {}): void {
    if (this.attached) this.aimKatana(this.swordAngle);
    if (this.slotKatana) this.aimSlotKatana(this.swordAngle);
    this.keepBothHandsOnKatana(handTarget, handIK, upperBody, syncOptions);
    this.syncHiltLayer();
  }

  getSecondaryTarget(): IKTarget | undefined {
    const primaryRight = this.primaryRight;
    const secondaryArm = this.puppet.getIK(primaryRight ? this.profile.armIK.left : this.profile.armIK.right);
    if (!secondaryArm.enabled) return undefined;
    return this.katana.getGripWorldPosition(primaryRight ? katanaGrips.secondary : katanaGrips.primary);
  }

  private get primaryRight(): boolean {
    return !this.profile.katana.swapHandsWithFacing || this.puppet.facingDirection === 'right';
  }

  configureArms(handTarget: IKTarget, handIK: boolean, upperBody: boolean): void {
    const rightArm = this.puppet.getIK(this.profile.armIK.right);
    const leftArm = this.puppet.getIK(this.profile.armIK.left);
    const primaryRight = this.primaryRight;
    leftArm.bendDirection = -1;
    const primaryArm = primaryRight ? rightArm : leftArm;
    const secondaryArm = primaryRight ? leftArm : rightArm;
    primaryArm.priority = 0;
    secondaryArm.priority = 1;
    primaryArm.setEndOffset({ x: 0, y: 0 });
    secondaryArm.setEndOffset(this.profile.katana.gripOffset);
    primaryArm.enabled = handIK;
    primaryArm.setTarget(handTarget);
    secondaryArm.enabled =
      (handIK || upperBody) && this.attached && (this.puppet.currentAnimation === 'sword' || upperBody);
    if (upperBody) primaryArm.enabled = true;
    secondaryArm.setTargetProvider(() => {
      this.aimKatana(this.swordAngle);
      return this.katana.getGripWorldPosition(primaryRight ? katanaGrips.secondary : katanaGrips.primary);
    });
  }

  /** One visible katana: the sprite follows the hand except when grip-aware IK needs the prop. */
  syncMode(upperBody: boolean): void {
    const needsGripPoints = this.enabled && (this.puppet.currentAnimation === 'sword' || upperBody);
    if (this.attached !== needsGripPoints) {
      if (needsGripPoints) {
        this.katana.container.setVisible(true);
        this.attachKatana();
      } else {
        this.puppet.detach(this.katana.container);
        this.katana.container.setVisible(false);
      }
      this.attached = needsGripPoints;
    }
    const useSlot = this.enabled && !needsGripPoints;
    if (this.slotKatana !== useSlot) {
      this.slotKatana = useSlot;
      if (useSlot) this.puppet.setAttachment(this.profile.katana.itemSlot, this.profile.katana.attachment);
      else this.puppet.clearAttachment(this.profile.katana.itemSlot);
    }
    this.syncHiltLayer();
  }

  private syncHiltLayer(): void {
    if (!this.hiltSlot) return;
    const behind = this.enabled && this.puppet.facingDirection === 'left';
    const splitProp = behind && this.attached;
    if (splitProp !== this.hiltBehind) {
      if (splitProp) {
        this.katana.container.remove(this.katana.hilt);
        this.puppet.attachToSlot(this.hiltSlot, this.katana.hilt);
      } else {
        this.puppet.detach(this.katana.hilt);
        this.katana.hilt.setPosition(0, 0).setRotation(0).setScale(1);
        this.katana.container.add(this.katana.hilt).sort('depth');
      }
      this.hiltBehind = splitProp;
    }
    if (splitProp) {
      // Both mounts follow the right palm; copy the blade's compensated local transform.
      const blade = this.katana.container;
      this.katana.hilt.setPosition(blade.x, blade.y).setRotation(blade.rotation).setScale(blade.scaleX, blade.scaleY);
    }
    const splitSlot = behind && this.slotKatana;
    if (splitSlot) this.puppet.setAttachment(this.hiltSlot, this.profile.katana.attachment);
    else this.puppet.clearAttachment(this.hiltSlot);
    const image = this.puppet.getSlotImage(this.profile.katana.itemSlot);
    if (splitSlot && image) {
      image.setCrop(this.profile.katana.hiltWidth, 0, image.width - this.profile.katana.hiltWidth, image.height);
      this.puppet
        .getSlotImage(this.hiltSlot)
        ?.setCrop(0, 0, this.profile.katana.hiltWidth, image.height)
        .setRotation(image.rotation);
    } else image?.setCrop();
  }

  private attachKatana(): void {
    const primaryRight = this.primaryRight;
    const grip = primaryRight ? katanaGrips.primary : katanaGrips.secondary;
    const arm = this.puppet.getIK(primaryRight ? this.profile.armIK.right : this.profile.armIK.left);
    this.puppet.attach(arm.endBone, this.katana.container, {
      x: this.profile.katana.gripOffset.x - grip.x,
      y: this.profile.katana.gripOffset.y - grip.y,
    });
  }

  private keepBothHandsOnKatana(
    handTarget: IKTarget,
    handIK: boolean,
    upperBody: boolean,
    syncOptions: SyncPoseOptions,
  ): void {
    if (!this.attached || (!handIK && !upperBody) || (this.puppet.currentAnimation !== 'sword' && !upperBody)) {
      this.previousRearPalm = undefined;
      return;
    }
    const leftArm = this.puppet.getIK(this.profile.armIK.left);
    const rightArm = this.puppet.getIK(this.profile.armIK.right);
    const facing = this.puppet.facingDirection;
    const primaryArm = this.primaryRight ? rightArm : leftArm;
    const secondaryArm = this.primaryRight ? leftArm : rightArm;
    const secondaryGrip = this.primaryRight ? katanaGrips.secondary : katanaGrips.primary;
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

  private aimKatana(angle: number): void {
    if (!this.katana.container.parentContainer) return;
    const rotation = this.katanaRotationIn(this.katana.container.parentContainer, angle);
    if (rotation === undefined) return;
    this.katana.container.setRotation(rotation);
    const grip = this.primaryRight ? katanaGrips.primary : katanaGrips.secondary;
    this.katana.container.setPosition(
      grip.x - (Math.cos(rotation) * grip.x - Math.sin(rotation) * grip.y),
      grip.y - (Math.sin(rotation) * grip.x + Math.cos(rotation) * grip.y),
    );
  }

  private aimSlotKatana(angle: number): void {
    const image = this.puppet.getSlotImage(this.profile.katana.itemSlot);
    if (!image?.parentContainer) return;
    const rotation = this.katanaRotationIn(image.parentContainer, angle);
    if (rotation !== undefined) image.setRotation(rotation);
  }

  private katanaRotationIn(mount: Phaser.GameObjects.Container, angle: number): number | undefined {
    const world = this.puppet.container.getWorldTransformMatrix();
    const parent = mount.getWorldTransformMatrix();
    const dx = world.a * Math.cos(angle) + world.c * Math.sin(angle);
    const dy = world.b * Math.cos(angle) + world.d * Math.sin(angle);
    const determinant = parent.a * parent.d - parent.b * parent.c;
    if (determinant === 0) return undefined;
    // Transform a direction (no translation), so the blade aims relative to
    // facing while its sprite or prop grip stays fixed at the palm.
    return Math.atan2((parent.a * dy - parent.b * dx) / determinant, (parent.d * dx - parent.c * dy) / determinant);
  }
}
