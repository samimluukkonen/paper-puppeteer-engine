import type { Keyframe } from '../../engine/AnimationClip.js';
import { transformProperties } from '../../engine/types.js';
import { timeToTimelineX } from './timeline.js';
import { type Seconds, toSeconds } from './timeUnits.js';

/** Match the summary diamond's CSS width; property keys retain their exact, separate markers. */
export const TIMELINE_SUMMARY_WIDTH = 7;

/** One representative authored timestamp per diamond-width interval at the current zoom. */
export function summarizeKeyframeTimes(keys: readonly Keyframe[], duration: Seconds, width: number): Set<Seconds> {
  const buckets = new Map<number, Seconds>();
  for (const key of keys) {
    if (!transformProperties.some((property) => key[property] !== undefined)) continue;
    const time = toSeconds(key.time);
    const bucket = Math.floor(timeToTimelineX(time, duration, width) / TIMELINE_SUMMARY_WIDTH);
    // Keep an authored endpoint visible even when it shares the last interval with a nearby key.
    if (!buckets.has(bucket) || time === duration) buckets.set(bucket, time);
  }
  return new Set(buckets.values());
}
