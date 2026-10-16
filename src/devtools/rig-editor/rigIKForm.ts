import { createIKConstraint } from '../../engine/ik/ikAuthoring.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { RigDefinition } from '../../engine/types.js';

/** Enumerate topology, never character-specific bone names. Full model validation still runs at commit. */
export function rigIKChains(rig: RigDefinition) {
  const bones = new Map(rig.bones.map((bone) => [bone.id, bone]));
  return rig.bones.flatMap((end) => {
    const middle = end.parent ? bones.get(end.parent) : undefined;
    return middle?.parent ? [{ rootBone: middle.parent, middleBone: middle.id, endBone: end.id }] : [];
  });
}

export function rigIKFormError(rig: RigDefinition, definition: TwoBoneIKDefinition): string {
  try {
    createIKConstraint(rig, definition);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
