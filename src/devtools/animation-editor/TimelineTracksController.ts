import type { Keyframe } from '../../engine/AnimationClip.js';
import { ikAnimationProperties } from '../../engine/ik/animationKeyframes.js';
import { setAttribute } from '../../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { AnimationEventRef } from './animationEvents.js';
import { EventTrackController } from './EventTrackController.js';
import { ikTrackKey, type IKKeyframeSelection } from './ikTimeline.js';
import { interpolationLabel } from './interpolationPresentation.js';
import { keyIdentity, keyframeSelectionIndex, sameKey } from './keyframeSelection.js';
import { timeToTimelineX } from './timeline.js';
import { summarizeKeyframeTimes } from './timelineSummaries.js';
import { type KeyframeSelection, type TimelineTrack, timelineTrackKey } from './timelineTracks.js';

interface TrackElements {
  readonly label: HTMLElement;
  readonly select: HTMLButtonElement;
  readonly expand: HTMLButtonElement | undefined;
  readonly indicator: HTMLElement;
  /** Full-width time lane; marker centers share ruler/playhead coordinates. */
  readonly lane: HTMLElement;
  readonly markers: Map<number, HTMLButtonElement>;
  readonly summaries: Map<number, HTMLElement>;
  track?: TimelineTrack;
  summary?: { keys: readonly Keyframe[]; expanded: boolean; duration: number; width: number };
}

const emptyKeys: readonly Keyframe[] = Object.freeze([]);

