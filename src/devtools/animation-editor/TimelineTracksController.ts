import { setAttribute } from '../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { TimelineTrack } from './timelineTracks.js';

interface TrackElements {
  readonly label: HTMLElement;
  readonly select: HTMLButtonElement;
  readonly expand: HTMLButtonElement | undefined;
  readonly indicator: HTMLElement;
  /** Full-width time lane, ready to host markers using the timeline's shared coordinates. */
  readonly lane: HTMLElement;
}

function trackKey(track: TimelineTrack): string {
  return JSON.stringify([track.boneId, track.kind === 'property' ? track.property : null]);
}

/** Reconcile only structural changes, preserving surviving buttons, focus and scroll during playback. */
function reconcileRows(container: HTMLElement, rows: HTMLElement[]): void {
  const wanted = new Set(rows);
  for (const child of Array.from(container.children)) if (!wanted.has(child as HTMLElement)) child.remove();
  for (const [index, row] of rows.entries())
    if (container.children[index] !== row) container.insertBefore(row, container.children[index] ?? null);
}

/** Label/lanes adapter. Selection, expansion, data and the clock are owned by AnimationEditorState. */
export class TimelineTracksController {
  private state: AnimationEditorState | undefined;
  private tracks: readonly TimelineTrack[] | undefined;
  private readonly rows = new Map<string, TrackElements>();
  private selectedBone: string | null | undefined;
  private selectedProperty: AnimationEditorState['selectedTimelineProperty'] | undefined;

  constructor(
    private readonly labels: HTMLElement,
    private readonly lanes: HTMLElement,
  ) {}

  private createRow(track: TimelineTrack): TrackElements {
    const label = document.createElement('div');
    label.className = `timeline-track-label timeline-${track.kind}-track`;
    label.dataset.boneId = track.boneId;
    const lane = document.createElement('div');
    lane.className = `timeline-track-lane timeline-${track.kind}-track`;
    lane.dataset.boneId = track.boneId;
    if (track.kind === 'property') {
      label.dataset.property = track.property;
      lane.dataset.property = track.property;
    }
    let expand: HTMLButtonElement | undefined;
    if (track.kind === 'bone') {
      expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'timeline-expand';
      expand.addEventListener('click', () => {
        const state = this.state;
        if (state) state.setTimelineBoneExpanded(track.boneId, !state.isTimelineBoneExpanded(track.boneId));
      });
      label.append(expand);
    }
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'timeline-track-select';
    select.textContent = track.kind === 'bone' ? track.boneId : track.property;
    select.setAttribute(
      'aria-label',
      track.kind === 'bone' ? `Select bone ${track.boneId}` : `Select ${track.boneId} ${track.property} track`,
    );
    select.addEventListener('click', () => {
      if (track.kind === 'bone') this.state?.selectBone(track.boneId);
      else this.state?.selectTimelineProperty(track.boneId, track.property);
    });
    const indicator = document.createElement('span');
    indicator.className = 'timeline-key-presence';
    label.append(select, indicator);
    return { label, select, expand, indicator, lane };
  }

  render(state: AnimationEditorState): void {
    this.state = state;
    const tracks = state.timelineTracks;
    const changed = tracks !== this.tracks;
    if (changed) {
      this.tracks = tracks;
      const keys = new Set(tracks.map(trackKey));
      for (const key of this.rows.keys()) if (!keys.has(key)) this.rows.delete(key);
      const labels: HTMLElement[] = [];
      const lanes: HTMLElement[] = [];
      for (const track of tracks) {
        const key = trackKey(track);
        let row = this.rows.get(key);
        if (!row) {
          row = this.createRow(track);
          this.rows.set(key, row);
        }
        row.label.style.paddingLeft = `${4 + track.depth * 12}px`;
        for (const element of [row.label, row.lane]) setAttribute(element, 'data-has-keys', String(track.hasKeys));
        row.indicator.textContent = track.hasKeys ? '●' : '○';
        row.indicator.title = track.hasKeys ? 'Contains authored keys' : 'No authored keys';
        row.indicator.setAttribute('aria-label', row.indicator.title);
        if (row.expand && track.kind === 'bone') {
          row.expand.textContent = track.expanded ? '▼' : '▶';
          setAttribute(row.expand, 'aria-expanded', String(track.expanded));
          setAttribute(
            row.expand,
            'aria-label',
            `${track.expanded ? 'Collapse' : 'Expand'} ${track.boneId} properties`,
          );
        }
        labels.push(row.label);
        lanes.push(row.lane);
      }
      reconcileRows(this.labels, labels);
      reconcileRows(this.lanes, lanes);
      if (!tracks.length) {
        const empty = document.createElement('p');
        empty.className = 'timeline-empty';
        empty.textContent = 'No bones available.';
        this.labels.append(empty);
      }
    }
    if (
      !changed &&
      this.selectedBone === state.selectedBoneId &&
      this.selectedProperty === state.selectedTimelineProperty
    )
      return;
    this.selectedBone = state.selectedBoneId;
    this.selectedProperty = state.selectedTimelineProperty;
    for (const track of tracks) {
      const row = this.rows.get(trackKey(track))!;
      const selected =
        track.boneId === this.selectedBone && (track.kind === 'bone' || track.property === this.selectedProperty);
      for (const element of [row.label, row.lane]) setAttribute(element, 'data-selected', String(selected));
      setAttribute(row.select, 'aria-pressed', String(selected));
    }
  }

  dispose(): void {
    this.state = undefined;
    this.rows.clear();
    this.labels.replaceChildren();
    this.lanes.replaceChildren();
  }
}
