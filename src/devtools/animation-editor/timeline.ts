import { type Milliseconds, type Seconds, toSeconds } from './timeUnits.js';

/** Editor coordinates use continuous seconds; external clips and the runtime use milliseconds. */
export function animationDurationSeconds(animation: { readonly duration: Milliseconds } | null): Seconds {
  return animation && Number.isFinite(animation.duration) ? Math.max(0, toSeconds(animation.duration)) : 0;
}

export function clampTime(time: Seconds, duration: Seconds): Seconds {
  if (Number.isNaN(time) || !(duration > 0) || !Number.isFinite(duration)) return 0;
  return Math.max(0, Math.min(time, duration));
}

export function timeToTimelineX(time: Seconds, duration: Seconds, width: number): number {
  return duration > 0 && width > 0 && Number.isFinite(width) ? (clampTime(time, duration) / duration) * width : 0;
}

export function timelineXToTime(x: number, duration: Seconds, width: number): Seconds {
  return width > 0 && Number.isFinite(width) ? clampTime((x / width) * duration, duration) : 0;
}

export type KeyframeSnapMode = 'none' | 'frame';
export const DEFAULT_KEYFRAME_FPS = 10;

/** Editor-only nearest-frame snapping in seconds, clamped again for off-frame endpoints. */
export function snapKeyframeTime(time: Seconds, duration: Seconds, mode: KeyframeSnapMode, fps?: number): Seconds {
  const clamped = clampTime(time, duration);
  if (mode === 'none' || clamped === 0 || clamped === duration) return clamped;
  const rate = fps !== undefined && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_KEYFRAME_FPS;
  const frame = clamped * rate;
  return Number.isFinite(frame) ? clampTime(Math.round(frame) / rate, duration) : clamped;
}

export interface RulerTick {
  readonly time: Seconds;
  readonly major: boolean;
  readonly label: string | null;
}

/** Fit major labels about 80px apart using 1/2/2.5/5 decade intervals, with four subdivisions.
 * Integer tick indices avoid accumulated floating point drift. Endpoints are always included.
 */
export function generateRulerTicks(duration: Seconds, width: number): readonly RulerTick[] {
  const start: RulerTick = { time: 0, major: true, label: '0 s' };
  if (!(duration > 0) || !Number.isFinite(duration) || !(width > 0) || !Number.isFinite(width)) return [start];
  const target = duration / Math.max(1, Math.min(100, Math.floor(width / 80)));
  const decade = 10 ** Math.floor(Math.log10(target));
  const majorStep = ([1, 2, 2.5, 5, 10].find((step) => step * decade >= target) ?? 10) * decade;
  const minorStep = majorStep / 4;
  if (!(minorStep > 0) || !Number.isFinite(majorStep))
    return [start, { time: duration, major: true, label: `${duration} s` }];
  const precision = Math.min(12, Math.max(0, -Math.floor(Math.log10(majorStep)) + 1));
  const label = (time: number): string => `${Number(time.toFixed(precision))} s`;
  const ticks: RulerTick[] = [start];
  const count = Math.min(400, Math.ceil(duration / minorStep));
  for (let index = 1; index < count; index += 1) {
    const time = index * minorStep;
    if (time >= duration) break;
    const major = index % 4 === 0;
    ticks.push({ time, major, label: major ? label(time) : null });
  }
  ticks.push({ time: duration, major: true, label: label(duration) });
  return ticks;
}
