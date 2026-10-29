import { setAttribute, setText } from '../../shared/domUpdates.js';
import type { GuideTargets } from '../shared/guides/GuideTargets.js';
import { AnimationEditorState } from './AnimationEditorState.js';
import { EventInspectorController } from './EventInspectorController.js';
import { GraphEditorController } from './GraphEditorController.js';
import { registerGraphGuideTargets } from './graphGuideTargets.js';
import { InterpolationController } from './InterpolationController.js';
import { MeshDeformationController } from './MeshDeformationController.js';
import { RootMotionController } from './RootMotionController.js';
import { generateRulerTicks, timeToTimelineX } from './timeline.js';
import { defaultTimelineFilters, normalizedTrackSearch, type TimelineFilters } from './timelineFiltering.js';
import { TimelineInputController } from './TimelineInputController.js';
import { viewportXToTime } from './timelineNavigation.js';
import { TimelineNavigationController } from './TimelineNavigationController.js';
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
  private readonly snapGuide: HTMLElement;
  private readonly input: TimelineInputController;
  private readonly session: TimelineSessionController;
  private readonly root: RootMotionController;
  private readonly deformation: MeshDeformationController;
  private readonly tracks: TimelineTracksController;
  private readonly interpolation: InterpolationController;
  private readonly graph: GraphEditorController;
  private readonly releaseGraphTargets: () => void;
  private readonly eventInspector: EventInspectorController;
  private width = 0;
  private rulerKey = '';
  private readonly viewAbort = new AbortController();
  private readonly inset: HTMLElement;
  private readonly navigation: TimelineNavigationController;
  private resizeFrame = 0;
  private renderedView: readonly unknown[] | undefined;
  private readonly filter: HTMLSelectElement;
  private readonly filterStatus: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly showIK: HTMLInputElement;
  private readonly showEvents: HTMLInputElement;

  constructor(
    private readonly app: HTMLElement,
    guideTargets?: GuideTargets,
  ) {
    this.timeline = this.element('#timeline');
    this.inset = this.element('.timeline-inset');
    this.ruler = this.element('#timeline-ruler');
    this.playhead = this.element('#timeline-playhead');
    this.snapGuide = this.element('#timeline-snap-guide');
    this.filter = this.element('#timeline-filter');
    this.filterStatus = this.element('#timeline-filter-status');
    this.search = this.element('#timeline-search');
    this.showIK = this.element('#timeline-show-ik');
    this.showEvents = this.element('#timeline-show-events');
    this.root = new RootMotionController(app);
    this.deformation = new MeshDeformationController(app);
    this.tracks = new TimelineTracksController(
      this.element('#timeline-track-labels'),
      this.element('#timeline-tracks'),
      (event, key, marker) => this.input.beginKeyDrag(event, key, marker),
      (event, ref, marker) => this.input.beginEventDrag(event, ref, marker),
      this.root,
      this.deformation,
    );
    this.session = new TimelineSessionController(app, () => this.state, {
      endScrub: () => this.input.endScrub(),
    });
    this.interpolation = new InterpolationController(app, () => this.state);
    this.eventInspector = new EventInspectorController(app, () => this.state);
    this.navigation = new TimelineNavigationController(
      app,
      () => this.state,
      () => {
        this.width = this.timeline.getBoundingClientRect().width;
        this.input.previewKeyDrag();
        this.input.previewMarquee();
        this.render();
      },
      () => this.input.cancelGesture(),
    );
    this.input = new TimelineInputController(app, this.timeline, () => this.state, this.ruler, this.navigation);
    this.width = this.timeline.getBoundingClientRect().width;
    this.resize = new ResizeObserver(() => {
      if (this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        this.navigation.resize();
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
    this.graph = new GraphEditorController(app, () => this.state);
    this.releaseGraphTargets = guideTargets
      ? registerGraphGuideTargets(app, guideTargets, (graph) => this.graph.revealView(graph))
      : () => {};
    this.bind(this.state);
  }

  get hasUnsavedChanges(): boolean {
    return this.state.hasUnsavedChanges;
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing animation editor element ${selector}.`);
    return element;
  }

  bind(state: AnimationEditorState, characterId?: string): void {
    this.graph.cancelGesture();
    this.input.cancelGesture();
    this.state.pause();
    this.unsubscribe?.();
    this.state = state;
    this.session.bind(characterId);
    this.unsubscribe = state.subscribe(() => this.render());
    this.render();
  }

  showError(message: string): void {
    // Discard the adapter's obsolete session, releasing authored snapshots and gesture capture.
    this.bind(new AnimationEditorState());
    this.session.showError(message);
  }

  private render(): void {
    this.root.render(this.state, this.navigation.view.contentWidth);
    this.deformation.render(this.state, this.navigation.view.contentWidth);
    this.graph.render();
    this.input.synchronize();
    const state = this.state;
    this.navigation.render();
    // Navigation measures and sets lane width during resize/zoom; clock ticks reuse that width.
    this.width = this.navigation.view.contentWidth;
    const animation = state.workingAnimation;
    const width = this.width;
    state.setTimelineSnapContentWidth(width);
    const filters = state.timelineFilters;
    const visibility = state.timelineVisibility;
    // Clock-only notifications need the playhead and time controls, not row/inspector reconciliation.
    const view = [
      state,
      animation,
      state.timelineTracks,
      this.deformation.revision,
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
    const viewport = this.navigation.view;
    const visibleStart = viewportXToTime(0, viewport);
    const visibleEnd = viewportXToTime(viewport.viewportWidth, viewport);
    const rulerKey = `${state.duration}:${width}:${visibleStart}:${visibleEnd}`;
    if (rulerKey !== this.rulerKey) {
      this.rulerKey = rulerKey;
      this.ruler.replaceChildren(
        ...generateRulerTicks(state.duration, width, visibleStart, visibleEnd).map((tick) => {
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
    const guide = state.timelineSnapGuide;
    this.snapGuide.hidden = !guide;
    if (guide) {
      this.snapGuide.style.left = `${timeToTimelineX(guide.time, state.duration, width)}px`;
      this.snapGuide.dataset.type = guide.type;
      this.snapGuide.dataset.time = String(guide.time);
      const names = { frame: 'Frame', keyframe: 'Keyframe', event: 'Event', playhead: 'Playhead' };
      setText(
        this.snapGuide.querySelector<HTMLElement>('span')!,
        `Snap: ${names[guide.type]} @ ${guide.time.toFixed(3)} s`,
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
    this.graph.cancelGesture();
    this.input.cancelGesture();
    this.state.pause();
    this.input.dispose();
    this.session.dispose();
    this.navigation.dispose();
    this.interpolation.dispose();
    this.releaseGraphTargets();
    this.graph.dispose();
    this.eventInspector.dispose();
    this.resize.disconnect();
    cancelAnimationFrame(this.resizeFrame);
    this.viewAbort.abort();
    this.unsubscribe?.();
    this.root.dispose();
    this.deformation.dispose();
    this.tracks.dispose();
  }
}
