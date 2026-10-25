import { localToWorld, worldToLocal, type Affine, type Point } from '../../engine/affineMath.js';

/** Root translation uses the puppet's linear placement transform, never a pelvis/bone transform. */
export function rootMotionMatrix(matrix: Affine, origin: Point): Affine {
  return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: origin.x, ty: origin.y };
}
export const rootPositionToWorld = (point: Point, matrix: Affine): Point => localToWorld(point, matrix);
export function pointerToRootPosition(
  pointer: Point,
  camera: { getWorldPoint(x: number, y: number): Point },
  matrix: Affine,
): Point | undefined {
  return worldToLocal(camera.getWorldPoint(pointer.x, pointer.y), matrix);
}
