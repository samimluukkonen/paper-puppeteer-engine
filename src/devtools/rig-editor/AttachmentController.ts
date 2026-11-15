import type { CreateIKConstraintOptions, IKConstraintPatch, FootContactMarker } from '../../engine/data.js';
import { downloadJson } from '../../shared/downloadJson.js';
import type { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { notifySubscribers } from '../shared/subscriberNotifications.js';
import type { RigEditor } from './RigEditor.js';
import type { RigSelectionInspectorTab } from './RigEditorState.js';

/** React adapter. Slot/attachment selection belongs exclusively to RigEditorState. */
export class AttachmentController {
  private editor: RigEditor | undefined;
  private readonly listeners = new Set<() => void>();
  private snapshot = { editor: undefined as RigEditor | undefined, revision: 0, message: '' };
  private readonly releaseArtwork: (() => void) | undefined;
  constructor(readonly artwork?: ArtworkController) {
    this.releaseArtwork = artwork?.subscribe(() => this.refresh());
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  bind(editor: RigEditor): void {
    if (this.editor !== editor) this.snapshot = { ...this.snapshot, message: '' };
    this.editor = editor;
    this.artwork?.refreshTargets();
    this.refresh();
  }
  refresh(): void {
    this.snapshot = { ...this.snapshot, editor: this.editor, revision: this.snapshot.revision + 1 };
    notifySubscribers(this.listeners, 'Attachment subscribers failed.');
  }
  private run(action: (editor: RigEditor) => void | false, message: string): void {
    const editor = this.editor;
    if (!editor) return;
    try {
      editor.cancelGesture();
      editor.state.endOperation();
      const result = action(editor);
      this.snapshot = { ...this.snapshot, message: result === false ? 'Operation cancelled.' : message };
    } catch (error) {
      this.snapshot = { ...this.snapshot, message: error instanceof Error ? error.message : String(error) };
    }
    this.refresh();
  }
  selectIK(id: string): void {
    this.run((editor) => {
      editor.state.selectIKConstraint(id);
      editor.state.visibility.ik = true;
      editor.refresh();
    }, 'Rig default target selected. Drag its crosshair in the canvas.');
  }
  selectFootContactMarker(id: string): void {
    this.run((editor) => {
      editor.state.selectFootContactMarker(id);
      editor.refresh();
    }, 'Contact selected. Drag its green crosshair in the canvas.');
  }
  createFootContactMarker(boneId: string): void {
    this.run((editor) => {
      const id = editor.state.suggestFootContactMarkerId();
      editor.state.createFootContactMarker({ id, name: `${boneId} contact`, boneId });
      editor.refresh();
    }, 'Contact marker added. Drag the crosshair to the foot contact point.');
  }
  updateFootContactMarker(id: string, patch: Partial<Omit<FootContactMarker, 'id'>>): void {
    this.run((editor) => {
      editor.state.updateFootContactMarker(id, patch);
      editor.refresh();
    }, 'Contact marker updated.');
  }
  removeFootContactMarker(id: string): void {
    this.run((editor) => {
      editor.state.removeFootContactMarker(id);
      editor.refresh();
    }, 'Contact marker deleted.');
  }
  createIK(options: CreateIKConstraintOptions): void {
    this.run((editor) => {
      editor.createIKConstraint(options);
      editor.setIKPreview(true);
    }, 'IK constraint created. Drag its default target to preview the chain.');
  }
  updateIK(id: string, patch: IKConstraintPatch): void {
    this.run((editor) => editor.updateIKConstraint(id, patch), 'Rig IK defaults updated.');
  }
  removeIK(id: string): void {
    this.run((editor) => editor.removeIKConstraint(id), 'IK constraint deleted.');
  }
  previewIK(enabled: boolean): void {
    this.run((editor) => editor.setIKPreview(enabled), 'IK preview updated.');
  }
  createBone(id: string): void {
    this.run((editor) => {
      editor.state.createBone(id.trim());
      editor.refresh();
    }, 'Bone added. Drag its joint in Joint Editing mode or edit its local transform.');
  }
  renameBone(id: string): void {
    this.run((editor) => {
      const selection = editor.state.selection;
      if (selection?.type !== 'bone') throw new Error('Select a bone first.');
      editor.state.renameBone(selection.id, id.trim());
      editor.refresh();
    }, 'Bone renamed. Child and slot references updated.');
  }
  reparentBone(parent: string): void {
    this.run((editor) => {
      const selection = editor.state.selection;
      if (selection?.type !== 'bone') throw new Error('Select a bone first.');
      const affected: string[] = [];
      const pending = [selection.id];
      while (pending.length) {
        const id = pending.pop()!;
        affected.push(...editor.state.boneDependencies(id));
        pending.push(...editor.state.childrenOf(id));
      }
      if (
        !window.confirm(
          `Change parent of "${selection.id}" to "${parent}"? Local transforms are retained; world placement changes.\nDependent authored data is retained: ${affected.join(', ') || 'none'}.`,
        )
      )
        return false;
      editor.state.reparentBone(selection.id, parent);
      editor.refresh();
    }, 'Hierarchy updated.');
  }
  removeBone(): void {
    this.run((editor) => {
      const selection = editor.state.selection;
      if (selection?.type !== 'bone') throw new Error('Select a bone first.');
      const dependencies = editor.state.boneDependencies(selection.id);
      if (dependencies.length)
        throw new Error(
          `Cannot remove "${selection.id}": ${dependencies.join(', ')}. Reparent children and remove dependent references first.`,
        );
      if (!window.confirm(`Remove bone "${selection.id}"?`)) return false;
      editor.state.removeBone(selection.id);
      editor.refresh();
    }, 'Bone removal finished.');
  }
  removeBoneAndReassignMeshes(replacement: string): void {
    this.run((editor) => {
      const selected = editor.state.selection;
      if (selected?.type !== 'bone') throw new Error('Select a bone first.');
      editor.state.removeBoneAndReassignMeshes(selected.id, replacement);
      editor.refresh();
    }, 'Bone removed. Its weights were reassigned and all mesh bind snapshots updated. Undo restores the complete change.');
  }
  createSlot(id: string): void {
    this.run((editor) => {
      const selection = editor.state.selection;
      if (!selection) throw new Error('Select the bone that should carry the artwork.');
      editor.state.createSlot(
        id.trim(),
        selection.type === 'bone' ? selection.id : editor.state.getSlot(selection.id).bone,
      );
      editor.refresh();
    }, 'Empty slot created. Create an attachment from imported artwork, then assign it in the default skin.');
  }
  removeSlot(): void {
    this.run((editor) => {
      const selection = editor.state.selection;
      if (selection?.type !== 'slot') throw new Error('Select a slot first.');
      editor.state.removeSlot(selection.id);
      editor.refresh();
    }, 'Empty slot removed.');
  }
  selectSlot(id: string, inspectorTab?: RigSelectionInspectorTab): void {
    this.run((editor) => {
      editor.state.selectSlot(id, inspectorTab);
      editor.refresh();
    }, 'Slot selected. Artwork alignment uses the same selection.');
  }
  selectSkin(name: string): void {
    this.run((editor) => editor.selectSkin(name), 'Skin preview updated.');
  }
  assign(id: string | null | undefined): void {
    this.run(
      (editor) => {
        const selection = editor.state.selection;
        if (selection?.type !== 'slot') throw new Error('Select a slot first.');
        editor.state.assignAttachment(selection.id, id);
        editor.refresh();
      },
      id === undefined
        ? 'Override removed. Default artwork restored.'
        : id === null
          ? 'Slot cleared.'
          : 'Attachment assigned.',
    );
  }
  convertToMesh(): void {
    this.run((editor) => {
      const image = editor.getSelectedImage();
      if (!image) throw new Error('Select a rigid sprite attachment slot first.');
      const scale = editor.getArtworkOriginScale();
      if (scale.x !== 1 || scale.y !== 1)
        throw new Error('Apply or revert the artwork size replacement before converting to mesh.');
      editor.state.convertSelectedSpriteToMesh({ width: image.width, height: image.height });
      editor.refresh();
    }, 'Mesh created. Open Mesh geometry to select vertices and edges. Default-skin conversion creates a new variant skin.');
  }
  meshAction(action: 'edit' | 'paint' | 'subdivide' | 'delete' | 'normalize' | 'reset'): void {
    this.run((editor) => {
      if (action === 'edit') editor.state.editMode = 'mesh';
      if (action === 'paint') {
        if (!editor.state.selectedMesh) throw new Error('Select a mesh attachment first.');
        editor.state.editMode = 'weights';
      }
      if (action === 'subdivide') editor.state.subdivideSelectedMeshEdge();
      if (action === 'delete') editor.state.deleteSelectedMeshVertex();
      if (action === 'normalize' || action === 'reset') editor.state.normalizeSelectedMeshWeights(action === 'reset');
      editor.refresh();
    }, 'Mesh geometry updated.');
  }
  weightSettings(patch: {
    boneId?: string;
    radius?: number;
    strength?: number;
    erase?: boolean;
    limit?: number;
  }): void {
    this.run((editor) => {
      const state = editor.state;
      if (patch.boneId !== undefined) state.selectWeightBone(patch.boneId);
      if (patch.limit !== undefined) state.setWeightInfluenceLimit(patch.limit);
      if (patch.radius !== undefined) {
        if (!Number.isFinite(patch.radius) || patch.radius < 1 || patch.radius > 500)
          throw new Error('Brush radius must be 1–500 pixels.');
        state.brushRadius = patch.radius;
      }
      if (patch.strength !== undefined) {
        if (!Number.isFinite(patch.strength) || patch.strength < 0 || patch.strength > 1)
          throw new Error('Strength must be between 0 and 1.');
        state.brushStrength = patch.strength;
      }
      if (patch.erase !== undefined) state.brushErase = patch.erase;
      editor.refresh(false);
    }, 'Brush settings updated.');
  }
  editWeight(value: number): boolean {
    let committed = false;
    this.run((editor) => {
      editor.state.editSelectedVertexWeight(value);
      editor.refresh();
      committed = true;
    }, 'Vertex weight updated.');
    return committed;
  }
  meshDiagnostics(enabled: boolean): void {
    if (!this.editor) return;
    this.editor.meshDiagnosticsEnabled = enabled;
    this.editor.refresh(false);
    this.refresh();
  }
  weightPreview(enabled: boolean, boneId: string, degrees: number): void {
    this.run(
      (editor) => editor.setWeightPreview(enabled, boneId, (degrees * Math.PI) / 180),
      'Deformation preview updated. No animation keys authored.',
    );
  }
  previewPose(name: string, time = 0): void {
    this.run((editor) => editor.setPreviewPose(name, time), 'Pose preview updated. No animation keys authored.');
  }
  selectMeshVertex(id: string): void {
    this.run((editor) => {
      editor.state.selectedMeshVertexId = id || null;
      editor.state.selectedMeshEdge = null;
      editor.refresh();
    }, 'Mesh vertex selected. Drag the cyan diamond or edit local X/Y.');
  }
  selectMeshEdge(value: string): void {
    this.run((editor) => {
      const edge = value ? value.split(':').map(Number) : null;
      editor.state.selectedMeshEdge = edge ? [edge[0]!, edge[1]!] : null;
      editor.state.selectedMeshVertexId = null;
      editor.refresh();
    }, 'Mesh edge selected.');
  }
  editMeshVertex(axis: 'x' | 'y', value: number): boolean {
    let committed = false;
    this.run((editor) => {
      const vertex = editor.state.selectedMesh?.vertices.find((v) => v.id === editor.state.selectedMeshVertexId);
      if (!vertex) throw new Error('Select a mesh vertex.');
      editor.state.moveMeshVertex(vertex.id, axis === 'x' ? value : vertex.x, axis === 'y' ? value : vertex.y);
      editor.refresh();
      committed = true;
    }, 'Mesh vertex updated. UV coordinates retained.');
    return committed;
  }
  createAttachment(id: string, texture: string, frame: string, numericFrame: boolean): void {
    this.run((editor) => {
      editor.state.createAttachment({
        id: id.trim(),
        texture,
        ...(frame === '' ? {} : { frame: numericFrame ? Number(frame) : frame }),
      });
      editor.refresh();
    }, 'Attachment created. Assign it to the selected slot to align its artwork.');
  }
  removeAttachment(id: string): void {
    this.run((editor) => {
      editor.state.removeAttachment(id);
      editor.refresh();
    }, 'Attachment definition removed.');
  }
  createSkin(name: string): void {
    this.run((editor) => {
      editor.state.createSkin(name.trim());
      editor.refresh();
    }, 'Empty partial skin created. Unspecified slots use the default skin.');
  }
  renameSkin(name: string): void {
    this.run((editor) => {
      editor.state.renameSkin(editor.state.activeSkin, name.trim());
      editor.refresh();
    }, 'Skin renamed.');
  }
  downloadSkin(): void {
    this.run((editor) => {
      const name = editor.state.activeSkin;
      const json = editor.state.exportSkinJson(name, false);
      downloadJson(json, `${name.replace(/[^a-zA-Z0-9._-]/g, '-')}.json`);
      editor.state.exportSkinJson(name);
      editor.refresh();
    }, 'Skin JSON downloaded. Replace its referenced skin file in the character folder.');
  }
  unbind(): void {
    this.editor = undefined;
    this.refresh();
  }
  dispose(): void {
    this.releaseArtwork?.();
    this.unbind();
    this.listeners.clear();
  }
}
