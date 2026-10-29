import type { ValidationIssue } from '../../engine/externalData.js';
import {
  getMeshDeformationTrack,
  meshDeformationIssues,
  type MeshDeformationKey,
  type VertexOffset,
} from '../../engine/meshDeformation.js';
import type { Rig } from '../../engine/Rig.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { editDeformationKey, setDeformationOffsets } from './deformationEdits.js';
import type { TimelineClipboard } from './TimelineClipboard.js';
import { validateEditedAnimation } from './validatedAnimation.js';

type DeformationState = Pick<
  AnimationEditorState,
  | 'animationAuthoringEnabled'
  | 'selectedMeshId'
  | 'currentTimeMilliseconds'
  | 'currentTime'
  | 'selectedDeformationTime'
  | 'meshDiagnosticsEnabled'
  | 'deformationEditing'
  | 'deformationSelected'
  | 'rootMotionSelected'
  | 'selectedRootKey'
  | 'keyframeFPS'
  | 'pause'
  | 'endScrub'
>;

interface DeformationActions {
  batch<Result>(command: () => Result): Result;
  install(animation: ReadonlyAnimation): boolean;
  clearBoneSelection(): void;
  notify(): void;
  cancelTimelineDrag(): boolean;
  updateTime(time: number): boolean;
}

/** Own provisional mesh corrections and key commands; the session retains selection, clock and history. */
export class AnimationEditorDeformationCommands {
  constructor(
    private readonly state: DeformationState,
    private readonly document: AnimationEditorDocument,
    private readonly clipboard: TimelineClipboard,
    private readonly actions: DeformationActions,
  ) {}
  get previewAnimation(): ReadonlyAnimation | undefined {
    return this.deformationGesture?.preview;
  }
  private deformationGesture: {
    base: ReadonlyAnimation;
    preview: ReadonlyAnimation;
    rig: Rig;
    meshId: string;
    time: number;
  } | null = null;
  get deformationEditActive(): boolean {
    return this.deformationGesture !== null;
  }
  beginDeformationEdit(): boolean {
    if (
      !this.state.animationAuthoringEnabled ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.selectedMeshId
    )
      return false;
    this.actions.batch(() => {
      this.actions.cancelTimelineDrag();
      this.state.pause();
      this.state.endScrub();
      this.actions.clearBoneSelection();
      this.state.rootMotionSelected = false;
      this.state.selectedRootKey = null;
      this.state.deformationSelected = true;
      this.deformationGesture = {
        base: this.document.workingAnimation!,
        preview: this.document.workingAnimation!,
        rig: this.document.rig!,
        meshId: this.state.selectedMeshId!,
        time: this.state.currentTimeMilliseconds,
      };
      this.actions.notify();
    });
    return true;
  }
  previewMeshOffsets(changes: Readonly<Record<string, VertexOffset>>): boolean {
    const gesture = this.deformationGesture;
    if (!gesture || gesture.base !== this.document.workingAnimation || gesture.rig !== this.document.rig) return false;
    gesture.preview = setDeformationOffsets(gesture.base, gesture.rig, gesture.meshId, gesture.time, changes);
    this.actions.notify();
    return true;
  }
  previewDeformationMove(key: MeshDeformationKey, time: number): boolean {
    const gesture = this.deformationGesture;
    if (!gesture || gesture.base !== this.document.workingAnimation || gesture.rig !== this.document.rig) return false;
    gesture.preview = editDeformationKey(gesture.base, gesture.rig, gesture.meshId, { ...key, time }, key.time);
    this.actions.notify();
    return true;
  }
  cancelDeformationEdit(): boolean {
    if (!this.deformationGesture) return false;
    this.deformationGesture = null;
    this.actions.notify();
    return true;
  }
  commitDeformationEdit(time = this.state.currentTime): boolean {
    const gesture = this.deformationGesture;
    if (!gesture) return false;
    this.deformationGesture = null;
    if (
      gesture.base !== this.document.workingAnimation ||
      gesture.rig !== this.document.rig ||
      !this.state.animationAuthoringEnabled
    ) {
      this.actions.notify();
      return false;
    }
    return this.actions.batch(() => {
      this.state.selectedDeformationTime = time;
      return this.actions.install(gesture.preview);
    });
  }

  setMeshDiagnostics(enabled: boolean): void {
    this.state.meshDiagnosticsEnabled = enabled;
    this.actions.notify();
  }

