import type { Facing, JointTransform, Puppet } from '../engine/index.js';
import { type DemoCharacterProfile, sketchProfile } from './demoCharacterProfiles.js';

const parts = ['UpperArm', 'Forearm', 'Hand', 'Thigh', 'LowerLeg', 'Foot'] as const;

/** Transfer whole limb chains, including the sketch's unequal hip and shin offsets. */
export function swapSketchLimbs(puppet: Puppet): void {
  for (const part of parts) {
    const left = puppet.getBone(`left${part}`).pose;
    const right = puppet.getBone(`right${part}`).pose;
    const previous = { ...left };
    Object.assign(left, right);
    Object.assign(right, previous);
  }
}

/** Keep authored clips canonical while the displayed left-facing rig uses anatomical limb IDs. */
export class SketchFacingLayout {
  private readonly authored = new Map<string, JointTransform>();
  private visualFacing: Facing | undefined;
  private gripHand = false;

  constructor(
    private readonly puppet: Puppet,
    private readonly profile: DemoCharacterProfile = sketchProfile,
  ) {}

  restoreAuthoredPose(): void {
    for (const [id, pose] of this.authored) Object.assign(this.puppet.getBone(id).pose, pose);
    this.authored.clear();
  }

  forgetPose(): void {
    this.authored.clear();
  }

  applyPose(): void {
    if (this.puppet.facingDirection !== 'left') return;
    for (const part of parts)
      for (const side of ['left', 'right']) {
        const id = `${side}${part}`;
        this.authored.set(id, { ...this.puppet.getBone(id).pose });
      }
    swapSketchLimbs(this.puppet);
  }

  setGripHand(enabled: boolean): void {
    this.gripHand = enabled;
    this.visualFacing = undefined;
    this.syncVisuals();
  }

  syncVisuals(force = false): void {
    const facing = this.puppet.facingDirection;
    if (!force && this.visualFacing === facing) return;
    for (const part of parts)
      for (const side of ['left', 'right'] as const) {
        const source = facing === 'left' ? (side === 'left' ? 'right' : 'left') : side;
        const slot = `${side}${part}Visual`;
        this.puppet.setAttachment(
          slot,
          slot === this.profile.appearance.gripHandSlot && this.gripHand
            ? this.profile.appearance.gripHandAttachment
            : `${source}${part}Default`,
        );
        if (facing === 'left') this.puppet.setSlotDepth(slot, this.puppet.rig.getSlot(`${source}${part}Visual`).depth!);
        else this.puppet.clearSlotDepth(slot);
      }
    this.visualFacing = facing;
  }
}
