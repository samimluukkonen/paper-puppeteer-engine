import { evaluateCurveProgress } from '../../engine/animationCurves.js';
import { interpolateNumber, quantizePlaybackTime } from '../../engine/animationMath.js';
import type { ReadonlyAnimation } from './AnimationEditorState.js';
import type { RootLoopMode, WorldDisplacementMode } from './worldDisplacement.js';

export interface PreviewPositionKey {
  /** Animation milliseconds, matching authored clip and preview sample times. */
  readonly time: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface MotionPreviewSettings {
  readonly enabled: boolean;
  /** Optional for legacy saved preferences; enabled trajectories migrate to preview mode. */
  readonly displacementMode?: WorldDisplacementMode | undefined;
  readonly rootLoopMode?: RootLoopMode | undefined;
  readonly positionKeys: readonly PreviewPositionKey[];
  readonly interpolation: 'linear' | 'stepped';
  readonly showTrajectory: boolean;
}

export const DEFAULT_MOTION_PREVIEW: MotionPreviewSettings = Object.freeze({
  enabled: false,
  displacementMode: 'authored',
  rootLoopMode: 'reset',
  positionKeys: Object.freeze([]),
  interpolation: 'linear',
  showTrajectory: true,
});

/** Share the pose evaluator's held-frame timing, including its exact endpoint exception. */
export function motionPreviewSampleTime(animation: ReadonlyAnimation | null, time: number): number {
  return animation && time !== animation.duration
    ? quantizePlaybackTime(time, animation.playback ?? { mode: 'smooth' })
    : time;
}

export function validPreviewPositionKeys(keys: readonly PreviewPositionKey[]): boolean {
  return keys.every(
    (key, index) =>
      [key.time, key.offsetX, key.offsetY].every(Number.isFinite) &&
      key.time >= 0 &&
      (index === 0 || key.time > keys[index - 1]!.time),
  );
}

/** Stateless world offsets. Hold endpoints, interpolate segments, never integrate previous positions. */
export function evaluatePreviewDisplacement(
  settings: MotionPreviewSettings,
  animationTime: number,
): { x: number; y: number } {
  const keys = settings.positionKeys;
  if (!settings.enabled || !Number.isFinite(animationTime) || !keys.length || !validPreviewPositionKeys(keys))
    return { x: 0, y: 0 };
  let start = keys[0]!;
  for (const end of keys.slice(1)) {
    if (animationTime < end.time) {
      const progress = evaluateCurveProgress(
        { mode: settings.interpolation },
        (animationTime - start.time) / (end.time - start.time),
      );
      return {
        x: interpolateNumber(start.offsetX, end.offsetX, progress),
        y: interpolateNumber(start.offsetY, end.offsetY, progress),
      };
    }
    start = end;
  }
  return { x: start.offsetX, y: start.offsetY };
}
