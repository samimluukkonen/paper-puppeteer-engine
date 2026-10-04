import type { IKTarget } from '../engine/index.js';
import { assertFinite } from '../engine/types.js';

type Side = 'left' | 'right';
type Feet = Readonly<Record<Side, IKTarget>>;
export type FootSoles = Readonly<Record<Side, { toe: IKTarget; heel: IKTarget }>>;
export const SKETCH_HEEL_STRIKE_ANGLE = -0.14;

export interface WalkFootIK {
  target: IKTarget;
  mix: number;
  /** Foot angle before the outer facing mirror; negative lifts the toes. */
  rotation?: number;
}

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

/** Keep the authored stride; plant during contact and release for heel rise and swing. */
export function demoWalkFootIK(
  time: number,
  duration: number,
  ground: Feet,
  animated: Feet,
): Readonly<Record<Side, WalkFootIK>> {
  assertFinite(time, 'Walk time');
  assertFinite(duration, 'Walk duration');
  if (duration <= 0) throw new Error('Walk duration must be greater than zero.');
  const phase = (((time % duration) + duration) % duration) / duration;
  const foot = (side: Side): WalkFootIK => {
    const step = (phase + (side === 'right' ? 0.5 : 0)) % 1;
    const mix =
      step < 0.4
        ? 1
        : step < 0.6
          ? 1 - smoothstep((step - 0.4) / 0.2)
          : step < 0.9
            ? 0
            : smoothstep((step - 0.9) / 0.1);
    return { target: { x: animated[side].x, y: Math.min(animated[side].y, ground[side].y) }, mix };
  };
  return { left: foot('left'), right: foot('right') };
}

/** Heel-first landing, flat loading, heel rise before toe-off, then a toe-clearing swing. */
export function sketchWalkFootIK(
  time: number,
  duration: number,
  ground: Feet,
  direction: 1 | -1,
  soles: FootSoles,
  forwardReaches: Readonly<Record<Side, number>>,
): Readonly<Record<Side, WalkFootIK>> {
  assertFinite(time, 'Walk time');
  assertFinite(duration, 'Walk duration');
  if (duration <= 0) throw new Error('Walk duration must be greater than zero.');
  const phase = (((time % duration) + duration) % duration) / duration;
  const backwardReach = 62;
  const foot = (side: Side): WalkFootIK => {
    const forwardReach = forwardReaches[side];
    const travel = forwardReach + backwardReach;
    const step = (phase + (side === 'right' ? 0.5 : 0)) % 1;
    const swing = Math.max(0, (step - 0.6) / 0.4);
    const lift = Math.sin(Math.PI * swing) ** 2;
    const stride = step < 0.6 ? forwardReach - travel * (step / 0.6) : -backwardReach + travel * smoothstep(swing);
    const rotation =
      step < 0.1
        ? SKETCH_HEEL_STRIKE_ANGLE * (1 - smoothstep(step / 0.1))
        : step < 0.6
          ? 0.24 * smoothstep(Math.max(0, (step - 0.35) / 0.25))
          : 0.24 * (1 - smoothstep(Math.min(1, swing / 0.35))) -
            0.18 * lift +
            SKETCH_HEEL_STRIKE_ANGLE * smoothstep(Math.max(0, (step - 0.85) / 0.15));
    const { toe, heel } = soles[side];
    const rotated = (point: IKTarget): IKTarget => ({
      x: point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
      y: point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
    });
    const rotatedToe = rotated(toe);
    const rotatedHeel = rotated(heel);
    // Roll about the heel when loading, then about the toe before push-off.
    const pivotMix = step < 0.6 ? 1 : 1 - smoothstep(Math.min(1, swing / 0.35));
    const heelPivotX = heel.x - rotatedHeel.x;
    const landingMix = smoothstep(Math.max(0, (step - 0.85) / 0.15));
    const pivotX = step < 0.1 ? heelPivotX : (toe.x - rotatedToe.x) * pivotMix + heelPivotX * landingMix;
    const soleRise = Math.max(rotatedToe.y, rotatedHeel.y) - Math.max(toe.y, heel.y);
    return {
      target: { x: ground[side].x + direction * (stride + pivotX), y: ground[side].y - soleRise - 10 * lift },
      mix: 1,
      rotation,
    };
  };
  return { left: foot('left'), right: foot('right') };
}
