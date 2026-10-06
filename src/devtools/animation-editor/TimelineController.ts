import { downloadJson } from '../../shared/downloadJson.js';
import { isTypingTarget } from '../../shared/keyboardShortcuts.js';
import { setAttribute, setText } from '../shared/domUpdates.js';
import { AnimationEditorState } from './AnimationEditorState.js';
import { generateRulerTicks, timelineXToTime, timeToTimelineX } from './timeline.js';
import type { KeyframeSelection } from './timelineTracks.js';
import { TimelineTracksController } from './TimelineTracksController.js';

/** DOM adapter only: width/pointer capture belong here, while time and animation data belong to state. */
export class TimelineController {
  private state = new AnimationEditorState();
  private unsubscribe: (() => void) | undefined;
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private readonly timeline: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly playhead: HTMLElement;
  private readonly selection: HTMLSelectElement;
  private readonly timeDisplay: HTMLElement;
  private readonly metadata: HTMLElement;
  private readonly status: HTMLElement;
  private readonly reset: HTMLButtonElement;
  private readonly playPause: HTMLButtonElement;
  private readonly loop: HTMLButtonElement;
  private readonly dirty: HTMLElement;
  private readonly speed: HTMLSelectElement;
  private readonly mode: HTMLSelectElement;
  private readonly fps: HTMLInputElement;
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly download: HTMLButtonElement;
  private readonly discard: HTMLButtonElement;
  private readonly exportFeedback: HTMLElement;
  private readonly deleteKey: HTMLButtonElement;
  private readonly previousKey: HTMLButtonElement;
  private readonly nextKey: HTMLButtonElement;
  private readonly snap: HTMLSelectElement;
  private readonly tracks: TimelineTracksController;
  private pointer: number | undefined;
  private keyPointer:
    | { id: number; startX: number; clientX: number; offset: number; moved: boolean; shift: boolean }
    | undefined;
  private pointerStartX = 0;
  private pointerMoved = false;
  private width = 0;
  private rulerKey = '';
  private externalError = '';
  private authoredFPS = '';
  private animation: AnimationEditorState['workingAnimation'] = null;

