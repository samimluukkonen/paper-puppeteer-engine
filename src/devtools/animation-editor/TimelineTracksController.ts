import { ikAnimationProperties } from '../../engine/core.js';
import type { Keyframe } from '../../engine/data.js';
import { setAttribute } from '../../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { AnimationEventRef } from './animationEvents.js';
import { EventTrackController } from './EventTrackController.js';
import { ikTrackKey, type IKKeyframeSelection } from './ikTimeline.js';
import { interpolationLabel } from './interpolationPresentation.js';
import { keyIdentity, keyframeSelectionIndex, sameKey } from './keyframeSelection.js';
import type { MeshDeformationController } from './MeshDeformationController.js';
import type { RootMotionController } from './RootMotionController.js';
import { timeToTimelineX } from './timeline.js';
import { summarizeKeyframeTimes } from './timelineSummaries.js';
import { type KeyframeSelection, type TimelineTrack, timelineTrackKey } from './timelineTracks.js';
import {
  timelineKeysInRange,
  timelineRowLayout,
  timelineRowWindow,
  TIMELINE_MARKER_OVERSCAN,
  TIMELINE_ROW_HEIGHT,
  type TimelineTrackViewport,
} from './timelineVirtualization.js';

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
  visibleKeys?: readonly TimelineMarkerKey[];
  summary?: {
    keys: readonly Keyframe[];
    expanded: boolean;
    duration: number;
    width: number;
    times: readonly { time: number }[];
  };
}

const emptyKeys: readonly Keyframe[] = Object.freeze([]);

