import type { AnimationEvent } from '../../engine/AnimationClip.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorKeyframeCommands } from './AnimationEditorKeyframeCommands.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import {
  addAnimationEvent,
  findAnimationEvent,
  getAnimationEventReferences,
  removeAnimationEvent,
  updateAnimationEvent,
  type AnimationEventRef,
} from './animationEvents.js';
import { animationDurationSeconds, snapKeyframeTime } from './timeline.js';
import {
  copyEventSelection,
  pasteEventClipboard,
  type EventClipboard,
  type TimelineClipboard,
} from './TimelineClipboard.js';
import { type Milliseconds, type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

export interface EventDrag {
  readonly ref: AnimationEventRef;
  readonly originalTime: Seconds;
  readonly previewTime: Seconds;
  readonly previewEvent: DeepReadonly<AnimationEvent>;
}

interface EventCommandActions {
  select(ref: AnimationEventRef): boolean;
  cancelTimelineDrag(): boolean;
  updateTime(time: Seconds): boolean;
  updateTimeMilliseconds(time: Milliseconds): boolean;
  install(animation: ReadonlyAnimation): boolean;
  notify(): void;
}

/** Owns event mutation transactions, clipboard commands and transient movement; the session coordinates navigation. */
export class AnimationEditorEventCommands {
  private dragEvent: EventDrag | null = null;

  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly actions: EventCommandActions,
    private readonly clipboard: TimelineClipboard,
    private readonly snapping: Pick<AnimationEditorKeyframeCommands, 'keyframeSnapMode' | 'keyframeFPS'>,
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
    this.actions.cancelTimelineDrag();
    if (!this.working || !this.rig) return false;
    let next: ReadonlyAnimation;
    try {
      next = edit(this.working, this.rig);
    } catch (error) {
      this.document.reportError(error);
      this.actions.notify();
      return false;
    }
    this.playback.pause();
    this.playback.endScrub();
    return this.actions.install(next);
  }
  /** The required name gets a neutral default; the UI immediately focuses it for editing. */
  createAnimationEvent(): boolean {
    this.actions.cancelTimelineDrag();
    const previous = new Set(getAnimationEventReferences(this.working));
    if (!this.addAnimationEvent({ time: this.playback.currentTimeMilliseconds, name: 'event' })) return false;
    const ref = getAnimationEventReferences(this.working).find((entry) => !previous.has(entry));
    return ref ? this.actions.select(ref) : false;
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
    this.actions.notify();
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
        : this.snapping.keyframeSnapMode === 'frame'
          ? 1 / this.snapping.keyframeFPS
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
      this.actions.notify();
      return false;
    }
    if (!this.editEvents(() => pasted.animation)) return false;
    this.selection.selectEvent(pasted.ref);
    this.actions.notify();
    return true;
  }
  /** Empty text removes optional data; explicit JSON null remains an authored payload. */
  setSelectedEventDataJson(text: string): boolean {
    this.actions.cancelTimelineDrag();
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
      this.actions.notify();
      return false;
    }
    return this.updateAnimationEvent(ref, next);
  }
  get eventDrag(): EventDrag | null {
    return this.dragEvent;
  }
  beginEventDrag(ref: AnimationEventRef): boolean {
    if (!this.actions.select(ref)) return false;
    const event = this.selectedEventData!;
    this.dragEvent = Object.freeze({
      ref,
      originalTime: toSeconds(event.time),
      previewTime: toSeconds(event.time),
      previewEvent: event,
    });
    this.actions.notify();
    return true;
  }
  previewEventDrag(time: Seconds, disableSnapping = false): boolean {
    const drag = this.dragEvent;
    if (!drag || !Number.isFinite(time)) return false;
    const previewTime = snapKeyframeTime(
      time,
      this.duration,
      disableSnapping ? 'none' : this.snapping.keyframeSnapMode,
      this.snapping.keyframeFPS,
    );
    this.dragEvent = Object.freeze({
      ...drag,
      previewTime,
      previewEvent: Object.freeze({ ...drag.previewEvent, time: toMilliseconds(previewTime) }),
    });
    this.actions.updateTime(previewTime);
    this.actions.notify();
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
    this.actions.updateTime(drag.originalTime);
    this.actions.notify();
    return true;
  }
  /** A new document session discards the gesture without restoring old navigation or notifying midway. */
  resetSession(): void {
    this.dragEvent = null;
  }
  /** Explicit inspector time edits clamp without snapping; gestures apply the shared snap policy first. */
  moveSelectedEvent(time: Seconds): boolean {
    this.actions.cancelTimelineDrag();
    const event = this.selectedEventData;
    const ref = this.selectedEvent;
    if (!event || !ref) return false;
    if (!Number.isFinite(time)) return this.updateAnimationEvent(ref, { ...event, time: toMilliseconds(time) });
    const target = snapKeyframeTime(time, this.duration, 'none');
    // Preserve exact fractional milliseconds when displaying/committing an
    // unchanged seconds value; a unit round trip can otherwise change one bit.
    const authoredTime = target === toSeconds(event.time) ? event.time : toMilliseconds(target);
    if (!this.updateAnimationEvent(ref, { ...event, time: authoredTime })) return false;
    this.actions.updateTimeMilliseconds(authoredTime);
    this.actions.notify();
    return true;
  }
  nudgeSelectedEvent(direction: -1 | 1, large = false): boolean {
    if (!this.selectedEventData || this.eventDrag) return false;
    const step = this.snapping.keyframeSnapMode === 'frame' ? 1 / this.snapping.keyframeFPS : 0.01;
    const time = toSeconds(this.selectedEventData.time) + direction * step * (large ? 10 : 1);
    return this.moveSelectedEvent(
      snapKeyframeTime(time, this.duration, this.snapping.keyframeSnapMode, this.snapping.keyframeFPS),
    );
  }
}
