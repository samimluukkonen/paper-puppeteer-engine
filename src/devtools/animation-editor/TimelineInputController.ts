import { isTypingTarget } from '../../shared/keyboardShortcuts.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { AnimationEventRef } from './animationEvents.js';
import { timelineXToTime, timeToTimelineX } from './timeline.js';
import type { KeyframeSelection } from './timelineTracks.js';

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

/** Owns shortcuts and one exclusive pointer gesture with a shared capture/cancellation lifecycle. */
export class TimelineInputController {
  private readonly abort = new AbortController();
  private gesture: TimelineGesture | undefined;

  constructor(
    private readonly app: HTMLElement,
    private readonly timeline: HTMLElement,
    private readonly getState: () => AnimationEditorState,
    private readonly scrubber: HTMLElement,
  ) {
    const options = { signal: this.abort.signal };
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target) || !this.state.workingAnimation)
          return;
        if (event.key === 'Escape' && (this.state.keyframeDrag || this.state.eventDrag)) {
          event.preventDefault();
          this.cancelGesture();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (this.gesture?.kind === 'marquee') this.cancelGesture();
          else this.state.clearTimelineSelection();
          return;
        }
        // Clipboard shortcuts belong to the timeline panel; native editing/bookmarks win elsewhere.
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.target instanceof Element &&
          this.app.contains(event.target) &&
          event.target.closest('.timeline-panel')
        ) {
          const command = event.key.toLowerCase();
          if (command === 'c' || command === 'v' || command === 'd') {
            event.preventDefault();
            if (!event.repeat) {
              if (command === 'c') this.state.copyTimelineSelection();
              else if (command === 'v') this.state.pasteTimelineClipboard();
              else this.state.duplicateTimelineSelection();
            }
            return;
          }
        }
        // Match the Rig Editor shortcuts while leaving native text-field undo intact.
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (!event.repeat) {
            if (event.shiftKey) this.state.redo();
            else this.state.undo();
          }
          return;
        }
        if (
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          (this.state.selectedKeyframe || this.state.selectedEvent) &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          if (this.state.selectedEvent)
            this.state.nudgeSelectedEvent(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
          else this.state.nudgeSelectedKeyframe(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
          return;
        }
        if (
          (event.key === 'Delete' || event.key === 'Backspace') &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          // Prevent native Backspace navigation even when there is no selected key.
          event.preventDefault();
          if (!event.repeat) {
            if (this.state.selectedEvent) this.state.deleteSelectedEvent();
            else this.state.deleteSelectedKeyframes();
          }
          return;
        }
        if (
          (event.code !== 'Space' && event.key !== 'Home') ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          (event.code === 'Space' && event.target instanceof Element && event.target.closest('button, a[href]'))
        )
          return;
        event.preventDefault();
        if (!event.repeat) {
          if (event.key === 'Home') this.state.restart();
          else this.state.togglePlayback();
        }
      },
      options,
    );
    this.timeline.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || this.gesture || !this.state.workingAnimation) return;
        event.preventDefault();
        if (
          event.target instanceof Element &&
          event.target.closest('.timeline-track-lane:not(.timeline-event-track)')
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
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.cancelGesture();
        }
      },
      options,
    );
    this.timeline.addEventListener(
      'keydown',
      (event) => {
        if (
          !this.state.workingAnimation ||
          event.defaultPrevented ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          isTypingTarget(event.target)
        )
          return;
        // Handle selected-key arrows before this bubbling event reaches the global shortcuts.
        if (
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          (this.state.selectedKeyframe || this.state.selectedEvent)
        ) {
          event.preventDefault();
          if (this.state.selectedEvent)
            this.state.nudgeSelectedEvent(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
          else this.state.nudgeSelectedKeyframe(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
          return;
        }
        const step = event.shiftKey ? 0.1 : 0.01;
        const time =
          event.key === 'End'
            ? this.state.duration
            : event.key === 'ArrowLeft'
              ? this.state.currentTime - step
              : event.key === 'ArrowRight'
                ? this.state.currentTime + step
                : undefined;
        if (time === undefined) return;
        event.preventDefault();
        this.state.setCurrentTime(time);
      },
      options,
    );
    this.scrubber.addEventListener(
      'keydown',
      (event) => {
        if (
          !this.state.workingAnimation ||
          event.defaultPrevented ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const step = event.shiftKey ? 0.1 : 0.01;
        const time =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? this.state.duration
              : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                ? this.state.currentTime - step
                : event.key === 'ArrowRight' || event.key === 'ArrowUp'
                  ? this.state.currentTime + step
                  : undefined;
        if (time === undefined) return;
        // Consume slider navigation before track/global shortcuts can move authored keys.
        event.preventDefault();
        this.state.setCurrentTime(time);
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
      gesture.kind === 'marquee'
        ? gesture.state !== this.state ||
          gesture.animation !== this.state.workingAnimation ||
          gesture.tracks !== this.state.timelineTracks ||
          this.state.isPlaying
        : gesture.kind === 'key-drag'
          ? !this.state.keyframeDrag
          : gesture.kind === 'event-drag'
            ? !this.state.eventDrag
            : !this.state.isScrubbing;
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

  beginKeyDrag(event: PointerEvent, key: KeyframeSelection, marker: HTMLButtonElement): void {
    event.stopPropagation();
    if (event.button !== 0 || this.gesture) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.state.selectKeyframe(key, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey });
      marker.focus({ preventScroll: true });
      return;
    }
    if (!this.state.beginKeyframeDrag(key)) return;
    marker.focus({ preventScroll: true });
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
      this.timeline.querySelectorAll<HTMLElement>('.timeline-track-lane:not(.timeline-event-track)'),
    );
    const included = rows.flatMap((row, index) => {
      const rect = row.getBoundingClientRect();
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
    this.abort.abort();
  }
}
