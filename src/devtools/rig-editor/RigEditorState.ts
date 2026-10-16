import { serializeSkinDefinition } from '../../engine/authoredSerialization.js';
import { normalizeBoneDirection } from '../../engine/boneMath.js';
import {
  RIG_FORMAT_VERSION,
  type RigJsonDefinition,
  type ValidationIssue,
  validateRigDefinition,
} from '../../engine/externalData.js';
import {
  assertIKConstraintChangesAllowed,
  createIKConstraint,
  getIKConstraint,
  ikConstraintDependencies,
  removeIKConstraint,
  updateIKConstraint,
  type CreateIKConstraintOptions,
  type IKConstraintPatch,
} from '../../engine/ik/ikAuthoring.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import { mergeSkins } from '../../engine/mergeSkins.js';
import { Rig } from '../../engine/Rig.js';
import { identifierSchema, spriteAttachmentSchema } from '../../engine/schemas.js';
import type {
  BoneDefinition,
  JointTransform,
  RigDefinition,
  SkinDefinition,
  SlotDefinition,
  SpriteAttachmentDefinition,
  TransformProperty,
} from '../../engine/types.js';
import { checkSkinReferences, throwValidationIssue } from '../../engine/validation.js';
import { boneHierarchy, sameRigTopology } from '../shared/boneHierarchy.js';
import { equalEditorData, freezeData, type ReadonlyEditorData, roundEditorNumber } from '../shared/editorData.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { inspectRigDraft, type RigEditorRecoverySnapshot } from './rigDraftRecovery.js';
import { serializeRigData, serializeRigJson } from './rigSerialization.js';

export type RigEditorSelection = { type: 'bone'; id: string } | { type: 'slot'; id: string } | null;
export type VisibilityKey = 'artwork' | 'bones' | 'boneNames' | 'boneLengths' | 'slots' | 'spriteOrigins' | 'ik';
export type EditMode = 'joint' | 'sprite' | 'origin' | 'slot';
export type BoneField = TransformProperty | 'length' | 'depth';
export type SlotField = TransformProperty | 'depth';
export type SpriteField = 'x' | 'y' | 'originX' | 'originY';
export type GridSnap = 0 | 1 | 2 | 5 | 10;
export type RotationSnap = 0 | 1 | 5 | 15;

export interface RigEditorStateOptions {
  /** Maximum undo entries, including grouped operations. Defaults to 100; zero disables history. */
  historyLimit?: number;
  defaultSkin?: string;
  standaloneSkins?: readonly SkinDefinition[];
  artworkIssue?: (texture: string, frame?: string | number) => string | undefined;
  /** Live references from every animation session and host-provided preview IK chain. */
  boneReferences?: (id: string) => readonly string[];
  /** Live IK track, baked metadata and specialized host references. Also reserves host-owned IDs. */
  ikReferences?: (id: string) => readonly string[];
}

export type { RigEditorRecoverySnapshot } from './rigDraftRecovery.js';
type HistoryEntry = RigEditorRecoverySnapshot;

export type ReadonlyRigData<T> = ReadonlyEditorData<T>;
type WorkingRig = {
  ik?: readonly TwoBoneIKDefinition[];
  root: string;
  bones: BoneDefinition[];
  slots?: SlotDefinition[];
  attachments?: SpriteAttachmentDefinition[];
  skins?: SkinDefinition[];
};

/** Undefined removes an optional authored field rather than serializing a placeholder value. */
function patchFields<Field extends string>(
  target: Partial<Record<Field, number>>,
  values: Partial<Record<Field, number | undefined>>,
): void {
  for (const field of Object.keys(values) as Field[]) {
    const value = values[field];
    if (value === undefined) delete target[field];
    else target[field] = value;
  }
}

