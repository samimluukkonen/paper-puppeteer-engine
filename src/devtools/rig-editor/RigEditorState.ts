import {
  normalizeBoneDirection,
  RIG_FORMAT_VERSION,
  validateRigDefinition,
  createFootContactMarker,
  assertIKConstraintChangesAllowed,
  createIKConstraint,
  getIKConstraint,
  ikConstraintDependencies,
  removeIKConstraint,
  updateIKConstraint,
  mergeSkins,
  createRectangleMeshAttachment,
  replaceMeshGeometry,
  deleteMeshVertex,
  subdivideMeshEdge,
  normalizeBoneInfluences,
  MeshWeightStroke,
  setBoneWeight,
  assertInfluenceLimit,
  Rig,
  footContactMarkerSchema,
  checkSkinReferences,
  throwValidationIssue,
  type RigJsonDefinition,
  type ValidationIssue,
  type CreateFootContactMarkerOptions,
  type CreateIKConstraintOptions,
  type IKConstraintPatch,
} from '../../engine/core.js';
import type {
  Point,
  TwoBoneIKDefinition,
  BoneDefinition,
  MeshAttachmentDefinition,
  FootContactMarker,
  JointTransform,
  RigDefinition,
  SkinDefinition,
  SlotDefinition,
  AttachmentDefinition,
  TransformProperty,
} from '../../engine/data.js';
import { boneHierarchy, sameRigTopology } from '../shared/boneHierarchy.js';
import { equalEditorData, freezeData, type ReadonlyEditorData, roundEditorNumber } from '../shared/editorData.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { RigArtworkCommands, type RigArtworkUpdate } from './RigArtworkCommands.js';
import { inspectRigDraft, type AuthoredRigData, type RigEditorRecoverySnapshot } from './rigDraftRecovery.js';
import { serializeRigData, serializeRigJson } from './rigSerialization.js';
import { RigStructureCommands } from './RigStructureCommands.js';

export type RigSelectionInspectorTab = 'mesh' | 'attachments';
export type RigEditorSelection = { type: 'bone'; id: string } | { type: 'slot'; id: string } | null;
export type VisibilityKey =
  | 'artwork'
  | 'bones'
  | 'boneNames'
  | 'boneLengths'
  | 'slots'
  | 'spriteOrigins'
  | 'ik'
  | 'footContacts';
export type EditMode = 'joint' | 'sprite' | 'origin' | 'slot' | 'mesh' | 'weights';
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
  /** Live deformation dependencies; reject newly incompatible attachment/vertex proposals atomically. */
  meshReferences?: (candidate: RigDefinition) => readonly string[];
  /** Live IK track, baked metadata and specialized host references. Also reserves host-owned IDs. */
  ikReferences?: (id: string) => readonly string[];
  /** Live persisted marker references, including host Scene Editor grounding selections. */
  footContactReferences?: (id: string) => readonly string[];
}

export type { RigEditorRecoverySnapshot } from './rigDraftRecovery.js';
type HistoryEntry = RigEditorRecoverySnapshot;

