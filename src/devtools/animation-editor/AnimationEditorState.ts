import type {
  AnimationClip,
  AnimationEvent,
  AnimationPlaybackMode,
  Interpolation,
  PropertyKeyframe,
} from '../../engine/AnimationClip.js';
import { dispatchAnimationEvents } from '../../engine/animationNotifications.js';
import type { FiredAnimationEvent } from '../../engine/AnimationPlayer.js';
import { collectAnimationStartEvents } from '../../engine/animationTimeline.js';
import type { ValidationIssue } from '../../engine/externalData.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { type JointTransform, type TransformProperty, transformProperties } from '../../engine/types.js';
import { freezeData } from '../shared/editorData.js';
import {
  AnimationEditorDocument,
  type AnimationEditorStateOptions,
  type ReadonlyAnimation,
} from './AnimationEditorDocument.js';
import { AnimationEditorKeyframeCommands, type KeyframeDrag } from './AnimationEditorKeyframeCommands.js';
import { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import { AnimationEditorSelection } from './AnimationEditorSelection.js';
import {
  addAnimationEvent,
  buildEventTimelineTrack,
  findAnimationEvent,
  getAnimationEventReferences,
  removeAnimationEvent,
  updateAnimationEvent,
  type AnimationEventRef,
  type EventTimelineTrack,
} from './animationEvents.js';
import { getEvaluatedBonePropertyValue, getEvaluatedBoneTransform } from './animationValues.js';
import { collectEditorPlaybackEvents, getEditorEventClip } from './editorPlaybackEvents.js';
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
import { animationDurationSeconds, DEFAULT_KEYFRAME_FPS, snapKeyframeTime, type KeyframeSnapMode } from './timeline.js';
import {
  TimelineClipboard,
  copyEventSelection,
  pasteEventClipboard,
  type EventClipboard,
} from './TimelineClipboard.js';
import type { KeyframeSelection, TimelineTrack } from './timelineTracks.js';
import { type Milliseconds, type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

export { PREVIEW_PLAYBACK_SPEEDS } from './AnimationEditorPlayback.js';
export const AUTHORED_FPS_MIN = 1;
export const AUTHORED_FPS_MAX = 240;
export const DEFAULT_AUTHORED_FPS = DEFAULT_KEYFRAME_FPS;

export type { AnimationEditorStateOptions, ReadonlyAnimation } from './AnimationEditorDocument.js';

export type { KeyframeDrag } from './AnimationEditorKeyframeCommands.js';

export interface EventDrag {
  readonly ref: AnimationEventRef;
  readonly originalTime: Seconds;
  readonly previewTime: Seconds;
  readonly previewEvent: DeepReadonly<AnimationEvent>;
}

/** Coordinates authored edits with transient selection, drafts, gestures and preview playback. */
export class AnimationEditorState {
  private readonly document: AnimationEditorDocument;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: FiredAnimationEvent) => void>();
  private readonly clipboard = new TimelineClipboard();
  private readonly playback = new AnimationEditorPlayback(() => this.working?.duration ?? 0);
  private readonly selection: AnimationEditorSelection;
  private readonly keyframes: AnimationEditorKeyframeCommands;
  private dragEvent: EventDrag | null = null;

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
    if (this.dragEvent?.ref === this.selectedEvent) return this.dragEvent.previewEvent;
    return this.selectedEvent ? findAnimationEvent(this.working, this.selectedEvent) : undefined;
  }
  get eventTimelineTrack(): EventTimelineTrack {
    return buildEventTimelineTrack(this.working);
  }
  /** Transient navigation only: preview sampling never dispatches authored events. */
  selectAnimationEvent(ref: AnimationEventRef): boolean {
    const event = findAnimationEvent(this.working, ref);
    if (!event) return false;
    this.cancelTimelineDrag();
    this.playback.pause();
    this.playback.endScrub();
    this.selection.selectEvent(ref);
    this.updateTimeMilliseconds(event.time);
    this.notify();
    return true;
  }
  clearEventSelection(): void {
    this.cancelEventDrag();
    if (this.selection.clearEvent()) this.notify();
  }
  clearTimelineSelection(): void {
    this.cancelTimelineDrag();
    const keys = this.selection.clearKey();
    const event = this.selection.clearEvent();
    if (keys || event) this.notify();
  }
  /** Authored event fields use the existing strict file schema and immutable mutation API. */
  addAnimationEvent(event: DeepReadonly<AnimationEvent>): boolean {
    return this.editEvents((animation, rig) => addAnimationEvent(animation, rig, event));
  }
  updateAnimationEvent(ref: AnimationEventRef, event: DeepReadonly<AnimationEvent>): boolean {
    return this.editEvents((animation, rig) => updateAnimationEvent(animation, rig, ref, event));
  }
  removeAnimationEvent(ref: AnimationEventRef): boolean {
    return this.editEvents((animation, rig) => removeAnimationEvent(animation, rig, ref));
  }
  private editEvents(edit: (animation: ReadonlyAnimation, rig: Rig) => ReadonlyAnimation): boolean {
    this.cancelTimelineDrag();
    if (!this.working || !this.rig) return false;
    let next: ReadonlyAnimation;
    try {
      next = edit(this.working, this.rig);
    } catch (error) {
      this.document.reportError(error);
      this.notify();
      return false;
    }
    this.playback.pause();
    this.playback.endScrub();
    return this.installWorkingAnimation(next);
  }
  /** The required name gets a neutral default; the UI immediately focuses it for editing. */
  createAnimationEvent(): boolean {
    this.cancelTimelineDrag();
    const previous = new Set(getAnimationEventReferences(this.working));
    if (!this.addAnimationEvent({ time: this.playback.currentTimeMilliseconds, name: 'event' })) return false;
    const ref = getAnimationEventReferences(this.working).find((entry) => !previous.has(entry));
    return ref ? this.selectAnimationEvent(ref) : false;
  }
  deleteSelectedEvent(): boolean {
    return this.selectedEvent ? this.removeAnimationEvent(this.selectedEvent) : false;
  }
  get timelineClipboard() {
    return this.clipboard.content;
  }
  get eventClipboard(): EventClipboard | null {
    return this.clipboard.content?.kind === 'event' ? this.clipboard.content.data : null;
  }
  copySelectedEvent(): boolean {
    if (!this.working || !this.selectedEvent) return false;
    const data = copyEventSelection(this.working, this.selectedEvent);
    if (!data) return false;
    this.clipboard.content = Object.freeze({ kind: 'event', data });
    this.notify();
    return true;
  }
  pasteEvent(): boolean {
    const time = this.playback.currentTimeMilliseconds;
    return this.eventClipboard ? this.pasteEventAt(this.eventClipboard, time) : false;
  }
  duplicateSelectedEvent(): boolean {
    if (!this.working || !this.selectedEvent) return false;
    const data = copyEventSelection(this.working, this.selectedEvent);
    if (!data) return false;
    const playback = this.working.playback;
    const step =
      playback?.mode === 'stepped' && Number.isFinite(playback.fps) && playback.fps > 0
        ? 1 / playback.fps
        : this.keyframeSnapMode === 'frame'
          ? 1 / this.keyframeFPS
          : 0.01;
    const source = data.event.time;
    const duration = this.working.duration;
    // At the endpoint step backwards; otherwise clamp forwards to a distinct, valid time.
    const target =
      source < duration
        ? Math.min(duration, source + toMilliseconds(step))
        : Math.max(0, source - toMilliseconds(step));
    if (target === source) return false;
    return this.pasteEventAt(data, target);
  }
  private pasteEventAt(data: EventClipboard, time: Milliseconds): boolean {
    if (!this.working || !this.rig) return false;
    let pasted: ReturnType<typeof pasteEventClipboard>;
    try {
      pasted = pasteEventClipboard(this.working, this.rig, data, time);
    } catch (error) {
      this.document.reportError(error);
      this.notify();
      return false;
    }
    if (!this.editEvents(() => pasted.animation)) return false;
    this.selection.selectEvent(pasted.ref);
    this.notify();
    return true;
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
  /** Empty text removes optional data; explicit JSON null remains an authored payload. */
  setSelectedEventDataJson(text: string): boolean {
    this.cancelTimelineDrag();
    const event = this.selectedEventData;
    const ref = this.selectedEvent;
    if (!event || !ref) return false;
    let next: DeepReadonly<AnimationEvent>;
    try {
      next = text.trim() ? { ...event, data: JSON.parse(text) as unknown } : { time: event.time, name: event.name };
    } catch {
      this.document.reportIssues([
        { severity: 'error', path: 'events.data', message: 'Event data must be valid JSON.' },
      ]);
      this.notify();
      return false;
    }
    return this.updateAnimationEvent(ref, next);
  }
  get eventDrag(): EventDrag | null {
    return this.dragEvent;
  }
  beginEventDrag(ref: AnimationEventRef): boolean {
    if (!this.selectAnimationEvent(ref)) return false;
    const event = this.selectedEventData!;
    this.dragEvent = Object.freeze({
      ref,
      originalTime: toSeconds(event.time),
      previewTime: toSeconds(event.time),
      previewEvent: event,
    });
    this.notify();
    return true;
  }
  previewEventDrag(time: Seconds, disableSnapping = false): boolean {
    const drag = this.dragEvent;
    if (!drag || !Number.isFinite(time)) return false;
    const previewTime = snapKeyframeTime(
      time,
      this.duration,
      disableSnapping ? 'none' : this.keyframeSnapMode,
      this.keyframeFPS,
    );
    this.dragEvent = Object.freeze({
      ...drag,
      previewTime,
      previewEvent: Object.freeze({ ...drag.previewEvent, time: toMilliseconds(previewTime) }),
    });
    this.updateTime(previewTime);
    this.notify();
    return true;
  }
  commitEventDrag(): boolean {
    const drag = this.dragEvent;
    if (!drag) return false;
    this.dragEvent = null;
    return this.moveSelectedEvent(drag.previewTime);
  }
  cancelEventDrag(): boolean {
    const drag = this.dragEvent;
    if (!drag) return false;
    this.dragEvent = null;
    this.updateTime(drag.originalTime);
    this.notify();
    return true;
  }
  /** Explicit inspector time edits clamp without snapping; gestures apply the shared snap policy first. */
  moveSelectedEvent(time: Seconds): boolean {
    this.cancelTimelineDrag();
    const event = this.selectedEventData;
    const ref = this.selectedEvent;
    if (!event || !ref) return false;
    if (!Number.isFinite(time)) return this.updateAnimationEvent(ref, { ...event, time: toMilliseconds(time) });
    const target = snapKeyframeTime(time, this.duration, 'none');
    // Preserve exact fractional milliseconds when displaying/committing an
    // unchanged seconds value; a unit round trip can otherwise change one bit.
    const authoredTime = target === toSeconds(event.time) ? event.time : toMilliseconds(target);
    if (!this.updateAnimationEvent(ref, { ...event, time: authoredTime })) return false;
    this.updateTimeMilliseconds(authoredTime);
    this.notify();
    return true;
  }
  nudgeSelectedEvent(direction: -1 | 1, large = false): boolean {
    if (!this.selectedEventData || this.eventDrag) return false;
    const step = this.keyframeSnapMode === 'frame' ? 1 / this.keyframeFPS : 0.01;
    const time = toSeconds(this.selectedEventData.time) + direction * step * (large ? 10 : 1);
    return this.moveSelectedEvent(snapKeyframeTime(time, this.duration, this.keyframeSnapMode, this.keyframeFPS));
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
    return this.keyframes.pasteKeyframes();
  }
  duplicateSelectedKeyframes(): boolean {
    return this.keyframes.duplicateSelectedKeyframes();
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
    this.cancelEventDrag();
    return this.keyframes.beginKeyframeDrag(key);
  }
  previewKeyframeDrag(time: Seconds, disableSnapping = false): boolean {
    return this.keyframes.previewKeyframeDrag(time, disableSnapping);
  }
  commitKeyframeDrag(): boolean {
    return this.keyframes.commitKeyframeDrag();
  }
  cancelKeyframeDrag(): boolean {
    return this.keyframes.cancelKeyframeDrag();
  }
  moveSelectedKeyframe(time: Seconds): boolean {
    return this.keyframes.moveSelectedKeyframe(time);
  }
  nudgeSelectedKeyframe(direction: -1 | 1, large = false): boolean {
    return this.keyframes.nudgeSelectedKeyframe(direction, large);
  }
  /** Resolve identity through the central tolerance policy, then select and seek in one notification. */
  selectKeyframe(selection: KeyframeSelection, modifiers: KeyframeSelectionModifiers = {}): boolean {
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
                entry.time >= Math.min(anchor.time, clicked.time) && entry.time <= Math.max(anchor.time, clicked.time),
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
  }
  clearKeyframeSelection(): void {
    this.cancelTimelineDrag();
    if (this.selection.clearKey()) this.notify();
  }
  /** Resolve externally supplied references before installing transient box selection. */
  selectKeyframes(keys: readonly KeyframeSelection[], additive = false): void {
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
  }
  selectKeyframeMarquee(box: KeyframeMarquee, additive = false): void {
    this.selectKeyframes(keysInMarquee(this.timelineTracks, box), additive);
  }
  deleteSelectedKeyframes(): boolean {
    return this.keyframes.deleteSelectedKeyframes();
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
    if (!this.rig?.hasBone(boneId)) return false;
    this.cancelTimelineDrag();
    if (this.selection.setExpanded(boneId, expanded)) this.notify();
    return true;
  }
  /** Atomic bone + property selection uses the same bone owner as hierarchy and preview picking. */
  selectTimelineProperty(boneId: string, property: TransformProperty): boolean {
    if (!this.rig?.hasBone(boneId) || !transformProperties.includes(property)) return false;
    this.cancelTimelineDrag();
    if (this.selection.selectProperty(boneId, property)) this.notify();
    return true;
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
    if (id !== null && !this.rig?.hasBone(id)) return false;
    this.cancelTimelineDrag();
    if (this.selection.selectBone(id)) this.notify();
    return true;
  }
  /** Focusing an authoring field pauses at the held time, even before the first input. */
  beginTransformEdit(): void {
    this.cancelTimelineDrag();
    if (this.selection.boneId && this.working) this.pause();
  }
  setTemporaryBoneProperty(property: TransformProperty, value: number): boolean {
    if (!this.selection.boneId || !this.working || !transformProperties.includes(property) || !Number.isFinite(value))
      return false;
    this.cancelTimelineDrag();
    this.playback.pause();
    this.selection.setDraft(property, value);
    this.notify();
    return true;
  }
  commitBoneProperty(property: TransformProperty): boolean {
    if (!this.selection.boneId || !transformProperties.includes(property)) return false;
    this.beginTransformEdit();
    const value = this.selectedBoneTransform?.[property];
    return value !== undefined && this.setBonePropertyKeyframe(this.selection.boneId, property, value);
  }
  deleteBonePropertyKey(property: TransformProperty): boolean {
    if (!this.selection.boneId || !transformProperties.includes(property)) return false;
    this.beginTransformEdit();
    return this.removeBonePropertyKeyframe(this.selection.boneId, property);
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

  private notify(): void {
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
    this.cancelTimelineDrag();
    const selected = this.document.selectAnimation(id, options);
    if (selected) {
      this.selection.resetAnimation();
      this.playback.reset();
    }
    this.notify();
    return selected;
  }

  setCurrentTime(time: Seconds): void {
    this.cancelTimelineDrag();
    // Explicit navigation cancels drafts even when clamping leaves the playhead at the same endpoint.
    const cancelled = this.clearTransformDraft();
    if (this.updateTime(time) || cancelled) this.notify();
  }

  /** Clamp navigation and authored edits using the same loop and scrub playback intent. */
  private updateTime(time: Seconds): boolean {
    const previous = this.currentTime;
    const changed = this.playback.setCurrentTime(time);
    if (previous !== this.currentTime) this.clearTransformDraft();
    return changed;
  }

  private updateTimeMilliseconds(time: Milliseconds): boolean {
    const previous = this.currentTime;
    const changed = this.playback.setCurrentTimeMilliseconds(time);
    if (previous !== this.currentTime) this.clearTransformDraft();
    return changed;
  }

  private notifyPlaybackChange(previous: Seconds, changed: boolean): void {
    if (previous !== this.currentTime) this.clearTransformDraft();
    if (changed) this.notify();
  }

  /** Preview preferences stay outside authored data and history. */
  setPreviewLoop(loop: boolean): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.setPreviewLoop(loop));
  }

  /** A preview preference, never serialized or recorded in authored history. */
  setPlaybackSpeed(speed: number): boolean {
    const previous = this.playbackSpeed;
    if (!this.playback.setPlaybackSpeed(speed)) return false;
    if (speed !== previous) this.notify();
    return true;
  }

  /** FPS only exists on stepped clips in the runtime format; keys and events retain millisecond times. */
  setAuthoredFPS(fps: number): boolean {
    if (this.working?.playback?.mode !== 'stepped') return false;
    if (!Number.isFinite(fps) || fps < AUTHORED_FPS_MIN || fps > AUTHORED_FPS_MAX) {
      this.document.reportIssues([
        {
          severity: 'error',
          path: 'playback.fps',
          message: `Animation FPS must be a finite number from ${AUTHORED_FPS_MIN} to ${AUTHORED_FPS_MAX}.`,
        },
      ]);
      this.notify();
      return false;
    }
    return this.setAuthoredPlayback({ mode: 'stepped', fps });
  }

  setAuthoredPlaybackMode(mode: AnimationPlaybackMode['mode']): boolean {
    if (!this.working || (mode !== 'smooth' && mode !== 'stepped')) return false;
    if (mode === (this.working.playback?.mode ?? 'smooth')) return true;
    return this.setAuthoredPlayback(mode === 'smooth' ? { mode } : { mode, fps: DEFAULT_AUTHORED_FPS });
  }

  private setAuthoredPlayback(playback: AnimationPlaybackMode): boolean {
    const source = this.working;
    if (!source || !this.rig) return false;
    let next: ReadonlyAnimation;
    try {
      getValidatedEditorAnimation(source, this.rig);
      next = validateEditedAnimation({ ...source, playback }, source, this.rig);
    } catch (error) {
      this.document.reportError(error);
      this.notify();
      return false;
    }
    return this.installWorkingAnimation(next);
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
    if (!this.working || !this.rig) return false;
    try {
      const next = setAnimationInterpolation(this.working, this.rig, mode);
      if (next === this.working) return true;
      return this.installWorkingAnimation(freezeData(next));
    } catch {
      return false;
    }
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
    return this.keyframes.setBonePropertyKeyframe(boneId, property, value, timeSeconds);
  }

  removeBonePropertyKeyframe(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.keyframes.removeBonePropertyKeyframe(boneId, property, timeSeconds);
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

  /** Keep playback intent while the pointer owns time; pause/play can still change that intent. */
  beginScrub(): void {
    this.cancelTimelineDrag();
    if (!this.working) return;
    const cancelled = this.clearTransformDraft();
    if (this.playback.beginScrub() || cancelled) this.notify();
  }

  endScrub(): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.endScrub());
  }

  /** Resume the sole editor clock; a completed clip starts again at zero. */
  play(): void {
    if (this.keyframeDrag || this.eventDrag) return;
    if (!this.playback.play()) return;
    this.clearTransformDraft();
    const events = this.startEvents();
    this.notify();
    this.dispatchEvents(events);
  }

  pause(): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.pause());
  }

  togglePlayback(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /** Rewind immediately, preserving whether playback is active. */
  restart(): void {
    this.playback.requestStart();
    this.setCurrentTime(0);
    this.dispatchEvents(this.startEvents());
  }

  /** Phaser supplies elapsed milliseconds; the scene converts them to continuous seconds here. */
  advancePlayback(deltaSeconds: Seconds): void {
    let events: FiredAnimationEvent[] = [];
    if (
      this.isPlaying &&
      !this.isScrubbing &&
      Number.isFinite(deltaSeconds) &&
      deltaSeconds > 0 &&
      this.working?.events?.length &&
      this.rig
    ) {
      try {
        events = collectEditorPlaybackEvents(
          getEditorEventClip(this.working, this.rig, this.previewLoop),
          this.playback.currentTimeMilliseconds,
          deltaSeconds,
          this.playbackSpeed,
        );
      } catch (error) {
        this.document.reportError(error);
        this.notify();
        return;
      }
    }
    this.notifyPlaybackChange(this.currentTime, this.playback.advance(deltaSeconds));
    this.dispatchEvents(events);
  }

  /** Runtime-compatible notifications are delivered after preview subscribers synchronize the held pose. */
  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  private startEvents(): FiredAnimationEvent[] {
    return this.playback.consumeStart() && this.working && this.rig
      ? collectAnimationStartEvents(getEditorEventClip(this.working, this.rig, this.previewLoop), 'base')
      : [];
  }
  private dispatchEvents(events: readonly FiredAnimationEvent[]): void {
    const errors = dispatchAnimationEvents(events, this.eventListeners);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Animation editor event listeners failed.');
  }

  /** Authored edit boundary: validate atomically, own a fresh JSON copy, and record one history entry. */
  replaceWorkingAnimation(input: unknown): boolean {
    if (!this.working) return false;
    const next = this.document.inspect(input);
    if (!next) {
      this.notify();
      return false;
    }
    return this.installWorkingAnimation(next);
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

  /** Export committed authored data only; drafts, selection, history and preview preferences stay local. */
  exportJson(): string {
    return this.document.exportJson();
  }

  markSaved(): void {
    this.document.markSaved();
    this.notify();
  }

  undo(): boolean {
    return this.restoreHistory(() => this.document.undo());
  }
  redo(): boolean {
    return this.restoreHistory(() => this.document.redo());
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
