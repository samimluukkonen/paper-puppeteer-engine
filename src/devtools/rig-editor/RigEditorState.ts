import {
  RIG_FORMAT_VERSION,
  type RigJsonDefinition,
  type ValidationIssue,
  validateRigDefinition,
} from '../../engine/externalData.js';
import { Rig } from '../../engine/Rig.js';
import type { BoneDefinition, RigDefinition, SlotDefinition, SpriteAttachmentDefinition } from '../../engine/types.js';

export type RigEditorSelection = { type: 'bone'; id: string } | { type: 'slot'; id: string } | null;
export type VisibilityKey = 'artwork' | 'bones' | 'boneNames' | 'boneLengths' | 'slots' | 'spriteOrigins' | 'ik';
export type EditMode = 'joint' | 'sprite';
type BoneField = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'length' | 'depth';
type SlotField = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'depth';
type SpriteField = 'x' | 'y' | 'originX' | 'originY';
export type GridSnap = 0 | 1 | 2 | 5 | 10;
export type RotationSnap = 0 | 1 | 5 | 15;

export interface RigEditorStateOptions {
  /** Maximum undo entries, including grouped operations. Defaults to 100; zero disables history. */
  historyLimit?: number;
}

type HistoryEntry = { rig: string; directions: [string, { x: number; y: number }][] };

const snapshot = (rig: RigDefinition): string => JSON.stringify(rig);
const round = (value: number): number => Number(value.toFixed(6));

