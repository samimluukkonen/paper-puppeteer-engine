import type { AnimationPlaybackMode } from './AnimationClip.js';

/** Use the same negative half-turn tie for keyframe interpolation and pose blending. */
export function shortestRotationDelta(from: number, to: number): number {
  const turn = 2 * Math.PI;
  return ((((to - from + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** Quantize milliseconds with a small tolerance at frame boundaries. Callers retain exact endpoints. */
export function quantizePlaybackTime(time: number, mode: AnimationPlaybackMode): number {
  if (mode.mode === 'smooth') return time;
  const step = 1000 / mode.fps;
  return Math.floor((time + 1e-9) / step) * step;
}
