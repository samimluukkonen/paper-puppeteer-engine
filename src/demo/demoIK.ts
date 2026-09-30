import type { TwoBoneIKDefinition } from '../engine/index.js';

export const demoIK: readonly TwoBoneIKDefinition[] = [
  {
    name: 'rightArmIK',
    rootBone: 'rightUpperArm',
    middleBone: 'rightForearm',
    endBone: 'rightHand',
    bendDirection: -1,
    priority: 0,
    enabled: false,
  },
  {
    name: 'leftArmIK',
    rootBone: 'leftUpperArm',
    middleBone: 'leftForearm',
    endBone: 'leftHand',
    endOffset: { x: 0, y: 20 },
    bendDirection: 1,
    priority: 1,
    enabled: false,
  },
  {
    name: 'leftLegIK',
    rootBone: 'leftThigh',
    middleBone: 'leftLowerLeg',
    endBone: 'leftFoot',
    bendDirection: 1,
    priority: 2,
    enabled: false,
  },
  {
    name: 'rightLegIK',
    rootBone: 'rightThigh',
    middleBone: 'rightLowerLeg',
    endBone: 'rightFoot',
    bendDirection: 1,
    priority: 2,
    enabled: false,
  },
];