export type ReadonlyRigData<T> = ReadonlyEditorData<T>;
type WorkingRig = {
  footContactMarkers?: readonly FootContactMarker[];
  name?: string;
  ik?: readonly TwoBoneIKDefinition[];
  root: string;
  bones: BoneDefinition[];
  slots?: SlotDefinition[];
  attachments?: AttachmentDefinition[];
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
  /** Host scene references must be resolved before changing a skin's identity. */
  skinReferences: ((name: string) => readonly string[]) | undefined;
  readonly source: Rig;
  private readonly data: WorkingRig;
  private cachedWorkingCopy: ReadonlyRigData<AuthoredRigData> | undefined;
  private cachedHistoryEntry: HistoryEntry | undefined;
  private topologyRig: Rig;
  get rig(): Rig {
    return this.topologyRig;
  }
  selection: RigEditorSelection = null;
  private inspectorSelection: { selection: NonNullable<RigEditorSelection>; tab: RigSelectionInspectorTab } | undefined;
  /** A control can request its own inspector for this exact selection, independently of browser focus. */
  get selectionInspectorTab(): RigSelectionInspectorTab | undefined {
    return this.inspectorSelection?.selection === this.selection ? this.inspectorSelection.tab : undefined;
  }
  selectedIKConstraintId: string | null = null;
  selectedFootContactMarkerId: string | null = null;
  private targetDragId: string | undefined;
  get ikTargetDragId(): string | undefined {
    return this.targetDragId;
  }
  editMode: EditMode = 'joint';
  selectedMeshVertexId: string | null = null;
  selectedMeshEdge: [number, number] | null = null;
  meshFeedback = '';
  influenceBoneId = '';
  brushRadius = 60;
  brushStrength = 0.25;
  brushErase = false;
  weightInfluenceLimit = 4;
  weightBrushPoint: Point | undefined;
  private weightStroke: MeshWeightStroke | undefined;

  get paintingWeights(): boolean {
    return !!this.weightStroke;
  }

  get meshSlotBoneId(): string {
    if (!this.selectedMesh || this.selection?.type !== 'slot') throw new Error('Select a mesh attachment slot.');
    return this.getSlot(this.selection.id).bone;
  }

  get weightBoneId(): string {
    return this.boneIndices.has(this.influenceBoneId) ? this.influenceBoneId : this.meshSlotBoneId;
  }

  /** Prefer the slot bone; erasing that bone falls back to its parent, root, then another bone. */
  get weightFallbackBoneId(): string {
    const selected = this.weightBoneId,
      slot = this.meshSlotBoneId;
    return (
      [slot, this.getBone(selected).parent, this.data.root, ...this.data.bones.map((bone) => bone.id)].find(
        (id): id is string => !!id && id !== selected,
      ) ?? selected
    );
  }

  selectWeightBone(id: string): void {
    this.getBone(id);
    this.influenceBoneId = id;
  }

  beginWeightStroke(points: readonly Point[], point: Point): void {
    this.finishWeightStroke(false);
    const mesh = this.selectedMesh;
    if (!mesh) throw new Error('Select a mesh attachment first.');
    const stroke = new MeshWeightStroke(mesh, points, point, {
      boneId: this.weightBoneId,
      rigidBoneId: this.meshSlotBoneId,
      fallbackBoneId: this.weightFallbackBoneId,
      radius: this.brushRadius,
      strength: this.brushStrength,
      erase: this.brushErase,
      limit: this.weightInfluenceLimit,
    });
    this.endOperation();
    this.beginOperation();
    this.weightStroke = stroke;
    this.continueWeightStroke(point);
  }

  continueWeightStroke(point: Point): void {
    if (!this.weightStroke) return;
    const result = this.weightStroke.sample(point);
    this.installMesh(result.mesh);
    this.meshFeedback = `${result.changed} vertices brushed; ${result.dropped} other influences dropped. Fallback: ${this.weightStroke.options.fallbackBoneId}.`;
  }

  finishWeightStroke(commit = true): void {
    if (!this.weightStroke) return;
    this.weightStroke = undefined;
    if (commit) this.endOperation();
    else {
      this.cancelOperation();
      this.meshFeedback = 'Weight stroke cancelled.';
    }
  }

  editSelectedVertexWeight(weight: number): void {
    const mesh = this.selectedMesh,
      id = this.selectedMeshVertexId;
    if (!mesh || !mesh.vertices.some((vertex) => vertex.id === id)) throw new Error('Select a mesh vertex.');
    const boneId = this.weightBoneId,
      fallback = this.weightFallbackBoneId;
    let dropped = 0;
    const vertices = mesh.vertices.map((vertex) => {
      if (vertex.id !== id) return vertex;
      const original = vertex.influences ?? [{ boneId: this.meshSlotBoneId, weight: 1 }];
      const influences = setBoneWeight(original, boneId, weight, fallback, this.weightInfluenceLimit);
      dropped = original.filter(
        (entry) =>
          entry.boneId !== boneId && entry.weight > 0 && !influences.some((next) => next.boneId === entry.boneId),
      ).length;
      return { ...vertex, influences };
    });
    this.installMesh({ ...mesh, vertices });
    this.meshFeedback = `Vertex weight updated; ${dropped} other influences dropped. Fallback: ${fallback}.`;
  }

  normalizeSelectedMeshWeights(reset = false): void {
    const mesh = this.selectedMesh;
    if (!mesh) throw new Error('Select a mesh attachment first.');
    const boneId = this.meshSlotBoneId;
    this.installMesh({
      ...mesh,
      vertices: mesh.vertices.map((vertex) => ({
        ...vertex,
        influences: reset
          ? [{ boneId, weight: 1 }]
          : normalizeBoneInfluences(vertex.influences ?? [{ boneId, weight: 1 }]),
      })),
    });
    this.meshFeedback = reset
      ? `Reset this mesh to slot bone ${boneId}.`
      : 'Normalized this mesh. No influences dropped.';
  }

  setWeightInfluenceLimit(limit: number): void {
    assertInfluenceLimit(limit);
    this.weightInfluenceLimit = limit;
    this.meshFeedback = 'Limit applies only to brushed or numerically edited vertices. Existing weights are retained.';
  }

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
    footContacts: true,
  };
  artworkOpacity = 1;
  gridSnap: GridSnap = 0;
  rotationSnap: RotationSnap = 0;
  get name(): string | undefined {
    return this.data.name;
  }
  private readonly includeSkins: boolean;
  private readonly initialCopy: ReadonlyRigData<AuthoredRigData>;
  private saved: ReadonlyRigData<AuthoredRigData>;
  private cachedDirty: boolean | undefined;
  private cachedRigDirty: boolean | undefined;
  private cachedIssues: readonly ValidationIssue[] | undefined;
  private validationDirty = true;
  private readonly history: SnapshotHistory<HistoryEntry>;
  private readonly structureCommands: RigStructureCommands;
  private readonly artworkCommands: RigArtworkCommands;
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
  private artworkIssue: RigEditorStateOptions['artworkIssue'];
  private readonly meshReferences: RigEditorStateOptions['meshReferences'];
  private readonly boneReferences: RigEditorStateOptions['boneReferences'];
  private readonly ikReferences: RigEditorStateOptions['ikReferences'];
  private readonly footContactReferences: RigEditorStateOptions['footContactReferences'];

  /** Renderer validation is borrowed only while a preview is mounted. */
  setArtworkValidator(validate: RigEditorStateOptions['artworkIssue']): void {
    this.artworkIssue = validate;
    this.validationDirty = true;
  }

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
    this.meshReferences = options.meshReferences;
    this.ikReferences = options.ikReferences;
    this.footContactReferences = options.footContactReferences;
    this.externalSkins = freezeData(structuredClone(options.standaloneSkins ?? []));
    this.initialExternalSkins = this.externalSkins;
    for (const skin of this.externalSkins) this.savedExternalSkins.set(skin.name, skin);
    this.defaultSkin = options.defaultSkin ?? mergeSkins(source.skins, this.externalSkins)[0]?.name ?? '';
    this.selectedSkin = this.defaultSkin;
    this.includeSkins = file ? file.skins !== undefined : true;
    this.data = structuredClone({
      ...(file?.name === undefined ? {} : { name: file.name }),
      root: source.root,
      ...(source.footContactMarkers === undefined ? {} : { footContactMarkers: [...source.footContactMarkers] }),
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
    this.structureCommands = new RigStructureCommands(this, {
      install: (candidate, renamed) => this.installStructure(candidate, renamed),
      hasBone: (id) => this.boneIndices.has(id),
      hasSlot: (id) => this.slotIndices.has(id),
      boneReferences: (id) => this.boneReferences?.(id) ?? [],
    });
    this.artworkCommands = new RigArtworkCommands(this, {
      install: (update) => this.installArtwork(update),
      hasAttachment: (id) => this.attachmentIndices.has(id),
      assertArtwork: (attachment) => this.assertArtwork(attachment),
    });
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
  get workingCopy(): ReadonlyRigData<AuthoredRigData> {
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
    for (const entries of [
      this.data.bones,
      this.data.slots,
      this.data.attachments,
      this.data.skins,
      this.data.ik,
      this.data.footContactMarkers,
    ])
      for (const entry of entries ?? []) freezeData(entry);
  }

  /** Reused by history, status, and asynchronous export completion. */
  get workingSnapshot(): ReadonlyRigData<AuthoredRigData> {
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
    const previousMeshIssues = new Set(this.meshReferences?.(this.workingCopy));
    this.history.change(() => {
      this.invalidate();
      edit();
      // Bound geometry must never survive a silent rest/hierarchy edit. History rolls failed proposals back.
      if (this.data.attachments?.some((attachment) => attachment.type === 'mesh')) new Rig(this.data);
      this.assertMeshReferences(this.data, previousMeshIssues);
    });
    if (!this.history.inOperation) this.updateWarnings();
  }

  private restore(copy: ReadonlyRigData<AuthoredRigData>): void {
    Object.assign(this.data, {
      ...copy,
      bones: [...copy.bones],
      ...(copy.slots === undefined ? {} : { slots: [...copy.slots] }),
      ...(copy.attachments === undefined ? {} : { attachments: [...copy.attachments] }),
      ...(copy.skins === undefined ? {} : { skins: [...copy.skins] }),
    });
    for (const key of ['name', 'slots', 'attachments', 'skins', 'ik', 'footContactMarkers'] as const)
      if (copy[key] === undefined) delete this.data[key];
    this.invalidate();
    this.cachedWorkingCopy = copy;
    this.rebuildIndexes();
    this.syncTopologyRig();
    this.reconcileSelection();
  }

  private syncTopologyRig(): void {
    // Numeric drafts may be temporarily invalid; retain the last validated topology in that case.
    if (
      sameRigTopology(this.topologyRig, this.workingCopy) &&
      equalEditorData(this.topologyRig.ik, this.data.ik) &&
      equalEditorData(this.topologyRig.footContactMarkers, this.data.footContactMarkers)
    )
      return;
    this.topologyRig = new Rig(this.workingCopy);
  }

  private reconcileSelection(): void {
    if (
      this.selectedFootContactMarkerId &&
      !this.data.footContactMarkers?.some((entry) => entry.id === this.selectedFootContactMarkerId)
    )
      this.selectedFootContactMarkerId = null;
    if (this.selectedIKConstraintId && !this.data.ik?.some((entry) => entry.name === this.selectedIKConstraintId))
      this.selectedIKConstraintId = null;
    if (
      this.selection &&
      !(this.selection.type === 'bone' ? this.boneIndices : this.slotIndices).has(this.selection.id)
    )
      this.selection = null;
  }

  private assertMeshReferences(
    candidate: RigDefinition,
    previous = new Set(this.meshReferences?.(this.workingCopy)),
  ): void {
    const issues = this.meshReferences?.(candidate).filter((issue) => !previous.has(issue)) ?? [];
    if (issues.length)
      throw new Error(
        `Mesh edit would invalidate ${issues.join('; ')} Restore the mesh IDs or explicitly remove the animation tracks first.`,
      );
  }

  private assertRetainedReferences(candidate: RigDefinition): void {
    this.assertMeshReferences(candidate);
    const markerIds = new Set(candidate.footContactMarkers?.map((marker) => marker.id));
    for (const marker of this.data.footContactMarkers ?? []) {
      if (markerIds.has(marker.id)) continue;
      const references = this.footContactMarkerDependencies(marker.id);
      if (references.length)
        throw new Error(
          `Foot contact marker "${marker.id}" is used by ${references.join(', ')}. Remove these references first.`,
        );
    }
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
    this.assertRetainedSkins(entry.rig.skins ?? [], entry.standaloneSkins ?? this.initialExternalSkins);
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
      this.assertRetainedSkins(this.initialCopy.skins ?? [], this.initialExternalSkins);
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
      ...(copy.name === undefined ? {} : { name: copy.name }),
      root: copy.root,
      ...(copy.footContactMarkers === undefined ? {} : { footContactMarkers: copy.footContactMarkers }),
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

  /** Import preflight with actionable live dependency errors; no document/history changes. */
  assertCanRestoreDraft(input: unknown): void {
    if (!this.inspectDraft(input, true))
      throw new Error(
        'Rig import requires the same hierarchy, bone artwork and default skin, with loaded image assets and valid frames. IK settings may change; referenced constraint IDs and chains must be retained. Open another character for a different hierarchy.',
      );
  }

  private inspectDraft(input: unknown, explainDependencies = false): RigEditorRecoverySnapshot | undefined {
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
      this.assertRetainedSkins(data.rig.skins ?? [], data.standaloneSkins ?? this.initialExternalSkins);
    } catch (error) {
      if (explainDependencies) throw error;
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

  markSaved(savedSnapshot: ReadonlyRigData<AuthoredRigData> = this.workingSnapshot): void {
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

  getAttachment(id: string): ReadonlyRigData<AttachmentDefinition> {
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
  get selectedMesh(): MeshAttachmentDefinition | undefined {
    const slot = this.selection?.type === 'slot' ? this.selection.id : undefined;
    const id = slot ? this.resolvedAttachment(slot) : undefined;
    const attachment = id ? this.getAttachment(id) : undefined;
    return attachment?.type === 'mesh' ? attachment : undefined;
  }

  removeBoneAndReassignMeshes(id: string, replacement: string): void {
    this.structureCommands.removeBoneAndReassignMeshes(id, replacement);
    this.meshFeedback = `Removed ${id}; reassigned its mesh weights to ${replacement} and explicitly rebound all meshes. Other vertex weights retained.`;
  }

  convertSelectedSpriteToMesh(imageSize: { width: number; height: number }): string {
    if (this.selection?.type !== 'slot') throw new Error('Select a rigid sprite attachment slot.');
    const slot = this.selection.id;
    const source = this.resolvedAttachment(slot);
    if (!source) throw new Error('Select a slot with rigid artwork.');
    const sprite = this.getAttachment(source);
    if (sprite.type === 'mesh') throw new Error('This attachment is already a mesh.');
    let id = `${source}-mesh`,
      suffix = 2;
    while (this.workingCopy.attachments?.some((entry) => entry.id === id)) id = `${source}-mesh-${suffix++}`;
    const mesh = createRectangleMeshAttachment({ ...sprite, id }, imageSize, this.workingCopy, this.getSlot(slot).bone);
    // Fork the default skin so inherited assignments and the original artwork remain untouched.
    let skinName = this.activeSkin;
    const original = this.getSkin(skinName);
    if (skinName === this.defaultSkin) {
      skinName = `${original.name}-mesh`;
      suffix = 2;
      while (this.skins.some((skin) => skin.name === skinName)) skinName = `${original.name}-mesh-${suffix++}`;
    }
    const next = freezeData({ ...original, name: skinName, slots: { ...original.slots, [slot]: id } });
    const external = this.isStandaloneSkin(skinName);
    this.installArtwork({
      attachments: [...(this.workingCopy.attachments ?? []), mesh],
      ...(external
        ? { standaloneSkins: this.standaloneSkins.map((skin) => (skin.name === skinName ? next : skin)) }
        : {
            skins:
              skinName === original.name
                ? this.workingCopy.skins!.map((skin) => (skin.name === skinName ? next : skin))
                : [...(this.workingCopy.skins ?? []), next],
          }),
    });
    this.selectedSkin = skinName;
    this.editMode = 'mesh';
    this.selectedMeshVertexId = mesh.vertices[0]!.id;
    this.selectedMeshEdge = null;
    this.meshFeedback = `Created ${id} in skin ${skinName}. Original rigid artwork remains available in Attachments & skins.`;
    return id;
  }

  private installMesh(mesh: MeshAttachmentDefinition): void {
    this.change(() => {
      this.data.attachments![this.attachmentIndices.get(mesh.id)!] = freezeData(mesh);
    });
  }

  moveMeshVertex(id: string, x: number, y: number): void {
    const mesh = this.selectedMesh;
    if (!mesh || !mesh.vertices.some((vertex) => vertex.id === id)) throw new Error('Select a mesh vertex.');
    this.installMesh(
      replaceMeshGeometry(
        mesh,
        {
          vertices: mesh.vertices.map((vertex) => (vertex.id === id ? { ...vertex, x, y } : vertex)),
          triangles: mesh.triangles,
        },
        this.workingCopy,
      ),
    );
    this.meshFeedback = '';
  }

  subdivideSelectedMeshEdge(): void {
    const mesh = this.selectedMesh,
      edge = this.selectedMeshEdge;
    if (!mesh || !edge) throw new Error('Select an edge to subdivide.');
    this.endOperation();
    const next = subdivideMeshEdge(mesh, edge[0], edge[1], this.workingCopy, this.meshSlotBoneId);
    this.installMesh(next);
    this.selectedMeshVertexId = next.vertices[next.vertices.length - 1]!.id;
    this.selectedMeshEdge = null;
    const endpointBones = new Set(
      [...(mesh.vertices[edge[0]]!.influences ?? []), ...(mesh.vertices[edge[1]]!.influences ?? [])]
        .filter((entry) => entry.weight > 0)
        .map((entry) => entry.boneId),
    );
    const kept = new Set(next.vertices.at(-1)!.influences?.map((entry) => entry.boneId));
    const dropped = [...endpointBones].filter((id) => !kept.has(id)).length;
    this.meshFeedback = `Edge subdivided. New UV and weights interpolated; ${dropped} weaker influences dropped at the four-bone limit. Existing vertices retained.`;
  }

  deleteSelectedMeshVertex(): void {
    const mesh = this.selectedMesh,
      id = this.selectedMeshVertexId;
    if (!mesh || !id) throw new Error('Select a vertex to delete.');
    this.endOperation();
    this.installMesh(deleteMeshVertex(mesh, id, this.workingCopy));
    this.selectedMeshVertexId = null;
    this.selectedMeshEdge = null;
    this.meshFeedback = 'Vertex deleted and its triangle fan triangulated.';
  }

  createAttachment(input: unknown): void {
    this.artworkCommands.createAttachment(input);
  }
  removeAttachment(id: string): void {
    this.artworkCommands.removeAttachment(id);
  }
  createSkin(name: string): void {
    this.artworkCommands.createSkin(name);
    this.selectedSkin = name;
  }
  renameSkin(name: string, next: string): void {
    this.artworkCommands.renameSkin(name, next);
    if (this.selectedSkin === name) this.selectedSkin = next;
  }
  /** Undefined removes an override (inherit); null explicitly hides the slot. */
  assignAttachment(slot: string, attachment: string | null | undefined, skin = this.activeSkin): void {
    this.artworkCommands.assignAttachment(slot, attachment, skin);
  }
  exportSkinJson(name: string, saveBaseline = true): string {
    this.endOperation();
    const json = this.artworkCommands.exportSkinJson(name);
    if (saveBaseline && this.isStandaloneSkin(name)) {
      this.savedExternalSkins.set(name, this.getSkin(name));
      this.cachedDirty = undefined;
      this.cachedRigDirty = undefined;
    }
    return json;
  }

  /** All artwork commands commit through the same snapshot/history boundary as joint and hierarchy edits. */
  private installArtwork(update: RigArtworkUpdate): void {
    this.assertRetainedSkins(
      update.skins ?? this.workingCopy.skins ?? [],
      update.standaloneSkins ?? this.externalSkins,
    );
    this.endOperation();
    this.change(() => {
      if (update.attachments !== undefined) {
        this.data.attachments = [...update.attachments];
      }
      if (update.skins !== undefined) this.data.skins = [...update.skins];
      if (update.standaloneSkins !== undefined) this.externalSkins = freezeData(update.standaloneSkins);
      if (update.attachments !== undefined) this.rebuildIndexes();
    });
  }
  private assertArtwork(attachment: AttachmentDefinition): void {
    const issue = this.artworkIssue?.(attachment.texture, attachment.frame);
    if (issue) throw new Error(issue);
  }

  private assertRetainedSkins(embedded: readonly SkinDefinition[], standalone: readonly SkinDefinition[]): void {
    const names = new Set(mergeSkins(embedded, standalone).map((skin) => skin.name));
    for (const skin of this.skins) {
      if (names.has(skin.name)) continue;
      const references = this.skinReferences?.(skin.name) ?? [];
      if (references.length)
        throw new Error(`Skin "${skin.name}" is used by ${references.join(', ')}. Remove these references first.`);
    }
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
    this.selectedFootContactMarkerId = null;
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

  /** Only the rig default target changes; animation documents are never involved. */
  beginIKTargetDrag(id: string): void {
    this.getIKConstraint(id);
    this.endOperation();
    this.selectIKConstraint(id);
    this.beginOperation();
    this.targetDragId = id;
  }

  moveIKTarget(target: { x: number; y: number }): void {
    const id = this.targetDragId;
    if (!id) return;
    const candidate = updateIKConstraint(this.workingCopy, id, { target });
    this.change(() => {
      this.data.ik = freezeData(candidate.ik!);
    });
  }

  endIKTargetDrag(commit = true): void {
    if (!this.targetDragId) return;
    this.targetDragId = undefined;
    if (commit) {
      this.syncTopologyRig();
      this.endOperation();
    } else this.cancelOperation();
  }

  removeIKConstraint(id: string): void {
    this.installStructure(
      removeIKConstraint(this.workingCopy, id, { references: (name) => this.ikReferences?.(name) ?? [] }),
    );
  }

  getFootContactMarker(id: string): Readonly<FootContactMarker> {
    const marker = this.data.footContactMarkers?.find((entry) => entry.id === id);
    if (!marker) throw new Error(`Unknown foot contact marker "${id}".`);
    return marker;
  }

  selectFootContactMarker(id: string): void {
    this.getFootContactMarker(id);
    this.clearSelection();
    this.selectedFootContactMarkerId = id;
  }

  footContactMarkerDependencies(id: string): readonly string[] {
    this.getFootContactMarker(id);
    return this.footContactReferences?.(id) ?? [];
  }

  /** Stable IDs are generated independently of display names and never change on rename. */
  suggestFootContactMarkerId(): string {
    let suffix = 1;
    let id = 'contact';
    while (this.data.footContactMarkers?.some((entry) => entry.id === id) || this.footContactReferences?.(id).length)
      id = `contact-${++suffix}`;
    return id;
  }

  createFootContactMarker(options: CreateFootContactMarkerOptions): void {
    if (
      this.footContactReferences?.(options.id).length &&
      !this.data.footContactMarkers?.some((entry) => entry.id === options.id)
    )
      throw new Error(`Foot contact marker ID "${options.id}" is reserved by external references.`);
    const candidate = createFootContactMarker(this.workingCopy, options);
    this.endOperation();
    this.installFootContactMarkers(candidate);
    this.selectFootContactMarker(options.id);
  }

  /** Group repeated local-coordinate updates with beginOperation/endOperation for one drag. */
  updateFootContactMarker(id: string, patch: Partial<Omit<FootContactMarker, 'id'>>): void {
    const marker = footContactMarkerSchema.parse({ ...this.getFootContactMarker(id), ...patch, id });
    this.getBone(marker.boneId);
    this.installFootContactMarkers({
      ...this.workingCopy,
      footContactMarkers: this.data.footContactMarkers!.map((entry) => (entry.id === id ? marker : entry)),
    });
  }

  removeFootContactMarker(id: string): void {
    this.getFootContactMarker(id);
    const candidate = {
      ...this.workingCopy,
      footContactMarkers: this.data.footContactMarkers!.filter((entry) => entry.id !== id),
    };
    this.assertRetainedReferences(candidate);
    this.endOperation();
    this.installFootContactMarkers(candidate);
    this.reconcileSelection();
  }

  private installFootContactMarkers(candidate: RigDefinition): void {
    const rig = new Rig(candidate);
    this.assertRetainedReferences(candidate);
    this.change(() => {
      this.data.footContactMarkers = freezeData(candidate.footContactMarkers!);
      this.topologyRig = rig;
    });
  }

  createBone(id: string, parent = this.selection?.type === 'bone' ? this.selection.id : this.data.root): void {
    this.structureCommands.createBone(id, parent);
  }

  boneDependencies(id: string): readonly string[] {
    return this.structureCommands.boneDependencies(id);
  }

  removeBone(id: string): void {
    this.structureCommands.removeBone(id);
  }

  renameBone(id: string, next: string): void {
    this.structureCommands.renameBone(id, next);
  }

  reparentBone(id: string, parent: string): void {
    this.structureCommands.reparentBone(id, parent);
  }

  createSlot(id: string, bone: string): void {
    this.structureCommands.createSlot(id, bone);
  }

  removeSlot(id: string): void {
    this.structureCommands.removeSlot(id);
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
    if (original && 'type' in original && original.type === 'mesh' && ('originX' in values || 'originY' in values))
      throw new Error('Mesh pivots are baked into vertex positions. Recreate the mesh to change its pivot.');
    const sprite = original ? { ...original } : undefined;
    if (!sprite) throw new Error(`No sprite for "${id}".`);
    this.change(() => {
      patchFields(sprite, values);
      if (attachment)
        this.data.attachments![this.attachmentIndices.get(id)!] = freezeData(sprite as AttachmentDefinition);
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
    this.selectedFootContactMarkerId = null;
    this.selectedIKConstraintId = null;
    this.selection = { type: 'bone', id };
  }

  selectSlot(id: string, inspectorTab?: RigSelectionInspectorTab): void {
    this.getSlot(id);
    this.selectedFootContactMarkerId = null;
    this.selectedIKConstraintId = null;
    this.selection = { type: 'slot', id };
    this.inspectorSelection = inspectorTab ? { selection: this.selection, tab: inspectorTab } : undefined;
  }

  clearSelection(): void {
    this.selectedFootContactMarkerId = null;
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
