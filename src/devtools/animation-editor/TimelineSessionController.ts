import { setAttribute, setText } from '../../shared/domUpdates.js';
import { downloadJson } from '../../shared/downloadJson.js';
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
  private readonly copyJson: HTMLButtonElement;
  private readonly logJson: HTMLButtonElement;
  private readonly discard: HTMLButtonElement;
  private readonly exportFeedback: HTMLElement;
  private readonly importPanel: HTMLElement;
  private readonly importText: HTMLTextAreaElement;
  private readonly importFile: HTMLInputElement;
  private readonly importFeedback: HTMLElement;
  private readonly reloadExport: HTMLButtonElement;
  private readonly deleteKey: HTMLButtonElement;
  private readonly copyKeys: HTMLButtonElement;
  private readonly pasteKeys: HTMLButtonElement;
  private readonly duplicateKeys: HTMLButtonElement;
  private readonly previousKey: HTMLButtonElement;
  private readonly nextKey: HTMLButtonElement;
  private readonly snap: HTMLSelectElement;
  private externalError = '';
  private authoredFPS = '';
  private animation: AnimationEditorState['workingAnimation'] = null;
  private exportSequence = 0;
  private committedExportSequence = 0;
  private sessionGeneration = 0;
  private importSequence = 0;
  private animationIdsKey = '';

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
    this.copyJson = this.element<HTMLButtonElement>('#animation-copy-json');
    this.logJson = this.element<HTMLButtonElement>('#animation-log-json');
    this.discard = this.element<HTMLButtonElement>('#animation-discard');
    this.exportFeedback = this.element('#animation-export-feedback');
    this.importPanel = this.element('#animation-import-panel');
    this.importText = this.element<HTMLTextAreaElement>('#animation-import-text');
    this.importFile = this.element<HTMLInputElement>('#animation-import-file');
    this.importFeedback = this.element('#animation-import-feedback');
    this.reloadExport = this.element<HTMLButtonElement>('#animation-reload-export');
    this.deleteKey = this.element<HTMLButtonElement>('#timeline-delete-key');
    this.copyKeys = this.element<HTMLButtonElement>('#timeline-copy-keys');
    this.pasteKeys = this.element<HTMLButtonElement>('#timeline-paste-keys');
    this.duplicateKeys = this.element<HTMLButtonElement>('#timeline-duplicate-keys');
    this.previousKey = this.element<HTMLButtonElement>('#timeline-previous-key');
    this.nextKey = this.element<HTMLButtonElement>('#timeline-next-key');
    this.snap = this.element<HTMLSelectElement>('#timeline-snap');
    const options = { signal: this.abort.signal };
    // Invalid inspector drafts can add errors on blur and move these buttons between down/up.
    // Hold focus until the replacement clears those drafts so the native click stays on its target.
    this.reloadExport.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button === 0) event.preventDefault();
      },
      options,
    );
    this.element('#animation-import-paste').addEventListener(
      'click',
      () => {
        this.importPanel.hidden = false;
        this.importText.focus();
      },
      options,
    );
    this.element('#animation-import-cancel').addEventListener(
      'click',
      () => {
        ++this.importSequence;
        this.importPanel.hidden = true;
        this.importText.value = '';
        setText(this.importFeedback, '');
      },
      options,
    );
    this.element('#animation-import-submit').addEventListener(
      'click',
      () => {
        ++this.importSequence;
        this.finishImport(this.state.importJson(this.importText.value));
      },
      options,
    );
    this.importFile.addEventListener(
      'change',
      () => {
        void this.importLocalFile();
      },
      options,
    );
    this.reloadExport.addEventListener(
      'click',
      () => {
        ++this.importSequence;
        this.finishImport(this.state.reloadCurrentExport());
      },
      options,
    );
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
        if (this.state.selectAnimation(this.selection.value || null)) {
          ++this.sessionGeneration;
          setText(this.exportFeedback, '');
        }
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
        void this.exportTo('download');
      },
      options,
    );
    this.copyJson.addEventListener(
      'click',
      () => {
        void this.exportTo('clipboard');
      },
      options,
    );
    this.logJson.addEventListener(
      'click',
      () => {
        void this.exportTo('console');
      },
      options,
    );
    this.discard.addEventListener(
      'click',
      () => {
        if (!this.state.dirty || !window.confirm('Discard unsaved animation changes?')) return;
        this.input.endScrub();
        if (this.state.selectAnimation(this.state.selectedAnimationId, { discardChanges: true })) {
          ++this.sessionGeneration;
          setText(this.exportFeedback, 'Changes discarded. The last saved animation was restored.');
        }
      },
      options,
    );
    this.deleteKey.addEventListener('click', () => this.state.deleteSelectedKeyframes(), options);
    this.copyKeys.addEventListener('click', () => this.state.copyTimelineSelection(), options);
    this.pasteKeys.addEventListener('click', () => this.state.pasteTimelineClipboard(), options);
    this.duplicateKeys.addEventListener('click', () => this.state.duplicateTimelineSelection(), options);
    this.previousKey.addEventListener('click', () => this.state.selectAdjacentKeyframe(-1), options);
    this.nextKey.addEventListener('click', () => this.state.selectAdjacentKeyframe(1), options);
  }

  private get state(): AnimationEditorState {
    return this.getState();
  }

  private finishImport(imported: boolean): void {
    if (!imported) {
      setText(
        this.importFeedback,
        this.state.validationIssues.map((issue) => `${issue.path ?? 'animation'}: ${issue.message}`).join('\n'),
      );
      return;
    }
    ++this.sessionGeneration;
    this.importPanel.hidden = true;
    this.importText.value = '';
    this.externalError = '';
    setText(this.exportFeedback, '');
    setText(
      this.importFeedback,
      `Imported "${this.state.selectedAnimationId}". Clean session; playback paused at zero.`,
    );
    this.render();
  }

  private async importLocalFile(): Promise<void> {
    const file = this.importFile.files?.[0];
    this.importFile.value = '';
    if (!file) return;
    const state = this.state;
    const animation = state.workingAnimation;
    const generation = this.sessionGeneration;
    const sequence = ++this.importSequence;
    const isCurrent = (): boolean =>
      !this.abort.signal.aborted &&
      this.state === state &&
      this.sessionGeneration === generation &&
      this.importSequence === sequence;
    try {
      const json = await file.text();
      if (!isCurrent()) return;
      if (state.workingAnimation !== animation) {
        setText(this.importFeedback, 'Animation changed while reading the file. Choose the file again to import.');
        return;
      }
      this.finishImport(state.importJson(json));
    } catch (error) {
      if (isCurrent())
        setText(
          this.importFeedback,
          `Could not read animation file: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }

  private async exportTo(destination: 'download' | 'clipboard' | 'console'): Promise<void> {
    const state = this.state;
    const id = state.selectedAnimationId;
    const source = state.sourceAnimation;
    const generation = this.sessionGeneration;
    const sequence = ++this.exportSequence;
    const isCurrent = (): boolean =>
      !this.abort.signal.aborted &&
      this.state === state &&
      state.selectedAnimationId === id &&
      state.sourceAnimation === source &&
      generation === this.sessionGeneration;
    try {
      const result = state.exportAnimation();
      if (!result.success)
        throw new Error(result.issues.map((issue) => `${issue.path ?? 'animation'}: ${issue.message}`).join('\n'));
      const snapshot = state.workingAnimation;
      const filename = state.selectedAnimationFilename ?? 'animation.json';
      let message: string;
      if (destination === 'clipboard') {
        if (!navigator.clipboard?.writeText)
          throw new Error('Clipboard API is unavailable. Use Download animation.json or Log Animation JSON.');
        try {
          await navigator.clipboard.writeText(result.json);
        } catch (error) {
          throw new Error('Clipboard access failed. Use Download animation.json or Log Animation JSON.', {
            cause: error,
          });
        }
        message = 'Animation JSON copied.';
      } else if (destination === 'download') {
        downloadJson(result.json, filename);
        message = `Animation JSON download started: ${filename}`;
      } else {
        console.log(result.json);
        message = 'Animation JSON logged to the console.';
      }
      if (!isCurrent() || sequence < this.committedExportSequence) return;
      this.committedExportSequence = sequence;
      // Clipboard writes can finish after further edits: save only the exported snapshot.
      state.markSaved(snapshot);
      if (sequence === this.exportSequence) setText(this.exportFeedback, message);
    } catch (error) {
      if (isCurrent() && sequence === this.exportSequence)
        setText(
          this.exportFeedback,
          `Could not export animation: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing animation editor element ${selector}.`);
    return element;
  }

  bind(characterId?: string): void {
    ++this.sessionGeneration;
    const state = this.state;
    this.externalError = '';
    setText(this.exportFeedback, '');
    setText(this.importFeedback, '');
    this.importPanel.hidden = true;
    this.importText.value = '';
    this.updateAnimationOptions(state);
    this.element('#character-status').textContent = characterId ? `Character: ${characterId}` : 'No character loaded.';
  }

  private updateAnimationOptions(state: AnimationEditorState): void {
    const ids = state.animationIds;
    const key = JSON.stringify(ids);
    if (key === this.animationIdsKey) return;
    this.animationIdsKey = key;
    this.selection.replaceChildren(new Option('No animation selected', ''), ...ids.map((id) => new Option(id, id)));
  }

  showError(message: string): void {
    this.externalError = message;
    this.render();
  }

  render(): void {
    const state = this.state;
    this.updateAnimationOptions(state);
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
    if (this.copyJson.disabled !== !animation) this.copyJson.disabled = !animation;
    if (this.logJson.disabled !== !animation) this.logJson.disabled = !animation;
    this.reloadExport.disabled = !animation;
    this.importFile.disabled = !state.rig;
    this.element<HTMLButtonElement>('#animation-import-paste').disabled = !state.rig;
    if (this.discard.disabled !== !state.dirty) this.discard.disabled = !state.dirty;
    const deleteDisabled = state.selectedKeys.length === 0;
    const previousDisabled = !state.getAdjacentKeyframe(-1);
    const nextDisabled = !state.getAdjacentKeyframe(1);
    if (this.deleteKey.disabled !== deleteDisabled) this.deleteKey.disabled = deleteDisabled;
    const copyDisabled = deleteDisabled && !state.selectedEvent;
    if (this.copyKeys.disabled !== copyDisabled) this.copyKeys.disabled = copyDisabled;
    if (this.duplicateKeys.disabled !== copyDisabled) this.duplicateKeys.disabled = copyDisabled;
    setText(this.copyKeys, state.selectedEvent ? 'Copy Event' : 'Copy Keys');
    setText(this.duplicateKeys, state.selectedEvent ? 'Duplicate Event' : 'Duplicate Keys');
    setText(this.pasteKeys, state.timelineClipboard?.kind === 'event' ? 'Paste Event' : 'Paste Keys');
    const pasteDisabled = !animation || !state.timelineClipboard;
    if (this.pasteKeys.disabled !== pasteDisabled) this.pasteKeys.disabled = pasteDisabled;
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