/** Owns editor data; the loaded rig stays untouched. */
export class RigEditorState {
  readonly source: Rig;
  private readonly data: WorkingRig;
  private cachedWorkingCopy: ReadonlyRigData<RigDefinition> | undefined;
  private cachedHistoryEntry: HistoryEntry | undefined;
  private topologyRig: Rig;
  get rig(): Rig {
    return this.topologyRig;
  }
  selection: RigEditorSelection = null;
  selectedIKConstraintId: string | null = null;
  editMode: EditMode = 'joint';
  dimUnselected = false;
  ikPreview = false;
  facing: 'left' | 'right' = 'right';
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
  gridSnap: GridSnap = 0;
  rotationSnap: RotationSnap = 0;
  readonly name: string | undefined;
  private readonly includeSkins: boolean;
  private readonly initialCopy: ReadonlyRigData<RigDefinition>;
  private saved: ReadonlyRigData<RigDefinition>;
  private cachedDirty: boolean | undefined;
  private cachedRigDirty: boolean | undefined;
  private cachedIssues: readonly ValidationIssue[] | undefined;
  private validationDirty = true;
  private readonly history: SnapshotHistory<HistoryEntry>;
  private readonly childDirections = new Map<string, { x: number; y: number }>();
  private readonly children = new Map<string, string[]>();
  private readonly boneIndices = new Map<string, number>();
  private readonly slotIndices = new Map<string, number>();
  private readonly attachmentIndices = new Map<string, number>();
  private externalSkins: readonly SkinDefinition[];
  private readonly initialExternalSkins: readonly SkinDefinition[];
  private readonly savedExternalSkins = new Map<string, SkinDefinition>();
  readonly defaultSkin: string;
  private selectedSkin: string;
  private readonly artworkIssue: RigEditorStateOptions['artworkIssue'];
  private readonly boneReferences: RigEditorStateOptions['boneReferences'];
  private readonly ikReferences: RigEditorStateOptions['ikReferences'];

  constructor(source: Rig, file?: RigJsonDefinition, options: RigEditorStateOptions = {}) {
    this.history = new SnapshotHistory(
      () => this.historyEntry(),
      (entry) => this.restoreHistory(entry),
      (left, right) =>
        equalEditorData(left.rig, right.rig) && equalEditorData(left.standaloneSkins, right.standaloneSkins),
      options.historyLimit ?? 100,
    );
    this.source = source;
    this.artworkIssue = options.artworkIssue;
    this.boneReferences = options.boneReferences;
    this.ikReferences = options.ikReferences;
    this.externalSkins = freezeData(structuredClone(options.standaloneSkins ?? []));
    this.initialExternalSkins = this.externalSkins;
    for (const skin of this.externalSkins) this.savedExternalSkins.set(skin.name, skin);
    this.defaultSkin = options.defaultSkin ?? mergeSkins(source.skins, this.externalSkins)[0]?.name ?? '';
    this.selectedSkin = this.defaultSkin;
    this.name = file?.name;
    this.includeSkins = file ? file.skins !== undefined : true;
    this.data = structuredClone({
      root: source.root,
      bones: [...source.bones],
      slots: [...source.slots],
      attachments: [...source.attachments],
      skins: [...source.skins],
      ...(source.ik === undefined ? {} : { ik: [...source.ik] }),
    });
    this.freezeEntries();
    this.topologyRig = source;
    this.rebuildIndexes();
    this.initialCopy = this.workingCopy;
    // Compact input can expand beyond the import limit when exported with indentation.
    // Reject it before the scene replaces the working editor or clears its recovery draft.
    assertJsonExportSize(this.exportCandidate());
    this.saved = this.initialCopy;
    this.cachedDirty = false;
  }

  get dirty(): boolean {
    this.cachedDirty ??=
      !equalEditorData(this.workingCopy, this.saved) || this.externalSkins.some((skin) => this.skinDirty(skin.name));
    return this.cachedDirty;
  }

  get rigDirty(): boolean {
    if (this.cachedRigDirty !== undefined) return this.cachedRigDirty;
    const { skins: _workingSkins, ...working } = this.workingCopy;
    const { skins: _savedSkins, ...saved } = this.saved;
    return (this.cachedRigDirty = !equalEditorData(working, saved));
  }
  get skinsDirty(): boolean {
    return (
      !equalEditorData(this.workingCopy.skins, this.saved.skins) ||
      this.externalSkins.some((skin) => this.skinDirty(skin.name))
    );
  }

  /** Immutable data view; edits replace only changed entries and preserve older views. */
  get workingCopy(): ReadonlyRigData<RigDefinition> {
    this.cachedWorkingCopy ??= freezeData({
      ...this.data,
      bones: [...this.data.bones],
      ...(this.data.slots === undefined ? {} : { slots: [...this.data.slots] }),
      ...(this.data.attachments === undefined ? {} : { attachments: [...this.data.attachments] }),
      ...(this.data.skins === undefined ? {} : { skins: [...this.data.skins] }),
    });
    return this.cachedWorkingCopy;
  }

  private freezeEntries(): void {
    for (const entries of [this.data.bones, this.data.slots, this.data.attachments, this.data.skins, this.data.ik])
      for (const entry of entries ?? []) freezeData(entry);
  }

  /** Reused by history, status, and asynchronous export completion. */
  get workingSnapshot(): ReadonlyRigData<RigDefinition> {
    return this.workingCopy;
  }

