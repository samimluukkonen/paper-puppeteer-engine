import { commitIKBake, transformProperties, type JointTransform, type TransformProperty } from '../../engine/core.js';
import type {
  Point,
  AnimationClip,
  AnimationLibraryMetadata,
  Interpolation,
  PropertyKeyframe,
  AnimationPose,
  ValidationIssue,
  IKBakePlan,
  Rig,
} from '../../engine/data.js';
import {
  type BoneSymmetryIssue,
  type BoneSymmetryMapping,
  createBoneSymmetryMapping,
  validateBoneSymmetryMapping,
} from '../shared/boneSymmetry.js';
import { freezeData } from '../shared/editorData.js';
import {
  AnimationEditorDeformationCommands,
  type AnimationEditorDeformationHandle,
} from './AnimationEditorDeformationCommands.js';
import {
  AnimationEditorDocument,
  type AnimationEditorStateOptions,
  type AnimationImportOptions,
  type ReadonlyAnimation,
} from './AnimationEditorDocument.js';
import { AnimationEditorEventCommands, type AnimationEditorEventHandle } from './AnimationEditorEventCommands.js';
import { AnimationEditorGraphGestures, type AnimationEditorGraphHandle } from './AnimationEditorGraphGestures.js';
import { AnimationEditorIKCommands, type AnimationEditorIKHandle } from './AnimationEditorIKCommands.js';
import {
  AnimationEditorKeyframeCommands,
  type AnimationEditorKeyframeHandle,
} from './AnimationEditorKeyframeCommands.js';
import { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import {
  AnimationEditorPlaybackController,
  type AnimationEditorPlaybackHandle,
} from './AnimationEditorPlaybackController.js';
import { AnimationEditorPreviewCommands, type AnimationEditorPreviewHandle } from './AnimationEditorPreviewCommands.js';
import { AnimationEditorRootMotion, type AnimationEditorRootMotionHandle } from './AnimationEditorRootMotion.js';
import { AnimationEditorSelection } from './AnimationEditorSelection.js';
import { AnimationEditorSelectionCommands } from './AnimationEditorSelectionCommands.js';
import { AnimationEditSession } from './AnimationEditSession.js';
import type { AnimationEventRef } from './animationEvents.js';
import type { AnimationExportResult } from './animationSerialization.js';
import {
  getEvaluatedAnimationPose,
  getEvaluatedBonePropertyValue,
  getEvaluatedBoneTransform,
} from './animationValues.js';
import type { AnimationVariationOptions } from './animationVariation.js';
import type { NewAnimationOptions } from './createEmptyAnimation.js';
import {
  type GhostPoseSample,
  type GhostSamplingSettings,
  sampleGhostPose,
  sampleGhostPoses,
} from './ghostPoseSampling.js';
import {
  getAnimationInterpolation,
  getInterpolationForKeys,
  getSegmentInterpolation,
  type InterpolationSelectionState,
  type SegmentInterpolation,
  setAnimationInterpolation,
} from './interpolation.js';
import { setBonePropertyKeyframes } from './keyframeEdits.js';
import { findBonePropertyKeyframe, getKeyedPropertiesAtTime, hasKeyframeAtTime } from './keyframeQueries.js';
import type { KeyframeMarquee, KeyframeSelectionModifiers } from './keyframeSelection.js';
import { PoseLibrary } from './PoseLibrary.js';
import { rootKeys } from './rootMotionEdits.js';
import { animationDurationSeconds, type KeyframeSnapMode } from './timeline.js';
import { TimelineClipboard } from './TimelineClipboard.js';
import type { TimelineFilters, TimelineVisibility } from './timelineFiltering.js';
import { AnimationEditorTimelineSnapping, type TimelineSnapSettings } from './timelineSnapping.js';
import type { KeyframeSelection, TimelineTrack } from './timelineTracks.js';
import type { Milliseconds, Seconds } from './timeUnits.js';

export { PREVIEW_PLAYBACK_SPEEDS } from './AnimationEditorPlayback.js';
export { AUTHORED_FPS_MIN, AUTHORED_FPS_MAX, DEFAULT_AUTHORED_FPS } from './AnimationEditorPlaybackController.js';

export type {
  AnimationEditorStateOptions,
  AnimationImportOptions,
  ReadonlyAnimation,
} from './AnimationEditorDocument.js';

export type { EventDrag } from './AnimationEditorEventCommands.js';
export type { KeyframeDrag } from './AnimationEditorKeyframeCommands.js';
export type { AnimationExportResult } from './animationSerialization.js';

export type EditorMode = 'animation' | 'rig-tweak' | 'rig';

/** Coordinates authored edits with transient selection, drafts, gestures and preview playback. */
export class AnimationEditorState {
  private placementOffset: Readonly<Point> = Object.freeze({ x: 0, y: 0 });
  /** Session-only preview placement, independent of authored keys, history and camera navigation. */
  get previewPlacementOffset(): Readonly<Point> {
    return this.placementOffset;
  }
  setPreviewPlacementOffset(x: number, y: number): void {
    if (![x, y].every(Number.isFinite) || (x === this.placementOffset.x && y === this.placementOffset.y)) return;
    this.placementOffset = Object.freeze({ x, y });
    this.notify();
  }

  get previewElapsedTimeMilliseconds(): number {
    return this.previewAnimation === this.workingAnimation || this.previews.trajectoryCopyActive
      ? this.clock.elapsedTimeMilliseconds
      : this.previews.previewTimeMilliseconds;
  }
  private clearRootSelection(): void {
    const changed =
      this.rootMotion.rootMotionSelected ||
      this.rootMotion.selectedRootKey !== null ||
      this.deformation.deformationSelected;
    this.deformation.deformationSelected = false;
    this.deformation.selectedDeformationTime = null;
    this.rootMotion.rootMotionSelected = false;
    this.rootMotion.selectedRootKey = null;
    if (changed) this.notify();
  }

  /** A validated provisional curve uses the ordinary preview evaluator, never document/export ownership. */
  get previewAnimation(): ReadonlyAnimation | null {
    return (
      this.previewCommands.trajectoryAnimation ??
      this.previewCommands.cleanupAnimation ??
      this.deformationCommands.previewAnimation ??
      this.previewCommands.variationAnimation ??
      this.rootMotionCommands.previewAnimation ??
      this.graphCommands.previewAnimation ??
      this.working
    );
  }

  readonly poseLibrary: PoseLibrary;
  /** Capture the evaluated authored FK pose, never Puppet's post-IK/rendered transforms. */
  saveCurrentPose(name: string, boneIds?: readonly string[]): string {
    if (!this.animationAuthoringEnabled || !this.working || !this.rig)
      throw new Error('Select an animation before saving a pose.');
    if (this.hasPendingAnimationEdits) throw new Error('Commit or cancel temporary edits before saving a pose.');
    const sampled = getEvaluatedAnimationPose(this.working, this.rig, this.currentTimeMilliseconds);
    const ids = [...new Set(boneIds ?? this.rig.bones.map((bone) => bone.id))];
    if (!ids.length) throw new Error('Select at least one bone.');
    const bones = Object.fromEntries(
      ids.map((id) => {
        const transform = sampled.get(id);
        if (!transform) throw new Error(`Unknown bone "${id}".`);
        return [id, { ...transform }];
      }),
    );
    return this.poseLibrary.add({ version: 1, name, bones }, this.rig);
  }

  /** One validated keyframe batch and one document history entry, using editor milliseconds. */
  applyLibraryPose(id: string): boolean {
    return this.session.run(false, () => {
      if (!this.working || !this.rig || this.hasPendingAnimationEdits || this.poseLibrary.compatibility(id, this.rig))
        return false;
      const pose = this.poseLibrary.get(id).pose;
      const edits = Object.entries(pose.bones).flatMap(([boneId, values]) =>
        transformProperties.flatMap((property) =>
          values[property] === undefined
            ? []
            : [{ boneId, property, value: values[property], timeMs: this.currentTimeMilliseconds }],
        ),
      );
      if (!edits.length) return false;
      // Computed before commit so an invalid pose still throws to the caller instead of being reported.
      const next = setBonePropertyKeyframes(this.working, this.rig, edits, { preserveTiming: true });
      // Pose apply pauses without ending a scrub, then drops the pose preview before the install.
      return this.session.commit(() => next, {
        pause: false,
        after: () => {
          this.playback.pause();
          this.previewCommands.clearPose();
        },
      });
    });
  }
  /** Loaded character rig, retained independently of restored drafts and preview tweaks. */
  readonly sourceRig: Rig | undefined;
  private readonly document: AnimationEditorDocument;
  /** The deep edit-transaction module: owns the commit ordering, history install and notification boundary. */
  private readonly session: AnimationEditSession;
  setReplacementGuard(guard: ((name: string) => boolean) | undefined): void {
    this.document.replacementGuard = guard;
  }
  private readonly clipboard = new TimelineClipboard();
  private readonly clock = new AnimationEditorPlayback(
    () => this.working?.duration ?? 0,
    () => this.working?.events ?? [],
  );
  private readonly rootMotionCommands: AnimationEditorRootMotion;
  /** Root selection, world-displacement view preferences, root keys and the provisional XY drag. */
  readonly rootMotion: AnimationEditorRootMotionHandle;
  private readonly graphCommands: AnimationEditorGraphGestures;
  /** Detached graph-editor curve gestures and one-shot graph key edits. */
  readonly graph: AnimationEditorGraphHandle;
  private readonly previewCommands: AnimationEditorPreviewCommands;
  /** Detached trajectory, cleanup, variation and pose-library previews outside document history. */
  readonly previews: AnimationEditorPreviewHandle;
  private readonly deformationCommands: AnimationEditorDeformationCommands;
  /** Mesh deformation selection, provisional mesh edits and deformation key commands. */
  readonly deformation: AnimationEditorDeformationHandle;
  private readonly selection: AnimationEditorSelection;
  private readonly selectionCommands: AnimationEditorSelectionCommands;
  private readonly snapping: AnimationEditorTimelineSnapping;
  private readonly keyframeCommands: AnimationEditorKeyframeCommands;
  /** Bone keyframe edits, clipboard, drag, mirroring and retiming. */
  readonly keyframes: AnimationEditorKeyframeHandle;
  /** IK selection, drafts, target drags and IK key edits. */
  readonly ik: AnimationEditorIKHandle;
  private readonly eventCommands: AnimationEditorEventCommands;
  /** Animation event edits, event clipboard, event drag and event selection. */
  readonly events: AnimationEditorEventHandle;
  private readonly playbackController: AnimationEditorPlaybackController;
  /** Preview playback, scrubbing, preview preferences, animation events and authored playback metadata. */
  readonly playback: AnimationEditorPlaybackHandle;
  private importedSessions = 0;
  private animationSessions = 0;
  private symmetry: BoneSymmetryMapping | null;
  private symmetryIssues: readonly BoneSymmetryIssue[] = Object.freeze([]);
  private mode: EditorMode = 'animation';
  private readonly clipContexts = new Map<string, { time: Seconds; keys: readonly KeyframeSelection[] }>();

  constructor(rig?: Rig, animations: readonly AnimationClip[] = [], options: AnimationEditorStateOptions = {}) {
    this.sourceRig = rig;
    this.poseLibrary = new PoseLibrary(
      options.characterId ?? 'standalone',
      rig,
      options.poses ?? [],
      () => {
        this.previewCommands.clearPose();
        this.notify();
      },
      () => this.rig,
    );
    this.symmetry = rig ? createBoneSymmetryMapping(rig).mapping : null;
    this.document = new AnimationEditorDocument(rig, animations, options);
    this.session = new AnimationEditSession({
      document: this.document,
      authoringEnabled: () => this.animationAuthoringEnabled,
      working: () => this.working,
      rig: () => this.rig,
      currentTime: () => this.clock.currentTime,
      cancelActiveDrags: () => this.cancelTimelineDrag(),
      pausePlayback: () => this.playback.pause(),
      endScrub: () => this.playback.endScrub(),
      updateTime: (time) => this.updateTime(time),
      updateTimeMilliseconds: (time) => this.updateTimeMilliseconds(time),
      clearTransformDraft: () => this.clearTransformDraft(),
      setSelectedKeys: (keys, primary) => this.selection.setKeys(keys, primary),
      reconcileSelection: () => this.selectionCommands.reconcile(),
      reconcileRootKey: () => {
        if (
          this.rootMotion.selectedRootKey &&
          !rootKeys(this.working!, this.rootMotion.selectedRootKey.property).some(
            (key) => key.time / 1000 === this.rootMotion.selectedRootKey!.time,
          )
        )
          this.rootMotion.selectedRootKey = null;
      },
      clearRootSelection: () => this.clearRootSelection(),
      selectKeyframe: (key, modifiers) => this.selectionCommands.selectKeyframe(key, modifiers),
      selectEvent: (ref) => this.selectionCommands.selectAnimationEvent(ref),
      clearBoneSelection: () => this.selection.selectBone(null),
      clearOtherSelection: () => {
        this.selection.selectBone(null);
        this.deformation.deformationSelected = false;
        this.deformation.selectedDeformationTime = null;
      },
      selectCommittedKey: (channel, time) => {
        if (channel.kind === 'root')
          this.rootMotion.selectedRootKey = Object.freeze({ property: channel.property, time });
        if (channel.kind === 'ik')
          this.selection.setIKKey({ kind: 'ik', constraintId: channel.id, property: channel.property, time });
      },
      reconcilePreviews: () => this.previewCommands.reconcile(),
    });
    this.rootMotion = this.rootMotionCommands = new AnimationEditorRootMotion(this, this.session);
    this.graph = this.graphCommands = new AnimationEditorGraphGestures(this, this.session);
    this.previews = this.previewCommands = new AnimationEditorPreviewCommands(this, this.document, this.session);
    this.selection = new AnimationEditorSelection(rig);
    this.deformation = this.deformationCommands = new AnimationEditorDeformationCommands(
      this,
      this.document,
      this.clipboard,
      this.session,
    );
    this.snapping = new AnimationEditorTimelineSnapping(
      () => this.workingAnimation,
      () => this.notify(),
    );
    this.selectionCommands = new AnimationEditorSelectionCommands(
      this.document,
      this.selection,
      this.clock,
      this.session,
    );
    this.keyframes = this.keyframeCommands = new AnimationEditorKeyframeCommands(
      this.document,
      this.selection,
      this.clock,
      this.session,
      this.clipboard,
      this.snapping,
      { symmetry: () => this.symmetry, cancelEventDrag: () => this.events.cancelEventDrag() },
    );
    this.events = this.eventCommands = new AnimationEditorEventCommands(
      this.document,
      this.selection,
      this.clock,
      this.session,
      this.clipboard,
      this.snapping,
    );
    this.playback = this.playbackController = new AnimationEditorPlaybackController(
      this.document,
      this.selection,
      this.clock,
      this.session,
      {
        navigate: (time) => this.setCurrentTime(time),
        authoringEnabled: () => this.animationAuthoringEnabled,
        cancelCleanupPreview: () => this.previews.cancelCleanupPreview(),
        isDragging: () =>
          !!(
            this.keyframes.keyframeDrag ||
            this.events.eventDrag ||
            this.ik.ikTargetDrag ||
            this.graph.graphEditActive ||
            this.rootMotion.rootMotionDragActive ||
            this.deformation.deformationEditActive
          ),
      },
    );
    this.ik = new AnimationEditorIKCommands(
      this.document,
      this.selection,
      this.clock,
      this.snapping,
      this.session,
      () =>
        this.graph.graphEditActive || this.previewCommands.hasIKPreview
          ? { animation: this.previewAnimation!, timeMs: this.previews.previewTimeMilliseconds }
          : null,
    );
  }

  private get working(): ReadonlyAnimation | null {
    return this.document.workingAnimation;
  }

  get rig(): Rig | undefined {
    return this.document.rig;
  }
  get editorMode(): EditorMode {
    return this.mode;
  }
  get animationAuthoringEnabled(): boolean {
    return this.mode === 'animation';
  }

  setEditorMode(mode: EditorMode): void {
    if (mode === this.mode) return;
    this.batchNotifications(() => {
      const heldTime = this.currentTimeMilliseconds;
      this.cancelTimelineDrag();
      this.cancelTransformEdit();
      this.ik.cancelIKEdit();
      this.playback.pause();
      this.playback.endScrub();
      this.mode = mode;
      this.updateTimeMilliseconds(heldTime);
      this.notify();
    });
  }

  /** Same-topology rig edits invalidate sampling, without installing animation snapshots. */
  updatePreviewRig(rig: Rig): void {
    if (rig === this.rig) return;
    this.rootMotion.cancelRootMotionDrag();
    this.graph.cancelGraphEdit();
    this.document.rig = rig;
    this.selection.updateRig(rig);
    this.symmetry = createBoneSymmetryMapping(rig, { manualPairs: this.symmetry?.pairs ?? [] }).mapping;
    this.notify();
  }

  /** Rig-session preferences survive animation changes and stay outside authored data and history. */
  get symmetryMapping(): BoneSymmetryMapping | null {
    return this.symmetry;
  }
  get symmetryValidationIssues(): readonly BoneSymmetryIssue[] {
    return this.symmetryIssues;
  }
  getMirroredBoneId(boneId: string): string | null {
    return this.symmetry?.getMirroredBoneId(boneId) ?? null;
  }
  setSymmetryMapping(mapping: BoneSymmetryMapping): boolean {
    const issues = this.rig
      ? validateBoneSymmetryMapping(this.rig, mapping)
      : freezeData<BoneSymmetryIssue[]>([
          {
            code: 'rig-mismatch',
            severity: 'error',
            message: 'Load a rig before assigning symmetry pairs.',
            boneIds: [],
          },
        ]);
    this.symmetryIssues = issues;
    if (!this.rig || issues.some((entry) => entry.severity === 'error')) {
      this.notify();
      return false;
    }
    // Rebuild from pairs so the session owns its snapshot and its authoritative reciprocal lookup.
    const result = createBoneSymmetryMapping(this.rig, { manualPairs: mapping.pairs });
    this.symmetryIssues = result.issues;
    if (result.success) this.symmetry = result.mapping;
    this.notify();
    return result.success;
  }

  get animationIds(): readonly string[] {
    return this.document.animationIds;
  }
  /** Typed authoring target; IK constraints never share a bone identity. */
  get selectedTarget() {
    return this.selection.target;
  }
  get selectedBoneId(): string | null {
    return this.selection.boneId;
  }
  get selectedTimelineProperty(): TransformProperty | null {
    return this.selection.property;
  }
  get selectedKeyframe(): KeyframeSelection | null {
    return this.selection.key;
  }
  get selectedEvent(): AnimationEventRef | null {
    return this.selection.event;
  }
  clearTimelineSelection(): void {
    return this.batchNotifications(() => {
      if (this.rootMotion.selectedRootKey) {
        this.rootMotion.selectedRootKey = null;
        this.notify();
      }
      if (this.selection.clearIKKey()) this.notify();
      this.selectionCommands.clearTimelineSelection();
    });
  }
  get timelineClipboard() {
    return this.clipboard.content;
  }
  copyTimelineSelection(): boolean {
    if (this.deformation.deformationSelected) return this.deformationCommands.copyDeformationKey();
    if (this.rootMotion.rootMotionSelected) return false;
    if (this.ik.selectedIKConstraintId) return false;
    return this.selectedEvent ? this.events.copySelectedEvent() : this.keyframes.copySelectedKeyframes();
  }
  pasteTimelineClipboard(): boolean {
    if (this.clipboard.content?.kind === 'deformation') return this.deformationCommands.pasteDeformationKey();
    if (this.rootMotion.rootMotionSelected) return false;
    if (this.ik.selectedIKConstraintId) return false;
    return this.clipboard.content?.kind === 'event' ? this.events.pasteEvent() : this.keyframes.pasteKeyframes();
  }
  duplicateTimelineSelection(): boolean {
    if (this.deformation.deformationSelected) return this.deformation.duplicateDeformationKey();
    if (this.rootMotion.rootMotionSelected) return this.rootMotion.duplicateRootKey();
    if (this.ik.selectedIKConstraintId) return false;
    return this.selectedEvent ? this.events.duplicateSelectedEvent() : this.keyframes.duplicateSelectedKeyframes();
  }
  private cancelTimelineDrag(): boolean {
    const deformation = this.deformation.cancelDeformationEdit();
    const root = this.rootMotion.cancelRootMotionDrag();
    const cleanup = this.previews.cancelCleanupPreview();
    const variation = this.previews.cancelVariationPreview();
    const graph = this.graph.cancelGraphEdit();
    const ik = this.ik?.cancelIKTargetDrag() ?? false;
    const event = this.events.cancelEventDrag();
    return this.keyframes.cancelKeyframeDrag() || event || ik || graph || variation || cleanup || root || deformation;
  }
  get selectedKeys(): readonly KeyframeSelection[] {
    return this.selection.keys;
  }
  get primaryKey(): KeyframeSelection | null {
    return this.selection.key;
  }
  get timelineSnapSettings(): TimelineSnapSettings {
    return this.snapping.settings;
  }
  get timelineSnapGuide() {
    return this.keyframes.keyframeDrag?.snapGuide ?? this.events.eventDrag?.snapGuide ?? null;
  }
  setTimelineSnapSettings(patch: Partial<TimelineSnapSettings>): void {
    this.batchNotifications(() => {
      const previous = this.snapping.settings;
      this.snapping.setSettings(patch);
      if (previous === this.snapping.settings) return;
      const key = this.keyframes.keyframeDrag;
      const event = this.events.eventDrag;
      if (key) this.keyframes.previewKeyframeDrag(key.proposedTime, key.disableSnapping);
      if (event) this.events.previewEventDrag(event.proposedTime, event.disableSnapping);
    });
  }
  /** Measured content width already includes timeline zoom; this never changes authored state. */
  setTimelineSnapContentWidth(width: number): void {
    this.snapping.setContentWidth(width);
  }
  setKeyframeSnapMode(mode: KeyframeSnapMode): void {
    if (mode !== 'none' && mode !== 'frame') return;
    this.setTimelineSnapSettings({
      enabled: mode === 'frame',
      frames: true,
      keyframes: false,
      events: false,
      playhead: false,
    });
  }
  nudgeSelectedKeyframe(direction: -1 | 1, large = false): boolean {
    if (this.deformation.deformationSelected) {
      const key = this.deformation.selectedDeformationKey;
      return (
        !!key &&
        this.deformation.changeDeformationKey({
          ...key,
          time: key.time + (direction * (large ? 10 : 1) * 1000) / this.keyframes.keyframeFPS,
        })
      );
    }
    if (this.rootMotion.rootMotionSelected && this.rootMotion.selectedRootKey) {
      const key = this.rootMotion.selectedRootKey;
      try {
        return this.graph.editGraphKey(
          { channel: { kind: 'root', id: 'Root Motion', property: key.property }, time: key.time },
          { time: key.time + (direction * (large ? 10 : 1)) / this.keyframes.keyframeFPS },
        );
      } catch (error) {
        this.document.reportError(error);
        this.notify();
        return false;
      }
    }
    return this.keyframes.nudgeSelectedKeyframe(direction, large);
  }
  /** Resolve identity through the central tolerance policy, then select and seek in one notification. */
  selectKeyframe(selection: KeyframeSelection, modifiers: KeyframeSelectionModifiers = {}): boolean {
    return this.session.selectKeyframe(selection, modifiers);
  }
  clearKeyframeSelection(): void {
    return this.batchNotifications(() => {
      if (this.deformation.selectedDeformationTime !== null) {
        this.deformation.selectedDeformationTime = null;
        this.notify();
      }
      if (this.rootMotion.selectedRootKey) {
        this.rootMotion.selectedRootKey = null;
        this.notify();
      }
      if (this.selection.clearIKKey()) this.notify();
      this.selectionCommands.clearKeyframeSelection();
    });
  }
  /** Resolve externally supplied references before installing transient box selection. */
  selectKeyframes(keys: readonly KeyframeSelection[], additive = false): void {
    return this.batchNotifications(() => {
      this.clearRootSelection();
      return this.selectionCommands.selectKeyframes(keys, additive);
    });
  }
  selectKeyframeMarquee(box: KeyframeMarquee, additive = false): void {
    return this.batchNotifications(() => {
      this.clearRootSelection();
      return this.selectionCommands.selectKeyframeMarquee(box, additive);
    });
  }
  /** The toolbar and keyboard share the same typed selection dispatch. */
  deleteTimelineSelection(): boolean {
    if (this.deformation.deformationSelected) return this.deformation.changeDeformationKey(null);
    if (this.rootMotion.rootMotionSelected) return this.animationAuthoringEnabled && this.rootMotion.deleteRootKey();
    if (!this.animationAuthoringEnabled) return false;
    if (this.selectedEvent) return this.events.deleteSelectedEvent();
    if (this.ik.selectedIKKeyframe) return this.ik.deleteSelectedIKKeyframe();
    return this.deleteSelectedKeyframes();
  }

  deleteSelectedKeyframes(): boolean {
    return this.session.run(false, () =>
      this.ik.selectedIKKeyframe ? this.ik.deleteSelectedIKKeyframe() : this.keyframes.deleteSelectedKeyframes(),
    );
  }
  /** Compatibility alias: deletion operates on the whole selection. */
  deleteSelectedKeyframe(): boolean {
    if (!this.animationAuthoringEnabled) return false;
    return this.deleteSelectedKeyframes();
  }
  /** Previous/next authored key on the selected property, relative to the current playhead. */
  getAdjacentKeyframe(direction: -1 | 1): KeyframeSelection | undefined {
    return this.selectionCommands.getAdjacentKeyframe(direction);
  }
  selectAdjacentKeyframe(direction: -1 | 1): boolean {
    if (this.deformation.deformationSelected && this.deformation.selectedMeshId) {
      const key = this.deformation.getAdjacentDeformationKey(direction);
      return !!key && this.deformation.selectDeformation(this.deformation.selectedMeshId, key.time / 1000);
    }
    return this.batchNotifications(() => this.selectionCommands.selectAdjacentKeyframe(direction));
  }
  /** Cached immutable editor rows: playback and selection never rebuild layout or authored-key queries. */
  get timelineTracks(): readonly TimelineTrack[] {
    return this.selection.tracks(this.working);
  }
  get timelineFilters(): TimelineFilters {
    return this.selection.timelineFilters;
  }
  get timelineVisibility(): TimelineVisibility {
    return this.selection.visibility(this.working);
  }
  setTimelineFilters(patch: Partial<TimelineFilters>): void {
    this.batchNotifications(() => {
      this.cancelTimelineDrag();
      this.events.cancelEventDrag();
      if (this.selection.setTimelineFilters(patch)) this.notify();
    });
  }
  expandTimeline(mode: 'all' | 'none' | 'selected'): void {
    this.batchNotifications(() => {
      this.cancelTimelineDrag();
      this.events.cancelEventDrag();
      this.selection.expandTimeline(mode);
      this.notify();
    });
  }
  revealTimelineSelection(): void {
    this.batchNotifications(() => {
      this.cancelTimelineDrag();
      this.events.cancelEventDrag();
      this.selection.revealTimelineSelection();
      this.notify();
    });
  }
  isTimelineBoneExpanded(boneId: string): boolean {
    return this.selection.isExpanded(boneId);
  }
  setTimelineBoneExpanded(boneId: string, expanded: boolean): boolean {
    return this.batchNotifications(() => this.selectionCommands.setTimelineBoneExpanded(boneId, expanded));
  }
  /** Atomic bone + property selection uses the same bone owner as hierarchy and preview picking. */
  selectTimelineProperty(boneId: string, property: TransformProperty): boolean {
    return this.batchNotifications(() => {
      this.clearRootSelection();
      return this.selectionCommands.selectTimelineProperty(boneId, property);
    });
  }
  /** Editor-only prospective local values, never serialized or recorded in history. */
  get boneTransformDraft(): Readonly<Partial<JointTransform>> {
    return this.selection.draft;
  }
  get hasTemporaryTransform(): boolean {
    return this.selection.hasDraft;
  }
  get selectedBoneTransform(): JointTransform | undefined {
    const evaluated = this.selection.boneId ? this.getEvaluatedBoneTransform(this.selection.boneId) : undefined;
    return evaluated ? { ...evaluated, ...this.selection.draft } : undefined;
  }
  selectBone(id: string | null): boolean {
    return this.batchNotifications(() => {
      this.clearRootSelection();
      return this.selectionCommands.selectBone(id);
    });
  }
  /** Focusing an authoring field pauses at the held time, even before the first input. */
  beginTransformEdit(): void {
    return this.session.run(undefined, () => {
      this.cancelTimelineDrag();
      if (this.selection.boneId && this.working) this.playback.pause();
    });
  }
  setTemporaryBoneProperty(property: TransformProperty, value: number): boolean {
    return this.session.run(false, () => {
      if (!this.selection.boneId || !this.working || !transformProperties.includes(property) || !Number.isFinite(value))
        return false;
      this.cancelTimelineDrag();
      this.clock.pause();
      this.selection.setDraft(property, value);
      this.notify();
      return true;
    });
  }
  commitBoneProperty(property: TransformProperty): boolean {
    return this.session.run(false, () => {
      if (!this.selection.boneId || !transformProperties.includes(property)) return false;
      this.beginTransformEdit();
      const value = this.selectedBoneTransform?.[property];
      return value !== undefined && this.keyframes.setBonePropertyKeyframe(this.selection.boneId, property, value);
    });
  }
  deleteBonePropertyKey(property: TransformProperty): boolean {
    return this.session.run(false, () => {
      if (!this.selection.boneId || !transformProperties.includes(property)) return false;
      this.beginTransformEdit();
      return this.keyframes.removeBonePropertyKeyframe(this.selection.boneId, property);
    });
  }
  cancelTransformEdit(): void {
    if (!this.hasTemporaryTransform) return;
    this.clearTransformDraft();
    this.notify();
  }
  private clearTransformDraft(): boolean {
    return this.selection.clearDraft();
  }
  get selectedAnimationId(): string | null {
    return this.document.selectedAnimationId;
  }
  get selectedAnimationFilename(): string | undefined {
    return this.document.selectedAnimationFilename;
  }
  get sourceAnimation(): ReadonlyAnimation | null {
    return this.document.sourceAnimation;
  }
  get workingAnimation(): ReadonlyAnimation | null {
    return this.working;
  }
  get currentTimeMilliseconds(): Milliseconds {
    return this.clock.currentTimeMilliseconds;
  }
  get currentTime(): Seconds {
    return this.clock.currentTime;
  }
  get duration(): Seconds {
    return animationDurationSeconds(this.working);
  }
  get loop(): boolean {
    return this.working?.loop ?? false;
  }
  get hasPendingAnimationEdits(): boolean {
    return (
      this.hasTemporaryTransform ||
      Object.keys(this.ik.ikTargetDraft).length > 0 ||
      !!this.keyframes.keyframeDrag ||
      !!this.events.eventDrag ||
      !!this.ik.ikTargetDrag ||
      this.graph.graphEditActive ||
      this.rootMotion.rootMotionDragActive ||
      this.deformation.deformationEditActive
    );
  }

  get hasUnsavedChanges(): boolean {
    return this.document.hasUnsavedChanges;
  }

  isNewAnimation(id: string | null = this.selectedAnimationId): boolean {
    return this.document.isNewAnimation(id);
  }

  get dirty(): boolean {
    return this.document.dirty;
  }
  get validationIssues(): readonly ValidationIssue[] {
    return this.document.validationIssues;
  }
  get canUndo(): boolean {
    return this.document.canUndo;
  }
  get canRedo(): boolean {
    return this.document.canRedo;
  }
  get historyLength(): number {
    return this.document.historyLength;
  }
  subscribe(listener: () => void): () => void {
    return this.session.subscribe(listener);
  }

  /** Nested commands publish the complete document, selection and clock together. */
  private batchNotifications<Result>(command: () => Result): Result {
    return this.session.batch(command);
  }

  private notify(): void {
    this.session.notify();
  }

  /** Failed selections preserve the working copy; callers may explicitly discard authored changes. */
  selectAnimation(id: string | null, options: { discardChanges?: boolean; keepChanges?: boolean } = {}): boolean {
    return this.session.run(false, () => {
      if (options.keepChanges && this.selectedAnimationId) {
        this.clipContexts.set(this.selectedAnimationId, { time: this.currentTime, keys: this.selectedKeys });
      }
      const selected = this.document.selectAnimation(id, options);
      if (selected) {
        this.resetAnimationSession();
        const context = options.keepChanges && id ? this.clipContexts.get(id) : undefined;
        if (context) {
          this.selectionCommands.selectKeyframes(context.keys);
          this.updateTime(context.time);
        }
      }
      this.notify();
      return selected;
    });
  }

  setCurrentTime(time: Seconds): void {
    return this.batchNotifications(() => {
      this.cancelTimelineDrag();
      // Explicit navigation cancels drafts even when clamping leaves the playhead at the same endpoint.
      const cancelled = this.clearTransformDraft();
      if (this.updateTime(time) || cancelled) this.notify();
    });
  }

  /** Clamp navigation and authored edits using the same loop and scrub playback intent. */
  private updateTime(time: Seconds): boolean {
    return this.playbackController.setCurrentTime(time);
  }

  private updateTimeMilliseconds(time: Milliseconds): boolean {
    return this.playbackController.setCurrentTimeMilliseconds(time);
  }

  get authoredInterpolation(): Interpolation | undefined {
    return getAnimationInterpolation(this.working);
  }

  get selectedInterpolation(): InterpolationSelectionState {
    return getInterpolationForKeys(this.working, this.selectedKeys);
  }

  getSegmentInterpolation(key: KeyframeSelection): SegmentInterpolation | undefined {
    return getSegmentInterpolation(this.working, key);
  }

  /** Clip-level declaration only; undefined restores the implicit linear default. */
  setAuthoredInterpolation(mode: Interpolation | undefined): boolean {
    return this.session.run(false, () => {
      if (!this.working || !this.rig) return false;
      let next: ReadonlyAnimation;
      try {
        next = setAnimationInterpolation(this.working, this.rig, mode);
      } catch {
        // Invalid declarations fail silently, without a reported issue.
        return false;
      }
      // An unchanged declaration succeeds without clearing the draft, seeking or notifying.
      if (next === this.working) return true;
      return this.session.commit(() => next, { pause: false });
    });
  }

  /** Queries never install animation snapshots or change validation, history, or dirty state.
   * Returned keyframe times are milliseconds, matching the external authored format.
   */
  findBonePropertyKeyframe(
    boneId: string,
    property: TransformProperty,
    timeSeconds = this.currentTime,
  ): PropertyKeyframe | undefined {
    return this.working
      ? findBonePropertyKeyframe(this.working, boneId, property, this.clock.resolveTimeMilliseconds(timeSeconds))
      : undefined;
  }

  hasKeyframeAtTime(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.working
      ? hasKeyframeAtTime(this.working, boneId, property, this.clock.resolveTimeMilliseconds(timeSeconds))
      : false;
  }

  getKeyedPropertiesAtTime(boneId: string, timeSeconds = this.currentTime): TransformProperty[] {
    return this.working
      ? getKeyedPropertiesAtTime(this.working, boneId, this.clock.resolveTimeMilliseconds(timeSeconds))
      : [];
  }

  getEvaluatedBonePropertyValue(
    boneId: string,
    property: TransformProperty,
    timeSeconds = this.currentTime,
  ): number | undefined {
    return this.previewAnimation && this.rig
      ? getEvaluatedBonePropertyValue(
          this.previewAnimation,
          this.rig,
          boneId,
          property,
          timeSeconds === this.currentTime
            ? this.previews.previewTimeMilliseconds
            : this.clock.resolveTimeMilliseconds(timeSeconds),
        )
      : undefined;
  }

  getEvaluatedBoneTransform(boneId: string, timeSeconds = this.currentTime): JointTransform | undefined {
    return this.previewAnimation && this.rig
      ? getEvaluatedBoneTransform(
          this.previewAnimation,
          this.rig,
          boneId,
          timeSeconds === this.currentTime
            ? this.previews.previewTimeMilliseconds
            : this.clock.resolveTimeMilliseconds(timeSeconds),
        )
      : undefined;
  }

  /** Read-only complete authored pose at arbitrary continuous seconds, before drafts/presets/IK. */
  sampleGhostPose(timeSeconds: Seconds): AnimationPose | undefined {
    return sampleGhostPose(this.working, this.rig, timeSeconds);
  }

  /** Up to three spaced authored poses per direction; never moves or notifies the editor clock. */
  sampleGhostPoses(settings: GhostSamplingSettings = {}): GhostPoseSample[] {
    return sampleGhostPoses(this.working, this.rig, this.currentTime, settings);
  }

  /** Authored edit boundary: validate atomically, own a fresh JSON copy, and record one history entry. */
  replaceWorkingAnimation(input: unknown): boolean {
    return this.session.run(false, () => {
      if (!this.working) return false;
      const next = this.document.inspect(input);
      if (!next) {
        this.notify();
        return false;
      }
      return this.session.commit(() => next, { pause: false });
    });
  }

  /** Commit a validated full-clip IK proposal as one authored history operation. */
  commitIKBake(plan: IKBakePlan): boolean {
    return this.session.run(false, () => {
      if (!this.working || !this.rig) return false;
      const result = commitIKBake(this.working, plan, this.rig);
      if (!result.success) {
        this.document.reportIssues(result.issues);
        this.notify();
        return false;
      }
      const next = this.document.inspect({ ...result.animation, version: this.working.version });
      if (!next) {
        this.notify();
        return false;
      }
      const installed = this.session.commit(() => next, { pause: false });
      // Install clears the document issues, so the bake warnings are reported again afterwards.
      if (installed) this.document.reportIssues(result.issues);
      return installed;
    });
  }

  /** Advances only for successful imports/reloads, so adapters can distinguish them from selection. */
  get importRevision(): number {
    return this.importedSessions;
  }

  /** Every successful selection, import, reload or revert invalidates pending session actions. */
  get sessionRevision(): number {
    return this.animationSessions;
  }

  private resetAnimationSession(clearBone = false): void {
    this.deformation.cancelDeformationEdit();
    this.deformation.deformationEditing = false;
    this.rootMotion.cancelRootMotionDrag();
    this.clearRootSelection();
    this.rootMotion.rootMotionEditing = false;
    this.previewCommands.reset();
    this.graph.cancelGraphEdit();
    this.ik.cancelIKTargetDrag();
    ++this.animationSessions;
    this.keyframeCommands.resetSession();
    this.eventCommands.resetSession();
    this.selection.resetAnimation();
    if (clearBone) this.selection.selectBone(null);
    this.clock.reset();
  }

  /** Revert uses the current session's source, never a network reload or the last exported copy. */
  revertAnimation(options: { discardChanges?: boolean } = {}): boolean {
    return this.session.run(false, () => {
      const reverted = this.document.revertAnimation(options);
      if (reverted) this.resetAnimationSession(true);
      this.notify();
      return reverted;
    });
  }

  /** Lightweight artist labels use the ordinary authored history and persistence boundary. */
  setLibraryMetadata(library: AnimationLibraryMetadata): boolean {
    return this.session.run(false, () => {
      if (this.hasPendingAnimationEdits || !this.working) return false;
      const next = this.document.inspect({ ...this.working, library });
      if (!next) {
        this.notify();
        return false;
      }
      return this.session.commit(() => next, { pause: false });
    });
  }

  /** A new document is a navigation boundary, never an edit to the previously selected clip. */
  createAnimation(options: NewAnimationOptions): boolean {
    return this.createAnimationSession(() => this.document.createAnimation(options));
  }

  createDerivedAnimation(input: AnimationClip): boolean {
    if (this.hasPendingAnimationEdits) return false;
    return this.createAnimationSession(() => this.document.createDerivedAnimation(input));
  }

  createVariation(options: AnimationVariationOptions): boolean {
    if (this.hasPendingAnimationEdits) {
      this.document.reportError(new Error('Commit or cancel temporary edits before creating a variation.'));
      this.notify();
      return false;
    }
    return this.createAnimationSession(() => this.document.createVariation(options));
  }

  private createAnimationSession(create: () => boolean): boolean {
    return this.session.run(false, () => {
      const previousId = this.selectedAnimationId;
      const previousContext = { time: this.currentTime, keys: this.selectedKeys };
      const created = create();
      if (created) {
        if (previousId) this.clipContexts.set(previousId, previousContext);
        this.resetAnimationSession(true);
      }
      this.notify();
      return created;
    });
  }

  /** Recovery registers a missing clip as unsaved and preserves every other document. */
  recoverAnimation(source: unknown, draft: unknown): boolean {
    return this.batchNotifications(() => {
      const recovered = this.document.recoverAnimation(source, draft);
      if (recovered) this.resetAnimationSession(true);
      this.notify();
      return recovered;
    });
  }

  /** Validate before touching navigation; notify once with the complete fresh session and pose at zero. */
  importJson(json: string, options: AnimationImportOptions = {}): boolean {
    return this.session.run(false, () => {
      const imported = this.document.importJson(json, options);
      if (imported) {
        ++this.importedSessions;
        this.resetAnimationSession(true);
      }
      this.notify();
      return imported;
    });
  }

  /** Reload committed export through the same validated import boundary, without saving on failure. */
  reloadCurrentExport(options: AnimationImportOptions = {}): boolean {
    const result = this.exportAnimation();
    if (result.success) return this.importJson(result.json, options);
    this.document.reportIssues(result.issues);
    this.notify();
    return false;
  }

  /** Export committed authored data only; drafts, selection, history and preview preferences stay local. */
  exportAnimation(): AnimationExportResult {
    return this.document.exportAnimation();
  }

  packageAnimations(): readonly ReadonlyAnimation[] {
    return this.document.packageAnimations();
  }

  exportJson(): string {
    return this.document.exportJson();
  }

  markSaved(snapshot: ReadonlyAnimation | null = this.workingAnimation): void {
    this.document.markSaved(snapshot);
    this.notify();
  }

  undo(): boolean {
    return this.session.run(false, () => this.restoreHistory(() => this.document.undo()));
  }
  redo(): boolean {
    return this.session.run(false, () => this.restoreHistory(() => this.document.redo()));
  }
  private restoreHistory(restore: () => boolean): boolean {
    // Undo/redo is also a cancellation boundary when the requested history stack is empty.
    const cancelledDrag = this.cancelTimelineDrag();
    const cancelled = this.clearTransformDraft() || cancelledDrag || !!this.previews.previewedPose;
    this.previewCommands.clearPose();
    const changed = restore();
    if (changed) {
      this.updateTime(this.currentTime);
      if (
        this.rootMotion.selectedRootKey &&
        !rootKeys(this.working!, this.rootMotion.selectedRootKey.property).some(
          (key) => key.time / 1000 === this.rootMotion.selectedRootKey!.time,
        )
      )
        this.rootMotion.selectedRootKey = null;
      this.selectionCommands.reconcile();
    }
    if (changed || cancelled) this.notify();
    return changed;
  }
}
