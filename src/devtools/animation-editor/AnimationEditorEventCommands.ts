import { assertJsonInputSize, JsonInputLimitError } from '../../engine/core.js';
import type { AnimationEvent, DeepReadonly, Rig } from '../../engine/data.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
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
import { animationDurationSeconds, clampTime } from './timeline.js';
import {
  copyEventSelection,
  pasteEventClipboard,
  type EventClipboard,
  type TimelineClipboard,
} from './TimelineClipboard.js';
import type { AnimationEditorTimelineSnapping, TimelineSnapGuide } from './timelineSnapping.js';
import { type Milliseconds, type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

export interface EventDrag {
  readonly ref: AnimationEventRef;
  readonly originalTime: Seconds;
  /** Exact authored timestamp for cancellation; seconds remain the timeline geometry unit. */
  readonly originalTimeMilliseconds: Milliseconds;
  readonly previewTime: Seconds;
  readonly playheadTime: Seconds;
  readonly snapGuide: TimelineSnapGuide | null;
  readonly proposedTime: Seconds;
  readonly disableSnapping: boolean;
  readonly previewEvent: DeepReadonly<AnimationEvent>;
}

/** The public `state.events` domain handle; only the facade resets the session. */
export type AnimationEditorEventHandle = Omit<AnimationEditorEventCommands, 'resetSession'>;

/**
 * Owns event mutation transactions, clipboard commands and transient movement; the session owns the commit ordering.
 * Guarded commands run through `session.run`; the drag cancel only batches. Edits whose only effect is one
 * `commit` (add, update, remove, delete) rely on its guard.
 */
export class AnimationEditorEventCommands {
  private dragEvent: EventDrag | null = null;

  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly session: AnimationEditActions,
    private readonly clipboard: TimelineClipboard,
    private readonly snapping: AnimationEditorTimelineSnapping,
  ) {}

  private get working(): ReadonlyAnimation | null {
    return this.document.workingAnimation;
  }
  private get rig(): Rig | undefined {
    return this.document.rig;
  }
  private get duration(): Seconds {
    return animationDurationSeconds(this.working);
  }
  private get selectedEvent(): AnimationEventRef | null {
    return this.selection.event;
  }

  get eventTimelineTrack(): EventTimelineTrack {
    return buildEventTimelineTrack(this.working);
  }
  /** Transient navigation only: preview sampling never dispatches authored events. */
  selectAnimationEvent(ref: AnimationEventRef): boolean {
    return this.session.selectEvent(ref);
  }
  get selectedEventData() {
    if (this.dragEvent?.ref === this.selectedEvent) return this.dragEvent.previewEvent;
    return this.selectedEvent ? findAnimationEvent(this.working, this.selectedEvent) : undefined;
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
    return this.session.commit((animation, rig) => {
      const next = edit(animation, rig);
      // Bound the complete document, including other payloads and pretty-printed JSON overhead.
      assertJsonExportSize(next);
      return next;
    });
  }
  /** The required name gets a neutral default; the UI immediately focuses it for editing. */
  createAnimationEvent(): boolean {
    return this.session.run(false, () => {
      this.session.cancelActiveDrags();
      const previous = new Set(getAnimationEventReferences(this.working));
      if (!this.addAnimationEvent({ time: this.playback.currentTimeMilliseconds, name: 'event' })) return false;
      const ref = getAnimationEventReferences(this.working).find((entry) => !previous.has(entry));
      return ref ? this.session.selectEvent(ref) : false;
    });
  }
  deleteSelectedEvent(): boolean {
    return this.selectedEvent ? this.removeAnimationEvent(this.selectedEvent) : false;
  }
  get eventClipboard(): EventClipboard | null {
    return this.clipboard.content?.kind === 'event' ? this.clipboard.content.data : null;
  }
  copySelectedEvent(): boolean {
    if (!this.working || !this.selectedEvent) return false;
    const data = copyEventSelection(this.working, this.selectedEvent);
    if (!data) return false;
    this.clipboard.content = Object.freeze({ kind: 'event', data });
    this.session.notify();
    return true;
  }
  pasteEvent(): boolean {
    return this.session.run(false, () => {
      const time = this.playback.currentTimeMilliseconds;
      return this.eventClipboard ? this.pasteEventAt(this.eventClipboard, time) : false;
    });
  }
  duplicateSelectedEvent(): boolean {
    return this.session.run(false, () => this.duplicateEvent());
  }
  private duplicateEvent(): boolean {
    if (!this.working || !this.selectedEvent) return false;
    const data = copyEventSelection(this.working, this.selectedEvent);
    if (!data) return false;
    const playback = this.working.playback;
    const step =
      playback?.mode === 'stepped' && Number.isFinite(playback.fps) && playback.fps > 0
        ? 1 / playback.fps
        : this.snapping.settings.enabled && this.snapping.settings.frames
          ? 1 / this.snapping.fps
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
      this.session.notify();
      return false;
    }
    if (!this.editEvents(() => pasted.animation)) return false;
    this.selection.selectEvent(pasted.ref);
    this.session.notify();
    return true;
  }
  /** Empty text removes optional data; explicit JSON null remains an authored payload. */
  setSelectedEventDataJson(text: string): boolean {
    return this.session.run(false, () => this.setEventDataJson(text));
  }
  private setEventDataJson(text: string): boolean {
    this.session.cancelActiveDrags();
    const event = this.selectedEventData;
    const ref = this.selectedEvent;
    if (!event || !ref) return false;
    let next: DeepReadonly<AnimationEvent>;
    try {
      assertJsonInputSize(text);
      next = text.trim() ? { ...event, data: JSON.parse(text) as unknown } : { time: event.time, name: event.name };
    } catch (error) {
      this.document.reportIssues([
        {
          severity: 'error',
          path: 'events.data',
          message: error instanceof JsonInputLimitError ? error.message : 'Event data must be valid JSON.',
        },
      ]);
      this.session.notify();
      return false;
    }
    return this.updateAnimationEvent(ref, next);
  }
  get eventDrag(): EventDrag | null {
    return this.dragEvent;
  }
  beginEventDrag(ref: AnimationEventRef): boolean {
    return this.session.run(false, () => this.startEventDrag(ref));
  }
  private startEventDrag(ref: AnimationEventRef): boolean {
    const playheadTime = this.playback.currentTime;
    if (!this.session.selectEvent(ref)) return false;
    const event = this.selectedEventData!;
    this.dragEvent = Object.freeze({
      ref,
      originalTime: toSeconds(event.time),
      originalTimeMilliseconds: event.time,
      previewTime: toSeconds(event.time),
      previewEvent: event,
      playheadTime,
      snapGuide: null,
      proposedTime: toSeconds(event.time),
      disableSnapping: false,
    });
    this.session.notify();
    return true;
  }
  previewEventDrag(time: Seconds, disableSnapping = false): boolean {
    return this.session.run(false, () => this.updateEventDrag(time, disableSnapping));
  }
  private updateEventDrag(time: Seconds, disableSnapping: boolean): boolean {
    const drag = this.dragEvent;
    if (!drag || !Number.isFinite(time)) return false;
    const result = this.snapping.resolve(time, {
      playheadTime: drag.playheadTime,
      excludedEvent: drag.ref,
      disableSnapping,
    });
    const previewTime = result.time;
    this.dragEvent = Object.freeze({
      ...drag,
      previewTime,
      snapGuide: result.guide,
      proposedTime: time,
      disableSnapping,
      previewEvent: Object.freeze({ ...drag.previewEvent, time: toMilliseconds(previewTime) }),
    });
    this.session.updateTime(previewTime);
    this.session.notify();
    return true;
  }
  commitEventDrag(): boolean {
    return this.session.run(false, () => {
      const drag = this.dragEvent;
      if (!drag) return false;
      this.dragEvent = null;
      return this.moveSelectedEvent(drag.previewTime);
    });
  }
  cancelEventDrag(): boolean {
    return this.session.batch(() => {
      const drag = this.dragEvent;
      if (!drag) return false;
      this.dragEvent = null;
      this.session.updateTimeMilliseconds(drag.originalTimeMilliseconds);
      this.session.notify();
      return true;
    });
  }
  /** A new document session discards the gesture without restoring old navigation or notifying midway. */
  resetSession(): void {
    this.dragEvent = null;
  }
  /** Explicit inspector time edits clamp without snapping; gestures apply the shared snap policy first. */
  moveSelectedEvent(time: Seconds): boolean {
    // One notification for the commit and the follow-up seek; the commit holds the authoring guard.
    return this.session.batch(() => this.moveEvent(time));
  }
  private moveEvent(time: Seconds): boolean {
    const event = this.selectedEventData;
    const ref = this.selectedEvent;
    if (!event || !ref) return false;
    if (!Number.isFinite(time)) return this.updateAnimationEvent(ref, { ...event, time: toMilliseconds(time) });
    const target = clampTime(time, this.duration);
    // Preserve exact fractional milliseconds when displaying/committing an
    // unchanged seconds value; a unit round trip can otherwise change one bit.
    const authoredTime = target === toSeconds(event.time) ? event.time : toMilliseconds(target);
    if (!this.updateAnimationEvent(ref, { ...event, time: authoredTime })) return false;
    this.session.updateTimeMilliseconds(authoredTime);
    this.session.notify();
    return true;
  }
  nudgeSelectedEvent(direction: -1 | 1, large = false): boolean {
    if (!this.selectedEventData || this.eventDrag) return false;
    const step = this.snapping.settings.enabled && this.snapping.settings.frames ? 1 / this.snapping.fps : 0.01;
    const time = toSeconds(this.selectedEventData.time) + direction * step * (large ? 10 : 1);
    return this.moveSelectedEvent(
      this.snapping.resolve(time, {
        playheadTime:
          this.playback.currentTime === toSeconds(this.selectedEventData.time) ? NaN : this.playback.currentTime,
        ...(this.selectedEvent ? { excludedEvent: this.selectedEvent } : {}),
        ...(direction > 0
          ? {
              minTime:
                toSeconds(this.selectedEventData.time) +
                Number.EPSILON * Math.max(1, toSeconds(this.selectedEventData.time)) * 2,
            }
          : {
              maxTime:
                toSeconds(this.selectedEventData.time) -
                Number.EPSILON * Math.max(1, toSeconds(this.selectedEventData.time)) * 2,
            }),
      }).time,
    );
  }
}