type TimelineKey = KeyframeSelection | IKKeyframeSelection;
type TimelineMarkerKey = Extract<TimelineTrack, { kind: 'property' | 'ik-property' }>['keyframes'][number];
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
  private deformationRevision = -1;
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
  private viewportKey = '';
  private rangeKey = '';
  private visibility: AnimationEditorState['timelineVisibility'] | undefined;
  private visibilityRendered: AnimationEditorState['timelineVisibility'] | undefined;
  private layout: ReturnType<typeof timelineRowLayout> = [];
  private readonly labelSpacers = [this.spacer(), this.spacer()];
  private readonly laneSpacers = [this.spacer(), this.spacer()];

  private spacer(): HTMLElement {
    const spacer = document.createElement('div');
    spacer.className = 'timeline-virtual-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }

  private remove(element: HTMLElement): void {
    if (element.contains(document.activeElement)) this.lanes.parentElement?.focus({ preventScroll: true });
    element.remove();
  }

  constructor(
    private readonly labels: HTMLElement,
    private readonly lanes: HTMLElement,
    private readonly onKeyPointerDown: (event: PointerEvent, key: TimelineKey, marker: HTMLButtonElement) => void,
    onEventPointerDown?: (event: PointerEvent, ref: AnimationEventRef, marker: HTMLButtonElement) => void,
    private readonly root?: RootMotionController,
    private readonly deformation?: MeshDeformationController,
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

  render(state: AnimationEditorState, width: number, viewport: TimelineTrackViewport): void {
    this.state = state;
    this.events.render(state, width);
    const visibility = state.timelineVisibility;
    if (state.timelineTracks !== this.tracks || visibility !== this.visibility) {
      this.layout = timelineRowLayout(state.timelineTracks, visibility.rows);
      this.visibility = visibility;
    }
    const prefixHeight =
      (this.root?.lanes.filter((lane) => !lane.hidden).length ?? 0) * TIMELINE_ROW_HEIGHT +
      (visibility.eventVisible ? state.eventTimelineTrack.stackCount * TIMELINE_ROW_HEIGHT : 0);
    const { first, end } = timelineRowWindow(this.layout.length, viewport.top, viewport.height, prefixHeight);
    const tracks = this.layout.slice(first, end).map(({ track }) => track);
    const rangeKey = `${viewport.left}:${viewport.width}:${width}:${state.duration}`;
    const rangeChanged = this.rangeKey !== rangeKey;
    this.rangeKey = rangeKey;
    const viewportKey = `${first}:${end}:${rangeKey}`;
    const viewportChanged = this.viewportKey !== viewportKey;
    const changed =
      state.timelineTracks !== this.tracks ||
      viewportChanged ||
      visibility !== this.visibilityRendered ||
      this.deformationRevision !== (this.deformation?.revision ?? -1) ||
      this.drag !== state.keyframeDrag;
    this.viewportKey = viewportKey;
    this.visibilityRendered = visibility;
    const startTime = ((viewport.left - TIMELINE_MARKER_OVERSCAN) / Math.max(1, width)) * state.duration;
    const endTime = ((viewport.left + viewport.width + TIMELINE_MARKER_OVERSCAN) / Math.max(1, width)) * state.duration;
    const movingKeys = keyframeSelectionIndex(state.keyframeDrag?.originalKeys ?? []);
    const delta = state.keyframeDrag?.previewDelta ?? 0;
    this.deformationRevision = this.deformation?.revision ?? -1;
    const summariesChanged = changed || this.summaryAnimation !== state.workingAnimation;
    this.summaryAnimation = state.workingAnimation;
    const interpolationChanged = this.interpolation !== state.authoredInterpolation;
    this.interpolation = state.authoredInterpolation;
    const changedRows = new Set<TrackElements>();
    const newMarkers = new Set<HTMLButtonElement>();
    if (changed) {
      this.tracks = state.timelineTracks;
      const keys = new Set(tracks.map(trackKey));
      for (const [key, row] of this.rows)
        if (!keys.has(key)) {
          this.remove(row.label);
          this.remove(row.lane);
          this.rows.delete(key);
        }
      const labels: HTMLElement[] = [...(this.root?.labels ?? []), this.events.label, this.labelSpacers[0]!];
      const lanes: HTMLElement[] = [...(this.root?.lanes ?? []), this.events.lane, this.laneSpacers[0]!];
      for (const track of tracks) {
        const key = trackKey(track);
        let row = this.rows.get(key);
        if (!row) {
          row = this.createRow(track);
          this.rows.set(key, row);
        }
        labels.push(row.label);
        lanes.push(row.lane);
        const trackChanged = row.track !== track;
        if (!trackChanged && !viewportChanged && this.drag === state.keyframeDrag) continue;
        changedRows.add(row);
        row.track = track;
        if (trackChanged) {
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
        }
        if (isProperty(track)) {
          const visible = new Map(
            timelineKeysInRange<TimelineMarkerKey>(track.keyframes, startTime, endTime).map((key) => [key.time, key]),
          );
          if (delta && track.kind === 'property')
            for (const key of timelineKeysInRange(track.keyframes, startTime - delta, endTime - delta))
              if (movingKeys.has(keyIdentity(key))) visible.set(key.time, key);
          for (const [time, key] of visible) {
            const preview = time + (!isIKKey(key) && movingKeys.has(keyIdentity(key)) ? delta : 0);
            if (preview < startTime || preview > endTime) visible.delete(time);
          }
          row.visibleKeys = [...visible.values()];
          const times = new Set(visible.keys());
          for (const [time, marker] of row.markers) {
            if (times.has(time)) continue;
            if (document.activeElement === marker) this.lanes.parentElement?.focus({ preventScroll: true });
            marker.remove();
            row.markers.delete(time);
          }
          for (const keyframe of row.visibleKeys) {
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
              marker.addEventListener('contextmenu', (event) => {
                // macOS emits contextmenu after Control-click. The pointer handler already
                // toggled this key; selecting it again would replace the remaining group.
                if (event.ctrlKey) {
                  event.preventDefault();
                  return;
                }
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
            row.visibleKeys.map((keyframe) => row.markers.get(keyframe.time)!),
          );
        }
      }
      for (const spacers of [this.labelSpacers, this.laneSpacers]) {
        spacers[0]!.style.height = `${first * TIMELINE_ROW_HEIGHT}px`;
        spacers[1]!.style.height = `${(this.layout.length - end) * TIMELINE_ROW_HEIGHT}px`;
      }
      labels.push(this.labelSpacers[1]!, ...(this.deformation?.labels ?? []));
      lanes.push(this.laneSpacers[1]!, ...(this.deformation?.lanes ?? []));
      reconcileRows(this.labels, labels);
      reconcileRows(this.lanes, lanes);
      if (!state.timelineTracks.length) {
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
        for (const key of row.visibleKeys ?? []) {
          const marker = row.markers.get(key.time)!;
          const segment = isIKKey(key) ? undefined : state.getSegmentInterpolation(key);
          const ikCurve = isIKKey(key)
            ? state.findIKPropertyKeyframe(key.constraintId, key.property, key.time)?.curve
            : undefined;
          setAttribute(marker, 'data-interpolation', ikCurve?.mode ?? segment?.mode ?? 'unavailable');
          const interpolation = isIKKey(key)
            ? `${interpolationLabel(ikCurve?.mode ?? state.authoredInterpolation ?? 'linear')} (${ikCurve ? 'property override' : 'inherited from clip'})`
            : segment
              ? `${interpolationLabel(segment.mode)} (${segment.scope === 'property' ? 'property override' : 'inherited from clip'})`
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
          summary.width === width &&
          !rangeChanged
        )
          continue;
        if (
          summary?.keys !== keys ||
          summary.expanded !== track.expanded ||
          summary.duration !== state.duration ||
          summary.width !== width
        ) {
          const times = track.expanded
            ? new Set<number>()
            : summarizeKeyframeTimes(
                keys,
                state.duration,
                width,
                track.kind === 'ik' ? ikAnimationProperties : undefined,
              );
          row.summary = {
            keys,
            expanded: track.expanded,
            duration: state.duration,
            width,
            times: [...times].map((time) => ({ time })),
          };
        }
        const times = new Set(timelineKeysInRange(row.summary!.times, startTime, endTime).map(({ time }) => time));
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
        for (const key of row.visibleKeys ?? []) position(key, row.markers.get(key.time)!);
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
        for (const key of row.visibleKeys ?? []) {
          if (!isIKKey(key)) continue;
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

  /** Event visibility and context presentation; property filtering precedes DOM allocation. */
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
    this.tracks = undefined;
    this.visibility = undefined;
    this.visibilityRendered = undefined;
    this.layout = [];
    this.summaryAnimation = undefined;
    this.rows.clear();
    this.labels.replaceChildren();
    this.lanes.replaceChildren();
  }
}
