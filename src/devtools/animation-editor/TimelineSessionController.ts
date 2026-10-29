import { setAttribute, setText } from '../../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { AnimationFileController } from './AnimationFileController.js';
import { retimeSelectionReason, setCommandAvailability } from './commandAvailability.js';
import type { TimelineInputController } from './TimelineInputController.js';
import type { TimelineSnapSettings } from './timelineSnapping.js';

/** Settings, animation selection, history and session status; file controls have their own lifetime. */
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
  private readonly discard: HTMLButtonElement;
  private readonly sessionStatus: HTMLElement;
  private readonly deleteKey: HTMLButtonElement;
  private readonly copyKeys: HTMLButtonElement;
  private readonly pasteKeys: HTMLButtonElement;
  private readonly duplicateKeys: HTMLButtonElement;
  private readonly previousKey: HTMLButtonElement;
  private readonly nextKey: HTMLButtonElement;
  private readonly snap: readonly { setting: keyof TimelineSnapSettings; input: HTMLInputElement }[];
  private externalError = '';
  private authoredFPS = '';
  private animation: AnimationEditorState['workingAnimation'] = null;
  private readonly files: AnimationFileController;
  private animationIds: readonly string[] | undefined;
  private animationOptions: readonly { id: string; element: HTMLOptionElement }[] = [];
  private renderedControls: readonly unknown[] | undefined;

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
    this.discard = this.element<HTMLButtonElement>('#animation-discard');
    this.sessionStatus = this.element('#animation-session-status');
    this.deleteKey = this.element<HTMLButtonElement>('#timeline-delete-key');
    this.copyKeys = this.element<HTMLButtonElement>('#timeline-copy-keys');
    this.pasteKeys = this.element<HTMLButtonElement>('#timeline-paste-keys');
    this.duplicateKeys = this.element<HTMLButtonElement>('#timeline-duplicate-keys');
    this.previousKey = this.element<HTMLButtonElement>('#timeline-previous-key');
    this.nextKey = this.element<HTMLButtonElement>('#timeline-next-key');
    this.snap = (['enabled', 'frames', 'keyframes', 'events', 'playhead'] as const).map((setting) => ({
      setting,
      input: this.element<HTMLInputElement>(`#timeline-snap-${setting}`),
    }));
    this.files = new AnimationFileController(app, getState, () => {
      this.externalError = '';
      this.render();
    });
    const options = { signal: this.abort.signal };
    // Invalid inspector drafts can add errors on blur and move these buttons between down/up.
    // Hold focus until the replacement clears those drafts so the native click stays on its target.
    this.discard.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button === 0) event.preventDefault();
      },
      options,
    );
    for (const { setting, input } of this.snap)
      input.addEventListener('change', () => this.state.setTimelineSnapSettings({ [setting]: input.checked }), options);
    this.selection.addEventListener(
      'change',
      () => {
        if (this.state.selectAnimation(this.selection.value || null, { keepChanges: true })) {
          this.files.invalidateSession();
        }
        this.render(true);
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
    this.discard.addEventListener(
      'click',
      () => {
        if (!this.state.dirty || !window.confirm('Discard unsaved animation changes?')) return;
        this.input.endScrub();
        if (this.state.selectAnimation(this.state.selectedAnimationId, { discardChanges: true })) {
          this.files.invalidateSession('Changes discarded. The last saved animation was restored.');
        }
      },
      options,
    );
    this.deleteKey.addEventListener(
      'click',
      () => {
        this.state.deleteTimelineSelection();
      },
      options,
    );
    this.copyKeys.addEventListener('click', () => this.state.copyTimelineSelection(), options);
    this.pasteKeys.addEventListener('click', () => this.state.pasteTimelineClipboard(), options);
    this.duplicateKeys.addEventListener('click', () => this.state.duplicateTimelineSelection(), options);
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
    this.files.reset();
    const state = this.state;
    this.externalError = '';
    this.updateAnimationOptions(state);
    this.element('#character-status').textContent = characterId ? `Character: ${characterId}` : 'No character loaded.';
  }

  private updateAnimationOptions(state: AnimationEditorState): void {
    const ids = state.animationIds;
    if (ids !== this.animationIds) {
      this.animationIds = ids;
      this.animationOptions = ids.map((id) => ({ id, element: new Option(id, id) }));
      this.selection.replaceChildren(
        new Option('No animation selected', ''),
        ...this.animationOptions.map((option) => option.element),
      );
    }
    for (const { id, element } of this.animationOptions)
      setText(element, `${id}${state.isNewAnimation(id) ? ' (New)' : ''}`);
  }

  showError(message: string): void {
    this.externalError = message;
    this.render();
  }

  render(force = false): void {
    const state = this.state;
    const animation = state.workingAnimation;
    const authoredChanged = animation !== this.animation;
    this.animation = animation;
    for (const { setting, input } of this.snap) input.checked = state.timelineSnapSettings[setting];
    const selectedId = state.selectedAnimationId ?? '';
    if (this.selection.value !== selectedId) this.selection.value = selectedId;
    const playbackLabel = state.isPlaying ? 'Pause' : 'Play';
    setText(this.playPause.querySelector?.<HTMLElement>('[data-control-label]') ?? this.playPause, playbackLabel);
    setAttribute(this.playPause, 'aria-label', playbackLabel);
    setAttribute(this.playPause, 'title', `${playbackLabel} (Space)`);
    setAttribute(this.loop, 'aria-pressed', String(state.previewLoop));
    setText(this.timeDisplay, `${state.currentTime.toFixed(3)} / ${state.duration.toFixed(3)} s`);
    const playback = animation?.playback;
    const speed = String(state.playbackSpeed);
    if (this.speed.value !== speed) this.speed.value = speed;
    const mode = playback?.mode ?? 'smooth';
    if (this.mode.value !== mode) this.mode.value = mode;
    const fps = playback?.mode === 'stepped' ? String(playback.fps) : '';
    // Leave an uncommitted numeric edit alone while playback notifications refresh the other controls.
    if ((authoredChanged || fps !== this.authoredFPS || document.activeElement !== this.fps) && this.fps.value !== fps)
      this.fps.value = fps;
    this.authoredFPS = fps;
    const previousDisabled = !(state.deformationSelected
      ? state.getAdjacentDeformationKey(-1)
      : state.getAdjacentKeyframe(-1));
    const nextDisabled = !(state.deformationSelected
      ? state.getAdjacentDeformationKey(1)
      : state.getAdjacentKeyframe(1));
    if (this.previousKey.disabled !== previousDisabled) this.previousKey.disabled = previousDisabled;
    if (this.nextKey.disabled !== nextDisabled) this.nextKey.disabled = nextDisabled;
    setText(
      this.metadata,
      animation
        ? `Mode: ${mode} · FPS: ${playback?.mode === 'stepped' ? playback.fps : 'continuous'} · Authored loop: ${state.loop ? 'on' : 'off'} · Playback: ${state.previewLoop ? 'loop' : 'once'} · Speed: ${speed}× · ${state.isScrubbing ? 'Scrubbing' : state.isPlaying ? 'Playing' : 'Paused'}`
        : 'Select an animation to preview its pose.',
    );
    // Only time-dependent controls above need work during clock-only notifications.
    const controls = [
      state,
      state.animationIds,
      animation,
      selectedId,
      state.timelineSnapSettings,
      state.dirty,
      state.isNewAnimation(),
      state.canUndo,
      state.canRedo,
      state.selectedKeys,
      state.selectedTarget,
      state.selectedIKKeyframe,
      state.selectedRootKey,
      state.selectedDeformationKey,
      state.deformationSelected,
      state.rootMotionSelected,
      state.selectedEvent,
      state.timelineClipboard,
      state.timelineVisibility,
      state.validationIssues,
      this.externalError,
    ];
    if (!force && this.renderedControls && controls.every((value, index) => value === this.renderedControls![index]))
      return;
    this.updateAnimationOptions(state);
    if (this.selection.value !== selectedId) this.selection.value = selectedId;
    for (const { setting, input } of this.snap)
      input.disabled = !animation || (setting !== 'enabled' && !state.timelineSnapSettings.enabled);
    const selectionDisabled = !state.animationIds.length;
    if (this.selection.disabled !== selectionDisabled) this.selection.disabled = selectionDisabled;
    if (this.reset.disabled !== !animation) this.reset.disabled = !animation;
    const playDisabled = !animation || !(state.duration > 0);
    if (this.playPause.disabled !== playDisabled) this.playPause.disabled = playDisabled;
    if (this.loop.disabled !== !animation) this.loop.disabled = !animation;
    if (this.speed.disabled !== !animation) this.speed.disabled = !animation;
    if (this.mode.disabled !== !animation) this.mode.disabled = !animation;
    const fpsDisabled = !animation || mode !== 'stepped';
    if (this.fps.disabled !== fpsDisabled) this.fps.disabled = fpsDisabled;
    if (this.undo.disabled !== !state.canUndo) this.undo.disabled = !state.canUndo;
    if (this.redo.disabled !== !state.canRedo) this.redo.disabled = !state.canRedo;
    this.files.render();
    if (this.discard.disabled !== !state.dirty) this.discard.disabled = !state.dirty;
    const deleteDisabled =
      state.selectedKeys.length === 0 &&
      !state.selectedIKKeyframe &&
      !state.selectedEvent &&
      !state.selectedRootKey &&
      !state.selectedDeformationKey;
    if (this.deleteKey.disabled !== deleteDisabled) this.deleteKey.disabled = deleteDisabled;
    setCommandAvailability(
      this.deleteKey,
      deleteDisabled ? 'Select keys or an event in the timeline to delete.' : '',
      'Delete the complete selection (Delete / Backspace), including hidden keys',
    );
    setCommandAvailability(
      this.element<HTMLButtonElement>('#animation-retime-open'),
      retimeSelectionReason(state),
      'Scale selected key times around the first selected time or playhead',
    );
    // Pair configuration must remain reachable when the current mapping needs repair.
    setCommandAvailability(
      this.element<HTMLButtonElement>('#animation-mirror-open'),
      !state.rig ? 'Load a character to configure symmetry pairs.' : !animation ? 'Load a valid animation first.' : '',
      'Configure bone pairs, preview and mirror authored bone motion',
    );
    const bakeReason =
      !animation || !state.rig
        ? 'Load a valid animation and rig first.'
        : !(state.rig.ik ?? []).some(
              (entry) => entry.enabled !== false && !animation.disabledIKConstraints?.includes(entry.name),
            )
          ? 'No active rig IK constraints. Undo a bake or load a rig with enabled IK.'
          : '';
    setCommandAvailability(
      this.element<HTMLButtonElement>('#animation-bake-open'),
      bakeReason,
      'Select IK constraints and sampling FPS, then preview before baking',
    );
    const count =
      state.selectedKeys.length +
      (state.selectedIKKeyframe ? 1 : 0) +
      (state.selectedRootKey ? 1 : 0) +
      (state.selectedDeformationKey ? 1 : 0);
    const hidden = state.timelineVisibility.hiddenKeyCount;
    setText(
      this.deleteKey,
      state.selectedEvent
        ? 'Delete Event'
        : count
          ? `Delete ${count} Selected Key${count === 1 ? '' : 's'}${hidden ? ` (${hidden} hidden)` : ''}`
          : 'Delete Selected Keys',
    );
    const copyDisabled = state.deformationSelected
      ? !state.selectedDeformationKey
      : state.rootMotionSelected || !!state.selectedIKConstraintId || (deleteDisabled && !state.selectedEvent);
    if (this.copyKeys.disabled !== copyDisabled) this.copyKeys.disabled = copyDisabled;
    if (this.duplicateKeys.disabled !== (state.rootMotionSelected ? !state.selectedRootKey : copyDisabled))
      this.duplicateKeys.disabled = state.rootMotionSelected ? !state.selectedRootKey : copyDisabled;
    setText(this.copyKeys, state.selectedEvent ? 'Copy Event' : 'Copy Keys');
    setText(this.duplicateKeys, state.selectedEvent ? 'Duplicate Event' : 'Duplicate Keys');
    setText(this.pasteKeys, state.timelineClipboard?.kind === 'event' ? 'Paste Event' : 'Paste Keys');
    const pasteDisabled =
      state.timelineClipboard?.kind === 'deformation'
        ? !animation
        : state.deformationSelected ||
          state.rootMotionSelected ||
          !!state.selectedIKConstraintId ||
          !animation ||
          !state.timelineClipboard;
    if (this.pasteKeys.disabled !== pasteDisabled) this.pasteKeys.disabled = pasteDisabled;
    const clipboardReason = state.deformationSelected
      ? state.selectedDeformationKey
        ? ''
        : 'Select a deformation key first.'
      : state.rootMotionSelected
        ? 'Root clipboard is unavailable; use Duplicate key.'
        : state.selectedIKConstraintId
          ? 'IK clipboard and duplication are unavailable. Select bone keys or an event.'
          : copyDisabled
            ? 'Select bone keys or an event first.'
            : '';
    setCommandAvailability(this.copyKeys, clipboardReason, 'Copy selection (Ctrl/Cmd+C in timeline)');
    setCommandAvailability(
      this.duplicateKeys,
      state.rootMotionSelected ? (state.selectedRootKey ? '' : 'Select a root key first.') : clipboardReason,
      'Duplicate selection (Ctrl/Cmd+D in timeline)',
    );
    setCommandAvailability(
      this.pasteKeys,
      state.timelineClipboard?.kind === 'deformation'
        ? !animation
          ? 'Load a valid animation first.'
          : ''
        : state.deformationSelected
          ? 'Copy a deformation key first.'
          : state.rootMotionSelected
            ? 'Select a bone or event track to paste.'
            : state.selectedIKConstraintId
              ? 'Select a bone track or event track to paste.'
              : !animation
                ? 'Load a valid animation first.'
                : !state.timelineClipboard
                  ? 'Copy bone keys or an event first.'
                  : '',
      'Paste at the playhead (Ctrl/Cmd+V in timeline)',
    );
    setText(
      this.dirty,
      state.isNewAnimation() ? 'New / Unsaved' : state.dirty ? 'Unsaved changes' : 'No unsaved changes',
    );
    setText(
      this.sessionStatus,
      `Animation: ${state.selectedAnimationId ?? 'none'} · Status: ${animation ? (state.isNewAnimation() ? 'New / Unsaved' : state.dirty ? 'Modified' : 'Clean') : 'No animation'}`,
    );
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
                ? 'This character has no animations. Choose + New Animation to create a clip, or use File tools to import animation JSON.'
                : 'No animation selected.'),
    );
    this.renderedControls = controls;
  }

  dispose(): void {
    this.files.dispose();
    this.abort.abort();
  }
}
