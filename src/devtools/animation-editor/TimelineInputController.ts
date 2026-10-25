import type { AnimationEditorState } from './AnimationEditorState.js';
import type { AnimationEventRef } from './animationEvents.js';
import type { IKKeyframeSelection } from './ikTimeline.js';
import { timelineXToTime, timeToTimelineX } from './timeline.js';
import { TimelineKeyboardController } from './TimelineKeyboardController.js';
import type { KeyframeSelection } from './timelineTracks.js';

export interface TimelineNavigationActions {
  zoomBy(factor: number): void;
  fitAnimation(): void;
  centerPlayhead(): void;
}

interface ScrubGesture {
  kind: 'scrub';
  id: number;
  startX: number;
  moved: boolean;
  additive: boolean;
}

interface KeyDragGesture {
  kind: 'key-drag' | 'event-drag';
  id: number;
  startX: number;
  clientX: number;
  offset: number;
  moved: boolean;
  shift: boolean;
}

interface MarqueeGesture {
  kind: 'marquee';
  id: number;
  startTime: number;
  startY: number;
  startX: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  additive: boolean;
  element: HTMLElement;
  state: AnimationEditorState;
  animation: AnimationEditorState['workingAnimation'];
  tracks: AnimationEditorState['timelineTracks'];
}

type TimelineGesture = ScrubGesture | KeyDragGesture | MarqueeGesture;

/** Owns one exclusive pointer gesture and composes keyboard routing with its capture/cancellation lifecycle. */
export class TimelineInputController {
  private readonly abort = new AbortController();
  private gesture: TimelineGesture | undefined;
  private readonly keyboard: TimelineKeyboardController;

