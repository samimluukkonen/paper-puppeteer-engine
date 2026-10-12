import { setAttribute, setText } from '../../shared/domUpdates.js';
import { AnimationEditorState } from './AnimationEditorState.js';
import { EventInspectorController } from './EventInspectorController.js';
import { InterpolationController } from './InterpolationController.js';
import { generateRulerTicks, timeToTimelineX } from './timeline.js';
import { defaultTimelineFilters, normalizedTrackSearch, type TimelineFilters } from './timelineFiltering.js';
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
  private readonly interpolation: InterpolationController;
  private readonly eventInspector: EventInspectorController;
  private width = 0;
  private rulerKey = '';
  private readonly viewAbort = new AbortController();
  private readonly inset: HTMLElement;
  private resizeFrame = 0;
  private renderedView: readonly unknown[] | undefined;
  private readonly filter: HTMLSelectElement;
  private readonly filterStatus: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly showIK: HTMLInputElement;
  private readonly showEvents: HTMLInputElement;

  constructor(private readonly app: HTMLElement) {
    this.timeline = this.element('#timeline');
    this.inset = this.element('.timeline-inset');
    this.ruler = this.element('#timeline-ruler');
    this.playhead = this.element('#timeline-playhead');
    this.filter = this.element('#timeline-filter');
    this.filterStatus = this.element('#timeline-filter-status');
    this.search = this.element('#timeline-search');
    this.showIK = this.element('#timeline-show-ik');
    this.showEvents = this.element('#timeline-show-events');
    this.tracks = new TimelineTracksController(
      this.element('#timeline-track-labels'),
      this.element('#timeline-tracks'),
      (event, key, marker) => this.input.beginKeyDrag(event, key, marker),
      (event, ref, marker) => this.input.beginEventDrag(event, ref, marker),
    );
    this.session = new TimelineSessionController(app, () => this.state, {
      endScrub: () => this.input.endScrub(),
    });
    this.interpolation = new InterpolationController(app, () => this.state);
    this.eventInspector = new EventInspectorController(app, () => this.state);
    this.input = new TimelineInputController(app, this.timeline, () => this.state, this.ruler);
    this.width = this.timeline.getBoundingClientRect().width;
    this.resize = new ResizeObserver(() => {
      if (this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        this.updateTimelineWidth();
        this.width = this.timeline.getBoundingClientRect().width;
        this.input.previewKeyDrag();
        this.input.previewMarquee();
        this.render();
      });
    });
    this.resize.observe(this.timeline);
    this.resize.observe(this.inset);
    this.resize.observe(this.element('.timeline-label-column'));
    const options = { signal: this.viewAbort.signal };
    const updateFilters = (): void => {
      const mode = this.filter.value;
      const patch: TimelineFilters = {
        search: this.search.value,
        mode: mode === 'keyed' || mode === 'selected' ? mode : 'all',
        showIK: this.showIK.checked,
        showEvents: this.showEvents.checked,
      };
      this.input.cancelGesture();
      this.state.setTimelineFilters(patch);
    };
    this.search.addEventListener('input', updateFilters, options);
    for (const control of [this.filter, this.showIK, this.showEvents])
      control.addEventListener('change', updateFilters, options);
    this.element('#timeline-clear-filters').addEventListener(
      'click',
      () => {
        this.input.cancelGesture();
        this.state.setTimelineFilters(defaultTimelineFilters);
      },
      options,
    );
    for (const [id, mode] of [
      ['timeline-expand-all', 'all'],
      ['timeline-collapse-all', 'none'],
      ['timeline-expand-selected', 'selected'],
    ] as const)
      this.element(`#${id}`).addEventListener(
        'click',
        () => {
          this.input.cancelGesture();
          this.state.expandTimeline(mode);
        },
        options,
      );
    this.element('#timeline-reveal-selection').addEventListener(
      'click',
      () => {
        this.input.cancelGesture();
        this.state.revealTimelineSelection();
        const selected =
          this.element('#timeline-tracks').querySelector<HTMLElement>(
            '[data-primary="true"], .timeline-event[aria-pressed="true"]',
          ) ??
          this.element('#timeline-track-labels').querySelector<HTMLElement>(
            '.timeline-property-track[data-selected="true"] .timeline-track-select, ' +
              '.timeline-ik-property-track[data-selected="true"] .timeline-track-select',
          ) ??
          this.element('#timeline-track-labels').querySelector<HTMLElement>(
            '[data-selected="true"] .timeline-track-select',
          );
        selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        selected?.focus({ preventScroll: true });
      },
      options,
    );
    this.element('#timeline-zoom').addEventListener(
      'change',
      () => {
        this.input.cancelGesture();
        this.updateTimelineWidth();
        this.width = this.timeline.getBoundingClientRect().width;
        this.render();
      },
      { signal: this.viewAbort.signal },
    );
    this.bind(this.state);
  }

  private updateTimelineWidth(): void {
    const control = this.element<HTMLSelectElement>('#timeline-zoom');
    const requested = Number(control.value);
    const zoom = [1, 2, 4, 8].includes(requested) ? requested : 1;
    if (control.value !== String(zoom)) control.value = String(zoom);
    const labels = this.element('.timeline-label-column').getBoundingClientRect().width;
    const width = Math.max(60, this.inset.clientWidth - labels);
    this.inset.style.gridTemplateColumns = `min(var(--timeline-label-width), 50%) ${width * zoom}px`;
    setAttribute(this.element('#timeline-label-divider'), 'aria-valuenow', String(Math.round(labels)));
    setAttribute(
      this.element('#timeline-label-divider'),
      'aria-valuemax',
      String(Math.floor(Math.min(400, this.inset.clientWidth / 2))),
    );
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
    const filters = state.timelineFilters;
    const visibility = state.timelineVisibility;
    // Clock-only notifications need the playhead and time controls, not row/inspector reconciliation.
    const view = [
      state,
      animation,
      state.timelineTracks,
      state.selectedTarget,
      state.selectedIKKeyframe,
      state.selectedBoneId,
      state.selectedTimelineProperty,
      state.selectedKeys,
      state.selectedEvent,
      state.keyframeDrag,
      state.eventDrag,
      width,
      filters,
      visibility,
    ];
    if (!this.renderedView || view.some((value, index) => value !== this.renderedView![index])) {
      this.tracks.render(state, width);
      this.tracks.filter(state);
      if (this.search.value !== filters.search) this.search.value = filters.search;
      if (this.filter.value !== filters.mode) this.filter.value = filters.mode;
      this.showIK.checked = filters.showIK;
      this.showEvents.checked = filters.showEvents;
      const active =
        !!normalizedTrackSearch(filters.search) || filters.mode !== 'all' || !filters.showIK || !filters.showEvents;
      this.filterStatus.hidden = !active;
      setText(
        this.filterStatus,
        `${visibility.rows.size + (visibility.eventVisible ? 1 : 0)} visible rows · Ancestors are kept for context. Clear Filters to show every track.`,
      );
      this.element('#timeline-filter-empty').hidden = !active || visibility.rows.size > 0 || visibility.eventVisible;
      this.element<HTMLButtonElement>('#timeline-clear-filters').disabled = !active;
      this.element<HTMLButtonElement>('#timeline-expand-selected').disabled =
        !state.selectedTarget && !state.selectedKeys.length;
      this.element('#timeline-reveal-selection').hidden = !visibility.selectionHidden;
      const selectionStatus = this.element('#timeline-selection-status');
      selectionStatus.hidden = !visibility.selectionHidden;
      const count = state.selectedKeys.length + (state.selectedIKKeyframe ? 1 : 0);
      setText(
        selectionStatus,
        visibility.hiddenKeyCount
          ? `${count} selected key${count === 1 ? '' : 's'} (${visibility.hiddenKeyCount} hidden). Commands affect all selected keys, including hidden keys.`
          : state.selectedEvent
            ? '1 selected event (hidden). Delete Event affects this event. Reveal Selection to show it.'
            : 'The selected track is hidden. Reveal Selection to show it.',
      );
      this.interpolation.render();
      this.eventInspector.render(state);
      this.renderedView = view;
    }
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
    this.interpolation.dispose();
    this.eventInspector.dispose();
    this.resize.disconnect();
    cancelAnimationFrame(this.resizeFrame);
    this.viewAbort.abort();
    this.unsubscribe?.();
    this.tracks.dispose();
  }
}