type TimelineKey = KeyframeSelection | IKKeyframeSelection;
function isIKKey(key: TimelineKey): key is IKKeyframeSelection {
  return 'kind' in key;
}
function keyOwner(key: TimelineKey): string {
  return isIKKey(key) ? key.constraintId : key.boneId;
}
function trackOwner(track: TimelineTrack): string {
  return 'constraintId' in track ? track.constraintId : track.boneId;
}
function isProperty(track: TimelineTrack): track is Extract<TimelineTrack, { kind: 'property' | 'ik-property' }> {
  return track.kind === 'property' || track.kind === 'ik-property';
}
function trackKey(track: TimelineTrack): string {
  return 'constraintId' in track
    ? ikTrackKey(track.constraintId, track.kind === 'ik-property' ? track.property : null)
    : timelineTrackKey(track.boneId, track.kind === 'property' ? track.property : null);
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
  private readonly events: EventTrackController;
  private state: AnimationEditorState | undefined;
  private tracks: readonly TimelineTrack[] | undefined;
  private interpolation: AnimationEditorState['authoredInterpolation'];
  private readonly rows = new Map<string, TrackElements>();
  private selectedIK: AnimationEditorState['selectedTarget'] | undefined;
  private selectedIKKey: IKKeyframeSelection | null | undefined;
  private selectedBone: string | null | undefined;
  private selectedProperty: AnimationEditorState['selectedTimelineProperty'] | undefined;
  private selectedKey: KeyframeSelection | null | undefined;
  private selectedKeys: readonly KeyframeSelection[] | undefined;
  private width = -1;
  private duration = -1;
  private drag: AnimationEditorState['keyframeDrag'] | undefined;
  private summaryAnimation: AnimationEditorState['workingAnimation'] | undefined;

  constructor(
    private readonly labels: HTMLElement,
    private readonly lanes: HTMLElement,
    private readonly onKeyPointerDown: (event: PointerEvent, key: TimelineKey, marker: HTMLButtonElement) => void,
    onEventPointerDown?: (event: PointerEvent, ref: AnimationEventRef, marker: HTMLButtonElement) => void,
  ) {
    this.events = new EventTrackController(onEventPointerDown);
  }

  private createRow(track: TimelineTrack): TrackElements {
    const label = document.createElement('div');
    label.className = `timeline-track-label timeline-${track.kind}-track`;
    if ('constraintId' in track) label.dataset.constraintId = track.constraintId;
    else label.dataset.boneId = track.boneId;
    const lane = document.createElement('div');
    lane.className = `timeline-track-lane timeline-${track.kind}-track`;
    if ('constraintId' in track) lane.dataset.constraintId = track.constraintId;
    else lane.dataset.boneId = track.boneId;
    if (isProperty(track)) {
      label.dataset.property = track.property;
      lane.dataset.property = track.property;
    }
    let expand: HTMLButtonElement | undefined;
    if (track.kind === 'bone' || track.kind === 'ik') {
      expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'timeline-expand';
      expand.addEventListener('click', () => {
        const state = this.state;
        if (state) {
          if (track.kind === 'ik')
            state.setTimelineIKExpanded(track.constraintId, !state.isTimelineIKExpanded(track.constraintId));
          else state.setTimelineBoneExpanded(track.boneId, !state.isTimelineBoneExpanded(track.boneId));
        }
      });
      label.append(expand);
    }
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'timeline-track-select';
    select.textContent =
      track.kind === 'ik'
        ? `IK: ${track.constraintId}`
        : track.kind === 'bone'
          ? track.boneId
          : track.property === 'mix'
            ? 'mix (influence)'
            : track.property;
    select.setAttribute(
      'aria-label',
      track.kind === 'ik'
        ? `Select IK target ${track.constraintId}`
        : track.kind === 'bone'
          ? `Select bone ${track.boneId}`
          : `Select ${trackOwner(track)} ${track.property} track`,
    );
    select.addEventListener('click', () => {
      if ('constraintId' in track)
        this.state?.selectIKConstraint(track.constraintId, track.kind === 'ik-property' ? track.property : null);
      else if (track.kind === 'bone') this.state?.selectBone(track.boneId);
      else this.state?.selectTimelineProperty(track.boneId, track.property);
    });
    const indicator = document.createElement('span');
    indicator.className = 'timeline-key-presence';
    label.append(select, indicator);
    return { label, select, expand, indicator, lane, markers: new Map(), summaries: new Map() };
  }

  private selectMarker(key: TimelineKey, modifiers: { additive: boolean; range: boolean }): void {
    if (isIKKey(key)) this.state?.selectIKKeyframe(key);
    else this.state?.selectKeyframe(key, modifiers);
  }

  render(state: AnimationEditorState, width: number): void {
    this.state = state;
    this.events.render(state, width);
    const tracks = state.timelineTracks;
    const changed = tracks !== this.tracks;
    const summariesChanged = changed || this.summaryAnimation !== state.workingAnimation;
    this.summaryAnimation = state.workingAnimation;
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
        if (row.expand && (track.kind === 'bone' || track.kind === 'ik')) {
          row.expand.textContent = track.expanded ? '▼' : '▶';
          setAttribute(row.expand, 'aria-expanded', String(track.expanded));
          setAttribute(
            row.expand,
            'aria-label',
            `${track.expanded ? 'Collapse' : 'Expand'} ${trackOwner(track)} properties`,
          );
        }
        if (isProperty(track)) {
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
              marker.addEventListener('contextmenu', () => {
                if (button.getAttribute('aria-pressed') !== 'true')
                  this.selectMarker(keyframe, { additive: false, range: false });
              });
              marker.addEventListener('click', (event) => {
                if (event.detail === 0)
                  this.selectMarker(keyframe, {
                    additive: event.ctrlKey || event.metaKey,
                    range: event.shiftKey,
                  });
              });
              row.markers.set(keyframe.time, marker);
            }
            const description = `Select ${keyOwner(keyframe)} ${keyframe.property} key at ${keyframe.time} s`;
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
        if (!track || !isProperty(track) || (!interpolationChanged && !changedRows.has(row))) continue;
        for (const key of track.keyframes) {
          const marker = row.markers.get(key.time)!;
          const segment = isIKKey(key) ? undefined : state.getSegmentInterpolation(key);
          setAttribute(marker, 'data-interpolation', segment?.mode ?? 'unavailable');
          const interpolation = isIKKey(key)
            ? `${interpolationLabel(state.authoredInterpolation ?? 'linear')} (inherited from clip)`
            : segment
              ? `${interpolationLabel(segment.mode)} (inherited from clip)`
              : 'Unavailable (no outgoing segment)';
          setAttribute(
            marker,
            'title',
            `${keyOwner(key)}.${key.property}\nTime: ${key.time.toFixed(3)} s (value ${key.value})\nInterpolation: ${interpolation}`,
          );
        }
      }
    }
    const resized = width !== this.width || state.duration !== this.duration;
    if (summariesChanged || resized) {
      for (const row of this.rows.values()) {
        const track = row.track;
        if (!track || (track.kind !== 'bone' && track.kind !== 'ik')) continue;
        const authored = track.kind === 'ik' ? state.workingAnimation?.ikTracks : state.workingAnimation?.tracks;
        const id = trackOwner(track);
        const keys = authored && Object.hasOwn(authored, id) ? authored[id]! : emptyKeys;
        const summary = row.summary;
        if (
          summary?.keys === keys &&
          summary.expanded === track.expanded &&
          summary.duration === state.duration &&
          summary.width === width
        )
          continue;
        row.summary = { keys, expanded: track.expanded, duration: state.duration, width };
        const times = track.expanded
          ? new Set<number>()
          : summarizeKeyframeTimes(
              keys,
              state.duration,
              width,
              track.kind === 'ik' ? ikAnimationProperties : undefined,
            );
        for (const [time, marker] of row.summaries) {
          if (times.has(time)) continue;
          marker.remove();
          row.summaries.delete(time);
        }
        for (const time of times) {
          let marker = row.summaries.get(time);
          if (!marker) {
            marker = document.createElement('span');
            marker.className = 'timeline-summary';
            marker.setAttribute('aria-hidden', 'true');
            row.lane.append(marker);
            row.summaries.set(time, marker);
          }
          const left = `${timeToTimelineX(time, state.duration, width)}px`;
          if (marker.style.left !== left) marker.style.left = left;
        }
      }
    }
    const previousDrag = this.drag;
    this.width = width;
    this.duration = state.duration;
    this.drag = state.keyframeDrag;
    if (changed || resized || previousDrag !== this.drag) {
      const moving = keyframeSelectionIndex(this.drag?.originalKeys ?? []);
      const position = (ref: TimelineKey, marker: HTMLButtonElement): void => {
        const dragging = !isIKKey(ref) && moving.has(keyIdentity(ref));
        marker.style.left = `${timeToTimelineX(dragging ? ref.time + this.drag!.previewDelta : ref.time, this.duration, width)}px`;
        setAttribute(marker, 'data-dragging', String(dragging));
      };
      const positionedRows = resized ? new Set(this.rows.values()) : changedRows;
      for (const row of positionedRows) {
        const track = row.track;
        if (!track || !isProperty(track)) continue;
        for (const key of track.keyframes) position(key, row.markers.get(key.time)!);
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
      this.selectedIK === state.selectedTarget &&
      this.selectedIKKey === state.selectedIKKeyframe &&
      this.selectedBone === state.selectedBoneId &&
      this.selectedProperty === state.selectedTimelineProperty &&
      this.selectedKey === state.primaryKey &&
      this.selectedKeys === state.selectedKeys
    )
      return;
    const previousKeys = this.selectedKeys ?? [];
    const previousPrimary = this.selectedKey;
    this.selectedIK = state.selectedTarget;
    this.selectedIKKey = state.selectedIKKeyframe;
    this.selectedBone = state.selectedBoneId;
    this.selectedProperty = state.selectedTimelineProperty;
    this.selectedKey = state.primaryKey;
    this.selectedKeys = state.selectedKeys;
    const selectionIndex = keyframeSelectionIndex(this.selectedKeys);
    for (const track of tracks) {
      const row = this.rows.get(trackKey(track))!;
      const selected =
        'constraintId' in track
          ? track.constraintId === state.selectedIKConstraintId &&
            (track.kind === 'ik' || track.property === state.selectedIKProperty)
          : track.boneId === this.selectedBone && (track.kind === 'bone' || track.property === this.selectedProperty);
      if (track.kind === 'ik-property')
        for (const key of track.keyframes) {
          const marker = row.markers.get(key.time)!;
          const active =
            this.selectedIKKey?.constraintId === key.constraintId &&
            this.selectedIKKey.property === key.property &&
            this.selectedIKKey.time === key.time;
          setAttribute(marker, 'aria-pressed', String(active));
          setAttribute(marker, 'data-primary', String(active));
        }
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

  /** Keep original row indices for marquee selection while changing only visibility. */
  filter(state: AnimationEditorState): void {
    const visibility = state.timelineVisibility;
    const setHidden = (label: HTMLElement, lane: HTMLElement, hidden: boolean): void => {
      if (hidden && !label.hidden && (label.contains(document.activeElement) || lane.contains(document.activeElement)))
        this.lanes.parentElement?.focus({ preventScroll: true });
      if (label.hidden !== hidden) label.hidden = hidden;
      if (lane.hidden !== hidden) lane.hidden = hidden;
    };
    setHidden(this.events.label, this.events.lane, !visibility.eventVisible);
    for (const row of this.rows.values()) {
      const track = row.track!;
      setHidden(row.label, row.lane, !visibility.rows.has(track));
      setAttribute(row.label, 'data-filter-context', String(visibility.context.has(track)));
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