/** Order authoring fields consistently without changing array order or untouched numbers. */
function stable(value: unknown, original: unknown): unknown {
  if (typeof value === 'number') return value === original ? value : round(value);
  if (Array.isArray(value))
    return value.map((entry, index) => stable(entry, Array.isArray(original) ? original[index] : undefined));
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const baseline = original && typeof original === 'object' ? (original as Record<string, unknown>) : {};
    const order = [
      'version',
      'name',
      'root',
      'bones',
      'slots',
      'attachments',
      'skins',
      'id',
      'parent',
      'bone',
      'length',
      'sprite',
      'depth',
      'texture',
      'frame',
      'x',
      'y',
      'rotation',
      'scaleX',
      'scaleY',
      'originX',
      'originY',
    ];
    return Object.fromEntries(
      Object.keys(source)
        .sort((a, b) => {
          const ai = order.indexOf(a),
            bi = order.indexOf(b);
          return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b);
        })
        .map((key) => [key, stable(source[key], baseline[key])]),
    );
  }
  return value;
}

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
  gridSnap: GridSnap = 0;
  rotationSnap: RotationSnap = 0;
  readonly name: string | undefined;
  readonly historyLimit: number;
  private readonly includeSkins: boolean;
  private readonly initialCopy: RigDefinition;
  private saved: string;
  private cachedSnapshot: string | undefined;
  private cachedIssues: readonly ValidationIssue[] | undefined;
  private readonly past: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];
  private operation: HistoryEntry | undefined;
  private readonly childDirections = new Map<string, { x: number; y: number }>();
  private readonly children = new Map<string, string[]>();

  constructor(source: Rig, file?: RigJsonDefinition, options: RigEditorStateOptions = {}) {
    this.historyLimit = options.historyLimit ?? 100;
    if (!Number.isSafeInteger(this.historyLimit) || this.historyLimit < 0)
      throw new Error('History limit must be a nonnegative safe integer.');
    this.source = source;
    this.name = file?.name;
    this.includeSkins = file ? file.skins !== undefined : true;
    this.workingCopy = structuredClone({
      root: source.root,
      bones: source.bones,
      slots: source.slots,
      attachments: source.attachments,
      skins: source.skins,
    });
    this.rig = new Rig(this.workingCopy);
    this.initialCopy = structuredClone(this.workingCopy);
    this.saved = snapshot(this.workingCopy);
    this.cachedSnapshot = this.saved;
    for (const bone of this.rig.bones) {
      if (bone.parent === undefined) continue;
      const children = this.children.get(bone.parent) ?? [];
      children.push(bone.id);
      this.children.set(bone.parent, children);
    }
  }

  get dirty(): boolean {
    return this.workingSnapshot !== this.saved;
  }

  /** Reused by history, status, and asynchronous export completion. */
  get workingSnapshot(): string {
    this.cachedSnapshot ??= snapshot(this.workingCopy);
    return this.cachedSnapshot;
  }

  private invalidate(): void {
    this.cachedSnapshot = undefined;
    this.cachedIssues = undefined;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get historyLength(): number {
    return this.past.length;
  }

  beginOperation(): void {
    if (this.operation === undefined) this.operation = this.historyEntry();
  }

  endOperation(): void {
    if (this.operation === undefined) return;
    const before = this.operation;
    this.operation = undefined;
    this.record(before);
  }

  private historyEntry(): HistoryEntry {
    return { rig: this.workingSnapshot, directions: [...this.childDirections] };
  }

  private record(before: HistoryEntry): void {
    if (before.rig === this.workingSnapshot) return;
    this.pushPast(before);
    this.future.length = 0;
  }

  private pushPast(entry: HistoryEntry): void {
    if (this.historyLimit === 0) return;
    this.past.push(entry);
    if (this.past.length > this.historyLimit) this.past.splice(0, this.past.length - this.historyLimit);
  }

  private change(edit: () => void): void {
    const before = this.operation ?? this.historyEntry();
    try {
      edit();
    } finally {
      this.invalidate();
    }
    if (this.operation === undefined) this.record(before);
    this.updateWarnings();
  }

  private restore(json: string): void {
    const copy = JSON.parse(json) as RigDefinition;
    Object.assign(this.workingCopy, copy);
    for (const key of ['slots', 'attachments', 'skins'] as const)
      if (copy[key] === undefined) delete (this.workingCopy as unknown as Record<string, unknown>)[key];
    this.invalidate();
    this.cachedSnapshot = json;
  }

  private restoreHistory(entry: HistoryEntry): void {
    this.restore(entry.rig);
    this.childDirections.clear();
    for (const [id, direction] of entry.directions) this.childDirections.set(id, direction);
  }

  undo(): boolean {
    this.endOperation();
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.historyEntry());
    this.restoreHistory(previous);
    this.updateWarnings();
    return true;
  }

  redo(): boolean {
    this.endOperation();
    const next = this.future.pop();
    if (next === undefined) return false;
    this.pushPast(this.historyEntry());
    this.restoreHistory(next);
    this.updateWarnings();
    return true;
  }

  resetSelected(attachmentId?: string): boolean {
    const selected = this.selection;
    if (!selected) return false;
    this.change(() => {
      if (selected.type === 'bone') {
        const index = this.workingCopy.bones.findIndex((bone) => bone.id === selected.id);
        const original = this.initialCopy.bones[index]!;
        if (this.getBone(selected.id).length !== original.length) {
          // Length edits move direct children; reset those offsets in the same history entry.
          for (const childId of this.childrenOf(selected.id)) {
            const child = this.getBone(childId) as BoneDefinition & { x?: number; y?: number };
            this.childDirections.delete(childId);
            const initialChild = this.initialCopy.bones.find((bone) => bone.id === childId)!;
            for (const field of ['x', 'y'] as const) {
              if (initialChild[field] === undefined) delete child[field];
              else child[field] = initialChild[field];
            }
          }
        }
        (this.workingCopy.bones as BoneDefinition[])[index] = structuredClone(original);
      } else {
        const index = this.workingCopy.slots!.findIndex((slot) => slot.id === selected.id);
        (this.workingCopy.slots as SlotDefinition[])[index] = structuredClone(this.initialCopy.slots![index]!);
        // The inspector's artwork fields belong to the active slot attachment.
        if (attachmentId) {
          const attachmentIndex = this.workingCopy.attachments?.findIndex((item) => item.id === attachmentId) ?? -1;
          if (attachmentIndex >= 0)
            (this.workingCopy.attachments as SpriteAttachmentDefinition[])[attachmentIndex] = structuredClone(
              this.initialCopy.attachments![attachmentIndex]!,
            );
        }
      }
    });
    return true;
  }

  resetRig(): void {
    this.change(() => {
      this.restore(snapshot(this.initialCopy));
      this.childDirections.clear();
    });
  }

  snapTranslation(value: number): number {
    return this.gridSnap ? round(Math.round(value / this.gridSnap) * this.gridSnap) : value;
  }

  snapRotation(value: number): number {
    if (!this.rotationSnap) return value;
    const step = (this.rotationSnap * Math.PI) / 180;
    return Math.round(value / step) * step;
  }

  validationIssues(): readonly ValidationIssue[] {
    this.cachedIssues ??= validateRigDefinition(this.exportCandidate());
    return this.cachedIssues;
  }

  private exportCandidate(): RigJsonDefinition {
    return {
      version: RIG_FORMAT_VERSION,
      ...(this.name === undefined ? {} : { name: this.name }),
      root: this.workingCopy.root,
      bones: this.workingCopy.bones,
      ...(this.workingCopy.slots === undefined ? {} : { slots: this.workingCopy.slots }),
      ...(this.workingCopy.attachments === undefined ? {} : { attachments: this.workingCopy.attachments }),
      ...(this.includeSkins && this.workingCopy.skins !== undefined ? { skins: this.workingCopy.skins } : {}),
    };
  }

  markSaved(savedSnapshot = this.workingSnapshot): void {
    this.saved = savedSnapshot;
  }

  exportRig(saveBaseline = true): RigJsonDefinition {
    this.endOperation();
    const candidate = stable(this.exportCandidate(), {
      ...this.exportCandidate(),
      bones: this.initialCopy.bones,
      slots: this.initialCopy.slots,
      attachments: this.initialCopy.attachments,
      skins: this.initialCopy.skins,
    }) as RigJsonDefinition;
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
    return `${JSON.stringify(this.exportRig(saveBaseline), null, 2)}\n`;
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
    this.editBoneFields(id, { [field]: value });
  }

  editBoneFields(id: string, values: Partial<Record<BoneField, number>>): void {
    for (const [field, value] of Object.entries(values)) this.assertValue(field, value);
    const bone = this.getBone(id);
    this.change(() => {
      Object.assign(bone, values);
      if (values.length !== undefined) {
        for (const childId of this.childrenOf(id)) {
          const child = this.getBone(childId) as BoneDefinition & { x?: number; y?: number };
          const x = child.x ?? 0;
          const y = child.y ?? 0;
          const distance = Math.hypot(x, y);
          const direction = distance
            ? { x: x / distance, y: y / distance }
            : (this.childDirections.get(childId) ?? { x: 0, y: 1 });
          this.childDirections.set(childId, direction);
          child.x = direction.x * values.length;
          child.y = direction.y * values.length;
        }
      }
    });
  }

  editSlot(id: string, field: SlotField, value: number): void {
    this.editSlotFields(id, { [field]: value });
  }

  editSlotFields(id: string, values: Partial<Record<SlotField, number>>): void {
    for (const [field, value] of Object.entries(values)) this.assertValue(field, value);
    const slot = this.getSlot(id);
    this.change(() => {
      Object.assign(slot, values);
    });
  }

  editSprite(id: string, field: SpriteField, value: number, attachment = false): void {
    this.editSpriteFields(id, { [field]: value }, attachment);
  }

  editSpriteFields(id: string, values: Partial<Record<SpriteField, number>>, attachment = false): void {
    for (const [field, value] of Object.entries(values)) this.assertValue(field, value);
    const sprite = attachment ? this.getAttachment(id) : this.getBone(id).sprite;
    if (!sprite) throw new Error(`No sprite for "${id}".`);
    this.change(() => {
      Object.assign(sprite, values);
    });
  }

  private assertValue(field: string, value: number): void {
    if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
    if (field === 'length' && value < 0) throw new Error('Bone length cannot be negative.');
    if ((field === 'originX' || field === 'originY') && (value < 0 || value > 1))
      throw new Error('Origin must be between 0 and 1.');
  }

  /** Explicit validation also refreshes caches after direct working-copy mutations. */
  validate(): void {
    this.invalidate();
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
