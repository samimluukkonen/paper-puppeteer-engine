import { downloadJson } from '../../shared/downloadJson.js';
import { setAttribute, setText } from '../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { TimelineInputController } from './TimelineInputController.js';

/** Settings, animation selection, history, export actions, and session status. */
export class TimelineSessionController {
  private readonly abort = new AbortController();
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
  private externalError = '';
  private authoredFPS = '';
  private animation: AnimationEditorState['workingAnimation'] = null;

  constructor(
    private readonly app: HTMLElement,
    private readonly getState: () => AnimationEditorState,
    private readonly input: Pick<TimelineInputController, 'endScrub'>,
  ) {
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
        this.input.endScrub();
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
        this.input.endScrub();
        if (this.state.selectAnimation(this.state.selectedAnimationId, { discardChanges: true }))
          setText(this.exportFeedback, 'Changes discarded. The last saved animation was restored.');
      },
      options,
    );
    this.deleteKey.addEventListener('click', () => this.state.deleteSelectedKeyframe(), options);
    this.previousKey.addEventListener('click', () => this.state.selectAdjacentKeyframe(-1), options);
    this.nextKey.addEventListener('click', () => this.state.selectAdjacentKeyframe(1), options);
  }

  private get state(): AnimationEditorState {
    return this.getState();
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing animation editor element ${selector}.`);
    return element;
  }

  bind(characterId?: string): void {
    const state = this.state;
    this.externalError = '';
    setText(this.exportFeedback, '');
    const empty = new Option('No animation selected', '');
    this.selection.replaceChildren(empty, ...state.animationIds.map((id) => new Option(id, id)));
    this.element('#character-status').textContent = characterId ? `Character: ${characterId}` : 'No character loaded.';
  }

  showError(message: string): void {
    this.externalError = message;
    this.render();
  }

  render(): void {
    const state = this.state;
    const animation = state.workingAnimation;
    const authoredChanged = animation !== this.animation;
    this.animation = animation;
    if (this.snap.value !== state.keyframeSnapMode) this.snap.value = state.keyframeSnapMode;
    this.snap.disabled = !animation;
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
    this.abort.abort();
  }
}
