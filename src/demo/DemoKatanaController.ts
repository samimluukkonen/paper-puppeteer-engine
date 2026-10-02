import type Phaser from 'phaser';
import type { Facing, IKTarget, Puppet, SyncPoseOptions, TwoBoneIKConstraint } from '../engine/index.js';
import type { Katana } from './Katana.js';
import { katanaGrips } from './Katana.js';
import {
  gripReachCorrection,
  type HeadBounds,
  horizontalEdgesAtY,
  type PalmPathState,
  palmClearanceCorrection,
  stepPalmAroundHead,
  updatePalmPath,
} from './katanaArmTarget.js';

// The hand joint is at the wrist; +Y runs along this rig's hand toward its palm.
const palmGripOffset: IKTarget = { x: 0, y: 15 };
const palmVisibilityMargin = 8;
const maximumPalmStep = 8;

/** Owns the single visible weapon and the rear hand's continuous path around the body. */
export class DemoKatanaController {
  enabled = true;
  private attached = false;
  private slotKatana = false;
  private swordAngle = -0.65;
  private rearPalmPath: PalmPathState = { side: 'right', overHead: false };
  private previousRearPalm: IKTarget | undefined;

  constructor(
    private readonly puppet: Puppet,
    private readonly katana: Katana,
  ) {
    katana.container.setVisible(false);
  }

  rotate(delta: number): void {
    this.swordAngle += delta;
  }

  resetRearPalm(direction: Facing): void {
    this.rearPalmPath = { side: direction, overHead: false };
    this.previousRearPalm = undefined;
  }

  reattach(): void {
    if (this.attached) this.attachKatana();
  }

  syncVisualOverride(): void {
    if (this.slotKatana) this.puppet.setAttachment('rightHandItem', 'katana');
    else this.puppet.clearAttachment('rightHandItem');
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
  }

  getSecondaryTarget(): IKTarget | undefined {
    const facing = this.puppet.facingDirection;
    const secondaryArm = this.puppet.getIK(facing === 'right' ? 'leftArmIK' : 'rightArmIK');
    if (!secondaryArm.enabled) return undefined;
    return this.katana.getGripWorldPosition(facing === 'right' ? katanaGrips.secondary : katanaGrips.primary);
  }

