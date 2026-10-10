import type {
  AnimationClip,
  AnimationEvent,
  AnimationPlaybackMode,
  Interpolation,
  PropertyKeyframe,
} from '../../engine/AnimationClip.js';
import type { FiredAnimationEvent } from '../../engine/AnimationPlayer.js';
import type { AnimationPose } from '../../engine/AnimationPose.js';
import type { ValidationIssue } from '../../engine/externalData.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { type JointTransform, type TransformProperty, transformProperties } from '../../engine/types.js';
import { freezeData } from '../shared/editorData.js';
import {
  AnimationEditorDocument,
  type AnimationEditorStateOptions,
  type AnimationImportOptions,
  type ReadonlyAnimation,
} from './AnimationEditorDocument.js';
import { AnimationEditorEventCommands, type EventDrag } from './AnimationEditorEventCommands.js';
import { AnimationEditorKeyframeCommands, type KeyframeDrag } from './AnimationEditorKeyframeCommands.js';
import { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import { AnimationEditorPlaybackCommands } from './AnimationEditorPlaybackCommands.js';
import { AnimationEditorPlaybackController } from './AnimationEditorPlaybackController.js';
import { AnimationEditorSelection } from './AnimationEditorSelection.js';
import {
  buildEventTimelineTrack,
  findAnimationEvent,
  type AnimationEventRef,
  type EventTimelineTrack,
} from './animationEvents.js';
import type { AnimationExportResult } from './animationSerialization.js';
import { getEvaluatedBonePropertyValue, getEvaluatedBoneTransform } from './animationValues.js';
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
  setInterpolationForKeys,
} from './interpolation.js';
import type { KeyframeClipboard } from './keyframeClipboard.js';
import { findBonePropertyKeyframe, getKeyedPropertiesAtTime, hasKeyframeAtTime } from './keyframeQueries.js';
import {
  keysInMarquee,
  resolveKey,
  sameKey,
  type KeyframeMarquee,
  type KeyframeSelectionModifiers,
} from './keyframeSelection.js';
import { animationDurationSeconds, type KeyframeSnapMode } from './timeline.js';
import { TimelineClipboard, type EventClipboard } from './TimelineClipboard.js';
import type { KeyframeSelection, TimelineTrack } from './timelineTracks.js';
import { type Milliseconds, type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

export { PREVIEW_PLAYBACK_SPEEDS } from './AnimationEditorPlayback.js';
export { AUTHORED_FPS_MIN, AUTHORED_FPS_MAX, DEFAULT_AUTHORED_FPS } from './AnimationEditorPlaybackCommands.js';

export type {
  AnimationEditorStateOptions,
  AnimationImportOptions,
  ReadonlyAnimation,
} from './AnimationEditorDocument.js';

export type { EventDrag } from './AnimationEditorEventCommands.js';
export type { KeyframeDrag } from './AnimationEditorKeyframeCommands.js';
export type { AnimationExportResult } from './animationSerialization.js';

/** Coordinates authored edits with transient selection, drafts, gestures and preview playback. */
export class AnimationEditorState {
  private readonly document: AnimationEditorDocument;
  private readonly listeners = new Set<() => void>();
  private readonly clipboard = new TimelineClipboard();
  private readonly playback = new AnimationEditorPlayback(() => this.working?.duration ?? 0);
  private readonly selection: AnimationEditorSelection;
  private readonly keyframes: AnimationEditorKeyframeCommands;
  private readonly events: AnimationEditorEventCommands;
  private readonly playbackController: AnimationEditorPlaybackController;
  private readonly playbackCommands: AnimationEditorPlaybackCommands;
  private notificationDepth = 0;
  private notificationPending = false;
  private importedSessions = 0;
  private animationSessions = 0;

  constructor(
    readonly rig?: Rig,
    animations: readonly AnimationClip[] = [],
    options: AnimationEditorStateOptions = {},
  ) {
    this.document = new AnimationEditorDocument(rig, animations, options);
    this.selection = new AnimationEditorSelection(rig);
    this.keyframes = new AnimationEditorKeyframeCommands(
      this.document,
      this.selection,
      this.playback,
      {
        select: (key) => this.selectKeyframe(key),
        updateTime: (time) => this.updateTime(time),
        install: (animation, retainDraft, selectedKeys) =>
          this.installWorkingAnimation(animation, retainDraft, selectedKeys),
        notify: () => this.notify(),
      },
      this.clipboard,
    );
    this.events = new AnimationEditorEventCommands(
      this.document,
      this.selection,
      this.playback,
      {
        select: (ref) => this.selectAnimationEvent(ref),
        cancelTimelineDrag: () => this.cancelTimelineDrag(),
        updateTime: (time) => this.updateTime(time),
        updateTimeMilliseconds: (time) => this.updateTimeMilliseconds(time),
        install: (animation) => this.installWorkingAnimation(animation),
        notify: () => this.notify(),
      },
      this.clipboard,
      this.keyframes,
    );
    this.playbackController = new AnimationEditorPlaybackController(this.document, this.selection, this.playback, {
      notify: () => this.notify(),
      navigate: (time) => this.setCurrentTime(time),
      isDragging: () => !!(this.keyframeDrag || this.eventDrag),
    });
    this.playbackCommands = new AnimationEditorPlaybackCommands(this.document, {
      install: (animation) => this.installWorkingAnimation(animation),
      notify: () => this.notify(),
    });
  }

  private get working(): ReadonlyAnimation | null {
    return this.document.workingAnimation;
  }

  get animationIds(): readonly string[] {
    return this.document.animationIds;
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
  get selectedEventData() {
    return this.events.selectedEventData;
  }
  get eventTimelineTrack(): EventTimelineTrack {
    return buildEventTimelineTrack(this.working);
  }
  /** Transient navigation only: preview sampling never dispatches authored events. */
  selectAnimationEvent(ref: AnimationEventRef): boolean {
    return this.batchNotifications(() => {
      const event = findAnimationEvent(this.working, ref);
      if (!event) return false;
      this.cancelTimelineDrag();
      this.playback.pause();
      this.playback.endScrub();
      this.selection.selectEvent(ref);
      this.updateTimeMilliseconds(event.time);
      this.notify();
      return true;
    });
  }
  clearEventSelection(): void {
    return this.batchNotifications(() => {
      this.cancelEventDrag();
      if (this.selection.clearEvent()) this.notify();
    });
  }
  clearTimelineSelection(): void {
    return this.batchNotifications(() => {
      this.cancelTimelineDrag();
      const keys = this.selection.clearKey();
      const event = this.selection.clearEvent();
      if (keys || event) this.notify();
    });
  }
  addAnimationEvent(event: DeepReadonly<AnimationEvent>): boolean {
    return this.batchNotifications(() => this.events.addAnimationEvent(event));
  }
  updateAnimationEvent(ref: AnimationEventRef, event: DeepReadonly<AnimationEvent>): boolean {
    return this.batchNotifications(() => this.events.updateAnimationEvent(ref, event));
  }
  removeAnimationEvent(ref: AnimationEventRef): boolean {
    return this.batchNotifications(() => this.events.removeAnimationEvent(ref));
  }
  createAnimationEvent(): boolean {
    return this.batchNotifications(() => this.events.createAnimationEvent());
  }
  deleteSelectedEvent(): boolean {
    return this.batchNotifications(() => this.events.deleteSelectedEvent());
  }
  get timelineClipboard() {
    return this.clipboard.content;
  }
  get eventClipboard(): EventClipboard | null {
    return this.events.eventClipboard;
  }
  copySelectedEvent(): boolean {
    return this.events.copySelectedEvent();
  }
  pasteEvent(): boolean {
    return this.batchNotifications(() => this.events.pasteEvent());
  }
  duplicateSelectedEvent(): boolean {
    return this.batchNotifications(() => this.events.duplicateSelectedEvent());
  }
  copyTimelineSelection(): boolean {
    return this.selectedEvent ? this.copySelectedEvent() : this.copySelectedKeyframes();
  }
  pasteTimelineClipboard(): boolean {
    return this.clipboard.content?.kind === 'event' ? this.pasteEvent() : this.pasteKeyframes();
  }
  duplicateTimelineSelection(): boolean {
    return this.selectedEvent ? this.duplicateSelectedEvent() : this.duplicateSelectedKeyframes();
  }
  setSelectedEventDataJson(text: string): boolean {
    return this.batchNotifications(() => this.events.setSelectedEventDataJson(text));
  }
  get eventDrag(): EventDrag | null {
    return this.events.eventDrag;
  }
  beginEventDrag(ref: AnimationEventRef): boolean {
    return this.batchNotifications(() => this.events.beginEventDrag(ref));
  }
  previewEventDrag(time: Seconds, disableSnapping = false): boolean {
    return this.batchNotifications(() => this.events.previewEventDrag(time, disableSnapping));
  }
  commitEventDrag(): boolean {
    return this.batchNotifications(() => this.events.commitEventDrag());
  }
  cancelEventDrag(): boolean {
    return this.batchNotifications(() => this.events.cancelEventDrag());
  }
  moveSelectedEvent(time: Seconds): boolean {
    return this.batchNotifications(() => this.events.moveSelectedEvent(time));
  }
  nudgeSelectedEvent(direction: -1 | 1, large = false): boolean {
    return this.batchNotifications(() => this.events.nudgeSelectedEvent(direction, large));
  }
  private cancelTimelineDrag(): boolean {
    const event = this.cancelEventDrag();
    return this.cancelKeyframeDrag() || event;
  }
  get selectedKeys(): readonly KeyframeSelection[] {
    return this.selection.keys;
  }
  get primaryKey(): KeyframeSelection | null {
    return this.selection.key;
  }
  get keyframeClipboard(): KeyframeClipboard | null {
    return this.keyframes.keyframeClipboard;
  }
  copySelectedKeyframes(): boolean {
    return this.keyframes.copySelectedKeyframes();
  }
  pasteKeyframes(): boolean {
    return this.batchNotifications(() => this.keyframes.pasteKeyframes());
  }
  duplicateSelectedKeyframes(): boolean {
    return this.batchNotifications(() => this.keyframes.duplicateSelectedKeyframes());
  }
  get keyframeDrag(): KeyframeDrag | null {
    return this.keyframes.keyframeDrag;
  }
  get keyframeSnapMode(): KeyframeSnapMode {
    return this.keyframes.keyframeSnapMode;
  }
  get keyframeFPS(): number {
    return this.keyframes.keyframeFPS;
  }
  setKeyframeSnapMode(mode: KeyframeSnapMode): void {
    this.keyframes.setKeyframeSnapMode(mode);
  }
  beginKeyframeDrag(key: KeyframeSelection): boolean {
    return this.batchNotifications(() => {
      this.cancelEventDrag();
      return this.keyframes.beginKeyframeDrag(key);
    });
  }
  previewKeyframeDrag(time: Seconds, disableSnapping = false): boolean {
    return this.batchNotifications(() => this.keyframes.previewKeyframeDrag(time, disableSnapping));
  }
  commitKeyframeDrag(): boolean {
    return this.batchNotifications(() => this.keyframes.commitKeyframeDrag());
  }
  cancelKeyframeDrag(): boolean {
    return this.batchNotifications(() => this.keyframes.cancelKeyframeDrag());
  }
  moveSelectedKeyframe(time: Seconds): boolean {
    return this.batchNotifications(() => this.keyframes.moveSelectedKeyframe(time));
  }
  nudgeSelectedKeyframe(direction: -1 | 1, large = false): boolean {
    return this.batchNotifications(() => this.keyframes.nudgeSelectedKeyframe(direction, large));
  }
  /** Resolve identity through the central tolerance policy, then select and seek in one notification. */
  selectKeyframe(selection: KeyframeSelection, modifiers: KeyframeSelectionModifiers = {}): boolean {
    return this.batchNotifications(() => {
      const { boneId, property, time } = selection;
      if (!this.rig?.hasBone(boneId)) return false;
      const key = this.findBonePropertyKeyframe(boneId, property, time);
      if (!key) return false;
      this.cancelTimelineDrag();
      this.playback.pause();
      this.playback.endScrub();
      const clicked = Object.freeze({ boneId, property, time: toSeconds(key.time) });
      const anchor = this.selection.anchor;
      if (modifiers.range && anchor) {
        // Range stays anchored across repeated Shift-clicks. Cross-track Shift adds and makes the clicked key primary.
        const track = this.timelineTracks.find(
          (row) => row.kind === 'property' && row.boneId === boneId && row.property === property,
        );
        const range =
          anchor.boneId === boneId && anchor.property === property && track?.kind === 'property'
            ? track.keyframes.filter(
                (entry) =>
                  entry.time >= Math.min(anchor.time, clicked.time) &&
                  entry.time <= Math.max(anchor.time, clicked.time),
              )
            : [...this.selectedKeys, clicked];
        this.selection.setKeys(modifiers.additive ? [...this.selectedKeys, ...range] : range, clicked);
        this.updateTimeMilliseconds(key.time);
      } else if (modifiers.additive) {
        const exists = this.selection.hasKey(clicked);
        this.selection.setKeys(
          exists ? this.selectedKeys.filter((entry) => !sameKey(entry, clicked)) : [...this.selectedKeys, clicked],
          this.primaryKey,
        );
        // Add/toggle retains primary where possible; fallback primary never seeks.
      } else {
        this.selection.selectKey(clicked);
        this.updateTimeMilliseconds(key.time);
      }
      this.notify();
      return true;
    });
  }
  clearKeyframeSelection(): void {
    return this.batchNotifications(() => {
      this.cancelTimelineDrag();
      if (this.selection.clearKey()) this.notify();
    });
  }
  /** Resolve externally supplied references before installing transient box selection. */
  selectKeyframes(keys: readonly KeyframeSelection[], additive = false): void {
    return this.batchNotifications(() => {
      this.cancelTimelineDrag();
      this.playback.pause();
      this.playback.endScrub();
      const resolved = keys.flatMap((key) => {
        const ref = resolveKey(this.working, key);
        return ref ? [ref] : [];
      });
      const previous = this.primaryKey;
      this.selection.setKeys(additive ? [...this.selectedKeys, ...resolved] : resolved, previous);
      if (!additive && this.primaryKey && (!previous || !sameKey(previous, this.primaryKey)))
        this.updateTime(this.primaryKey.time);
      this.notify();
    });
  }
  selectKeyframeMarquee(box: KeyframeMarquee, additive = false): void {
    this.selectKeyframes(keysInMarquee(this.timelineTracks, box), additive);
  }
  deleteSelectedKeyframes(): boolean {
    return this.batchNotifications(() => this.keyframes.deleteSelectedKeyframes());
  }
  /** Compatibility alias: deletion operates on the whole selection. */
  deleteSelectedKeyframe(): boolean {
    return this.deleteSelectedKeyframes();
  }
  /** Previous/next authored key on the selected property, relative to the current playhead. */
  getAdjacentKeyframe(direction: -1 | 1): KeyframeSelection | undefined {
    return this.selection.adjacentKey(this.working, this.currentTime, direction);
  }
  selectAdjacentKeyframe(direction: -1 | 1): boolean {
    const key = this.getAdjacentKeyframe(direction);
    return key ? this.selectKeyframe(key) : false;
  }
  /** Authored snapshots are authoritative; history never restores transient selection. */
  private validateKeyframeSelection(): void {
    this.selection.validateKey(this.working);
    this.selection.validateEvent(this.working);
  }
  /** Cached immutable editor rows: playback and selection never rebuild layout or authored-key queries. */
  get timelineTracks(): readonly TimelineTrack[] {
    return this.selection.tracks(this.working);
  }
  isTimelineBoneExpanded(boneId: string): boolean {
    return this.selection.isExpanded(boneId);
  }
  setTimelineBoneExpanded(boneId: string, expanded: boolean): boolean {
    return this.batchNotifications(() => {
      if (!this.rig?.hasBone(boneId)) return false;
      this.cancelTimelineDrag();
      if (this.selection.setExpanded(boneId, expanded)) this.notify();
      return true;
    });
  }
  /** Atomic bone + property selection uses the same bone owner as hierarchy and preview picking. */
  selectTimelineProperty(boneId: string, property: TransformProperty): boolean {
    return this.batchNotifications(() => {
      if (!this.rig?.hasBone(boneId) || !transformProperties.includes(property)) return false;
      this.cancelTimelineDrag();
      if (this.selection.selectProperty(boneId, property)) this.notify();
      return true;
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
      if (id !== null && !this.rig?.hasBone(id)) return false;
      this.cancelTimelineDrag();
      if (this.selection.selectBone(id)) this.notify();
      return true;
    });
  }
  /** Focusing an authoring field pauses at the held time, even before the first input. */
  beginTransformEdit(): void {
    return this.batchNotifications(() => {
      this.cancelTimelineDrag();
      if (this.selection.boneId && this.working) this.pause();
    });
  }
  setTemporaryBoneProperty(property: TransformProperty, value: number): boolean {
    return this.batchNotifications(() => {
      if (!this.selection.boneId || !this.working || !transformProperties.includes(property) || !Number.isFinite(value))
        return false;
      this.cancelTimelineDrag();
      this.playback.pause();
      this.selection.setDraft(property, value);
      this.notify();
      return true;
    });
  }
  commitBoneProperty(property: TransformProperty): boolean {
    return this.batchNotifications(() => {
      if (!this.selection.boneId || !transformProperties.includes(property)) return false;
      this.beginTransformEdit();
      const value = this.selectedBoneTransform?.[property];
      return value !== undefined && this.setBonePropertyKeyframe(this.selection.boneId, property, value);
    });
  }
  deleteBonePropertyKey(property: TransformProperty): boolean {
    return this.batchNotifications(() => {
      if (!this.selection.boneId || !transformProperties.includes(property)) return false;
      this.beginTransformEdit();
      return this.removeBonePropertyKeyframe(this.selection.boneId, property);
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
  get currentTime(): Seconds {
    return this.playback.currentTime;
  }
  get duration(): Seconds {
    return animationDurationSeconds(this.working);
  }
  get isPlaying(): boolean {
    return this.playback.isPlaying;
  }
  get previewLoop(): boolean {
    return this.playback.previewLoop;
  }
  get playbackSpeed(): number {
    return this.playback.playbackSpeed;
  }
  get isScrubbing(): boolean {
    return this.playback.isScrubbing;
  }
  get loop(): boolean {
    return this.working?.loop ?? false;
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
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Nested commands publish the complete document, selection and clock together. */
  private batchNotifications<Result>(command: () => Result): Result {
    ++this.notificationDepth;
    try {
      return command();
    } finally {
      --this.notificationDepth;
      if (this.notificationDepth === 0 && this.notificationPending) {
        this.notificationPending = false;
        this.notify();
      }
    }
  }

  private notify(): void {
    if (this.notificationDepth > 0) {
      this.notificationPending = true;
      return;
    }
    const errors: unknown[] = [];
    // Keep this notification stable when a subscriber adds or removes listeners.
    // oxlint-disable-next-line unicorn/no-useless-spread -- Preserve the listener snapshot during callbacks.
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Animation editor listeners failed.');
  }

  /** Failed selections preserve the working copy; callers may explicitly discard authored changes. */
  selectAnimation(id: string | null, options: { discardChanges?: boolean } = {}): boolean {
    return this.batchNotifications(() => {
      const selected = this.document.selectAnimation(id, options);
      if (selected) {
        this.resetAnimationSession();
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

  /** Preview preferences stay outside authored data and history. */
  setPreviewLoop(loop: boolean): void {
    this.playbackController.setPreviewLoop(loop);
  }

  setPlaybackSpeed(speed: number): boolean {
    return this.playbackController.setPlaybackSpeed(speed);
  }

  /** Authored metadata edits share the session's atomic notification boundary. */
  setAuthoredFPS(fps: number): boolean {
    return this.batchNotifications(() => this.playbackCommands.setAuthoredFPS(fps));
  }

  setAuthoredPlaybackMode(mode: AnimationPlaybackMode['mode']): boolean {
    return this.batchNotifications(() => this.playbackCommands.setAuthoredPlaybackMode(mode));
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
    return this.batchNotifications(() => {
      if (!this.working || !this.rig) return false;
      try {
        const next = setAnimationInterpolation(this.working, this.rig, mode);
        if (next === this.working) return true;
        return this.installWorkingAnimation(freezeData(next));
      } catch {
        return false;
      }
    });
  }

  /** The current format has no per-key overrides; unavailable edits preserve all session state. */
  setSelectedKeyframeInterpolation(mode: Interpolation): boolean {
    if (!this.working) return false;
    try {
      setInterpolationForKeys(this.working, this.selectedKeys, mode);
    } catch {
      return false;
    }
    return false;
  }

  /** State-facing authoring uses continuous seconds, defaulting to the sole editor clock. */
  setBonePropertyKeyframe(
    boneId: string,
    property: TransformProperty,
    value: number,
    timeSeconds = this.currentTime,
  ): boolean {
    return this.batchNotifications(() => this.keyframes.setBonePropertyKeyframe(boneId, property, value, timeSeconds));
  }

  removeBonePropertyKeyframe(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.batchNotifications(() => this.keyframes.removeBonePropertyKeyframe(boneId, property, timeSeconds));
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
      ? findBonePropertyKeyframe(this.working, boneId, property, toMilliseconds(timeSeconds))
      : undefined;
  }

  hasKeyframeAtTime(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.working ? hasKeyframeAtTime(this.working, boneId, property, toMilliseconds(timeSeconds)) : false;
  }

  getKeyedPropertiesAtTime(boneId: string, timeSeconds = this.currentTime): TransformProperty[] {
    return this.working ? getKeyedPropertiesAtTime(this.working, boneId, toMilliseconds(timeSeconds)) : [];
  }

  getEvaluatedBonePropertyValue(
    boneId: string,
    property: TransformProperty,
    timeSeconds = this.currentTime,
  ): number | undefined {
    return this.working && this.rig
      ? getEvaluatedBonePropertyValue(this.working, this.rig, boneId, property, toMilliseconds(timeSeconds))
      : undefined;
  }

  getEvaluatedBoneTransform(boneId: string, timeSeconds = this.currentTime): JointTransform | undefined {
    return this.working && this.rig
      ? getEvaluatedBoneTransform(this.working, this.rig, boneId, toMilliseconds(timeSeconds))
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

  /** Keep playback intent while the pointer owns time; pause/play can still change that intent. */
  beginScrub(): void {
    return this.batchNotifications(() => {
      this.cancelTimelineDrag();
      this.playbackController.beginScrub();
    });
  }

  endScrub(): void {
    this.playbackController.endScrub();
  }

  play(): void {
    this.playbackController.play();
  }

  pause(): void {
    this.playbackController.pause();
  }

  togglePlayback(): void {
    this.playbackController.togglePlayback();
  }

  restart(): void {
    this.playbackController.restart();
  }

  /** Phaser supplies elapsed milliseconds; the scene converts them to continuous seconds here. */
  advancePlayback(deltaSeconds: Seconds): void {
    this.playbackController.advancePlayback(deltaSeconds);
  }

  /** Runtime-compatible notifications are delivered after preview subscribers synchronize the held pose. */
  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    return this.playbackController.onAnimationEvent(listener);
  }

  /** Authored edit boundary: validate atomically, own a fresh JSON copy, and record one history entry. */
  replaceWorkingAnimation(input: unknown): boolean {
    return this.batchNotifications(() => {
      if (!this.working) return false;
      const next = this.document.inspect(input);
      if (!next) {
        this.notify();
        return false;
      }
      return this.installWorkingAnimation(next);
    });
  }

  /** Internal edits have already validated their changes and retain immutable unchanged branches. */
  private installWorkingAnimation(
    next: ReadonlyAnimation,
    retainDraft = false,
    selectedKeys?: readonly KeyframeSelection[],
  ): boolean {
    this.cancelTimelineDrag();
    if (!this.document.install(next)) {
      this.notify();
      return false;
    }
    if (!retainDraft) this.clearTransformDraft();
    this.updateTime(this.currentTime);
    if (selectedKeys) this.selection.setKeys(selectedKeys, selectedKeys[0] ?? null);
    this.validateKeyframeSelection();
    this.notify();
    return true;
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
    ++this.animationSessions;
    this.keyframes.resetSession();
    this.events.resetSession();
    this.selection.resetAnimation();
    if (clearBone) this.selection.selectBone(null);
    this.playback.reset();
  }

  /** Revert uses the current session's source, never a network reload or the last exported copy. */
  revertAnimation(options: { discardChanges?: boolean } = {}): boolean {
    return this.batchNotifications(() => {
      const reverted = this.document.revertAnimation(options);
      if (reverted) this.resetAnimationSession(true);
      this.notify();
      return reverted;
    });
  }

  /** Validate before touching navigation; notify once with the complete fresh session and pose at zero. */
  importJson(json: string, options: AnimationImportOptions = {}): boolean {
    return this.batchNotifications(() => {
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

  exportJson(): string {
    return this.document.exportJson();
  }

  markSaved(snapshot: ReadonlyAnimation | null = this.workingAnimation): void {
    this.document.markSaved(snapshot);
    this.notify();
  }

  undo(): boolean {
    return this.batchNotifications(() => this.restoreHistory(() => this.document.undo()));
  }
  redo(): boolean {
    return this.batchNotifications(() => this.restoreHistory(() => this.document.redo()));
  }
  private restoreHistory(restore: () => boolean): boolean {
    // Undo/redo is also a cancellation boundary when the requested history stack is empty.
    const cancelledDrag = this.cancelTimelineDrag();
    const cancelled = this.clearTransformDraft() || cancelledDrag;
    const changed = restore();
    if (changed) {
      this.updateTime(this.currentTime);
      this.validateKeyframeSelection();
    }
    if (changed || cancelled) this.notify();
    return changed;
  }
}
