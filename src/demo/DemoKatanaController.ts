import type Phaser from 'phaser';
import type { Facing, IKTarget, Puppet, SyncPoseOptions } from '../engine/index.js';
import { type DemoCharacterProfile, demoPuppetProfile } from './demoCharacterProfiles.js';
import { DemoKatanaGripSolver } from './DemoKatanaGripSolver.js';
import type { Katana } from './Katana.js';
import { katanaGrips } from './Katana.js';

/** Owns weapon mounting, aiming, cropping, and draw layers; delegates grip corrections. */
export class DemoKatanaController {
  enabled = true;
  private attached = false;
  private slotKatana = false;
  private swordAngle = -0.65;
  private readonly gripSolver: DemoKatanaGripSolver;
  private readonly hiltSlot: string | undefined;
  private hiltBehind = false;

  constructor(
    private readonly puppet: Puppet,
    private readonly katana: Katana,
    private readonly profile: DemoCharacterProfile = demoPuppetProfile,
  ) {
    this.gripSolver = new DemoKatanaGripSolver(puppet, katana, profile);
    katana.container.setVisible(false);
    this.hiltSlot = puppet.rig.slots.find((slot) => slot.id === profile.katana.hiltSlot)?.id;
  }

  rotate(delta: number): void {
    this.swordAngle += delta;
  }

  resetRearPalm(direction: Facing): void {
    this.gripSolver.reset(direction);
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
    if (
      this.attached &&
      (handIK || upperBody) &&
      (this.puppet.currentAnimation === this.profile.clips.sword || upperBody)
    )
      this.gripSolver.solve(handTarget, this.primaryRight, syncOptions);
    else this.gripSolver.clear();
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
      (handIK || upperBody) &&
      this.attached &&
      (this.puppet.currentAnimation === this.profile.clips.sword || upperBody);
    if (upperBody) primaryArm.enabled = true;
    secondaryArm.setTargetProvider(() => {
      this.aimKatana(this.swordAngle);
      return this.katana.getGripWorldPosition(primaryRight ? katanaGrips.secondary : katanaGrips.primary);
    });
  }

  /** One visible katana: the sprite follows the hand except when grip-aware IK needs the prop. */
  syncMode(upperBody: boolean): void {
    const needsGripPoints = this.enabled && (this.puppet.currentAnimation === this.profile.clips.sword || upperBody);
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
