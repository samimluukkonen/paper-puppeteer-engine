import { Rig } from '../../engine/Rig.js';
import type { RigDefinition } from '../../engine/types.js';

export type RigEditorSelection = { type: 'bone'; id: string } | { type: 'slot'; id: string } | null;
export type VisibilityKey = 'artwork' | 'bones' | 'boneNames' | 'boneLengths' | 'slots' | 'spriteOrigins' | 'ik';

/** Owns editor data; the loaded rig stays untouched. */
export class RigEditorState {
  readonly source: Rig;
  readonly workingCopy: RigDefinition;
  readonly rig: Rig;
  selection: RigEditorSelection = null;
  readonly visibility: Record<VisibilityKey, boolean> = {
    artwork: true,
    bones: true,
    boneNames: true,
    boneLengths: false,
    slots: true,
    spriteOrigins: false,
    ik: false,
  };
  artworkOpacity = 1;
  private readonly children = new Map<string, string[]>();

  constructor(source: Rig) {
    this.source = source;
    this.workingCopy = structuredClone({
      root: source.root,
      bones: source.bones,
      slots: source.slots,
      attachments: source.attachments,
      skins: source.skins,
    });
    this.rig = new Rig(this.workingCopy);
    for (const bone of this.rig.bones) {
      if (bone.parent === undefined) continue;
      const children = this.children.get(bone.parent) ?? [];
      children.push(bone.id);
      this.children.set(bone.parent, children);
    }
  }

  selectBone(id: string): void {
    this.rig.getBone(id);
    this.selection = { type: 'bone', id };
  }

  selectSlot(id: string): void {
    if (!this.rig.slots.some((slot) => slot.id === id)) throw new Error(`Unknown slot "${id}".`);
    this.selection = { type: 'slot', id };
  }

  clearSelection(): void {
    this.selection = null;
  }

  childrenOf(id: string): readonly string[] {
    this.rig.getBone(id);
    return this.children.get(id) ?? [];
  }

  hierarchy(): readonly { id: string; depth: number }[] {
    const rows: { id: string; depth: number }[] = [];
    const visit = (id: string, depth: number): void => {
      rows.push({ id, depth });
      for (const child of this.childrenOf(id)) visit(child, depth + 1);
    };
    visit(this.rig.root, 0);
    return rows;
  }
}
