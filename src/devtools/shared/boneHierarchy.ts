import type { Rig } from '../../engine/Rig.js';

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
