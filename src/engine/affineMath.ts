import type { JointTransform } from './types.js';

export interface Point {
  x: number;
  y: number;
}
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** The joint/Phaser convention is T(x, y) R(rotation) diag(scaleX, scaleY). */
export function transformToAffine(transform: Readonly<JointTransform>, result: Affine): Affine {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  result.a = cos * transform.scaleX;
  result.b = sin * transform.scaleX;
  result.c = -sin * transform.scaleY;
  result.d = cos * transform.scaleY;
  result.tx = transform.x;
  result.ty = transform.y;
  return result;
}

/** Compose parent * local. The result must be distinct from both inputs. */
export function composeAffine(local: Affine, parent: Affine | undefined, result: Affine): Affine {
  if (!parent) return Object.assign(result, local);
  result.a = parent.a * local.a + parent.c * local.b;
  result.b = parent.b * local.a + parent.d * local.b;
  result.c = parent.a * local.c + parent.c * local.d;
  result.d = parent.b * local.c + parent.d * local.d;
  result.tx = parent.a * local.tx + parent.c * local.ty + parent.tx;
  result.ty = parent.b * local.tx + parent.d * local.ty + parent.ty;
  return result;
}

export function localToWorld(point: Point, matrix: Affine): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

/** Invert an affine transform using an axis-relative determinant tolerance.
 * Zero accepts any nonsingular transform whose local result remains finite.
 */
export function worldToLocal(point: Point, matrix: Affine, relativeDeterminantTolerance = 1e-12): Point | undefined {
  if (![point.x, point.y, matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].every(Number.isFinite))
    return undefined;
  // Normalize each axis before checking invertibility. The determinant's
  // magnitude should depend on the angle between axes, not their authored scale.
  const scaleX = Math.max(Math.abs(matrix.a), Math.abs(matrix.b));
  const scaleY = Math.max(Math.abs(matrix.c), Math.abs(matrix.d));
  if (scaleX === 0 || scaleY === 0) return undefined;
  const a = matrix.a / scaleX;
  const b = matrix.b / scaleX;
  const c = matrix.c / scaleY;
  const d = matrix.d / scaleY;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0 || Math.abs(det) < relativeDeterminantTolerance) return undefined;
  const x = point.x - matrix.tx;
  const y = point.y - matrix.ty;
  const local = { x: (d * x - c * y) / det / scaleX, y: (a * y - b * x) / det / scaleY };
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : undefined;
}
