import { normalizeBoneDirection } from '../../engine/boneMath.js';
import {
  RIG_FORMAT_VERSION,
  type RigJsonDefinition,
  type ValidationIssue,
  validateRigDefinition,
} from '../../engine/externalData.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { Rig } from '../../engine/Rig.js';
import type {
  BoneDefinition,
  RigDefinition,
  SkinDefinition,
  SlotDefinition,
  SpriteAttachmentDefinition,
  TransformProperty,
} from '../../engine/types.js';
import { boneHierarchy } from '../shared/boneHierarchy.js';
import { equalEditorData, freezeData, type ReadonlyEditorData, roundEditorNumber } from '../shared/editorData.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { inspectRigDraft, type RigEditorRecoverySnapshot } from './rigDraftRecovery.js';
import { serializeRigData, serializeRigJson } from './rigSerialization.js';

export type RigEditorSelection = { type: 'bone'; id: string } | { type: 'slot'; id: string } | null;
export type VisibilityKey = 'artwork' | 'bones' | 'boneNames' | 'boneLengths' | 'slots' | 'spriteOrigins' | 'ik';
export type EditMode = 'joint' | 'sprite';
export type BoneField = TransformProperty | 'length' | 'depth';
export type SlotField = TransformProperty | 'depth';
export type SpriteField = 'x' | 'y' | 'originX' | 'originY';
export type GridSnap = 0 | 1 | 2 | 5 | 10;
export type RotationSnap = 0 | 1 | 5 | 15;

export interface RigEditorStateOptions {
  /** Maximum undo entries, including grouped operations. Defaults to 100; zero disables history. */
  historyLimit?: number;
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
  gridSnap: GridSnap = 0;
  rotationSnap: RotationSnap = 0;
  readonly name: string | undefined;
  private readonly includeSkins: boolean;
  private readonly initialCopy: ReadonlyRigData<RigDefinition>;
  private saved: ReadonlyRigData<RigDefinition>;
  private cachedDirty: boolean | undefined;
  private cachedIssues: readonly ValidationIssue[] | undefined;
  private validationDirty = true;
  private readonly history: SnapshotHistory<HistoryEntry>;
  private readonly childDirections = new Map<string, { x: number; y: number }>();
  private readonly children = new Map<string, string[]>();
  private readonly boneIndices = new Map<string, number>();
  private readonly slotIndices = new Map<string, number>();
  private readonly attachmentIndices = new Map<string, number>();

  constructor(source: Rig, file?: RigJsonDefinition, options: RigEditorStateOptions = {}) {
    this.history = new SnapshotHistory(
      () => this.historyEntry(),
      (entry) => this.restoreHistory(entry),
      (left, right) => equalEditorData(left.rig, right.rig),
      options.historyLimit ?? 100,
    );
    this.source = source;
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
    this.rig = source;
    this.rebuildIndexes();
    this.initialCopy = this.workingCopy;
    // Compact input can expand beyond the import limit when exported with indentation.
    // Reject it before the scene replaces the working editor or clears its recovery draft.
    assertJsonExportSize(this.exportCandidate());
    this.saved = this.initialCopy;
    this.cachedDirty = false;
    for (const bone of this.rig.bones) {
      if (bone.parent === undefined) continue;
      const children = this.children.get(bone.parent) ?? [];
      children.push(bone.id);
      this.children.set(bone.parent, children);
    }
    for (const children of this.children.values()) Object.freeze(children);
  }

  get dirty(): boolean {
    this.cachedDirty ??= !equalEditorData(this.workingCopy, this.saved);
    return this.cachedDirty;
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
    this.validationDirty = true;
  }

  /** Store array positions so replacing an entry during reset cannot leave stale object references. */
  private rebuildIndexes(): void {
    this.boneIndices.clear();
    this.slotIndices.clear();
    this.attachmentIndices.clear();
    for (const [index, bone] of this.workingCopy.bones.entries()) this.boneIndices.set(bone.id, index);
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

  private historyEntry(): HistoryEntry {
    this.cachedHistoryEntry ??= freezeData({ rig: this.workingCopy, directions: [...this.childDirections] });
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
  }

  private restoreHistory(entry: HistoryEntry): void {
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
        const original = this.initialCopy.bones[index]!;
        if (this.getBone(selected.id).length !== original.length) {
          // Length edits move direct children; reset those offsets in the same history entry.
          for (const childId of this.childrenOf(selected.id)) {
            const child = { ...this.getBone(childId) };
            this.childDirections.delete(childId);
            const initialChild = this.initialCopy.bones[this.boneIndices.get(childId)!]!;
            for (const field of ['x', 'y'] as const) {
              if (initialChild[field] === undefined) delete child[field];
              else child[field] = initialChild[field];
            }
            this.replaceBone(child);
          }
        }
        this.data.bones[index] = original;
      } else {
        const index = this.slotIndices.get(selected.id)!;
        this.data.slots![index] = this.initialCopy.slots![index]!;
        // The inspector's artwork fields belong to the active slot attachment.
        if (attachmentId) {
          const attachmentIndex = this.attachmentIndices.get(attachmentId);
          if (attachmentIndex !== undefined)
            this.data.attachments![attachmentIndex] = this.initialCopy.attachments![attachmentIndex]!;
        }
      }
    });
    return true;
  }

  resetRig(): void {
    this.change(() => {
      this.restore(this.initialCopy);
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
      ...(this.includeSkins && copy.skins !== undefined ? { skins: copy.skins } : {}),
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
    return { version: 1, rig: this.exportCandidate(snapshot.rig), directions: snapshot.directions };
  }

  canRestoreDraft(input: unknown): boolean {
    return inspectRigDraft(input, this.initialCopy, this.rig) !== undefined;
  }

  /** Restored authored changes stay dirty and form one undoable operation. */
  restoreDraft(input: unknown): boolean {
    const data = inspectRigDraft(input, this.initialCopy, this.rig);
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
  }

  exportRig(saveBaseline = true): RigJsonDefinition {
    this.endOperation();
    const candidate = serializeRigData(this.exportCandidate(), this.initialCopy);
    const issues = validateRigDefinition(candidate);
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
    this.rig.getBone(id);
    this.selection = { type: 'bone', id };
  }

  selectSlot(id: string): void {
    this.getSlot(id);
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
    return boneHierarchy(this.rig);
  }
}