  private invalidate(): void {
    this.cachedWorkingCopy = undefined;
    this.cachedHistoryEntry = undefined;
    this.cachedDirty = undefined;
    this.cachedRigDirty = undefined;
    this.validationDirty = true;
  }

  /** Store array positions so replacing an entry during reset cannot leave stale object references. */
  private rebuildIndexes(): void {
    this.boneIndices.clear();
    this.slotIndices.clear();
    this.attachmentIndices.clear();
    this.children.clear();
    for (const [index, bone] of this.workingCopy.bones.entries()) {
      this.boneIndices.set(bone.id, index);
      if (bone.parent !== undefined) {
        const children = this.children.get(bone.parent) ?? [];
        children.push(bone.id);
        this.children.set(bone.parent, children);
      }
    }
    for (const children of this.children.values()) Object.freeze(children);
    for (const [index, slot] of (this.workingCopy.slots ?? []).entries()) this.slotIndices.set(slot.id, index);
    for (const [index, attachment] of (this.workingCopy.attachments ?? []).entries())
      this.attachmentIndices.set(attachment.id, index);
  }

  get historyLimit(): number {
    return this.history.limit;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  get historyLength(): number {
    return this.history.length;
  }

  beginOperation(): void {
    if (!this.history.inOperation) {
      this.validationIssues();
      this.history.beginOperation();
    }
  }

  endOperation(): void {
    if (this.history.endOperation()) this.updateWarnings();
  }

  cancelOperation(): void {
    if (this.history.cancelOperation()) this.updateWarnings();
  }

  private historyEntry(): HistoryEntry {
    this.cachedHistoryEntry ??= freezeData({
      rig: this.workingCopy,
      directions: [...this.childDirections],
      standaloneSkins: this.externalSkins,
    });
    return this.cachedHistoryEntry;
  }

  private change(edit: () => void): void {
    this.history.change(() => {
      this.invalidate();
      edit();
    });
    if (!this.history.inOperation) this.updateWarnings();
  }

  private restore(copy: ReadonlyRigData<RigDefinition>): void {
    Object.assign(this.data, {
      ...copy,
      bones: [...copy.bones],
      ...(copy.slots === undefined ? {} : { slots: [...copy.slots] }),
      ...(copy.attachments === undefined ? {} : { attachments: [...copy.attachments] }),
      ...(copy.skins === undefined ? {} : { skins: [...copy.skins] }),
    });
    for (const key of ['slots', 'attachments', 'skins', 'ik'] as const)
      if (copy[key] === undefined) delete this.data[key];
    this.invalidate();
    this.cachedWorkingCopy = copy;
    this.rebuildIndexes();
    this.syncTopologyRig();
    this.reconcileSelection();
  }

  private syncTopologyRig(): void {
    // Numeric drafts may be temporarily invalid; retain the last validated topology in that case.
    if (sameRigTopology(this.topologyRig, this.workingCopy) && equalEditorData(this.topologyRig.ik, this.data.ik))
      return;
    this.topologyRig = new Rig(this.workingCopy);
  }

  private reconcileSelection(): void {
    if (this.selectedIKConstraintId && !this.data.ik?.some((entry) => entry.name === this.selectedIKConstraintId))
      this.selectedIKConstraintId = null;
    if (
      this.selection &&
      !(this.selection.type === 'bone' ? this.boneIndices : this.slotIndices).has(this.selection.id)
    )
      this.selection = null;
  }

  private assertRetainedReferences(candidate: RigDefinition): void {
    assertIKConstraintChangesAllowed(this.workingCopy, candidate, {
      references: (id) => this.ikReferences?.(id) ?? [],
    });
    const ids = new Set(candidate.bones.map((bone) => bone.id));
    for (const bone of this.data.bones) {
      if (ids.has(bone.id)) continue;
      const references = this.boneReferences?.(bone.id) ?? [];
      if (references.length)
        throw new Error(`Bone "${bone.id}" is used by ${references.join(', ')}. Remove these references first.`);
    }
  }

  private restoreHistory(entry: HistoryEntry): void {
    this.assertRetainedReferences(entry.rig);
    this.externalSkins = entry.standaloneSkins ?? this.initialExternalSkins;
    this.restore(entry.rig);
    this.childDirections.clear();
    for (const [id, direction] of entry.directions) this.childDirections.set(id, direction);
  }

  undo(): boolean {
    this.endOperation();
    if (!this.history.undo()) return false;
    this.updateWarnings();
    return true;
  }

  redo(): boolean {
    this.endOperation();
    if (!this.history.redo()) return false;
    this.updateWarnings();
    return true;
  }

  resetSelected(attachmentId?: string): boolean {
    const selected = this.selection;
    if (!selected) return false;
    this.change(() => {
      if (selected.type === 'bone') {
        const index = this.boneIndices.get(selected.id)!;
        const current = this.getBone(selected.id);
        const original: BoneDefinition = this.initialCopy.bones.find((bone) => bone.id === selected.id) ?? {
          id: selected.id,
        };
        if (this.getBone(selected.id).length !== original.length) {
          // Length edits move direct children; reset those offsets in the same history entry.
          for (const childId of this.childrenOf(selected.id)) {
            const child = { ...this.getBone(childId) };
            this.childDirections.delete(childId);
            const initialChild = this.initialCopy.bones.find((bone) => bone.id === childId) ?? { id: childId };
            for (const field of ['x', 'y'] as const) {
              if (initialChild[field] === undefined) delete child[field];
              else child[field] = initialChild[field];
            }
            this.replaceBone(child);
          }
        }
        const reset = { ...original, id: selected.id };
        if (current.parent === undefined) delete reset.parent;
        else reset.parent = current.parent;
        this.data.bones[index] = freezeData(reset);
      } else {
        const index = this.slotIndices.get(selected.id)!;
        const current = this.getSlot(selected.id);
        const original = this.initialCopy.slots?.find((slot) => slot.id === selected.id);
        this.data.slots![index] = freezeData({ ...original, id: current.id, bone: current.bone });
        // The inspector's artwork fields belong to the active slot attachment.
        if (attachmentId) {
          const attachmentIndex = this.attachmentIndices.get(attachmentId);
          const original = this.initialCopy.attachments?.find((entry) => entry.id === attachmentId);
          if (attachmentIndex !== undefined && original) this.data.attachments![attachmentIndex] = original;
        }
      }
    });
    return true;
  }

  resetRig(): void {
    this.change(() => {
      this.assertRetainedReferences(this.initialCopy);
      this.restore(this.initialCopy);
      this.externalSkins = this.initialExternalSkins;
      this.childDirections.clear();
    });
  }

  snapTranslation(value: number): number {
    return this.gridSnap ? roundEditorNumber(Math.round(value / this.gridSnap) * this.gridSnap) : value;
  }

  snapRotation(value: number): number {
    if (!this.rotationSnap) return value;
    const step = (this.rotationSnap * Math.PI) / 180;
    return Math.round(value / step) * step;
  }

  get validationPending(): boolean {
    return this.history.inOperation && this.validationDirty;
  }

  /** During a grouped edit, retain the last full result until the operation finishes. */
  validationIssues(): readonly ValidationIssue[] {
    if (this.cachedIssues === undefined || (this.validationDirty && !this.history.inOperation)) {
      this.cachedIssues = validateRigDefinition(this.exportCandidate());
      const externalIssues: ValidationIssue[] = [];
      checkSkinReferences(this.externalSkins, this.workingCopy, (issue) => externalIssues.push(issue));
      this.cachedIssues = [...this.cachedIssues, ...externalIssues];
      for (const attachment of this.data.attachments ?? []) {
        const message = this.artworkIssue?.(attachment.texture, attachment.frame);
        if (message)
          this.cachedIssues = [
            ...this.cachedIssues,
            { severity: 'error', path: `attachments.${attachment.id}`, message },
          ];
      }
      this.validationDirty = false;
    }
    return this.cachedIssues;
  }

  private exportCandidate(copy = this.workingCopy): RigJsonDefinition {
    return {
      version: RIG_FORMAT_VERSION,
      ...(this.name === undefined ? {} : { name: this.name }),
      root: copy.root,
      ...(copy.ik === undefined ? {} : { ik: copy.ik }),
      bones: copy.bones,
      ...(copy.slots === undefined ? {} : { slots: copy.slots }),
      ...(copy.attachments === undefined ? {} : { attachments: copy.attachments }),
      ...((this.includeSkins || copy.skins?.length) && copy.skins !== undefined ? { skins: copy.skins } : {}),
    };
  }

  /** Complete authored draft without ending a focused field or drag history operation. */
  get recoveryDraft(): RigJsonDefinition {
    return this.exportCandidate();
  }

  /** Stable identity includes remembered directions, which cannot be recovered from zero offsets. */
  get recoverySnapshot(): RigEditorRecoverySnapshot {
    return this.historyEntry();
  }

  createRecoveryDraft(snapshot = this.recoverySnapshot) {
    return {
      version: 2,
      rig: this.exportCandidate(snapshot.rig),
      directions: snapshot.directions,
      standaloneSkins: snapshot.standaloneSkins ?? [],
    };
  }

  canRestoreDraft(input: unknown): boolean {
    return this.inspectDraft(input) !== undefined;
  }

  private inspectDraft(input: unknown): RigEditorRecoverySnapshot | undefined {
    const data = inspectRigDraft(
      input,
      this.initialCopy,
      this.rig,
      this.initialExternalSkins,
      this.defaultSkin,
      this.workingCopy,
    );
    if (!data) return undefined;
    try {
      this.assertRetainedReferences(data.rig);
    } catch {
      return undefined;
    }
    for (const attachment of data.rig.attachments ?? []) {
      if (
        /^(blob:|__paper_artwork_)/.test(attachment.texture) ||
        this.artworkIssue?.(attachment.texture, attachment.frame)
      )
        return undefined;
    }
    return data;
  }

  /** Restored authored changes stay dirty and form one undoable operation. */
  restoreDraft(input: unknown): boolean {
    const data = this.inspectDraft(input);
    if (!data) return false;
    this.endOperation();
    this.change(() => {
      this.restoreHistory(data);
    });
    return true;
  }

  markSaved(savedSnapshot: ReadonlyRigData<RigDefinition> = this.workingSnapshot): void {
    // A delayed export can save an older working copy after subsequent edits.
    this.saved = savedSnapshot;
    this.cachedDirty = undefined;
    this.cachedRigDirty = undefined;
  }

  exportRig(saveBaseline = true): RigJsonDefinition {
    this.endOperation();
    const candidate = serializeRigData(this.exportCandidate(), this.initialCopy);
    const issues = [...validateRigDefinition(candidate), ...this.validationIssues()];
    if (issues.some((issue) => issue.severity === 'error'))
      throw new Error(
        `Cannot export rig.\nErrors:\n${issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => `- ${issue.path ?? 'rig'}: ${issue.message}`)
          .join('\n')}`,
      );
    if (saveBaseline) this.markSaved();
    return candidate;
  }

  exportJson(saveBaseline = true): string {
    const json = serializeRigJson(this.exportRig(false));
    if (saveBaseline) this.markSaved();
    return json;
  }

  getBone(id: string): ReadonlyRigData<BoneDefinition> {
    const index = this.boneIndices.get(id);
    const bone = index === undefined ? undefined : this.data.bones[index];
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  getSlot(id: string): ReadonlyRigData<SlotDefinition> {
    const index = this.slotIndices.get(id);
    const slot = index === undefined ? undefined : this.data.slots?.[index];
    if (!slot) throw new Error(`Unknown slot "${id}".`);
    return slot;
  }

  getAttachment(id: string): ReadonlyRigData<SpriteAttachmentDefinition> {
    const index = this.attachmentIndices.get(id);
    const attachment = index === undefined ? undefined : this.data.attachments?.[index];
    if (!attachment) throw new Error(`Unknown attachment "${id}".`);
    return attachment;
  }

  get standaloneSkins(): readonly SkinDefinition[] {
    return this.externalSkins;
  }
  get skins(): readonly SkinDefinition[] {
    return mergeSkins(this.data.skins ?? [], this.externalSkins);
  }
  get activeSkin(): string {
    return this.skins.some((skin) => skin.name === this.selectedSkin) ? this.selectedSkin : this.defaultSkin;
  }
  selectSkin(name: string): void {
    this.getSkin(name);
    this.selectedSkin = name;
  }
  getSkin(name: string): SkinDefinition {
    const skin = this.skins.find((entry) => entry.name === name);
    if (!skin) throw new Error(`Unknown skin "${name}".`);
    return skin;
  }
  isStandaloneSkin(name: string): boolean {
    return this.externalSkins.some((skin) => skin.name === name);
  }
  skinDirty(name: string): boolean {
    return this.isStandaloneSkin(name) && !equalEditorData(this.getSkin(name), this.savedExternalSkins.get(name));
  }
  /** Resolve a partial override from a fresh default baseline, so repeated switching never accumulates mappings. */
  resolvedAttachment(slot: string, skin = this.activeSkin): string | undefined {
    this.getSlot(slot);
    const fallback = this.skins.find((entry) => entry.name === this.defaultSkin)?.slots;
    const overrides = this.skins.find((entry) => entry.name === skin)?.slots;
    const value = overrides && Object.hasOwn(overrides, slot) ? overrides[slot] : fallback?.[slot];
    return value ?? undefined;
  }
  createAttachment(input: unknown): void {
    const attachment = spriteAttachmentSchema.strict().parse(input);
    if (/^(blob:|__paper_artwork_)/.test(attachment.texture))
      throw new Error('Choose a stable character texture key, not a temporary preview texture.');
    if (this.attachmentIndices.has(attachment.id)) throw new Error(`Duplicate attachment ID "${attachment.id}".`);
    this.assertArtwork(attachment);
    this.endOperation();
    this.change(() => {
      this.data.attachments = [...(this.data.attachments ?? []), freezeData(attachment)];
      this.rebuildIndexes();
    });
  }
  removeAttachment(id: string): void {
    this.getAttachment(id);
    const references = [...(this.data.skins ?? []), ...this.externalSkins].flatMap((skin) =>
      Object.entries(skin.slots)
        .filter(([, value]) => value === id)
        .map(([slot]) => `${skin.name}/${slot}`),
    );
    if (references.length)
      throw new Error(`Attachment "${id}" is used by ${references.join(', ')}. Clear or replace these mappings first.`);
    this.endOperation();
    this.change(() => {
      this.data.attachments = this.data.attachments!.filter((entry) => entry.id !== id);
      this.rebuildIndexes();
    });
  }
  createSkin(name: string): void {
    identifierSchema.parse(name);
    if (this.skins.some((skin) => skin.name === name)) throw new Error(`Duplicate skin name "${name}".`);
    this.endOperation();
    this.change(() => {
      this.data.skins = [...(this.data.skins ?? []), freezeData({ version: 1 as const, name, slots: {} })];
    });
    this.selectedSkin = name;
  }
  renameSkin(name: string, next: string): void {
    const skin = this.getSkin(name);
    identifierSchema.parse(next);
    if (name === next) return;
    if (name === this.defaultSkin || this.isStandaloneSkin(name))
      throw new Error('This skin name is referenced by the character manifest. Create a new skin to use another name.');
    if (this.skins.some((entry) => entry.name === next)) throw new Error(`Duplicate skin name "${next}".`);
    this.endOperation();
    this.change(() => {
      this.data.skins = this.data.skins!.map((entry) =>
        entry.name === name ? freezeData({ ...skin, name: next }) : entry,
      );
    });
    if (this.selectedSkin === name) this.selectedSkin = next;
  }
  /** Undefined removes an override (inherit); null explicitly hides the slot. */
  assignAttachment(slot: string, attachment: string | null | undefined, skin = this.activeSkin): void {
    this.getSlot(slot);
    if (attachment !== null && attachment !== undefined) this.assertArtwork(this.getAttachment(attachment));
    const original = this.getSkin(skin);
    const slots = { ...original.slots };
    if (attachment === undefined) delete slots[slot];
    else
      Object.defineProperty(slots, slot, { value: attachment, enumerable: true, configurable: true, writable: true });
    const next = freezeData({ ...original, slots });
    checkSkinReferences([next], this.workingCopy, throwValidationIssue);
    this.endOperation();
    this.change(() => {
      if (this.isStandaloneSkin(skin))
        this.externalSkins = freezeData(this.externalSkins.map((entry) => (entry.name === skin ? next : entry)));
      else this.data.skins = this.data.skins!.map((entry) => (entry.name === skin ? next : entry));
    });
  }
  exportSkinJson(name: string, saveBaseline = true): string {
    this.endOperation();
    const skin = this.getSkin(name);
    checkSkinReferences([skin], this.workingCopy, throwValidationIssue);
    for (const id of Object.values(skin.slots)) if (id !== null) this.assertArtwork(this.getAttachment(id));
    assertJsonExportSize(skin);
    const json = serializeSkinDefinition(skin, this.workingCopy);
    if (saveBaseline && this.isStandaloneSkin(name)) {
      this.savedExternalSkins.set(name, skin);
      this.cachedDirty = undefined;
      this.cachedRigDirty = undefined;
    }
    return json;
  }
  private assertArtwork(attachment: SpriteAttachmentDefinition): void {
    const issue = this.artworkIssue?.(attachment.texture, attachment.frame);
    if (issue) throw new Error(issue);
  }

  /** Structural edits validate the complete candidate before installing one history entry. */
  private installStructure(candidate: RigDefinition, renamed?: { from: string; to: string }): void {
    const rig = new Rig(candidate);
    checkSkinReferences(this.externalSkins, rig, throwValidationIssue);
    this.assertRetainedReferences(candidate);
    this.endOperation();
    this.change(() => {
      this.restore(candidate);
      this.topologyRig = rig;
      if (renamed) {
        const direction = this.childDirections.get(renamed.from);
        if (direction) this.childDirections.set(renamed.to, direction);
      }
      for (const id of this.childDirections.keys()) if (!rig.hasBone(id)) this.childDirections.delete(id);
    });
  }

  getIKConstraint(id: string): ReadonlyRigData<TwoBoneIKDefinition> {
    return getIKConstraint(this.workingCopy, id);
  }

  selectIKConstraint(id: string): void {
    this.getIKConstraint(id);
    this.selection = null;
    this.selectedIKConstraintId = id;
  }

  ikConstraintDependencies(id: string): readonly string[] {
    return ikConstraintDependencies(this.workingCopy, id, { references: (name) => this.ikReferences?.(name) ?? [] });
  }

  createIKConstraint(options: CreateIKConstraintOptions, pose?: ReadonlyMap<string, Readonly<JointTransform>>): void {
    if (!this.data.ik?.some((entry) => entry.name === options.name) && this.ikReferences?.(options.name).length)
      throw new Error(`IK name "${options.name}" is reserved by external references. Choose another ID.`);
    this.installStructure(createIKConstraint(this.workingCopy, options, pose));
    this.selectIKConstraint(options.name);
  }

  updateIKConstraint(id: string, patch: IKConstraintPatch): void {
    this.installStructure(
      updateIKConstraint(this.workingCopy, id, patch, {
        references: (name) => this.ikReferences?.(name) ?? [],
      }),
    );
  }

  removeIKConstraint(id: string): void {
    this.installStructure(
      removeIKConstraint(this.workingCopy, id, { references: (name) => this.ikReferences?.(name) ?? [] }),
    );
  }

  createBone(id: string, parent = this.selection?.type === 'bone' ? this.selection.id : this.data.root): void {
    identifierSchema.parse(id);
    if (this.boneIndices.has(id)) throw new Error(`Duplicate bone ID "${id}".`);
    // New documents start with a single editable root; no character template is assumed.
    const bone: BoneDefinition = this.data.bones.length
      ? { id, parent: this.getBone(parent).id, y: this.getBone(parent).length ?? 40 }
      : { id };
    this.installStructure({
      ...this.workingCopy,
      root: this.data.bones.length ? this.data.root : id,
      bones: [...this.data.bones, bone],
    });
    this.selectBone(id);
  }

  /** Dependencies are reported before destructive changes; nothing is cascaded or silently removed. */
  boneDependencies(id: string): readonly string[] {
    this.getBone(id);
    return [
      ...this.childrenOf(id).map((child) => `child bone "${child}"`),
      ...(this.data.slots ?? []).filter((slot) => slot.bone === id).map((slot) => `slot "${slot.id}"`),
      ...(this.data.ik ?? [])
        .filter((chain) => [chain.rootBone, chain.middleBone, chain.endBone].includes(id))
        .map((chain) => `IK constraint "${chain.name}"`),
      ...(this.getBone(id).sprite ? ['bone artwork'] : []),
      ...(this.boneReferences?.(id) ?? []),
    ];
  }

  removeBone(id: string): void {
    const references = this.boneDependencies(id);
    if (id === this.data.root)
      throw new Error('The rig requires a root bone. Rename it or remove its children individually.');
    if (references.length)
      throw new Error(
        `Bone "${id}" is used by ${references.join(', ')}. Reparent children and remove dependent references first.`,
      );
    this.installStructure({ ...this.workingCopy, bones: this.data.bones.filter((bone) => bone.id !== id) });
  }

  renameBone(id: string, next: string): void {
    this.getBone(id);
    identifierSchema.parse(next);
    if (id === next) return;
    if (this.boneIndices.has(next)) throw new Error(`Duplicate bone ID "${next}".`);
    // Stable animation and host IK references cannot be rewritten by the rig document.
    const references = this.boneDependencies(id).filter(
      (value) => !value.startsWith('child bone ') && !value.startsWith('slot '),
    );
    if (references.length)
      throw new Error(`Bone "${id}" is used by ${references.join(', ')}. Remove these references before renaming.`);
    this.installStructure(
      {
        ...this.workingCopy,
        root: this.data.root === id ? next : this.data.root,
        bones: this.data.bones.map((bone) => ({
          ...bone,
          id: bone.id === id ? next : bone.id,
          ...(bone.parent === id ? { parent: next } : {}),
        })),
        slots: (this.data.slots ?? []).map((slot) => (slot.bone === id ? { ...slot, bone: next } : slot)),
      },
      { from: id, to: next },
    );
    this.selection = { type: 'bone', id: next };
  }

  /** Local transforms are retained; the hierarchy change is visible immediately in bind preview. */
  reparentBone(id: string, parent: string): void {
    const bone = this.getBone(id);
    this.getBone(parent);
    if (id === this.data.root) throw new Error('The root bone cannot have a parent.');
    if (bone.parent === parent) return;
    this.installStructure({
      ...this.workingCopy,
      bones: this.data.bones.map((entry) => (entry.id === id ? { ...entry, parent } : entry)),
    });
  }

  createSlot(id: string, bone: string): void {
    identifierSchema.parse(id);
    this.getBone(bone);
    if (this.slotIndices.has(id)) throw new Error(`Duplicate slot ID "${id}".`);
    this.installStructure({ ...this.workingCopy, slots: [...(this.data.slots ?? []), { id, bone }] });
    this.selectSlot(id);
  }

  removeSlot(id: string): void {
    this.getSlot(id);
    const references = this.skins.filter((skin) => Object.hasOwn(skin.slots, id)).map((skin) => `skin "${skin.name}"`);
    if (references.length)
      throw new Error(`Slot "${id}" is used by ${references.join(', ')}. Remove these overrides first.`);
    this.installStructure({ ...this.workingCopy, slots: this.data.slots!.filter((slot) => slot.id !== id) });
  }

  private replaceBone(bone: BoneDefinition): void {
    this.data.bones[this.boneIndices.get(bone.id)!] = freezeData(bone);
  }

  editBone(id: string, field: BoneField, value: number | undefined): void {
    this.editBoneFields(id, { [field]: value });
  }

  editBoneFields(id: string, values: Partial<Record<BoneField, number | undefined>>): void {
    for (const [field, value] of Object.entries(values)) if (value !== undefined) this.assertValue(field, value);
    const bone = { ...this.getBone(id) };
    this.change(() => {
      patchFields(bone, values);
      this.replaceBone(bone);
      if (values.length !== undefined) {
        for (const childId of this.childrenOf(id)) {
          const child = { ...this.getBone(childId) };
          const x = child.x ?? 0;
          const y = child.y ?? 0;
          const direction = normalizeBoneDirection(x, y) ?? this.childDirections.get(childId) ?? { x: 0, y: 1 };
          this.childDirections.set(childId, direction);
          child.x = direction.x * values.length;
          child.y = direction.y * values.length;
          this.replaceBone(child);
        }
      }
    });
  }

  editSlot(id: string, field: SlotField, value: number | undefined): void {
    this.editSlotFields(id, { [field]: value });
  }

  editSlotFields(id: string, values: Partial<Record<SlotField, number | undefined>>): void {
    for (const [field, value] of Object.entries(values)) if (value !== undefined) this.assertValue(field, value);
    const slot = { ...this.getSlot(id) };
    this.change(() => {
      patchFields(slot, values);
      this.data.slots![this.slotIndices.get(id)!] = freezeData(slot);
    });
  }

  editSprite(id: string, field: SpriteField, value: number | undefined, attachment = false): void {
    this.editSpriteFields(id, { [field]: value }, attachment);
  }

  editSpriteFields(id: string, values: Partial<Record<SpriteField, number | undefined>>, attachment = false): void {
    for (const [field, value] of Object.entries(values)) if (value !== undefined) this.assertValue(field, value);
    const original = attachment ? this.getAttachment(id) : this.getBone(id).sprite;
    const sprite = original ? { ...original } : undefined;
    if (!sprite) throw new Error(`No sprite for "${id}".`);
    this.change(() => {
      patchFields(sprite, values);
      if (attachment)
        this.data.attachments![this.attachmentIndices.get(id)!] = freezeData(sprite as SpriteAttachmentDefinition);
      else this.replaceBone({ ...this.getBone(id), sprite });
    });
  }

  private assertValue(field: string, value: number): void {
    if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
    if (field === 'length' && value < 0) throw new Error('Bone length cannot be negative.');
    if ((field === 'originX' || field === 'originY') && (value < 0 || value > 1))
      throw new Error('Origin must be between 0 and 1.');
  }

  /** Force full validation, including while a grouped edit is still in progress. */
  validate(): void {
    this.rebuildIndexes();
    this.invalidate();
    this.cachedIssues = undefined;
    this.updateWarnings();
  }

  private updateWarnings(): void {
    this.warnings = this.validationIssues().map((issue) => `${issue.path ?? 'rig'}: ${issue.message}`);
  }

  selectBone(id: string): void {
    this.getBone(id);
    this.selectedIKConstraintId = null;
    this.selection = { type: 'bone', id };
  }

  selectSlot(id: string): void {
    this.getSlot(id);
    this.selectedIKConstraintId = null;
    this.selection = { type: 'slot', id };
  }

  clearSelection(): void {
    this.selectedIKConstraintId = null;
    this.selection = null;
  }

  childrenOf(id: string): readonly string[] {
    this.getBone(id);
    return this.children.get(id) ?? [];
  }

  hierarchy(): readonly { id: string; depth: number }[] {
    return boneHierarchy(this.rig);
  }
}
