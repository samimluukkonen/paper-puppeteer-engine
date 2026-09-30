import type { Rig } from './Rig.js';

/** Attachment selection only; changing it never touches bones or IK state. */
export class SlotState {
  private readonly assigned = new Map<string, string>();
  private readonly slots: Set<string>;
  private readonly attachments: Set<string>;
  private readonly skins: Map<string, Readonly<Record<string, string | null>>>;

  constructor(rig: Rig) {
    this.slots = new Set(rig.slots.map((slot) => slot.id));
    this.attachments = new Set(rig.attachments.map((attachment) => attachment.id));
    this.skins = new Map(rig.skins.map((skin) => [skin.name, skin.slots]));
  }

  getAttachment(slot: string): string | undefined {
    this.requireSlot(slot);
    return this.assigned.get(slot);
  }

  setAttachment(slot: string, attachment: string): void {
    this.requireSlot(slot);
    if (!this.attachments.has(attachment)) throw new Error(`Unknown attachment "${attachment}".`);
    this.assigned.set(slot, attachment);
  }

  clearAttachment(slot: string): void {
    this.requireSlot(slot);
    this.assigned.delete(slot);
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
