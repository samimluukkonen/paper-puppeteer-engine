import { serializeSkinDefinition } from '../../engine/authoredSerialization.js';
import { identifierSchema, spriteAttachmentSchema } from '../../engine/schemas.js';
import type { SkinDefinition, SpriteAttachmentDefinition } from '../../engine/types.js';
import { checkSkinReferences, throwValidationIssue } from '../../engine/validation.js';
import { freezeData } from '../shared/editorData.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import type { RigEditorState } from './RigEditorState.js';

type ArtworkState = Pick<
  RigEditorState,
  | 'workingCopy'
  | 'standaloneSkins'
  | 'skins'
  | 'defaultSkin'
  | 'getSlot'
  | 'getAttachment'
  | 'getSkin'
  | 'isStandaloneSkin'
  | 'skinReferences'
>;

export interface RigArtworkUpdate {
  attachments?: readonly SpriteAttachmentDefinition[];
  skins?: readonly SkinDefinition[];
  standaloneSkins?: readonly SkinDefinition[];
}

export interface RigArtworkActions {
  install(update: RigArtworkUpdate): void;
  hasAttachment(id: string): boolean;
  assertArtwork(attachment: SpriteAttachmentDefinition): void;
}

/** Author attachment and skin proposals without owning history, saved baselines or preview selection. */
export class RigArtworkCommands {
  constructor(
    private readonly state: ArtworkState,
    private readonly actions: RigArtworkActions,
  ) {}

  createAttachment(input: unknown): void {
    const attachment = spriteAttachmentSchema.strict().parse(input);
    if (/^(blob:|__paper_artwork_)/.test(attachment.texture))
      throw new Error('Choose a stable character texture key, not a temporary preview texture.');
    if (this.actions.hasAttachment(attachment.id)) throw new Error(`Duplicate attachment ID "${attachment.id}".`);
    this.actions.assertArtwork(attachment);
    this.actions.install({ attachments: [...(this.state.workingCopy.attachments ?? []), freezeData(attachment)] });
  }

  removeAttachment(id: string): void {
    this.state.getAttachment(id);
    const references = [...(this.state.workingCopy.skins ?? []), ...this.state.standaloneSkins].flatMap((skin) =>
      Object.entries(skin.slots)
        .filter(([, value]) => value === id)
        .map(([slot]) => `${skin.name}/${slot}`),
    );
    if (references.length)
      throw new Error(`Attachment "${id}" is used by ${references.join(', ')}. Clear or replace these mappings first.`);
    this.actions.install({ attachments: this.state.workingCopy.attachments!.filter((entry) => entry.id !== id) });
  }

  createSkin(name: string): void {
    identifierSchema.parse(name);
    if (this.state.skins.some((skin) => skin.name === name)) throw new Error(`Duplicate skin name "${name}".`);
    this.actions.install({
      skins: [...(this.state.workingCopy.skins ?? []), freezeData({ version: 1 as const, name, slots: {} })],
    });
  }

  renameSkin(name: string, next: string): void {
    const skin = this.state.getSkin(name);
    identifierSchema.parse(next);
    if (name === next) return;
    const references = this.state.skinReferences?.(name) ?? [];
    if (references.length)
      throw new Error(
        `Skin "${name}" is used by ${references.join('; ')}. Choose another skin in these scenes before renaming it.`,
      );
    if (name === this.state.defaultSkin || this.state.isStandaloneSkin(name))
      throw new Error('This skin name is referenced by the character manifest. Create a new skin to use another name.');
    if (this.state.skins.some((entry) => entry.name === next)) throw new Error(`Duplicate skin name "${next}".`);
    this.actions.install({
      skins: this.state.workingCopy.skins!.map((entry) =>
        entry.name === name ? freezeData({ ...skin, name: next }) : entry,
      ),
    });
  }

  /** Undefined removes an override (inherit); null explicitly hides the slot. */
  assignAttachment(slot: string, attachment: string | null | undefined, skin: string): void {
    this.state.getSlot(slot);
    if (attachment !== null && attachment !== undefined)
      this.actions.assertArtwork(this.state.getAttachment(attachment));
    const original = this.state.getSkin(skin);
    const slots = { ...original.slots };
    if (attachment === undefined) delete slots[slot];
    else
      Object.defineProperty(slots, slot, { value: attachment, enumerable: true, configurable: true, writable: true });
    const next = freezeData({ ...original, slots });
    checkSkinReferences([next], this.state.workingCopy, throwValidationIssue);
    this.actions.install(
      this.state.isStandaloneSkin(skin)
        ? { standaloneSkins: this.state.standaloneSkins.map((entry) => (entry.name === skin ? next : entry)) }
        : { skins: this.state.workingCopy.skins!.map((entry) => (entry.name === skin ? next : entry)) },
    );
  }

  exportSkinJson(name: string): string {
    const skin = this.state.getSkin(name);
    checkSkinReferences([skin], this.state.workingCopy, throwValidationIssue);
    for (const id of Object.values(skin.slots))
      if (id !== null) this.actions.assertArtwork(this.state.getAttachment(id));
    assertJsonExportSize(skin);
    return serializeSkinDefinition(skin, this.state.workingCopy);
  }
}