  constructor(
    private readonly app: HTMLElement,
    private readonly timeline: HTMLElement,
    private readonly getState: () => AnimationEditorState,
    private readonly scrubber: HTMLElement,
    navigation?: TimelineNavigationActions,
  ) {
    const options = { signal: this.abort.signal };
    this.keyboard = new TimelineKeyboardController(app, timeline, getState, scrubber, {
      cancelGesture: () => this.cancelGesture(),
      hasMarquee: () => this.gesture?.kind === 'marquee',
      navigation,
    });
    this.timeline.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.state.animationAuthoringEnabled || event.button !== 0 || this.gesture || !this.state.workingAnimation)
          return;
        event.preventDefault();
        if (
          event.target instanceof Element &&
          event.target.closest('.timeline-track-lane:not(.timeline-event-track):not(.timeline-root-track)')
        ) {
          this.timeline.focus({ preventScroll: true });
          this.beginMarquee(event);
          return;
        }
        this.scrubber.focus({ preventScroll: true });
        this.gesture = {
          kind: 'scrub',
          id: event.pointerId,
          startX: event.clientX,
          moved: false,
          additive: event.ctrlKey || event.metaKey,
        };
        this.timeline.setPointerCapture(event.pointerId);
        this.state.beginScrub();
        this.scrub(event.clientX);
      },
      options,
    );
    this.timeline.addEventListener('pointermove', (event) => this.updateGesture(event), options);
    this.timeline.addEventListener(
      'pointerup',
      (event) => {
        const gesture = this.gesture;
        if (!gesture || event.pointerId !== gesture.id) return;
        this.updateGesture(event);
        if (gesture.kind === 'scrub' && !gesture.additive && !gesture.moved) this.state.clearTimelineSelection();
        this.endGesture(true);
      },
      options,
    );
    for (const name of ['pointercancel', 'lostpointercapture'] as const)
      this.timeline.addEventListener(
        name,
        (event) => {
          if (event.pointerId === this.gesture?.id) this.cancelGesture();
        },
        options,
      );
    window.addEventListener('blur', () => this.cancelGesture(), options);
    this.app.addEventListener(
      'scroll',
      () => {
        this.previewKeyDrag();
        this.previewMarquee();
      },
      { ...options, capture: true },
    );
    for (const name of ['keydown', 'keyup'] as const)
      window.addEventListener(
        name,
        (event) => {
          const pointer = this.gesture;
          if (event.key !== 'Shift' || (pointer?.kind !== 'key-drag' && pointer?.kind !== 'event-drag')) return;
          pointer.shift = name === 'keydown';
          this.previewKeyDrag();
        },
        options,
      );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.cancelGesture();
        }
      },
      options,
    );
  }

  private get state(): AnimationEditorState {
    return this.getState();
  }

  /** State commands can cancel gestures before the DOM delivers its next pointer event. */
  synchronize(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    const invalid =
      !this.state.animationAuthoringEnabled ||
      (gesture.kind === 'marquee'
        ? gesture.state !== this.state ||
          gesture.animation !== this.state.workingAnimation ||
          gesture.tracks !== this.state.timelineTracks ||
          this.state.isPlaying
        : gesture.kind === 'key-drag'
          ? !this.state.keyframeDrag
          : gesture.kind === 'event-drag'
            ? !this.state.eventDrag
            : !this.state.isScrubbing);
    if (invalid) this.cancelGesture();
  }

  private updateGesture(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.id) return;
    if (gesture.kind === 'marquee') {
      this.updateMarquee(event);
      return;
    }
    if (Math.abs(event.clientX - gesture.startX) > 3) gesture.moved = true;
    if (gesture.kind === 'scrub') this.scrub(event.clientX);
    else {
      gesture.clientX = event.clientX;
      gesture.shift = event.shiftKey;
      if (gesture.moved) this.previewKeyDrag();
    }
  }

  private scrub(clientX: number): void {
    const bounds = this.timeline.getBoundingClientRect();
    this.state.setCurrentTime(timelineXToTime(clientX - bounds.left, this.state.duration, bounds.width));
  }

  beginKeyDrag(event: PointerEvent, key: KeyframeSelection | IKKeyframeSelection, marker: HTMLButtonElement): void {
    event.stopPropagation();
    if (event.button !== 0 || this.gesture) return;
    event.preventDefault();
    // Commit the previous inspector field before selection changes or a drag acquires state.
    marker.focus({ preventScroll: true });
    if ('kind' in key) {
      this.state.selectIKKeyframe(key);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.state.selectKeyframe(key, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey });
      return;
    }
    if (!this.state.beginKeyframeDrag(key)) return;
    const bounds = this.timeline.getBoundingClientRect();
    this.gesture = {
      kind: 'key-drag',
      id: event.pointerId,
      startX: event.clientX,
      clientX: event.clientX,
      offset: event.clientX - bounds.left - timeToTimelineX(key.time, this.state.duration, bounds.width),
      moved: false,
      shift: event.shiftKey,
    };
    this.timeline.setPointerCapture(event.pointerId);
  }

  beginEventDrag(event: PointerEvent, ref: AnimationEventRef, marker: HTMLButtonElement): void {
    event.stopPropagation();
    if (event.button !== 0 || this.gesture) return;
    event.preventDefault();
    // Blurring an inspector field can commit an edit and cancel gestures. Finish
    // that focus transition before acquiring the new event drag transaction.
    marker.focus({ preventScroll: true });
    if (!this.state.beginEventDrag(ref)) return;
    const bounds = this.timeline.getBoundingClientRect();
    this.gesture = {
      kind: 'event-drag',
      id: event.pointerId,
      startX: event.clientX,
      clientX: event.clientX,
      offset:
        event.clientX -
        bounds.left -
        timeToTimelineX(this.state.eventDrag!.originalTime, this.state.duration, bounds.width),
      moved: false,
      shift: event.shiftKey,
    };
    this.timeline.setPointerCapture(event.pointerId);
  }

  previewKeyDrag(): void {
    const pointer = this.gesture;
    if ((pointer?.kind !== 'key-drag' && pointer?.kind !== 'event-drag') || !pointer.moved) return;
    const bounds = this.timeline.getBoundingClientRect();
    this.state.setTimelineSnapContentWidth(bounds.width);
    const preview =
      pointer.kind === 'event-drag'
        ? this.state.previewEventDrag.bind(this.state)
        : this.state.previewKeyframeDrag.bind(this.state);
    preview(
      timelineXToTime(pointer.clientX - bounds.left - pointer.offset, this.state.duration, bounds.width),
      pointer.shift,
    );
  }

  private beginMarquee(event: PointerEvent): void {
    this.state.pause();
    this.state.endScrub();
    this.state.cancelTransformEdit();
    const bounds = this.timeline.getBoundingClientRect();
    const element = document.createElement('div');
    element.className = 'timeline-marquee';
    element.setAttribute('aria-hidden', 'true');
    this.timeline.append(element);
    this.gesture = {
      kind: 'marquee',
      id: event.pointerId,
      startTime: timelineXToTime(event.clientX - bounds.left, this.state.duration, bounds.width),
      startY: event.clientY - bounds.top,
      startX: event.clientX,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      additive: event.ctrlKey || event.metaKey,
      element,
      state: this.state,
      animation: this.state.workingAnimation,
      tracks: this.state.timelineTracks,
    };
    this.timeline.setPointerCapture(event.pointerId);
    this.previewMarquee();
  }

  private updateMarquee(event: PointerEvent): void {
    const box = this.gesture;
    if (box?.kind !== 'marquee') return;
    box.clientX = event.clientX;
    box.clientY = event.clientY;
    const bounds = this.timeline.getBoundingClientRect();
    if (Math.abs(event.clientX - box.startX) > 3 || Math.abs(event.clientY - bounds.top - box.startY) > 3)
      box.moved = true;
    this.previewMarquee();
  }

  /** Content-relative geometry follows scroll/resize; only the shared converter produces animation time. */
  previewMarquee(): void {
    const box = this.gesture;
    if (box?.kind !== 'marquee') return;
    const bounds = this.timeline.getBoundingClientRect();
    const startX = timeToTimelineX(box.startTime, this.state.duration, bounds.width);
    const endX = Math.max(0, Math.min(bounds.width, box.clientX - bounds.left));
    const endY = Math.max(0, Math.min(bounds.height, box.clientY - bounds.top));
    box.element.hidden = !box.moved;
    box.element.style.left = `${Math.min(startX, endX)}px`;
    box.element.style.top = `${Math.min(box.startY, endY)}px`;
    box.element.style.width = `${Math.abs(endX - startX)}px`;
    box.element.style.height = `${Math.abs(endY - box.startY)}px`;
  }

  private commitMarquee(box: MarqueeGesture): void {
    if (!box.moved) {
      if (!box.additive) {
        this.state.clearTimelineSelection();
        this.scrub(box.clientX);
      }
      return;
    }
    const bounds = this.timeline.getBoundingClientRect();
    const minY = Math.min(box.startY, box.clientY - bounds.top);
    const maxY = Math.max(box.startY, box.clientY - bounds.top);
    // Event lanes have their own height/identity and never participate in key marquee row indices.
    const rows = Array.from(
      this.timeline.querySelectorAll<HTMLElement>(
        '.timeline-track-lane:not(.timeline-event-track):not(.timeline-root-track)',
      ),
    );
    const included = rows.flatMap((row, index) => {
      const rect = row.getBoundingClientRect();
      if (rect.height === 0) return [];
      const center = rect.top - bounds.top + rect.height / 2;
      return center >= minY && center <= maxY ? [index] : [];
    });
    this.state.selectKeyframeMarquee(
      {
        startTime: box.startTime,
        endTime: timelineXToTime(box.clientX - bounds.left, this.state.duration, bounds.width),
        firstRow: included[0] ?? -1,
        lastRow: included.at(-1) ?? -1,
      },
      box.additive,
    );
  }

  /** Clear the gesture before releasing capture, since lostpointercapture may fire immediately. */
  private endGesture(commit: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    if (gesture.kind === 'marquee') gesture.element.remove();
    if (this.timeline.hasPointerCapture(gesture.id)) this.timeline.releasePointerCapture(gesture.id);
    switch (gesture.kind) {
      case 'scrub':
        this.state.endScrub();
        break;
      case 'key-drag':
        if (commit) this.state.commitKeyframeDrag();
        else this.state.cancelKeyframeDrag();
        break;
      case 'event-drag':
        if (commit) this.state.commitEventDrag();
        else this.state.cancelEventDrag();
        break;
      case 'marquee':
        if (commit) this.commitMarquee(gesture);
        break;
    }
  }

  cancelGesture(): void {
    this.endGesture(false);
    // State-only commands can begin/cancel a drag before a DOM pointer is acquired.
    this.state.cancelKeyframeDrag();
    this.state.cancelEventDrag();
    this.state.endScrub();
  }

  endScrub(): void {
    if (this.gesture?.kind === 'scrub') this.endGesture(false);
    else this.state.endScrub();
  }

  dispose(): void {
    this.cancelGesture();
    this.keyboard.dispose();
    this.abort.abort();
  }
}
