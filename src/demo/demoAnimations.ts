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

function oppositeLeg(values: readonly number[]): Keyframe[] {
  const halfCycle = (values.length - 1) / 2;
  return rotations([...values.slice(halfCycle, -1), ...values.slice(0, halfCycle + 1)]);
}

const thigh = [-0.32, -0.24, -0.12, 0, 0.12, 0.24, 0.28, 0.15, -0.10, -0.28, -0.32];
const shin = [0.08, 0.16, 0.13, 0.08, 0.08, 0.15, 0.28, 0.82, 0.68, 0.28, 0.08];
const foot = [0.24, 0.08, -0.02, -0.08, -0.20, -0.36, -0.47, -0.70, -0.50, 0, 0.24];

export const walk: AnimationClip = {
  name: 'walk', duration: walkDuration, loop: true,
  tracks: {
    pelvis: [{ time: 0, y: 0 }, { time: 250, y: -2 }, { time: 500, y: 0 },
      { time: 750, y: -2 }, { time: 1000, y: 0 }],
    torso: rotations([-0.025, 0.02, 0.025, -0.02, -0.025]),
    head: rotations([0.03, -0.01, -0.03, 0.01, 0.03]),
    // A longer, nearly straight stance gives way to a brief flexed recovery.
    // The second leg follows the same motion half a cycle later.
    leftThigh: rotations(thigh),
    rightThigh: oppositeLeg(thigh),
    leftLowerLeg: rotations(shin),
    rightLowerLeg: oppositeLeg(shin),
    leftFoot: rotations(foot),
    rightFoot: oppositeLeg(foot),
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
