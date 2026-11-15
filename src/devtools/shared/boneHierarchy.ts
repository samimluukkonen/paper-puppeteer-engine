import type { Rig, RigDefinition } from '../../engine/data.js';

/** Runtime rigs sort parents first; authored arrays keep their own stable order. */
export function sameRigTopology(a: RigDefinition, b: RigDefinition): boolean {
  if (a.root !== b.root || a.bones.length !== b.bones.length || (a.slots?.length ?? 0) !== (b.slots?.length ?? 0))
    return false;
  const bones = new Map(a.bones.map((bone) => [bone.id, bone.parent]));
  const slots = new Map((a.slots ?? []).map((slot) => [slot.id, slot.bone]));
  return (
    b.bones.every((bone) => bones.has(bone.id) && bones.get(bone.id) === bone.parent) &&
    (b.slots ?? []).every((slot) => slots.has(slot.id) && slots.get(slot.id) === slot.bone)
  );
}

/** Parent-first depth-first rows shared by the rig and animation selection views. */
export function boneHierarchy(rig: Rig): readonly { id: string; depth: number }[] {
  const children = new Map<string, string[]>();
  for (const bone of rig.bones) {
    if (bone.parent === undefined) continue;
    const siblings = children.get(bone.parent) ?? [];
    siblings.push(bone.id);
    children.set(bone.parent, siblings);
  }
  const rows: { id: string; depth: number }[] = [];
  const pending = [{ id: rig.root, depth: 0 }];
  while (pending.length) {
    const row = pending.pop()!;
    rows.push(row);
    const siblings = children.get(row.id) ?? [];
    for (let index = siblings.length - 1; index >= 0; index -= 1)
      pending.push({ id: siblings[index]!, depth: row.depth + 1 });
  }
  return rows;
}
