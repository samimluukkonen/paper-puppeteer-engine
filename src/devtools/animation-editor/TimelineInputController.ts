import { isTypingTarget } from '../../shared/keyboardShortcuts.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { timelineXToTime, timeToTimelineX } from './timeline.js';
import type { KeyframeSelection } from './timelineTracks.js';

/** Owns keyboard shortcuts, pointer capture, and gesture cancellation for the current session. */
export class TimelineInputController {
  private readonly abort = new AbortController();
  private pointer: number | undefined;
  private keyPointer:
    | { id: number; startX: number; clientX: number; offset: number; moved: boolean; shift: boolean }
    | undefined;
  private pointerStartX = 0;
  private pointerMoved = false;

  constructor(
    private readonly app: HTMLElement,
    private readonly timeline: HTMLElement,
    private readonly getState: () => AnimationEditorState,
  ) {
    const options = { signal: this.abort.signal };
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target) || !this.state.workingAnimation)
          return;
        if (event.key === 'Escape' && this.state.keyframeDrag) {
          event.preventDefault();
          this.endKeyDrag(false);
          return;
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
          this.state.selectedKeyframe &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          this.state.nudgeSelectedKeyframe(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
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
          if (!event.repeat) this.state.deleteSelectedKeyframe();
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
        if (event.button !== 0 || this.pointer !== undefined || this.keyPointer || !this.state.workingAnimation) return;
        event.preventDefault();
        this.timeline.focus({ preventScroll: true });
        this.pointer = event.pointerId;
        this.pointerStartX = event.clientX;
        this.pointerMoved = false;
        this.timeline.setPointerCapture(event.pointerId);
        this.state.beginScrub();
        this.scrub(event.clientX);
      },
      options,
    );
    this.timeline.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerId === this.keyPointer?.id) {
          this.keyPointer.clientX = event.clientX;
          this.keyPointer.shift = event.shiftKey;
          if (Math.abs(event.clientX - this.keyPointer.startX) > 3) this.keyPointer.moved = true;
          if (this.keyPointer.moved) this.previewKeyDrag();
          return;
        }
        if (event.pointerId === this.pointer) {
          if (Math.abs(event.clientX - this.pointerStartX) > 3) this.pointerMoved = true;
          this.scrub(event.clientX);
        }
      },
      options,
    );
    this.timeline.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerId === this.keyPointer?.id) {
          this.keyPointer.clientX = event.clientX;
          this.keyPointer.shift = event.shiftKey;
          if (Math.abs(event.clientX - this.keyPointer.startX) > 3) this.keyPointer.moved = true;
          if (this.keyPointer.moved) this.previewKeyDrag();
          this.endKeyDrag(this.keyPointer?.moved ?? false);
          return;
        }
        if (event.pointerId !== this.pointer) return;
        this.scrub(event.clientX);
        if (!this.pointerMoved && Math.abs(event.clientX - this.pointerStartX) <= 3)
          this.state.clearKeyframeSelection();
        this.endScrub();
      },
      options,
    );
    for (const name of ['pointercancel', 'lostpointercapture'] as const)
      this.timeline.addEventListener(
        name,
        (event) => {
          if (event.pointerId === this.keyPointer?.id) this.endKeyDrag(false);
          if (event.pointerId === this.pointer) this.endScrub();
        },
        options,
      );
    window.addEventListener(
      'blur',
      () => {
        this.endKeyDrag(false);
        this.endScrub();
      },
      options,
    );
    this.app.addEventListener('scroll', () => this.previewKeyDrag(), { ...options, capture: true });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.endKeyDrag(false);
          this.endScrub();
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
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && this.state.selectedKeyframe) {
          event.preventDefault();
          this.state.nudgeSelectedKeyframe(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
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
  }

  private get state(): AnimationEditorState {
    return this.getState();
  }

  /** State commands can cancel gestures before the DOM delivers its next pointer event. */
  synchronize(): void {
    if (this.keyPointer && !this.state.keyframeDrag) this.endKeyDrag(false);
    if (this.pointer !== undefined && !this.state.isScrubbing) this.endScrub();
  }

  private scrub(clientX: number): void {
    const bounds = this.timeline.getBoundingClientRect();
    this.state.setCurrentTime(timelineXToTime(clientX - bounds.left, this.state.duration, bounds.width));
  }

  beginKeyDrag(event: PointerEvent, key: KeyframeSelection, marker: HTMLButtonElement): void {
    event.stopPropagation();
    if (event.button !== 0 || this.pointer !== undefined || this.keyPointer) return;
    event.preventDefault();
    if (!this.state.beginKeyframeDrag(key)) return;
    marker.focus({ preventScroll: true });
    const bounds = this.timeline.getBoundingClientRect();
    this.keyPointer = {
      id: event.pointerId,
      startX: event.clientX,
      clientX: event.clientX,
      offset: event.clientX - bounds.left - timeToTimelineX(key.time, this.state.duration, bounds.width),
      moved: false,
      shift: event.shiftKey,
    };
    this.timeline.setPointerCapture(event.pointerId);
  }

  previewKeyDrag(): void {
    const pointer = this.keyPointer;
    if (!pointer?.moved) return;
    const bounds = this.timeline.getBoundingClientRect();
    this.state.previewKeyframeDrag(
      timelineXToTime(pointer.clientX - bounds.left - pointer.offset, this.state.duration, bounds.width),
      pointer.shift,
    );
  }

  endKeyDrag(commit: boolean): void {
    const pointer = this.keyPointer;
    this.keyPointer = undefined;
    if (pointer && this.timeline.hasPointerCapture(pointer.id)) this.timeline.releasePointerCapture(pointer.id);
    if (commit) this.state.commitKeyframeDrag();
    else this.state.cancelKeyframeDrag();
  }

  endScrub(): void {
    const pointer = this.pointer;
    this.pointer = undefined;
    if (pointer !== undefined && this.timeline.hasPointerCapture(pointer)) this.timeline.releasePointerCapture(pointer);
    this.state.endScrub();
  }

  dispose(): void {
    this.endKeyDrag(false);
    this.endScrub();
    this.abort.abort();
  }
}
