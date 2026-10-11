import { isTypingTarget } from '../../shared/keyboardShortcuts.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

interface KeyboardGestureActions {
  cancelGesture(): void;
  hasMarquee(): boolean;
}

/** Routes timeline shortcuts and ruler navigation while preserving native typing and pointer cancellation. */
export class TimelineKeyboardController {
  private readonly abort = new AbortController();

  constructor(
    private readonly app: HTMLElement,
    timeline: HTMLElement,
    private readonly getState: () => AnimationEditorState,
    scrubber: HTMLElement,
    private readonly gestures: KeyboardGestureActions,
  ) {
    const options = { signal: this.abort.signal };
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target) || !this.state.workingAnimation)
          return;
        if (event.target instanceof Element && event.target.closest('dialog')) return;
        if (event.key === 'Escape' && (this.state.keyframeDrag || this.state.eventDrag)) {
          event.preventDefault();
          this.gestures.cancelGesture();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (this.gestures.hasMarquee()) this.gestures.cancelGesture();
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
        if (this.nudgeSelection(event)) return;
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
            else if (this.state.selectedIKKeyframe) this.state.deleteSelectedIKKeyframe();
            else this.state.deleteSelectedKeyframes();
          }
          return;
        }
        if (
          (event.code !== 'Space' && event.key !== 'Home') ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          (event.code === 'Space' &&
            event.target instanceof Element &&
            event.target.closest('button, a[href], summary'))
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
    timeline.addEventListener(
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
        if (this.nudgeSelection(event)) return;
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
    scrubber.addEventListener(
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

  private nudgeSelection(event: KeyboardEvent): boolean {
    const state = this.state;
    if (
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
      (!state.selectedKeyframe && !state.selectedEvent && !state.selectedIKKeyframe) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return false;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    if (state.selectedEvent) state.nudgeSelectedEvent(direction, event.shiftKey);
    else if (state.selectedIKKeyframe) state.nudgeSelectedIKKeyframe(direction, event.shiftKey);
    else state.nudgeSelectedKeyframe(direction, event.shiftKey);
    return true;
  }

  dispose(): void {
    this.abort.abort();
  }
}