  constructor(private readonly app: HTMLElement) {
    this.timeline = this.element('#timeline');
    this.ruler = this.element('#timeline-ruler');
    this.playhead = this.element('#timeline-playhead');
    this.selection = this.element<HTMLSelectElement>('#animation-selection');
    this.timeDisplay = this.element('#current-time');
    this.metadata = this.element('#animation-metadata');
    this.status = this.element('#animation-status');
    this.reset = this.element<HTMLButtonElement>('#reset-time');
    this.playPause = this.element<HTMLButtonElement>('#play-pause');
    this.loop = this.element<HTMLButtonElement>('#preview-loop');
    this.dirty = this.element('#animation-dirty');
    this.speed = this.element<HTMLSelectElement>('#playback-speed');
    this.mode = this.element<HTMLSelectElement>('#animation-mode');
    this.fps = this.element<HTMLInputElement>('#animation-fps');
    this.undo = this.element<HTMLButtonElement>('#animation-undo');
    this.redo = this.element<HTMLButtonElement>('#animation-redo');
    this.download = this.element<HTMLButtonElement>('#animation-download');
    this.discard = this.element<HTMLButtonElement>('#animation-discard');
    this.exportFeedback = this.element('#animation-export-feedback');
    this.deleteKey = this.element<HTMLButtonElement>('#timeline-delete-key');
    this.previousKey = this.element<HTMLButtonElement>('#timeline-previous-key');
    this.nextKey = this.element<HTMLButtonElement>('#timeline-next-key');
    this.snap = this.element<HTMLSelectElement>('#timeline-snap');
    this.tracks = new TimelineTracksController(
      this.element('#timeline-track-labels'),
      this.element('#timeline-tracks'),
      (event, key, marker) => this.beginKeyDrag(event, key, marker),
    );
    const options = { signal: this.abort.signal };
    this.snap.addEventListener(
      'change',
      () => {
        if (this.snap.value === 'none' || this.snap.value === 'frame') this.state.setKeyframeSnapMode(this.snap.value);
      },
      options,
    );
    this.selection.addEventListener(
      'change',
      () => {
        this.endScrub();
        if (this.state.selectAnimation(this.selection.value || null)) setText(this.exportFeedback, '');
      },
      options,
    );
    this.reset.addEventListener('click', () => this.state.restart(), options);
    this.playPause.addEventListener('click', () => this.state.togglePlayback(), options);
    this.loop.addEventListener('click', () => this.state.setPreviewLoop(!this.state.previewLoop), options);
    this.speed.addEventListener('change', () => this.state.setPlaybackSpeed(Number(this.speed.value)), options);
    this.mode.addEventListener(
      'change',
      () => {
        const mode = this.mode.value;
        if (mode === 'smooth' || mode === 'stepped') this.state.setAuthoredPlaybackMode(mode);
      },
      options,
    );
    this.fps.addEventListener(
      'change',
      () => {
        this.state.setAuthoredFPS(this.fps.valueAsNumber);
        // Rejected input restores the held authored value; the status retains the validation error.
        this.fps.value = this.authoredFPS;
      },
      options,
    );
    this.undo.addEventListener('click', () => this.state.undo(), options);
    this.redo.addEventListener('click', () => this.state.redo(), options);
    this.download.addEventListener(
      'click',
      () => {
        try {
          const json = this.state.exportJson();
          const filename = `${this.state.selectedAnimationId!.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
          downloadJson(json, filename);
          this.state.markSaved();
          setText(this.exportFeedback, `Animation JSON download started: ${filename}`);
        } catch (error) {
          setText(this.exportFeedback, `Could not download animation: ${String(error)}`);
        }
      },
      options,
    );
    this.discard.addEventListener(
      'click',
      () => {
        if (!this.state.dirty || !window.confirm('Discard unsaved animation changes?')) return;
        this.endScrub();
        if (this.state.selectAnimation(this.state.selectedAnimationId, { discardChanges: true }))
          setText(this.exportFeedback, 'Changes discarded. The last saved animation was restored.');
      },
      options,
    );
    this.deleteKey.addEventListener('click', () => this.state.deleteSelectedKeyframe(), options);
    this.previousKey.addEventListener('click', () => this.state.selectAdjacentKeyframe(-1), options);
    this.nextKey.addEventListener('click', () => this.state.selectAdjacentKeyframe(1), options);
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
    this.width = this.timeline.getBoundingClientRect().width;
    this.resize = new ResizeObserver(() => {
      this.width = this.timeline.getBoundingClientRect().width;
      this.previewKeyDrag();
      this.render();
    });
    this.resize.observe(this.timeline);
    this.bind(this.state);
  }

  get hasUnsavedChanges(): boolean {
    return this.state.dirty;
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing animation editor element ${selector}.`);
    return element;
  }

  bind(state: AnimationEditorState, characterId?: string): void {
    this.endKeyDrag(false);
    this.state.pause();
    this.endScrub();
    this.unsubscribe?.();
    this.state = state;
    this.externalError = '';
    setText(this.exportFeedback, '');
    const empty = new Option('No animation selected', '');
    this.selection.replaceChildren(empty, ...state.animationIds.map((id) => new Option(id, id)));
    this.element('#character-status').textContent = characterId ? `Character: ${characterId}` : 'No character loaded.';
    this.unsubscribe = state.subscribe(() => this.render());
    this.render();
  }

  showError(message: string): void {
    this.externalError = message;
    this.render();
  }

  private scrub(clientX: number): void {
    const bounds = this.timeline.getBoundingClientRect();
    this.state.setCurrentTime(timelineXToTime(clientX - bounds.left, this.state.duration, bounds.width));
  }

  private beginKeyDrag(event: PointerEvent, key: KeyframeSelection, marker: HTMLButtonElement): void {
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

  private previewKeyDrag(): void {
    const pointer = this.keyPointer;
    if (!pointer?.moved) return;
    const bounds = this.timeline.getBoundingClientRect();
    this.state.previewKeyframeDrag(
      timelineXToTime(pointer.clientX - bounds.left - pointer.offset, this.state.duration, bounds.width),
      pointer.shift,
    );
  }

  private endKeyDrag(commit: boolean): void {
    const pointer = this.keyPointer;
    this.keyPointer = undefined;
    if (pointer && this.timeline.hasPointerCapture(pointer.id)) this.timeline.releasePointerCapture(pointer.id);
    if (commit) this.state.commitKeyframeDrag();
    else this.state.cancelKeyframeDrag();
  }

  private endScrub(): void {
    const pointer = this.pointer;
    this.pointer = undefined;
    if (pointer !== undefined && this.timeline.hasPointerCapture(pointer)) this.timeline.releasePointerCapture(pointer);
    this.state.endScrub();
  }

  private render(): void {
    const state = this.state;
    if (this.keyPointer && !state.keyframeDrag) this.endKeyDrag(false);
    if (this.pointer !== undefined && !state.isScrubbing) this.endScrub();
    const animation = state.workingAnimation;
    const authoredChanged = animation !== this.animation;
    this.animation = animation;
    const width = this.width;
    this.tracks.render(state, width);
    if (this.snap.value !== state.keyframeSnapMode) this.snap.value = state.keyframeSnapMode;
    this.snap.disabled = !animation;
    const rulerKey = `${state.duration}:${width}`;
    if (rulerKey !== this.rulerKey) {
      this.rulerKey = rulerKey;
      this.ruler.replaceChildren(
        ...generateRulerTicks(state.duration, width).map((tick) => {
          const element = document.createElement('span');
          element.className = `timeline-tick${tick.major ? ' major' : ''}${tick.time === state.duration ? ' end' : ''}`;
          element.style.left = `${timeToTimelineX(tick.time, state.duration, width)}px`;
          if (tick.label !== null) {
            const label = document.createElement('span');
            label.textContent = tick.label;
            element.append(label);
          }
          return element;
        }),
      );
    }
    this.playhead.style.left = `${timeToTimelineX(state.currentTime, state.duration, width)}px`;
    setAttribute(this.timeline, 'aria-valuemax', String(state.duration));
    setAttribute(this.timeline, 'aria-valuenow', String(state.currentTime));
    setAttribute(
      this.timeline,
      'aria-valuetext',
      `${state.currentTime.toFixed(3)} of ${state.duration.toFixed(3)} seconds`,
    );
    setAttribute(this.timeline, 'aria-disabled', String(!animation));
    const selectedId = state.selectedAnimationId ?? '';
    if (this.selection.value !== selectedId) this.selection.value = selectedId;
    const selectionDisabled = !state.animationIds.length;
    if (this.selection.disabled !== selectionDisabled) this.selection.disabled = selectionDisabled;
    if (this.reset.disabled !== !animation) this.reset.disabled = !animation;
    const playDisabled = !animation || !(state.duration > 0);
    if (this.playPause.disabled !== playDisabled) this.playPause.disabled = playDisabled;
    setText(this.playPause, state.isPlaying ? 'Pause' : 'Play');
    if (this.loop.disabled !== !animation) this.loop.disabled = !animation;
    setAttribute(this.loop, 'aria-pressed', String(state.previewLoop));
    setText(this.timeDisplay, `${state.currentTime.toFixed(3)} / ${state.duration.toFixed(3)} s`);
    const playback = animation?.playback;
    const speed = String(state.playbackSpeed);
    if (this.speed.value !== speed) this.speed.value = speed;
    if (this.speed.disabled !== !animation) this.speed.disabled = !animation;
    const mode = playback?.mode ?? 'smooth';
    if (this.mode.value !== mode) this.mode.value = mode;
    if (this.mode.disabled !== !animation) this.mode.disabled = !animation;
    const fps = playback?.mode === 'stepped' ? String(playback.fps) : '';
    // Leave an uncommitted numeric edit alone while playback notifications refresh the other controls.
    if ((authoredChanged || fps !== this.authoredFPS || document.activeElement !== this.fps) && this.fps.value !== fps)
      this.fps.value = fps;
    this.authoredFPS = fps;
    const fpsDisabled = !animation || mode !== 'stepped';
    if (this.fps.disabled !== fpsDisabled) this.fps.disabled = fpsDisabled;
    if (this.undo.disabled !== !state.canUndo) this.undo.disabled = !state.canUndo;
    if (this.redo.disabled !== !state.canRedo) this.redo.disabled = !state.canRedo;
    if (this.download.disabled !== !animation) this.download.disabled = !animation;
    if (this.discard.disabled !== !state.dirty) this.discard.disabled = !state.dirty;
    const deleteDisabled = !state.selectedKeyframe;
    const previousDisabled = !state.getAdjacentKeyframe(-1);
    const nextDisabled = !state.getAdjacentKeyframe(1);
    if (this.deleteKey.disabled !== deleteDisabled) this.deleteKey.disabled = deleteDisabled;
    if (this.previousKey.disabled !== previousDisabled) this.previousKey.disabled = previousDisabled;
    if (this.nextKey.disabled !== nextDisabled) this.nextKey.disabled = nextDisabled;
    setText(
      this.metadata,
      animation
        ? `Mode: ${mode} · FPS: ${playback?.mode === 'stepped' ? playback.fps : 'continuous'} · Authored loop: ${state.loop ? 'on' : 'off'} · Playback: ${state.previewLoop ? 'loop' : 'once'} · Speed: ${speed}× · ${state.isScrubbing ? 'Scrubbing' : state.isPlaying ? 'Playing' : 'Paused'}`
        : 'Select an animation to preview its pose.',
    );
    setText(this.dirty, state.dirty ? 'Unsaved changes' : 'No unsaved changes');
    setText(
      this.status,
      this.externalError ||
        (state.validationIssues.length
          ? state.validationIssues.map((issue) => `${issue.path ?? 'animation'}: ${issue.message}`).join('\n')
          : animation
            ? 'Validation: OK'
            : !state.rig
              ? 'Load a character to begin.'
              : !state.animationIds.length
                ? 'This character has no animations.'
                : 'No animation selected.'),
    );
  }

  dispose(): void {
    this.endKeyDrag(false);
    this.state.pause();
    this.endScrub();
    this.abort.abort();
    this.resize.disconnect();
    this.unsubscribe?.();
    this.tracks.dispose();
  }
}
