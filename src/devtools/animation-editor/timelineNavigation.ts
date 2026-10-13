import { quantizePlaybackTime } from '../../engine/animationMath.js';
import { clampTime, timelineXToTime, timeToTimelineX } from './timeline.js';
import { type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

export const MIN_TIMELINE_ZOOM = 1;
export const MAX_TIMELINE_ZOOM = 128;

/** Native scroll offsets and content dimensions are CSS pixels; time remains continuous seconds. */
export interface TimelineViewport {
  readonly duration: Seconds;
  readonly viewportWidth: number;
  readonly contentWidth: number;
  readonly scrollLeft: number;
}

export function clampTimelineZoom(zoom: number): number {
  return Number.isNaN(zoom) ? 1 : Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, zoom));
}

export function panTimeline(view: TimelineViewport, offset: number): number {
  const maximum = Math.max(0, view.contentWidth - view.viewportWidth);
  return Number.isNaN(offset) ? 0 : Math.max(0, Math.min(maximum, offset));
}

export function timeToViewportX(time: Seconds, view: TimelineViewport): number {
  return timeToTimelineX(time, view.duration, view.contentWidth) - view.scrollLeft;
}

export function viewportXToTime(x: number, view: TimelineViewport): Seconds {
  return timelineXToTime(x + view.scrollLeft, view.duration, view.contentWidth);
}

/** Preserve the time at the requested viewport pixel, subject to native scroll boundaries. */
export function zoomTimeline(view: TimelineViewport, zoom: number, anchorX: number): TimelineViewport {
  const anchor = Math.max(0, Math.min(view.viewportWidth, anchorX));
  const time = viewportXToTime(anchor, view);
  const next = { ...view, contentWidth: view.viewportWidth * clampTimelineZoom(zoom) };
  return { ...next, scrollLeft: panTimeline(next, timeToTimelineX(time, view.duration, next.contentWidth) - anchor) };
}

export function centerTimelineTime(view: TimelineViewport, time: Seconds): number {
  return panTimeline(view, timeToTimelineX(time, view.duration, view.contentWidth) - view.viewportWidth / 2);
}

export function fitTimelineAnimation(view: TimelineViewport): TimelineViewport {
  return { ...view, contentWidth: view.viewportWidth, scrollLeft: 0 };
}

/** Include all compatible selected times, regardless of track visibility. Single keys get an 8× view. */
export function fitTimelineSelection(view: TimelineViewport, times: readonly Seconds[]): TimelineViewport | null {
  const valid = times.filter((time) => Number.isFinite(time) && time >= 0 && time <= view.duration);
  if (!valid.length) return null;
  let start = valid[0]!;
  let end = start;
  for (const time of valid) {
    start = Math.min(start, time);
    end = Math.max(end, time);
  }
  const span = end - start;
  const zoom = span > 0 ? (view.duration / span) * 0.8 : 8;
  const next = { ...view, contentWidth: view.viewportWidth * clampTimelineZoom(zoom) };
  return { ...next, scrollLeft: centerTimelineTime(next, start / 2 + end / 2) };
}

/** Scroll only near an edge; paused scrubs and ordinary visible playback never move the viewport. */
export function followTimelineTime(view: TimelineViewport, time: Seconds): number {
  const x = timeToViewportX(time, view);
  const margin = Math.min(48, view.viewportWidth * 0.1);
  if (x < margin) return panTimeline(view, view.scrollLeft + x - view.viewportWidth * 0.8);
  if (x > view.viewportWidth - margin) return panTimeline(view, view.scrollLeft + x - view.viewportWidth * 0.2);
  return view.scrollLeft;
}

export function timelineTimeToFrame(time: Seconds, duration: Seconds, fps: number): number | null {
  if (!(fps > 0) || !Number.isFinite(fps)) return null;
  const sampled = toSeconds(quantizePlaybackTime(toMilliseconds(clampTime(time, duration)), { mode: 'stepped', fps }));
  const frame = Math.round(sampled * fps);
  return Number.isSafeInteger(frame) ? frame : null;
}

export function timelineFrameToTime(frame: number, duration: Seconds, fps: number): Seconds | null {
  if (!(fps > 0) || !Number.isFinite(fps) || !Number.isSafeInteger(frame)) return null;
  return clampTime(frame / fps, duration);
}
