import { isEditorTypingTarget } from '../shared/editorShortcuts.js';
import { AnimationEditorState } from './AnimationEditorState.js';
import { generateRulerTicks, timelineXToTime, timeToTimelineX } from './timeline.js';

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

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
  private pointer: number | undefined;
  private width = 0;
  private rulerKey = '';
  private externalError = '';

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
    const options = { signal: this.abort.signal };
    this.selection.addEventListener(
      'change',
      () => {
        this.endScrub();
        this.state.selectAnimation(this.selection.value || null);
      },
      options,
    );
    this.reset.addEventListener('click', () => this.state.restart(), options);
    this.playPause.addEventListener('click', () => this.state.togglePlayback(), options);
    this.loop.addEventListener('click', () => this.state.setPreviewLoop(!this.state.previewLoop), options);
    window.addEventListener(
      'keydown',
      (event) => {
        if (
          event.code !== 'Space' ||
          event.defaultPrevented ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          isEditorTypingTarget(event.target) ||
          (event.target instanceof Element && event.target.closest('button, a[href]')) ||
          !this.state.workingAnimation
        )
          return;
        event.preventDefault();
        if (!event.repeat) this.state.togglePlayback();
      },
      options,
    );
    this.timeline.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || this.pointer !== undefined || !this.state.workingAnimation) return;
        event.preventDefault();
        this.timeline.focus();
        this.pointer = event.pointerId;
        this.timeline.setPointerCapture(event.pointerId);
        this.state.beginScrub();
        this.scrub(event.clientX);
      },
      options,
    );
    this.timeline.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerId === this.pointer) this.scrub(event.clientX);
      },
      options,
    );
    this.timeline.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerId !== this.pointer) return;
        this.scrub(event.clientX);
        this.endScrub();
      },
      options,
    );
    for (const name of ['pointercancel', 'lostpointercapture'] as const)
      this.timeline.addEventListener(
        name,
        (event) => {
          if (event.pointerId === this.pointer) this.endScrub();
        },
        options,
      );
    window.addEventListener('blur', () => this.endScrub(), options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.endScrub();
      },
      options,
    );
    this.timeline.addEventListener(
      'keydown',
      (event) => {
        if (!this.state.workingAnimation) return;
        const step = event.shiftKey ? 0.1 : 0.01;
        const time =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
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
      this.render();
    });
    this.resize.observe(this.timeline);
    this.bind(this.state);
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing animation editor element ${selector}.`);
    return element;
  }

  bind(state: AnimationEditorState, characterId?: string): void {
    this.state.pause();
    this.endScrub();
    this.unsubscribe?.();
    this.state = state;
    this.externalError = '';
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

  private endScrub(): void {
    const pointer = this.pointer;
    this.pointer = undefined;
    if (pointer !== undefined && this.timeline.hasPointerCapture(pointer)) this.timeline.releasePointerCapture(pointer);
    this.state.endScrub();
  }

  private render(): void {
    const state = this.state;
    if (this.pointer !== undefined && !state.isScrubbing) this.endScrub();
    const animation = state.workingAnimation;
    const width = this.width;
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
    setText(
      this.metadata,
      animation
        ? `Mode: ${playback?.mode ?? 'smooth'} · FPS: ${playback?.mode === 'stepped' ? playback.fps : 'continuous'} · Authored loop: ${state.loop ? 'on' : 'off'} · Playback: ${state.previewLoop ? 'loop' : 'once'} · ${state.isScrubbing ? 'Scrubbing' : state.isPlaying ? 'Playing' : 'Paused'}`
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
    this.state.pause();
    this.endScrub();
    this.abort.abort();
    this.resize.disconnect();
    this.unsubscribe?.();
  }
}
