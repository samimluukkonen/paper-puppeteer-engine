import { setAttribute } from '../../shared/domUpdates.js';
import { AnimationEditorState } from './AnimationEditorState.js';
import { generateRulerTicks, timeToTimelineX } from './timeline.js';
import { TimelineInputController } from './TimelineInputController.js';
import { TimelineSessionController } from './TimelineSessionController.js';
import { TimelineTracksController } from './TimelineTracksController.js';

/** Coordinates session adapters and renders the ruler, tracks, and playhead. */
export class TimelineController {
  private state = new AnimationEditorState();
  private unsubscribe: (() => void) | undefined;
  private readonly resize: ResizeObserver;
  private readonly timeline: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly playhead: HTMLElement;
  private readonly input: TimelineInputController;
  private readonly session: TimelineSessionController;
  private readonly tracks: TimelineTracksController;
  private width = 0;
  private rulerKey = '';

  constructor(private readonly app: HTMLElement) {
    this.timeline = this.element('#timeline');
    this.ruler = this.element('#timeline-ruler');
    this.playhead = this.element('#timeline-playhead');
    this.tracks = new TimelineTracksController(
      this.element('#timeline-track-labels'),
      this.element('#timeline-tracks'),
      (event, key, marker) => this.input.beginKeyDrag(event, key, marker),
    );
    this.session = new TimelineSessionController(app, () => this.state, {
      endScrub: () => this.input.endScrub(),
    });
    this.input = new TimelineInputController(app, this.timeline, () => this.state, this.ruler);
    this.width = this.timeline.getBoundingClientRect().width;
    this.resize = new ResizeObserver(() => {
      this.width = this.timeline.getBoundingClientRect().width;
      this.input.previewKeyDrag();
      this.input.previewMarquee();
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
    this.input.cancelGesture();
    this.state.pause();
    this.unsubscribe?.();
    this.state = state;
    this.session.bind(characterId);
    this.unsubscribe = state.subscribe(() => this.render());
    this.render();
  }

  showError(message: string): void {
    this.session.showError(message);
  }

  private render(): void {
    this.input.synchronize();
    const state = this.state;
    const animation = state.workingAnimation;
    const width = this.width;
    this.tracks.render(state, width);
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
    const playheadX = `${timeToTimelineX(state.currentTime, state.duration, width)}px`;
    this.playhead.style.left = playheadX;
    this.ruler.style.setProperty('--timeline-playhead-x', playheadX);
    setAttribute(this.ruler, 'aria-valuemax', String(state.duration));
    setAttribute(this.ruler, 'aria-valuenow', String(state.currentTime));
    setAttribute(
      this.ruler,
      'aria-valuetext',
      `${state.currentTime.toFixed(3)} of ${state.duration.toFixed(3)} seconds`,
    );
    setAttribute(this.timeline, 'aria-disabled', String(!animation));
    setAttribute(this.ruler, 'aria-disabled', String(!animation));
    this.session.render();
  }

  dispose(): void {
    this.input.cancelGesture();
    this.state.pause();
    this.input.dispose();
    this.session.dispose();
    this.resize.disconnect();
    this.unsubscribe?.();
    this.tracks.dispose();
  }
}
