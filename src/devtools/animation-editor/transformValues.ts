import type { TransformProperty } from '../../engine/data.js';

/** The inspector uses degrees; authored keys and the runtime retain radians, including multiple turns. */
export function toDisplayTransformValue(property: TransformProperty, value: number): number {
  return property === 'rotation' ? value * (180 / Math.PI) : value;
}

export function toLocalTransformValue(property: TransformProperty, value: number): number {
  return property === 'rotation' ? value * (Math.PI / 180) : value;
}
