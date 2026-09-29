import type { AnimationClip, Keyframe } from '../engine/index.js';

const idlePelvisKeys: readonly Keyframe[] = [
  { time: 0, y: 0 }, { time: 900, y: -2 }, { time: 1800, y: 0 },
];

export const idle: AnimationClip = {
  name: 'idle', duration: 1800, loop: true,
  tracks: {
    pelvis: idlePelvisKeys,
    torso: [{ time: 0, rotation: -0.018, scaleY: 1 },
      { time: 900, rotation: 0.018, scaleY: 1.012 },
      { time: 1800, rotation: -0.018, scaleY: 1 }],
    head: [{ time: 0, rotation: 0.035 }, { time: 900, rotation: -0.035 }, { time: 1800, rotation: 0.035 }],
    leftUpperArm: [{ time: 0, rotation: 0.12 }, { time: 900, rotation: 0.18 }, { time: 1800, rotation: 0.12 }],
    rightUpperArm: [{ time: 0, rotation: -0.12 }, { time: 900, rotation: -0.18 }, { time: 1800, rotation: -0.12 }],
    rightForearm: [{ time: 0, rotation: -0.12 }, { time: 900, rotation: -0.2 }, { time: 1800, rotation: -0.12 }],
    rightHand: [{ time: 0, rotation: -0.08 }, { time: 900, rotation: 0.06 }, { time: 1800, rotation: -0.08 }],
  },
};

const walkDuration = 1000;
function rotations(values: readonly number[]): Keyframe[] {
  return values.map((rotation, index) => ({ time: index * walkDuration / (values.length - 1), rotation }));
}

export const walk: AnimationClip = {
  name: 'walk', duration: walkDuration, loop: true,
  tracks: {
    pelvis: [{ time: 0, y: 0 }, { time: 125, y: -6 }, { time: 250, y: -8 },
      { time: 375, y: -4 }, { time: 500, y: 0 }, { time: 625, y: -6 },
      { time: 750, y: -8 }, { time: 875, y: -4 }, { time: 1000, y: 0 }],
    torso: rotations([-0.025, 0.02, 0.025, -0.02, -0.025]),
    head: rotations([0.03, -0.01, -0.03, 0.01, 0.03]),
    // Authored facing right: positive knee flexion folds both shins backward.
    // The trailing leg folds during recovery, then reaches forward for contact.
    leftThigh: rotations([-0.4, -0.22, 0, 0.22, 0.4, 0.2, -0.12, -0.36, -0.4]),
    rightThigh: rotations([0.4, 0.2, -0.12, -0.36, -0.4, -0.22, 0, 0.22, 0.4]),
    leftLowerLeg: rotations([0.08, 0.06, 0.04, 0.06, 0.08, 0.9, 1.05, 0.45, 0.08]),
    rightLowerLeg: rotations([0.08, 0.9, 1.05, 0.45, 0.08, 0.06, 0.04, 0.06, 0.08]),
    leftFoot: rotations([0.32, 0.16, -0.04, -0.28, -0.48, -1.1, -0.93, -0.09, 0.32]),
    rightFoot: rotations([-0.48, -1.1, -0.93, -0.09, 0.32, 0.16, -0.04, -0.28, -0.48]),
    leftUpperArm: rotations([0.32, 0.12, -0.26, 0.12, 0.32]),
    rightUpperArm: rotations([-0.32, -0.12, 0.26, -0.12, -0.32]),
    leftForearm: rotations([-0.16, -0.25, -0.12, -0.1, -0.16]),
    rightForearm: rotations([-0.34, -0.46, -0.3, -0.26, -0.34]),
    rightHand: rotations([-0.08, 0.08, 0.14, 0, -0.08]),
  },
};

export const sword: AnimationClip = {
  name: 'sword', duration: 1800, loop: true,
  tracks: {
    pelvis: idlePelvisKeys,
    torso: [{ time: 0, rotation: -0.08 }],
    leftUpperArm: [{ time: 0, rotation: -0.8 }],
    leftForearm: [{ time: 0, rotation: 1.2 }],
    rightUpperArm: [{ time: 0, rotation: -0.7 }],
    rightForearm: [{ time: 0, rotation: -1.1 }],
  },
};

export const demoAnimations: readonly AnimationClip[] = [idle, walk, sword];
