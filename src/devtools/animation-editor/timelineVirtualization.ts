import type { TimelineTrack } from './timelineTracks.js';

/** Shared with --timeline-row-height and the sticky ruler in style.css. */
export const TIMELINE_ROW_HEIGHT = 30;
export const TIMELINE_RULER_HEIGHT = 36;
const ROW_OVERSCAN = 2;
export const TIMELINE_MARKER_OVERSCAN = 12;

export interface TimelineTrackViewport {
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly width: number;
}

/** Keep authored row indices even when filtering compacts the displayed rows. */
export function timelineRowLayout(tracks: readonly TimelineTrack[], visible: ReadonlySet<TimelineTrack>) {
  return tracks.flatMap((track, index) => (visible.has(track) ? [{ track, index }] : []));
}

export function timelineRowWindow(count: number, top: number, height: number, prefixHeight: number) {
  const first = Math.min(count, Math.max(0, Math.floor((top - prefixHeight) / TIMELINE_ROW_HEIGHT) - ROW_OVERSCAN));
  const end = Math.max(
    first,
    Math.min(count, Math.ceil((top + height - prefixHeight) / TIMELINE_ROW_HEIGHT) + ROW_OVERSCAN),
  );
  return { first, end };
}

/** Sorted model keys are searched without visiting offscreen timestamps. Endpoints are inclusive. */
export function timelineKeysInRange<T extends { readonly time: number }>(
  keys: readonly T[],
  start: number,
  end: number,
): readonly T[] {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle]!.time < start) low = middle + 1;
    else high = middle;
  }
  const first = low;
  high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle]!.time <= end) low = middle + 1;
    else high = middle;
  }
  return keys.slice(first, low);
}
