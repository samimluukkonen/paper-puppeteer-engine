import { setAttribute } from '../../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { EventTrackController } from './EventTrackController.js';
import { interpolationLabel } from './interpolationPresentation.js';
import { keyIdentity, keyframeSelectionIndex, sameKey } from './keyframeSelection.js';
import { timeToTimelineX } from './timeline.js';
import { type KeyframeSelection, type TimelineTrack, timelineTrackKey } from './timelineTracks.js';

interface TrackElements {
  readonly label: HTMLElement;
  readonly select: HTMLButtonElement;
  readonly expand: HTMLButtonElement | undefined;
  readonly indicator: HTMLElement;
  /** Full-width time lane; marker centers share ruler/playhead coordinates. */
  readonly lane: HTMLElement;
  readonly markers: Map<number, HTMLButtonElement>;
  track?: TimelineTrack;
}

function trackKey(track: TimelineTrack): string {
  return timelineTrackKey(track.boneId, track.kind === 'property' ? track.property : null);
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
  private readonly events = new EventTrackController();
  private state: AnimationEditorState | undefined;
  private tracks: readonly TimelineTrack[] | undefined;
  private interpolation: AnimationEditorState['authoredInterpolation'];
  private readonly rows = new Map<string, TrackElements>();
  private selectedBone: string | null | undefined;
  private selectedProperty: AnimationEditorState['selectedTimelineProperty'] | undefined;
  private selectedKey: KeyframeSelection | null | undefined;
  private selectedKeys: readonly KeyframeSelection[] | undefined;
  private width = -1;
  private duration = -1;
  private drag: AnimationEditorState['keyframeDrag'] | undefined;

  constructor(
    private readonly labels: HTMLElement,
    private readonly lanes: HTMLElement,
    private readonly onKeyPointerDown: (event: PointerEvent, key: KeyframeSelection, marker: HTMLButtonElement) => void,
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
    return { label, select, expand, indicator, lane, markers: new Map() };
  }

  render(state: AnimationEditorState, width: number): void {
    this.state = state;
    this.events.render(state, width);
    const tracks = state.timelineTracks;
    const changed = tracks !== this.tracks;
    const interpolationChanged = this.interpolation !== state.authoredInterpolation;
    this.interpolation = state.authoredInterpolation;
    const changedRows = new Set<TrackElements>();
    const newMarkers = new Set<HTMLButtonElement>();
    if (changed) {
      this.tracks = tracks;
      const keys = new Set(tracks.map(trackKey));
      for (const key of this.rows.keys()) if (!keys.has(key)) this.rows.delete(key);
      const labels: HTMLElement[] = [this.events.label];
      const lanes: HTMLElement[] = [this.events.lane];
      for (const track of tracks) {
        const key = trackKey(track);
        let row = this.rows.get(key);
        if (!row) {
          row = this.createRow(track);
          this.rows.set(key, row);
        }
        labels.push(row.label);
        lanes.push(row.lane);
        if (row.track === track) continue;
        changedRows.add(row);
        row.track = track;
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
        if (track.kind === 'property') {
          const times = new Set(track.keyframes.map((key) => key.time));
          for (const [time, marker] of row.markers) {
            if (times.has(time)) continue;
            if (document.activeElement === marker) this.lanes.parentElement?.focus({ preventScroll: true });
            marker.remove();
            row.markers.delete(time);
          }
          for (const keyframe of track.keyframes) {
            let marker = row.markers.get(keyframe.time);
            if (!marker) {
              marker = document.createElement('button');
              marker.type = 'button';
              marker.className = 'timeline-keyframe';
              marker.dataset.time = String(keyframe.time);
              setAttribute(marker, 'data-primary', 'false');
              setAttribute(marker, 'aria-pressed', 'false');
              newMarkers.add(marker);
              // Markers own clicks; they must not begin a scrub or resume playback on release.
              const button = marker;
              marker.addEventListener('pointerdown', (event) => this.onKeyPointerDown(event, keyframe, button));
              marker.addEventListener('click', (event) => {
                if (event.detail === 0)
                  this.state?.selectKeyframe(keyframe, {
                    additive: event.ctrlKey || event.metaKey,
                    range: event.shiftKey,
                  });
              });
              row.markers.set(keyframe.time, marker);
            }
            const description = `Select ${keyframe.boneId} ${keyframe.property} key at ${keyframe.time} s`;
            setAttribute(marker, 'aria-label', description);
          }
          reconcileRows(
            row.lane,
            track.keyframes.map((keyframe) => row.markers.get(keyframe.time)!),
          );
        }
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
    // Metadata-only edits retain authored track/marker identities. Refresh independently of row reconciliation.
    if (changed || interpolationChanged) {
      for (const row of this.rows.values()) {
        const track = row.track;
        if (track?.kind !== 'property' || (!interpolationChanged && !changedRows.has(row))) continue;
        for (const key of track.keyframes) {
          const marker = row.markers.get(key.time)!;
          const segment = state.getSegmentInterpolation(key);
          setAttribute(marker, 'data-interpolation', segment?.mode ?? 'unavailable');
          const interpolation = segment
            ? `${interpolationLabel(segment.mode)} (inherited from clip)`
            : 'Unavailable (no outgoing segment)';
          setAttribute(
            marker,
            'title',
            `${key.boneId}.${key.property}\nTime: ${key.time.toFixed(3)} s (value ${key.value})\nInterpolation: ${interpolation}`,
          );
        }
      }
    }
    const resized = width !== this.width || state.duration !== this.duration;
    const previousDrag = this.drag;
    this.width = width;
    this.duration = state.duration;
    this.drag = state.keyframeDrag;
    if (changed || resized || previousDrag !== this.drag) {
      const moving = keyframeSelectionIndex(this.drag?.originalKeys ?? []);
      const position = (ref: KeyframeSelection, marker: HTMLButtonElement): void => {
        const dragging = moving.has(keyIdentity(ref));
        marker.style.left = `${timeToTimelineX(dragging ? ref.time + this.drag!.previewDelta : ref.time, this.duration, width)}px`;
        setAttribute(marker, 'data-dragging', String(dragging));
      };
      const positionedRows = resized ? new Set(this.rows.values()) : changedRows;
      for (const row of positionedRows) {
        const track = row.track;
        if (track?.kind !== 'property') continue;
        for (const [time, marker] of row.markers) {
          position({ boneId: track.boneId, property: track.property, time }, marker);
        }
      }
      if (previousDrag !== this.drag) {
        const affected = keyframeSelectionIndex([
          ...(previousDrag?.originalKeys ?? []),
          ...(this.drag?.originalKeys ?? []),
        ]);
        for (const ref of affected.values()) {
          const row = this.rows.get(timelineTrackKey(ref.boneId, ref.property));
          const marker = row?.markers.get(ref.time);
          if (row && marker && !positionedRows.has(row)) position(ref, marker);
        }
      }
    }
    if (
      !changed &&
      this.selectedBone === state.selectedBoneId &&
      this.selectedProperty === state.selectedTimelineProperty &&
      this.selectedKey === state.primaryKey &&
      this.selectedKeys === state.selectedKeys
    )
      return;
    const previousKeys = this.selectedKeys ?? [];
    const previousPrimary = this.selectedKey;
    this.selectedBone = state.selectedBoneId;
    this.selectedProperty = state.selectedTimelineProperty;
    this.selectedKey = state.primaryKey;
    this.selectedKeys = state.selectedKeys;
    const selectionIndex = keyframeSelectionIndex(this.selectedKeys);
    for (const track of tracks) {
      const row = this.rows.get(trackKey(track))!;
      const selected =
        track.boneId === this.selectedBone && (track.kind === 'bone' || track.property === this.selectedProperty);
      for (const element of [row.label, row.lane]) setAttribute(element, 'data-selected', String(selected));
      setAttribute(row.select, 'aria-pressed', String(selected));
    }
    const previousIndex = keyframeSelectionIndex(previousKeys);
    const affected = keyframeSelectionIndex([
      ...previousKeys,
      ...this.selectedKeys,
      ...(previousPrimary ? [previousPrimary] : []),
      ...(this.selectedKey ? [this.selectedKey] : []),
    ]);
    for (const ref of affected.values()) {
      const marker = this.rows.get(timelineTrackKey(ref.boneId, ref.property))?.markers.get(ref.time);
      if (!marker) continue;
      const id = keyIdentity(ref);
      const selected = selectionIndex.has(id);
      const primary = this.selectedKey !== null && sameKey(this.selectedKey, ref);
      const wasPrimary = !!previousPrimary && sameKey(previousPrimary, ref);
      if (!newMarkers.has(marker) && selected === previousIndex.has(id) && primary === wasPrimary) continue;
      setAttribute(marker, 'data-primary', String(primary));
      setAttribute(marker, 'aria-pressed', String(selected));
    }
  }

  dispose(): void {
    this.events.dispose();
    this.state = undefined;
    this.rows.clear();
    this.labels.replaceChildren();
    this.lanes.replaceChildren();
  }
}
