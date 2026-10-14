import { equalJsonData } from './equalJsonData.js';
import type { Rig } from './Rig.js';
import { spriteAttachmentSchema, skinFileSchema } from './schemas.js';
import type { SkinDefinition, SpriteAttachmentDefinition } from './types.js';
import { checkSkinReferences, throwValidationIssue } from './validation.js';

/** Attachment selection only; changing it never touches bones or IK state. */
export class SlotState {
  private readonly assigned = new Map<string, string>();
  private readonly slots: Set<string>;
  private attachments = new Map<string, Readonly<SpriteAttachmentDefinition>>();
  private skins = new Map<string, Readonly<Record<string, string | null>>>();

  constructor(rig: Rig) {
    this.slots = new Set(rig.slots.map((slot) => slot.id));
    this.updateDefinitions(rig.attachments, rig.skins);
  }

  /** Install owned artwork/skin data without changing joints or current slot assignments.
   * Clear assignments to removed IDs first. Invalid updates leave all runtime state untouched.
   */
  updateDefinitions(attachments: readonly SpriteAttachmentDefinition[], skins: readonly SkinDefinition[]): void {
    const parsed = spriteAttachmentSchema.strict().array().parse(attachments);
    const next = new Map(parsed.map((entry) => [entry.id, Object.freeze(entry)]));
    if (next.size !== parsed.length) throw new Error('Duplicate attachment IDs.');
    const parsedSkins = skinFileSchema.array().parse(skins);
    checkSkinReferences(
      parsedSkins,
      {
        root: '',
        bones: [],
        slots: [...this.slots].map((id) => ({ id, bone: '' })),
        attachments: parsed,
      },
      throwValidationIssue,
    );
    for (const id of this.assigned.values())
      if (!next.has(id)) throw new Error(`Clear assigned attachment "${id}" before removing its definition.`);
    // Keep unchanged definition identities so rendering can retain existing images.
    for (const [id, entry] of next)
      if (equalJsonData(entry, this.attachments.get(id))) next.set(id, this.attachments.get(id)!);
    this.attachments = next;
    this.skins = new Map(parsedSkins.map((skin) => [skin.name, Object.freeze(skin.slots)]));
  }

  getDefinition(id: string): Readonly<SpriteAttachmentDefinition> {
    const entry = this.attachments.get(id);
    if (!entry) throw new Error(`Unknown attachment "${id}".`);
    return entry;
  }

  getAttachment(slot: string): string | undefined {
    this.requireSlot(slot);
    return this.assigned.get(slot);
  }

  /** Validate even unchanged assignments, and report whether the selection changed. */
  setAttachment(slot: string, attachment: string): boolean {
    this.requireSlot(slot);
    if (!this.attachments.has(attachment)) throw new Error(`Unknown attachment "${attachment}".`);
    if (this.assigned.get(slot) === attachment) return false;
    this.assigned.set(slot, attachment);
    return true;
  }

  clearAttachment(slot: string): boolean {
    this.requireSlot(slot);
    return this.assigned.delete(slot);
  }

  /** Replace the complete selection. Slots absent from the skin become empty. */
  setSkin(name: string): void {
    const skin = this.requireSkin(name);
    this.assigned.clear();
    this.apply(skin);
  }

  /** Merge one partial skin into the current selection. Null explicitly clears a slot. */
  applySkin(name: string): void {
    this.apply(this.requireSkin(name));
  }

  private apply(skin: Readonly<Record<string, string | null>>): void {
    for (const [slot, attachment] of Object.entries(skin)) {
      if (attachment === null) this.assigned.delete(slot);
      else this.assigned.set(slot, attachment);
    }
  }

  private requireSlot(id: string): void {
    if (!this.slots.has(id)) throw new Error(`Unknown slot "${id}".`);
  }

  private requireSkin(name: string): Readonly<Record<string, string | null>> {
    const skin = this.skins.get(name);
    if (!skin) throw new Error(`Unknown skin "${name}".`);
    return skin;
  }
}