  configureArms(handTarget: IKTarget, handIK: boolean, upperBody: boolean): void {
    const rightArm = this.puppet.getIK('rightArmIK');
    const leftArm = this.puppet.getIK('leftArmIK');
    const facing = this.puppet.facingDirection;
    leftArm.bendDirection = -1;
    const primaryArm = facing === 'right' ? rightArm : leftArm;
    const secondaryArm = facing === 'right' ? leftArm : rightArm;
    primaryArm.priority = 0;
    secondaryArm.priority = 1;
    primaryArm.setEndOffset({ x: 0, y: 0 });
    secondaryArm.setEndOffset(palmGripOffset);
    primaryArm.enabled = handIK;
    primaryArm.setTarget(handTarget);
    secondaryArm.enabled =
      (handIK || upperBody) && this.attached && (this.puppet.currentAnimation === 'sword' || upperBody);
    if (upperBody) primaryArm.enabled = true;
    secondaryArm.setTargetProvider(() => {
      this.aimKatana(this.swordAngle);
      return this.katana.getGripWorldPosition(facing === 'right' ? katanaGrips.secondary : katanaGrips.primary);
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
      if (useSlot) this.puppet.setAttachment('rightHandItem', 'katana');
      else this.puppet.clearAttachment('rightHandItem');
    }
  }

  private attachKatana(): void {
    const facing = this.puppet.facingDirection;
    const grip = facing === 'right' ? katanaGrips.primary : katanaGrips.secondary;
    this.puppet.attach(facing === 'right' ? 'rightHand' : 'leftHand', this.katana.container, {
      x: palmGripOffset.x - grip.x,
      y: palmGripOffset.y - grip.y,
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
    const leftArm = this.puppet.getIK('leftArmIK');
    const rightArm = this.puppet.getIK('rightArmIK');
    const facing = this.puppet.facingDirection;
    const primaryArm = facing === 'right' ? rightArm : leftArm;
    const secondaryArm = facing === 'right' ? leftArm : rightArm;
    const secondaryGrip = facing === 'right' ? katanaGrips.secondary : katanaGrips.primary;
    const rearPalmBone = this.puppet.getBone(secondaryArm.endBone);
    const rearPalmOffset = secondaryArm.endOffset;
    const rearPalm = (): IKTarget =>
      rearPalmBone.container.getWorldTransformMatrix().transformPoint(rearPalmOffset.x, rearPalmOffset.y);
    const target = { ...handTarget };
    // Follow the head's top while crossing between sides. A vertical path
    // avoids the discontinuous left/right projection at the head's corners.
    const head = this.puppet.getSlotImage('headVisual');
    let headBounds: HeadBounds | undefined;
    if (head) {
      const corners = this.cutoutCorners(head);
      headBounds = {
        left: Math.min(...corners.map((point) => point.x)),
        right: Math.max(...corners.map((point) => point.x)),
        top: Math.min(...corners.map((point) => point.y)),
      };
      this.rearPalmPath = updatePalmPath(
        this.rearPalmPath,
        rearPalm(),
        headBounds,
        facing === 'right' || secondaryArm.status === 'solved',
        palmVisibilityMargin,
      );
    }
    for (let pass = 0; pass < 24; pass += 1) {
      const grip = this.katana.getGripWorldPosition(secondaryGrip);
      const reachCorrection =
        secondaryArm.status === 'clamped' ? this.secondaryReachCorrection(secondaryArm, grip) : { x: 0, y: 0 };
      const palm = rearPalm();
      const correction = palmClearanceCorrection(
        palm,
        reachCorrection,
        this.rearPalmPath,
        this.rearPalmPath.overHead ? undefined : this.bodyEdgesAt(palm.y),
        headBounds,
        palmVisibilityMargin,
      );
      if (Math.hypot(correction.x, correction.y) < 0.01) break;
      target.x += correction.x;
      target.y += correction.y;
      primaryArm.setTarget(target);
      this.puppet.syncPose(syncOptions);
    }
    if (this.previousRearPalm && headBounds) {
      let palm = rearPalm();
      const next = stepPalmAroundHead(this.previousRearPalm, palm, headBounds, palmVisibilityMargin, maximumPalmStep);
      for (let pass = 0; pass < 6 && Math.hypot(next.x - palm.x, next.y - palm.y) > 0.01; pass += 1) {
        target.x += next.x - palm.x;
        target.y += next.y - palm.y;
        primaryArm.setTarget(target);
        this.puppet.syncPose(syncOptions);
        palm = rearPalm();
      }
      // The bounded path may pass just outside the second arm's reach even
      // when its endpoints are reachable. Pull that frame back into reach.
      for (let pass = 0; pass < 12 && secondaryArm.status === 'clamped'; pass += 1) {
        const correction = this.secondaryReachCorrection(secondaryArm, this.katana.getGripWorldPosition(secondaryGrip));
        if (Math.hypot(correction.x, correction.y) < 0.0001) break;
        target.x += correction.x;
        target.y += correction.y;
        primaryArm.setTarget(target);
        this.puppet.syncPose(syncOptions);
        palm = rearPalm();
      }
    }
    this.previousRearPalm = rearPalm();
  }

  private secondaryReachCorrection(arm: TwoBoneIKConstraint, grip: IKTarget): IKTarget {
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

  private bodyEdgesAt(y: number): { left: number; right: number } | undefined {
    let left: number | undefined;
    let right: number | undefined;
    for (const id of ['head', 'torso', 'pelvis']) {
      const sprite = this.puppet.getSlotImage(`${id}Visual`);
      if (!sprite) continue;
      const edges = horizontalEdgesAtY(this.cutoutCorners(sprite), y);
      if (edges) {
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
    const grip = this.puppet.facingDirection === 'right' ? katanaGrips.primary : katanaGrips.secondary;
    this.katana.container.setPosition(
      grip.x - (Math.cos(rotation) * grip.x - Math.sin(rotation) * grip.y),
      grip.y - (Math.sin(rotation) * grip.x + Math.cos(rotation) * grip.y),
    );
  }

  private aimSlotKatana(angle: number): void {
    const image = this.puppet.getSlotImage('rightHandItem');
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
