import type { AnimationEditorState } from './AnimationEditorState.js';
import { setCommandAvailability } from './commandAvailability.js';
import { clampTime } from './timeline.js';
import {
  centerTimelineTime,
  clampTimelineZoom,
  fitTimelineAnimation,
  fitTimelineSelection,
  followTimelineTime,
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  panTimeline,
  timelineFrameToTime,
  timelineTimeToFrame,
  type TimelineViewport,
  timeToViewportX,
  viewportXToTime,
  zoomTimeline,
} from './timelineNavigation.js';
import { toSeconds } from './timeUnits.js';

/** View-only navigation. Authored data, selection and history remain owned by the existing session. */
export class TimelineNavigationController {
  private readonly abort = new AbortController();
  private readonly inset: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly zoomControl: HTMLSelectElement;
  private readonly customZoom: HTMLOptionElement;
  private readonly time: HTMLInputElement;
  private readonly frame: HTMLInputElement;
  private readonly frameControl: HTMLElement;
  private readonly follow: HTMLInputElement;
  private zoom = 1;
  private viewportWidth = 0;
  private contentWidth = 0;
  private session: AnimationEditorState | undefined;
  private animationId: string | null | undefined;

  constructor(
    private readonly app: HTMLElement,
    private readonly getState: () => AnimationEditorState,
    private readonly changed: () => void,
    private readonly cancelGesture: () => void,
  ) {
    this.inset = this.element('.timeline-inset');
    this.labels = this.element('.timeline-label-column');
    this.zoomControl = this.element('#timeline-zoom');
    this.customZoom = this.element('#timeline-custom-zoom');
    this.time = this.element('#timeline-time-input');
    this.frame = this.element('#timeline-frame-input');
    this.frameControl = this.element('#timeline-frame-control');
    this.follow = this.element('#timeline-follow');
    const options = { signal: this.abort.signal };
    this.zoomControl.addEventListener('change', () => this.setZoom(Number(this.zoomControl.value)), options);
    for (const [id, action] of [
      ['timeline-zoom-in', () => this.zoomBy(2)],
      ['timeline-zoom-out', () => this.zoomBy(0.5)],
      ['timeline-fit-animation', () => this.fitAnimation()],
      ['timeline-fit-selection', () => this.fitSelection()],
      ['timeline-center-playhead', () => this.centerPlayhead()],
    ] as const)
      this.element(`#${id}`).addEventListener('click', action, options);
    this.inset.addEventListener('scroll', () => this.changed(), options);
    this.inset.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey || event.metaKey) {
          if (!this.getState().workingAnimation) return;
          event.preventDefault();
          const left = this.inset.getBoundingClientRect().left + this.labels.getBoundingClientRect().width;
          const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewportWidth : 1);
          this.setZoom(this.zoom * Math.exp(Math.max(-1, Math.min(1, -delta * 0.005))), event.clientX - left);
        } else if (event.shiftKey && event.deltaY !== 0) {
          event.preventDefault();
          const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewportWidth : 1);
          this.inset.scrollLeft = panTimeline(this.view, this.inset.scrollLeft + delta + event.deltaX);
        }
        // Native horizontal trackpad scrolling and the scrollbar retain their usual behavior.
      },
      { ...options, passive: false },
    );
    const commitTime = (): void => {
      const state = this.getState();
      if (this.time.value.trim() && Number.isFinite(this.time.valueAsNumber)) {
        this.cancelGesture();
        state.setCurrentTime(clampTime(this.time.valueAsNumber, state.duration));
        this.centerPlayhead();
      }
      this.renderTime(true);
    };
    const commitFrame = (): void => {
      const state = this.getState();
      const fps = this.authoredFPS;
      const time = fps === undefined ? null : timelineFrameToTime(this.frame.valueAsNumber, state.duration, fps);
      if (this.frame.value.trim() && time !== null) {
        this.cancelGesture();
        state.setCurrentTime(time);
        this.centerPlayhead();
      }
      this.renderTime(true);
    };
    for (const [input, commit] of [
      [this.time, commitTime],
      [this.frame, commitFrame],
    ] as const) {
      let committedText: string | undefined;
      input.addEventListener(
        'input',
        () => {
          committedText = undefined;
        },
        options,
      );
      input.addEventListener(
        'change',
        () => {
          // Enter commits while focus stays here. Native change on later blur must not seek/center again.
          if (input.value === committedText) return;
          commit();
          committedText = input.value;
        },
        options,
      );
      input.addEventListener(
        'keydown',
        (event) => {
          if (event.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            committedText = input.value;
          } else if (event.key === 'Escape') {
            event.preventDefault();
            this.renderTime(true);
            committedText = input.value;
          }
        },
        options,
      );
    }
  }

  private element<T extends HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing animation editor element ${selector}.`);
    return element;
  }

  private get authoredFPS(): number | undefined {
    const playback = this.getState().workingAnimation?.playback;
    return playback?.mode === 'stepped' && Number.isFinite(playback.fps) && playback.fps > 0 ? playback.fps : undefined;
  }

  get view(): TimelineViewport {
    return {
      duration: this.getState().duration,
      viewportWidth: this.viewportWidth,
      contentWidth: this.contentWidth,
      scrollLeft: this.inset.scrollLeft,
    };
  }

  /** Resize retains the center time and zoom. Native layout accounts for scrollbar and browser zoom. */
  resize(): void {
    const center = viewportXToTime(this.viewportWidth / 2, this.view);
    this.updateWidth();
    this.inset.scrollLeft = this.zoom === 1 ? 0 : centerTimelineTime(this.view, center);
  }

  private updateWidth(): void {
    const labels = this.labels.getBoundingClientRect().width;
    this.viewportWidth = Math.max(1, this.inset.clientWidth - labels);
    this.contentWidth = this.viewportWidth * this.zoom;
    this.inset.style.gridTemplateColumns = `min(var(--timeline-label-width), 50%) ${this.contentWidth}px`;
    this.element('#timeline-label-divider').setAttribute('aria-valuenow', String(Math.round(labels)));
    this.element('#timeline-label-divider').setAttribute(
      'aria-valuemax',
      String(Math.floor(Math.min(400, this.inset.clientWidth / 2))),
    );
  }

  private apply(view: TimelineViewport): void {
    this.zoom = clampTimelineZoom(view.contentWidth / view.viewportWidth);
    this.updateWidth();
    this.inset.scrollLeft = panTimeline(this.view, view.scrollLeft);
    const value = String(this.zoom);
    this.customZoom.value = value;
    this.customZoom.textContent = `${Number(this.zoom.toFixed(2))}×`;
    this.customZoom.hidden = [1, 2, 4, 8, 16, 32, 64, 128].includes(this.zoom);
    // Prefer existing preset options so native selectOption and workspace reset keep working.
    this.zoomControl.value = value;
    this.changed();
  }

  private setZoom(zoom: number, anchorX?: number): void {
    this.cancelGesture();
    this.apply(zoomTimeline(this.view, zoom, anchorX ?? timeToViewportX(this.getState().currentTime, this.view)));
  }

  zoomBy(factor: number): void {
    this.setZoom(this.zoom * factor);
  }
  fitAnimation(): void {
    this.cancelGesture();
    this.apply(fitTimelineAnimation(this.view));
  }
  fitSelection(): void {
    const next = fitTimelineSelection(this.view, this.selectedTimes());
    if (!next) return;
    this.cancelGesture();
    this.apply(next);
  }
  centerPlayhead(): void {
    this.inset.scrollLeft = centerTimelineTime(this.view, this.getState().currentTime);
    this.changed();
  }

  private selectedTimes(): number[] {
    const state = this.getState();
    if (state.selectedIKKeyframe) return [state.selectedIKKeyframe.time];
    if (state.selectedEventData) return [toSeconds(state.selectedEventData.time)];
    return state.selectedKeys.map((key) => key.time);
  }

  private renderTime(force = false): void {
    const state = this.getState();
    this.time.disabled = !state.workingAnimation;
    this.time.max = String(state.duration);
    if (force || document.activeElement !== this.time) this.time.value = String(state.currentTime);
    const fps = this.authoredFPS;
    this.frameControl.hidden = fps === undefined;
    const frame = fps === undefined ? null : timelineTimeToFrame(state.currentTime, state.duration, fps);
    this.frame.disabled = !state.workingAnimation || frame === null;
    if (force || document.activeElement !== this.frame) this.frame.value = frame === null ? '' : String(frame);
  }

  render(): void {
    const state = this.getState();
    if (state !== this.session || state.selectedAnimationId !== this.animationId) {
      this.session = state;
      this.animationId = state.selectedAnimationId;
      this.zoom = 1;
      this.zoomControl.value = '1';
      this.updateWidth();
      this.inset.scrollLeft = 0;
      this.renderTime(true);
    }
    if (state.isPlaying && this.follow.checked)
      this.inset.scrollLeft = followTimelineTime(this.view, state.currentTime);
    this.renderTime();
    const hasSelection = !!state.selectedIKKeyframe || !!state.selectedEvent || state.selectedKeys.length > 0;
    setCommandAvailability(
      this.element<HTMLButtonElement>('#timeline-fit-selection'),
      !state.workingAnimation
        ? 'Load a valid animation first.'
        : !hasSelection
          ? 'Select bone keys, an IK key or an event to fit, including hidden selections.'
          : '',
      'Fit selected keyframes or event, including hidden selections',
    );
    this.element<HTMLButtonElement>('#timeline-zoom-in').disabled =
      !state.workingAnimation || this.zoom >= MAX_TIMELINE_ZOOM;
    this.element<HTMLButtonElement>('#timeline-zoom-out').disabled =
      !state.workingAnimation || this.zoom <= MIN_TIMELINE_ZOOM;
    for (const id of ['timeline-fit-animation', 'timeline-center-playhead'])
      this.element<HTMLButtonElement>(`#${id}`).disabled = !state.workingAnimation;
    this.zoomControl.disabled = !state.workingAnimation;
  }

  dispose(): void {
    this.abort.abort();
  }
}
