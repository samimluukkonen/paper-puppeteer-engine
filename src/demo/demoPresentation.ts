import type { Facing, Rig } from '../engine/index.js';

const leftArm = ['leftUpperArm', 'leftForearm', 'leftHand'];
const rightArm = ['rightUpperArm', 'rightForearm', 'rightHand'];
const leftLeg = ['leftThigh', 'leftLowerLeg', 'leftFoot'];
const rightLeg = ['rightThigh', 'rightLowerLeg', 'rightFoot'];
const limbs = new Set([...leftArm, ...rightArm, ...leftLeg, ...rightLeg]);
type ArmRotations = Readonly<Record<'leftUpperArm' | 'rightUpperArm', number>>;

export function demoArmRotations(animation: string | undefined, facing: Facing, rotations: ArmRotations): ArmRotations {
  const direction = animation === 'idle' && facing === 'right' ? -1 : 1;
  return {
    leftUpperArm: direction * rotations.leftUpperArm,
    rightUpperArm: direction * rotations.rightUpperArm,
  };
}

export function demoRenderOrder(rig: Rig, animation: string | undefined, facing: Facing): readonly string[] {
  if (animation !== 'walk' && animation !== 'idle' && animation !== 'sword') return rig.renderOrder;
  const rearArm = facing === 'right' ? leftArm : rightArm;
  const frontArm = facing === 'right' ? rightArm : leftArm;
  const rearLeg = facing === 'right' ? leftLeg : rightLeg;
  const frontLeg = facing === 'right' ? rightLeg : leftLeg;
  const body = [...rearLeg, ...rig.renderOrder.filter(id => !limbs.has(id))
    .flatMap(id => id === 'pelvis' ? [id, ...frontLeg] : [id])];
  return [...rearArm, ...body, ...frontArm];
}

export function demoShoulderPositions(rig: Rig, animation: string | undefined, facing: Facing): Readonly<Record<'leftUpperArm' | 'rightUpperArm', number>> {
  const swap = (animation === 'walk' || animation === 'idle' || animation === 'sword') && facing === 'right' ? -1 : 1;
  return {
    leftUpperArm: swap * (rig.getBone('leftUpperArm').x ?? 0),
    rightUpperArm: swap * (rig.getBone('rightUpperArm').x ?? 0),
  };
}

export function demoHipPositions(rig: Rig, facing: Facing): Readonly<Record<'leftThigh' | 'rightThigh', number>> {
  const left = rig.getBone('leftThigh').x ?? 0;
  const right = rig.getBone('rightThigh').x ?? 0;
  return facing === 'right'
    ? { leftThigh: right, rightThigh: left }
    : { leftThigh: left, rightThigh: right };
}
