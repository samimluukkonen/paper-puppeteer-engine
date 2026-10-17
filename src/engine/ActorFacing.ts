import type { Puppet } from './Puppet.js';
import { assertFinite } from './types.js';

/** Internal shared policy for one-time targeting and movement. Distances are world units. */
export function faceWorldDirection(puppet: Puppet, horizontalDistance: number): void {
  assertFinite(horizontalDistance, 'Facing horizontal distance');
  if (Math.abs(horizontalDistance) <= 1e-8) return;
  const matrix = puppet.container.getWorldTransformMatrix();
  assertFinite(matrix.a, 'Facing world axis x');
  assertFinite(matrix.b, 'Facing world axis y');
  // Remove the current mirror from the world-space right axis. Reflected/rotated parents
  // can reverse its horizontal direction; a vertical or collapsed axis cannot face either side.
  const axisScale = Math.max(Math.abs(matrix.a), Math.abs(matrix.b));
  if (axisScale === 0 || Math.abs(matrix.a / axisScale) <= 1e-12) return;
  const rightAxisX = matrix.a * (puppet.facingDirection === 'left' ? -1 : 1);
  const facing = Math.sign(horizontalDistance) === Math.sign(rightAxisX) ? 'right' : 'left';
  if (puppet.facingDirection !== facing) puppet.setFacing(facing);
}
