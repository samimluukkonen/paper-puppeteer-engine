import type { AnimationPose } from '../../engine/AnimationPose.js';
import type { Rig } from '../../engine/Rig.js';
import { getEvaluatedAnimationPose } from './animationValues.js';
import type { AnimationData } from './keyframeTargets.js';
import { DEFAULT_KEYFRAME_FPS } from './timeline.js';
import { type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

export interface GhostSamplingSettings {
  /** Optional spacing rate; absent uses authored stepped FPS, then the shared 10 FPS fallback. */
  readonly fps?: number;
  /** Positive integer authored frames between the playhead and each neighbor; defaults to one. */
  readonly frameSpacing?: number;
}

export interface GhostSampleTime {
  /** Continuous editor seconds, before playback sample-timing rules are applied. */
  readonly time: Seconds;
  readonly direction: 'previous' | 'next';
}

export interface GhostPoseSample extends GhostSampleTime {
  /** Complete detached local transforms in the existing pose type, before procedural IK. */
  readonly pose: AnimationPose;
}

/** Pure time arithmetic: at most one previous and one next sample, never wrapping or snapping the clock. */
export function getGhostSampleTimes(
  currentTime: Seconds,
  duration: Seconds,
  settings: GhostSamplingSettings = {},
): GhostSampleTime[] {
  if (
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    currentTime < 0 ||
    currentTime > duration
  )
    return [];
  const frames = settings.frameSpacing ?? 1;
  if (!Number.isSafeInteger(frames) || frames <= 0) return [];
  const fps =
    settings.fps !== undefined && Number.isFinite(settings.fps) && settings.fps > 0
      ? settings.fps
      : DEFAULT_KEYFRAME_FPS;
  const spacing = frames / fps;
  if (!Number.isFinite(spacing) || spacing <= 0) return [];
  const samples: GhostSampleTime[] = [];
  // Normalize only arithmetic roundoff at endpoints, never a genuinely out-of-range neighbor.
  const tolerance = Math.min(spacing / 4, 4 * Number.EPSILON * Math.max(currentTime, spacing));
  for (const direction of ['previous', 'next'] as const) {
    const candidate = currentTime + (direction === 'previous' ? -spacing : spacing);
    if (!Number.isFinite(candidate) || candidate < -tolerance || candidate > duration + tolerance) continue;
    const time = Math.max(0, Math.min(candidate, duration));
    if (direction === 'previous' ? time >= currentTime : time <= currentTime) continue;
    samples.push({ time, direction });
  }
  return samples;
}

/** Sample any in-range authored time without applying it to the active Puppet.
 * Missing/zero-duration animation and invalid times produce no pose. Invalid authored data still uses
 * existing evaluator validation. Future read-only IK may consume this detached pose and the rig.
 */
export function sampleGhostPose(
  animation: AnimationData | null,
  rig: Rig | undefined,
  time: Seconds,
): AnimationPose | undefined {
  if (
    !animation ||
    !rig ||
    !Number.isFinite(animation.duration) ||
    animation.duration <= 0 ||
    !Number.isFinite(time) ||
    time < 0 ||
    time > toSeconds(animation.duration)
  )
    return undefined;
  const timeMs =
    time === toSeconds(animation.duration) ? animation.duration : Math.min(toMilliseconds(time), animation.duration);
  return getEvaluatedAnimationPose(animation, rig, timeMs);
}

/** Working-copy orchestration without clocks, events, history, renderer or IK access. */
export function sampleGhostPoses(
  animation: AnimationData | null,
  rig: Rig | undefined,
  currentTime: Seconds,
  settings: GhostSamplingSettings = {},
): GhostPoseSample[] {
  if (!animation || !rig) return [];
  const fps = settings.fps ?? (animation.playback?.mode === 'stepped' ? animation.playback.fps : DEFAULT_KEYFRAME_FPS);
  const times = getGhostSampleTimes(currentTime, toSeconds(animation.duration), { ...settings, fps });
  return times.map((sample) => ({ ...sample, pose: sampleGhostPose(animation, rig, sample.time)! }));
}
