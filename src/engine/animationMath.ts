import type { AnimationPlaybackMode } from './AnimationClip.js';

/** Use the same negative half-turn tie for keyframe interpolation and pose blending. */
export function shortestRotationDelta(from: number, to: number): number {
  const turn = 2 * Math.PI;
  const difference = to - from;
  // Opposite finite extremes can overflow subtraction; reduce them before subtracting.
  const delta = Number.isFinite(difference) ? difference : (to % turn) - (from % turn);
  return ((((delta + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** Preserve ordinary interpolation precision, avoiding an overflowing difference at finite extremes. */
export function interpolateNumber(from: number, to: number, weight: number): number {
  if (weight <= 0) return from;
  if (weight >= 1) return to;
  const difference = to - from;
  return Number.isFinite(difference) ? from + difference * weight : from * (1 - weight) + to * weight;
}

/** Quantize milliseconds with a small tolerance at frame boundaries. Callers retain exact endpoints. */
export function quantizePlaybackTime(time: number, mode: AnimationPlaybackMode): number {
  if (mode.mode === 'smooth') return time;
  const step = 1000 / mode.fps;
  // A finite positive FPS can still produce an infinite interval. No finite
  // sample time reaches its next frame; nonlooping endpoints bypass this helper.
  if (!Number.isFinite(step)) return 0;
  const frames = time / step;
  // At this precision the interval cannot distinguish adjacent sample times.
  if (!Number.isFinite(frames)) return time;
  // Keep the boundary tolerance below a frame, including at extremely high FPS.
  const tolerance = Math.min(1e-9 / step, 1e-7);
  const quantized = Math.floor(frames + tolerance) * step;
  return Number.isFinite(quantized) ? quantized : time;
}
