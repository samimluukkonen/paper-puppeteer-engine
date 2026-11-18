import { blocksEditorShortcut, historyShortcut, isTypingTarget } from '../../shared/keyboardShortcuts.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { TimelineNavigationActions } from './TimelineInputController.js';

interface KeyboardGestureActions {
  cancelGesture(): void;
  hasMarquee(): boolean;
  navigation?: TimelineNavigationActions | undefined;
  revealSelection?: (() => void) | undefined;
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
        if (!this.state.animationAuthoringEnabled || blocksEditorShortcut(event) || !this.state.workingAnimation)
          return;
        // Body/canvas focus supports playback; controls outside this editor own their shortcuts.
        if (event.target instanceof Element && !this.app.contains(event.target) && event.target.tagName !== 'BODY')
          return;
        if (event.key === 'Escape' && (this.state.keyframes.keyframeDrag || this.state.events.eventDrag)) {
          event.preventDefault();
          this.gestures.cancelGesture();
          return;
        }
        if (event.key === 'Escape') {
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            (event.target instanceof Element && event.target.closest('[data-tool-panel]'))
          )
            return;
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
        const history = historyShortcut(event);
        if (history) {
          event.preventDefault();
          if (!event.repeat) {
            if (history === 'redo') this.state.redo();
            else this.state.undo();
          }
          return;
        }
        if (
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.target instanceof Element &&
          this.app.contains(event.target) &&
          event.target.closest('.timeline-panel')
        ) {
          const navigation = this.gestures.navigation;
          const command = event.key.toLowerCase();
          const action =
            command === '+' || command === '='
              ? () => navigation?.zoomBy(2)
              : command === '-'
                ? () => navigation?.zoomBy(0.5)
                : command === 'f' && !event.shiftKey
                  ? () => navigation?.fitAnimation()
                  : command === '['
                    ? () => {
                        this.state.selectAdjacentKeyframe(-1);
                      }
                    : command === ']'
                      ? () => {
                          this.state.selectAdjacentKeyframe(1);
                        }
                      : undefined;
          if (action && (navigation || command === '[' || command === ']')) {
            event.preventDefault();
            if (!event.repeat) {
              action();
              if (command === '[' || command === ']') {
                navigation?.centerPlayhead();
                this.gestures.revealSelection?.();
              }
            }
            return;
          }
        }
        if (event.key === 'End' && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          if (!event.repeat) {
            this.state.setCurrentTime(this.state.duration);
            this.gestures.navigation?.centerPlayhead();
          }
          return;
        }
        // Tool popovers own their navigation and dismissal, without nudging/deleting background keys.
        const inToolPanel = event.target instanceof Element && !!event.target.closest('[data-tool-panel]');
        if (!inToolPanel && this.nudgeSelection(event)) return;
        if (
          (event.key === 'Delete' || event.key === 'Backspace') &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !inToolPanel
        ) {
          // Prevent native Backspace navigation even when there is no selected key.
          event.preventDefault();
          if (!event.repeat) {
            this.state.deleteTimelineSelection();
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
          if (event.key === 'Home') {
            this.state.restart();
            this.gestures.navigation?.centerPlayhead();
          } else this.state.togglePlayback();
        }
      },
      options,
    );
    timeline.addEventListener(
      'keydown',
      (event) => {
        if (
          !this.state.animationAuthoringEnabled ||
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
        if (event.key === 'Home' || event.key === 'End') this.gestures.navigation?.centerPlayhead();
      },
      options,
    );
    scrubber.addEventListener(
      'keydown',
      (event) => {
        if (
          !this.state.animationAuthoringEnabled ||
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
        if (event.key === 'Home' || event.key === 'End') this.gestures.navigation?.centerPlayhead();
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
      (!state.selectedKeyframe &&
        !state.selectedEvent &&
        !state.ik.selectedIKKeyframe &&
        !state.rootMotion.selectedRootKey &&
        !state.deformation.selectedDeformationKey) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return false;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    if (state.selectedEvent) state.events.nudgeSelectedEvent(direction, event.shiftKey);
    else if (state.ik.selectedIKKeyframe) state.ik.nudgeSelectedIKKeyframe(direction, event.shiftKey);
    else state.nudgeSelectedKeyframe(direction, event.shiftKey);
    return true;
  }

  dispose(): void {
    this.abort.abort();
  }
}
