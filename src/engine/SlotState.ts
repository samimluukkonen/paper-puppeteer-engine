import { equalJsonData } from './equalJsonData.js';
import { validateMeshBindPose } from './meshBindPose.js';
import { validateMeshTopology } from './meshGeometry.js';
import { freezeData } from './readonlyData.js';
import type { Rig } from './Rig.js';
import { attachmentSchema, skinFileSchema } from './schemas.js';
import type { SkinDefinition, AttachmentDefinition } from './types.js';
import { checkSkinReferences, throwValidationIssue } from './validation.js';

/** Attachment selection only; changing it never touches bones or IK state. */
export class SlotState {
  private readonly assigned = new Map<string, string>();
  private readonly slots: Set<string>;
  private readonly rig: Rig;
  private attachments = new Map<string, Readonly<AttachmentDefinition>>();
  private skins = new Map<string, Readonly<Record<string, string | null>>>();

  /** Copy runtime assignments and immutable catalogs when staging a transactional update. */
  constructor(rig: Rig | SlotState) {
    if (rig instanceof SlotState) {
      this.rig = rig.rig;
      this.slots = rig.slots;
      for (const [slot, attachment] of rig.assigned) this.assigned.set(slot, attachment);
      this.attachments = rig.attachments;
      this.skins = rig.skins;
      return;
    }
    this.rig = rig;
    this.slots = new Set(rig.slots.map((slot) => slot.id));
    this.updateDefinitions(rig.attachments, rig.skins);
  }

  /** Install owned artwork/skin data without changing joints or current slot assignments.
   * Clear assignments to removed IDs first. Invalid updates leave all runtime state untouched.
   */
  updateDefinitions(attachments: readonly AttachmentDefinition[], skins: readonly SkinDefinition[]): void {
    const parsed = attachmentSchema.array().parse(attachments);
    for (const entry of parsed) {
      if (entry.type !== 'mesh') continue;
      for (const issue of [...validateMeshTopology(entry), ...validateMeshBindPose(entry, this.rig)])
        throwValidationIssue(issue);
    }
    const next = new Map<string, Readonly<AttachmentDefinition>>(parsed.map((entry) => [entry.id, freezeData(entry)]));
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

  getDefinition(id: string): Readonly<AttachmentDefinition> {
    const entry = this.attachments.get(id);
    if (!entry) throw new Error(`Unknown attachment "${id}".`);
    return entry;
  }

  /** Owned, validated catalog snapshots for render-only artwork inspection. */
  getDefinitions(): readonly Readonly<AttachmentDefinition>[] {
    return [...this.attachments.values()];
  }

  getSkins(): readonly SkinDefinition[] {
    return [...this.skins].map(([name, slots]) => ({ version: 1, name, slots }));
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
