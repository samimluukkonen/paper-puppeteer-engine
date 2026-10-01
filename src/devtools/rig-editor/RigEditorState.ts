import { Rig } from '../../engine/Rig.js';
import type { BoneDefinition, RigDefinition, SlotDefinition, SpriteAttachmentDefinition } from '../../engine/types.js';

export type RigEditorSelection = { type: 'bone'; id: string } | { type: 'slot'; id: string } | null;
export type VisibilityKey = 'artwork' | 'bones' | 'boneNames' | 'boneLengths' | 'slots' | 'spriteOrigins' | 'ik';
export type EditMode = 'joint' | 'sprite';
type BoneField = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'length' | 'depth';
type SlotField = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'depth';
type SpriteField = 'x' | 'y' | 'originX' | 'originY';

/** Owns editor data; the loaded rig stays untouched. */
export class RigEditorState {
  readonly source: Rig;
  readonly workingCopy: RigDefinition;
  readonly rig: Rig;
  selection: RigEditorSelection = null;
  editMode: EditMode = 'joint';
  dimUnselected = false;
  ikPreview = false;
  warnings: string[] = [];
  readonly visibility: Record<VisibilityKey, boolean> = {
    artwork: true,
    bones: true,
    boneNames: false,
    boneLengths: false,
    slots: true,
    spriteOrigins: false,
    ik: false,
  };
  artworkOpacity = 1;
  private readonly initial: string;
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
    this.initial = JSON.stringify(this.workingCopy);
    for (const bone of this.rig.bones) {
      if (bone.parent === undefined) continue;
      const children = this.children.get(bone.parent) ?? [];
      children.push(bone.id);
      this.children.set(bone.parent, children);
    }
  }

  get dirty(): boolean {
    return JSON.stringify(this.workingCopy) !== this.initial;
  }

  getBone(id: string): BoneDefinition {
    const bone = this.workingCopy.bones.find((item) => item.id === id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  getSlot(id: string): SlotDefinition {
    const slot = this.workingCopy.slots?.find((item) => item.id === id);
    if (!slot) throw new Error(`Unknown slot "${id}".`);
    return slot;
  }

  getAttachment(id: string): SpriteAttachmentDefinition {
    const attachment = this.workingCopy.attachments?.find((item) => item.id === id);
    if (!attachment) throw new Error(`Unknown attachment "${id}".`);
    return attachment;
  }

  editBone(id: string, field: BoneField, value: number): void {
    this.assertValue(field, value);
    (this.getBone(id) as unknown as Record<string, unknown>)[field] = value;
    if (field === 'length') {
      for (const childId of this.childrenOf(id)) {
        const child = this.getBone(childId) as BoneDefinition & { x?: number; y?: number };
        const x = child.x ?? 0;
        const y = child.y ?? 0;
        const distance = Math.hypot(x, y);
        child.x = distance ? (x * value) / distance : 0;
        child.y = distance ? (y * value) / distance : value;
      }
    }
    this.validate();
  }

  editSlot(id: string, field: SlotField, value: number): void {
    this.assertValue(field, value);
    (this.getSlot(id) as unknown as Record<string, unknown>)[field] = value;
    this.validate();
  }

  editSprite(id: string, field: SpriteField, value: number, attachment = false): void {
    this.assertValue(field, value);
    const sprite = attachment ? this.getAttachment(id) : this.getBone(id).sprite;
    if (!sprite) throw new Error(`No sprite for "${id}".`);
    (sprite as unknown as Record<string, unknown>)[field] = value;
    this.validate();
  }

  private assertValue(field: string, value: number): void {
    if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
    if (field === 'length' && value < 0) throw new Error('Bone length cannot be negative.');
    if ((field === 'originX' || field === 'originY') && (value < 0 || value > 1))
      throw new Error('Origin must be between 0 and 1.');
  }

  validate(): void {
    const warnings: string[] = [];
    const checkNumbers = (label: string, value: object): void => {
      for (const [field, number] of Object.entries(value))
        if (typeof number === 'number' && !Number.isFinite(number)) warnings.push(`${label}: invalid ${field}`);
    };
    const checkOrigin = (label: string, value: { originX?: number; originY?: number }): void => {
      for (const field of ['originX', 'originY'] as const) {
        const origin = value[field];
        if (origin !== undefined && (origin < 0 || origin > 1)) warnings.push(`${label}: ${field} must be 0–1`);
      }
    };
    for (const bone of this.workingCopy.bones) {
      if (bone.length !== undefined && (!Number.isFinite(bone.length) || bone.length < 0))
        warnings.push(`${bone.id}: invalid length`);
      checkNumbers(bone.id, bone);
      if (bone.sprite) {
        checkNumbers(`${bone.id} sprite`, bone.sprite);
        checkOrigin(`${bone.id} sprite`, bone.sprite);
      }
    }
    for (const slot of this.workingCopy.slots ?? []) {
      if (!this.workingCopy.bones.some((bone) => bone.id === slot.bone))
        warnings.push(`${slot.id}: missing bone ${slot.bone}`);
      checkNumbers(slot.id, slot);
    }
    for (const attachment of this.workingCopy.attachments ?? []) {
      checkNumbers(attachment.id, attachment);
      checkOrigin(attachment.id, attachment);
    }
    this.warnings = warnings;
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
