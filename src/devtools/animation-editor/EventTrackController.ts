import { setAttribute } from '../../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { AnimationEventRef, EventTimelineTrack } from './animationEvents.js';
import { timeToTimelineX } from './timeline.js';

/** The event track renders and selects through the events handle. */
type EventTrackState = Pick<
  AnimationEditorState,
  'events' | 'selectedEvent' | 'duration' | 'workingAnimation' | 'selectBone'
>;

/** Separate event lane: no bone ids, property keys, key collisions, or runtime callbacks. */
export class EventTrackController {
  readonly label = document.createElement('div');
  readonly lane = document.createElement('div');
  private readonly select = document.createElement('button');
  private readonly presence = document.createElement('span');
  private readonly markers = new Map<AnimationEventRef, HTMLButtonElement>();
  private state: EventTrackState | undefined;
  private track: EventTimelineTrack | undefined;
  private width = -1;
  private duration = -1;
  private selected: AnimationEventRef | null | undefined;

  private drag: AnimationEditorState['events']['eventDrag'] | undefined;

  constructor(
    private readonly onPointerDown?: (event: PointerEvent, ref: AnimationEventRef, marker: HTMLButtonElement) => void,
  ) {
    this.label.className = 'timeline-track-label timeline-event-track';
    this.lane.className = 'timeline-track-lane timeline-event-track';
    this.select.type = 'button';
    this.select.className = 'timeline-track-select';
    this.select.textContent = 'Events';
    this.select.setAttribute('aria-label', 'Select events track');
    this.select.addEventListener('click', () => this.state?.selectBone(null));
    this.presence.className = 'timeline-event-count';
    this.label.append(this.select, this.presence);
    this.lane.setAttribute('aria-label', 'Animation events');
  }

  render(state: EventTrackState, width: number): void {
    this.state = state;
    const track = state.events.eventTimelineTrack;
    const changed = track !== this.track;
    if (changed) {
      this.track = track;
      const refs = new Set(track.markers.map(({ ref }) => ref));
      for (const [ref, marker] of this.markers) {
        if (refs.has(ref)) continue;
        if (document.activeElement === marker) this.lane.parentElement?.focus({ preventScroll: true });
        marker.remove();
        this.markers.delete(ref);
      }
      this.presence.textContent = String(track.markers.length);
      this.presence.title = track.markers.length ? 'Authored animation events' : 'No authored events';
      for (const element of [this.label, this.lane]) element.style.height = `${track.stackCount * 30}px`;
      for (const model of track.markers) {
        let marker = this.markers.get(model.ref);
        if (!marker) {
          marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'timeline-event';
          marker.addEventListener('pointerdown', (event) => {
            if (this.onPointerDown) {
              this.onPointerDown(event, model.ref, marker!);
              return;
            }
            event.stopPropagation();
            if (event.button !== 0) return;
            event.preventDefault();
            this.state?.events.selectAnimationEvent(model.ref);
            marker!.focus({ preventScroll: true });
          });
          marker.addEventListener('contextmenu', () => this.state?.events.selectAnimationEvent(model.ref));
          marker.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.detail === 0) this.state?.events.selectAnimationEvent(model.ref);
          });
          this.markers.set(model.ref, marker);
        }
        setAttribute(marker, 'data-time', String(model.time));
        setAttribute(marker, 'data-event-name', model.name);
        setAttribute(marker, 'aria-label', `Select event ${model.name} at ${model.time} s`);
        setAttribute(marker, 'title', `${model.name}\nTime: ${model.time.toFixed(3)} s`);
        marker.style.top = `${model.stackIndex * 30 + 15}px`;
      }
      // Preserve surviving marker nodes/focus while reflecting deterministic authored ordering.
      for (const [index, model] of track.markers.entries()) {
        const marker = this.markers.get(model.ref)!;
        if (this.lane.children[index] !== marker) this.lane.insertBefore(marker, this.lane.children[index] ?? null);
      }
    }
    if (changed || width !== this.width || state.duration !== this.duration || state.events.eventDrag !== this.drag) {
      this.drag = state.events.eventDrag;
      this.width = width;
      this.duration = state.duration;
      for (const model of track.markers)
        this.markers.get(model.ref)!.style.left =
          `${timeToTimelineX(this.drag?.ref === model.ref ? this.drag.previewTime : model.time, state.duration, width)}px`;
    }
    this.select.disabled = !state.workingAnimation;
    if (changed || this.selected !== state.selectedEvent) {
      this.selected = state.selectedEvent;
      for (const [ref, marker] of this.markers) setAttribute(marker, 'aria-pressed', String(ref === this.selected));
      for (const element of [this.label, this.lane]) setAttribute(element, 'data-selected', String(!!this.selected));
      setAttribute(this.select, 'aria-pressed', String(!!this.selected));
    }
  }

  dispose(): void {
    this.state = undefined;
    this.markers.clear();
    this.label.remove();
    this.lane.remove();
  }
}
