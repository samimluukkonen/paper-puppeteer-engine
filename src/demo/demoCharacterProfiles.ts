import type { IKTarget, TwoBoneIKDefinition } from '../engine/core.js';
import { type DeepReadonly, freezeData } from '../engine/readonlyData.js';
import { demoPuppetCharacter, sketchCharacter } from '../shared/characterCatalog.js';
import { getCharacterPreviewSettings } from '../shared/characterPreviewSettings.js';

export type DemoAnimationRole = 'idle' | 'walk' | 'sword';

/** Presentation choices for a demo character; rig and animation data remain engine-owned. */
export type DemoCharacterProfile = DeepReadonly<{
  id: string;
  label: string;
  layout: 'sample' | 'authored';
  swapLimbsWithFacing: boolean;
  clips: Record<DemoAnimationRole, string>;
  upperBody: { clip: string; mask: readonly string[] };
  combatPose: string;
  appearance: {
    alternateSkin: string;
    gripHandSlot: string;
    openHandAttachment: string;
    gripHandAttachment: string;
    headwearSlot: string;
    headwearSkin: string;
  };
  placement: { scale: number; yOffset: number };
  ikChains: readonly TwoBoneIKDefinition[];
  armIK: Record<'left' | 'right', string>;
  legIK: Record<'left' | 'right', string>;
  katana: {
    swapHandsWithFacing: boolean;
    gripOffset: IKTarget;
    bodyClearanceMargin: number;
    headClearanceMargin: number;
    maximumPalmStep: number;
    itemSlot: string;
    attachment: string;
    hiltSlot: string;
    hiltWidth: number;
    headSlot: string;
    bodySlots: readonly string[];
  };
  feet: {
    mode: 'animated-ankles' | 'sole-contacts';
    stanceOffset: number;
    groundXOffset: number;
    groundYOffset: number;
    floorYOffset: number;
    contactOffset: number;
    pelvisBone: string;
    visualSlots: Record<'left' | 'right', string>;
    sway: {
      mode: 'elapsed' | 'stride';
      xAmplitude: number;
      yAmplitude: number;
      xPeriodMs: number;
      yPeriodMs: number;
    };
  };
}>;

const common = {
  clips: { idle: 'idle', walk: 'walk', sword: 'sword' },
  upperBody: {
    clip: 'guardUpperBody',
    mask: ['torso', 'head', 'leftUpperArm', 'leftForearm', 'leftHand', 'rightUpperArm', 'rightForearm', 'rightHand'],
  },
  combatPose: 'combat-ready',
  appearance: {
    alternateSkin: 'alternate',
    gripHandSlot: 'rightHandVisual',
    openHandAttachment: 'rightHandDefault',
    gripHandAttachment: 'rightHandGrip',
    headwearSlot: 'headwear',
    headwearSkin: 'helmet-only',
  },
  placement: { scale: 1.08, yOffset: 278 },
  armIK: { left: 'leftArmIK', right: 'rightArmIK' },
  legIK: { left: 'leftLegIK', right: 'rightLegIK' },
  katana: {
    headClearanceMargin: 8,
    maximumPalmStep: 8,
    itemSlot: 'rightHandItem',
    attachment: 'katana',
    hiltSlot: 'katanaHilt',
    hiltWidth: 39,
    headSlot: 'headVisual',
    bodySlots: [
      'headVisual',
      'torsoVisual',
      'pelvisVisual',
      'leftThighVisual',
      'rightThighVisual',
      'leftLowerLegVisual',
      'rightLowerLegVisual',
      'leftFootVisual',
      'rightFootVisual',
    ],
  },
  feet: {
    groundXOffset: 24,
    groundYOffset: 130,
    floorYOffset: 115,
    contactOffset: 7,
    pelvisBone: 'pelvis',
    visualSlots: { left: 'leftFootVisual', right: 'rightFootVisual' },
  },
};

export const demoPuppetProfile: DemoCharacterProfile = freezeData({
  ...common,
  ...demoPuppetCharacter,
  ...getCharacterPreviewSettings(demoPuppetCharacter.id),
  layout: 'sample',
  swapLimbsWithFacing: false,
  katana: {
    ...common.katana,
    swapHandsWithFacing: true,
    gripOffset: { x: 0, y: 15 },
    bodyClearanceMargin: 8,
  },
  feet: {
    ...common.feet,
    mode: 'animated-ankles',
    stanceOffset: 0,
    sway: { mode: 'elapsed', xAmplitude: 7, yAmplitude: 3, xPeriodMs: 1000, yPeriodMs: 700 },
  },
});

export const sketchProfile: DemoCharacterProfile = freezeData({
  ...common,
  ...sketchCharacter,
  ...getCharacterPreviewSettings(sketchCharacter.id),
  layout: 'authored',
  swapLimbsWithFacing: true,
  katana: {
    ...common.katana,
    swapHandsWithFacing: false,
    gripOffset: { x: 0, y: 18 },
    bodyClearanceMargin: -4,
  },
  feet: {
    ...common.feet,
    mode: 'sole-contacts',
    stanceOffset: 7,
    sway: { mode: 'stride', xAmplitude: 0, yAmplitude: -2, xPeriodMs: 1000, yPeriodMs: 700 },
  },
});

export const demoCharacterProfiles: readonly DemoCharacterProfile[] = Object.freeze([demoPuppetProfile, sketchProfile]);

/** Translate an engine clip name into the action displayed by the demo controls. */
export function getDemoAnimationRole(
  profile: DemoCharacterProfile,
  clip: string | undefined,
): DemoAnimationRole | undefined {
  for (const role of ['idle', 'walk', 'sword'] as const) {
    if (profile.clips[role] === clip) return role;
  }
  return undefined;
}

/** Demo actions use roles; explicitly registered clip names remain playable too. */
export function resolveDemoClip(profile: DemoCharacterProfile, name: string): string {
  return Object.hasOwn(profile.clips, name) ? profile.clips[name as DemoAnimationRole] : name;
}

export function getDemoCharacterProfile(id: string): DemoCharacterProfile {
  const profile = demoCharacterProfiles.find((entry) => entry.id === id);
  if (!profile) throw new Error(`No demo presentation profile for character "${id}".`);
  return profile;
}
