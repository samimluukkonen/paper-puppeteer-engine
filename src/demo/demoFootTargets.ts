import type { IKTarget } from '../engine/index.js';
import { walk } from './demoAnimations.js';

type Side = 'left' | 'right';
type Feet = Readonly<Record<Side, IKTarget>>;

export interface WalkFootIK {
  target: IKTarget;
  mix: number;
}

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

/** Keep the authored stride; plant during contact and release for heel rise and swing. */
export function demoWalkFootIK(
  time: number, ground: Feet, animated: Feet,
): Readonly<Record<Side, WalkFootIK>> {
  const phase = ((time % walk.duration) + walk.duration) % walk.duration / walk.duration;
  const foot = (side: Side): WalkFootIK => {
    const step = (phase + (side === 'right' ? 0.5 : 0)) % 1;
    const mix = step < 0.4 ? 1
      : step < 0.6 ? 1 - smoothstep((step - 0.4) / 0.2)
        : step < 0.9 ? 0 : smoothstep((step - 0.9) / 0.1);
    return { target: { x: animated[side].x,
      y: Math.min(animated[side].y, ground[side].y) }, mix };
  };
  return { left: foot('left'), right: foot('right') };
}
