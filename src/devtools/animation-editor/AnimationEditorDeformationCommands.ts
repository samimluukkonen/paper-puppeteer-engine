import {
  getMeshDeformationTrack,
  meshDeformationIssues,
  type MeshDeformationKey,
  type VertexOffset,
} from '../../engine/core.js';
import type { ValidationIssue, Rig } from '../../engine/data.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { editDeformationKey, setDeformationOffsets } from './deformationEdits.js';
import type { TimelineClipboard } from './TimelineClipboard.js';
import { validateEditedAnimation } from './validatedAnimation.js';

type DeformationState = Pick<
  AnimationEditorState,
  'animationAuthoringEnabled' | 'currentTimeMilliseconds' | 'currentTime' | 'rootMotion' | 'keyframes'
>;

/**
 * The public `state.deformation` domain handle. Only the facade reads the provisional preview, and the
 * deformation clipboard is reached through the shared timeline copy and paste commands.
 */
export type AnimationEditorDeformationHandle = Omit<
  AnimationEditorDeformationCommands,
  'previewAnimation' | 'copyDeformationKey' | 'pasteDeformationKey'
>;

/** Own mesh deformation selection, provisional mesh corrections and key commands; the session owns the commit ordering and history. */
export class AnimationEditorDeformationCommands {
  meshDiagnosticsEnabled = false;
  deformationEditing = false;
  deformationSelected = false;
  selectedMeshId: string | null = null;
  selectedDeformationTime: number | null = null;

  constructor(
    private readonly state: DeformationState,
    private readonly document: AnimationEditorDocument,
    private readonly clipboard: TimelineClipboard,
    private readonly session: AnimationEditActions,
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
      !this.selectedMeshId
    )
      return false;
    this.session.batch(() => {
      this.session.beginGesture();
      this.session.clearBoneSelection();
      this.state.rootMotion.rootMotionSelected = false;
      this.state.rootMotion.selectedRootKey = null;
      this.deformationSelected = true;
      this.deformationGesture = {
        base: this.document.workingAnimation!,
        preview: this.document.workingAnimation!,
        rig: this.document.rig!,
        meshId: this.selectedMeshId!,
        time: this.state.currentTimeMilliseconds,
      };
      this.session.notify();
    });
    return true;
  }
  previewMeshOffsets(changes: Readonly<Record<string, VertexOffset>>): boolean {
    const gesture = this.deformationGesture;
    if (!gesture || gesture.base !== this.document.workingAnimation || gesture.rig !== this.document.rig) return false;
    gesture.preview = setDeformationOffsets(gesture.base, gesture.rig, gesture.meshId, gesture.time, changes);
    this.session.notify();
    return true;
  }
  previewDeformationMove(key: MeshDeformationKey, time: number): boolean {
    const gesture = this.deformationGesture;
    if (!gesture || gesture.base !== this.document.workingAnimation || gesture.rig !== this.document.rig) return false;
    gesture.preview = editDeformationKey(gesture.base, gesture.rig, gesture.meshId, { ...key, time }, key.time);
    this.session.notify();
    return true;
  }
  cancelDeformationEdit(): boolean {
    if (!this.deformationGesture) return false;
    this.deformationGesture = null;
    this.session.notify();
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
      this.session.notify();
      return false;
    }
    return this.session.batch(() => {
      this.selectedDeformationTime = time;
      return this.session.commit(() => gesture.preview, { pause: false });
    });
  }

  /** Previous/next key on the selected mesh's deformation track, relative to the playhead. */
  getAdjacentDeformationKey(direction: -1 | 1): MeshDeformationKey | undefined {
    if (!this.deformationSelected || !this.document.workingAnimation || !this.selectedMeshId) return undefined;
    const keys = getMeshDeformationTrack(this.document.workingAnimation, this.selectedMeshId);
    return direction < 0
      ? [...keys].reverse().find((key) => key.time / 1000 < this.state.currentTime)
      : keys.find((key) => key.time / 1000 > this.state.currentTime);
  }

  setMeshDiagnostics(enabled: boolean): void {
    this.meshDiagnosticsEnabled = enabled;
    this.session.notify();
  }

  get selectedDeformationKey(): MeshDeformationKey | null {
    return this.deformationSelected && this.selectedMeshId !== null && this.selectedDeformationTime !== null
      ? ((this.document.workingAnimation
          ? getMeshDeformationTrack(this.document.workingAnimation, this.selectedMeshId)
          : []
        ).find((key) => key.time / 1000 === this.selectedDeformationTime) ?? null)
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
    this.session.batch(() => {
      this.cancelDeformationEdit();
      this.deformationEditing = enabled;
      if (enabled) {
        this.session.stopPlayback();
      }
      this.session.notify();
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
    return this.session.batch(() => {
      this.session.cancelActiveDrags();
      this.session.clearBoneSelection();
      this.state.rootMotion.rootMotionSelected = false;
      this.state.rootMotion.selectedRootKey = null;
      this.deformationSelected = true;
      this.selectedMeshId = meshId;
      this.selectedDeformationTime = time ?? null;
      if (time !== undefined) {
        this.session.stopPlayback();
        this.session.updateTime(time);
      }
      this.session.notify();
      return true;
    });
  }
  setMeshOffsets(changes: Readonly<Record<string, VertexOffset>> | null, time = this.state.currentTime): boolean {
    if (
      !this.state.animationAuthoringEnabled ||
      !this.document.workingAnimation ||
      !this.document.rig ||
      !this.selectedMeshId
    )
      return false;
    const id = this.selectedMeshId;
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
      !this.selectedMeshId ||
      previousTime === undefined
    )
      return false;
    return this.commitDeformationProposal(
      () =>
        editDeformationKey(
          this.document.workingAnimation!,
          this.document.rig!,
          this.selectedMeshId!,
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
      !this.selectedMeshId ||
      !this.state.animationAuthoringEnabled
    )
      return false;
    const destination =
      this.state.currentTimeMilliseconds !== key.time
        ? this.state.currentTimeMilliseconds
        : key.time + 1000 / this.state.keyframes.keyframeFPS;
    return this.commitDeformationProposal(
      () =>
        editDeformationKey(this.document.workingAnimation!, this.document.rig!, this.selectedMeshId!, {
          ...key,
          time: destination,
        }),
      destination / 1000,
    );
  }
  private commitDeformationProposal(
    create: () => ReadonlyAnimation,
    time: number | null,
    meshId = this.selectedMeshId,
  ): boolean {
    return this.session.batch(() => {
      const committed = this.session.commit(create, { pause: false });
      if (!committed) return false;
      this.session.clearBoneSelection();
      this.state.rootMotion.rootMotionSelected = false;
      this.state.rootMotion.selectedRootKey = null;
      this.selectedMeshId = meshId;
      this.deformationSelected = true;
      this.selectedDeformationTime = time;
      this.session.notify();
      return true;
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
    if (!key || !this.selectedMeshId) return false;
    this.clipboard.content = { kind: 'deformation', data: { meshId: this.selectedMeshId, key } };
    this.session.notify();
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