  get selectedDeformationKey(): MeshDeformationKey | null {
    return this.state.deformationSelected &&
      this.state.selectedMeshId !== null &&
      this.state.selectedDeformationTime !== null
      ? ((this.document.workingAnimation
          ? getMeshDeformationTrack(this.document.workingAnimation, this.state.selectedMeshId)
          : []
        ).find((key) => key.time / 1000 === this.state.selectedDeformationTime) ?? null)
      : null;
  }
  private topologyCache:
    | { animation: ReadonlyAnimation | null; rig: Rig | undefined; issues: readonly ValidationIssue[] }
    | undefined;
  get deformationTopologyIssues(): readonly ValidationIssue[] {
    if (
      !this.topologyCache ||
      this.topologyCache.animation !== this.document.workingAnimation ||
      this.topologyCache.rig !== this.document.rig
    )
      this.topologyCache = {
        animation: this.document.workingAnimation,
        rig: this.document.rig,
        issues: this.document.rig
          ? meshDeformationIssues(this.document.workingAnimation?.deformationTracks, this.document.rig)
          : [],
      };
    return this.topologyCache.issues;
  }
  setDeformationEditing(enabled: boolean): void {
    this.actions.batch(() => {
      this.cancelDeformationEdit();
      this.state.deformationEditing = enabled;
      if (enabled) {
        this.state.pause();
        this.state.endScrub();
      }
      this.actions.notify();
    });
  }
  selectDeformation(meshId: string, time?: number): boolean {
    if (
      !this.document.workingAnimation ||
      !this.document.rig?.attachments.some((entry) => entry.id === meshId && entry.type === 'mesh')
    )
      return false;
    if (
      time !== undefined &&
      !getMeshDeformationTrack(this.document.workingAnimation, meshId).some((key) => key.time / 1000 === time)
    )
      return false;
    return this.actions.batch(() => {
      this.actions.cancelTimelineDrag();
      this.actions.clearBoneSelection();
      this.state.rootMotionSelected = false;
      this.state.selectedRootKey = null;
      this.state.deformationSelected = true;
      this.state.selectedMeshId = meshId;
      this.state.selectedDeformationTime = time ?? null;
      if (time !== undefined) {
        this.state.pause();
        this.state.endScrub();
        this.actions.updateTime(time);
      }
      this.actions.notify();
      return true;
    });
  }
  setMeshOffsets(changes: Readonly<Record<string, VertexOffset>> | null, time = this.state.currentTime): boolean {
    if (
      !this.state.animationAuthoringEnabled ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.selectedMeshId
    )
      return false;
    const id = this.state.selectedMeshId;
    return this.commitDeformationProposal(
      () => setDeformationOffsets(this.document.workingAnimation!, this.document.rig!, id, time * 1000, changes),
      time,
    );
  }
  changeDeformationKey(key: MeshDeformationKey | null, previousTime = this.selectedDeformationKey?.time): boolean {
    if (
      !this.state.animationAuthoringEnabled ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.selectedMeshId ||
      previousTime === undefined
    )
      return false;
    return this.commitDeformationProposal(
      () =>
        editDeformationKey(
          this.document.workingAnimation!,
          this.document.rig!,
          this.state.selectedMeshId!,
          key,
          previousTime,
        ),
      key ? key.time / 1000 : null,
    );
  }
  duplicateDeformationKey(): boolean {
    const key = this.selectedDeformationKey;
    if (
      !key ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.selectedMeshId ||
      !this.state.animationAuthoringEnabled
    )
      return false;
    const destination =
      this.state.currentTimeMilliseconds !== key.time
        ? this.state.currentTimeMilliseconds
        : key.time + 1000 / this.state.keyframeFPS;
    return this.commitDeformationProposal(
      () =>
        editDeformationKey(this.document.workingAnimation!, this.document.rig!, this.state.selectedMeshId!, {
          ...key,
          time: destination,
        }),
      destination / 1000,
    );
  }
  private commitDeformationProposal(
    create: () => ReadonlyAnimation,
    time: number | null,
    meshId = this.state.selectedMeshId,
  ): boolean {
    return this.actions.batch(() => {
      try {
        const next = create();
        if (!this.actions.install(next)) return false;
        this.actions.clearBoneSelection();
        this.state.rootMotionSelected = false;
        this.state.selectedRootKey = null;
        this.state.selectedMeshId = meshId;
        this.state.deformationSelected = true;
        this.state.selectedDeformationTime = time;
        this.actions.notify();
        return true;
      } catch (error) {
        this.document.reportError(error);
        this.actions.notify();
        return false;
      }
    });
  }
  removeIncompatibleDeformationTracks(): boolean {
    if (
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.animationAuthoringEnabled ||
      !this.deformationTopologyIssues.length
    )
      return false;
    const deformationTracks = Object.fromEntries(
      Object.entries(this.document.workingAnimation.deformationTracks ?? {}).filter(
        ([id, keys]) => !meshDeformationIssues({ [id]: keys }, this.document.rig!).length,
      ),
    );
    return this.commitDeformationProposal(
      () =>
        validateEditedAnimation(
          { ...this.document.workingAnimation!, deformationTracks },
          this.document.workingAnimation!,
          this.document.rig!,
        ),
      null,
    );
  }
  copyDeformationKey(): boolean {
    const key = this.selectedDeformationKey;
    if (!key || !this.state.selectedMeshId) return false;
    this.clipboard.content = { kind: 'deformation', data: { meshId: this.state.selectedMeshId, key } };
    this.actions.notify();
    return true;
  }
  pasteDeformationKey(): boolean {
    const content = this.clipboard.content;
    if (
      content?.kind !== 'deformation' ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.state.animationAuthoringEnabled
    )
      return false;
    return this.commitDeformationProposal(
      () =>
        editDeformationKey(this.document.workingAnimation!, this.document.rig!, content.data.meshId, {
          ...content.data.key,
          time: this.state.currentTimeMilliseconds,
        }),
      this.state.currentTime,
      content.data.meshId,
    );
  }
}
