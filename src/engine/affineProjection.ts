import type { Affine } from './affineMath.js';

export interface AffineFactors {
  rotation: number;
  scaleX: number;
  scaleY: number;
  innerRotation: number;
  innerScale: number;
}

/** A = R(outer) diag(sx, sy) R(inner) scale(magnitude), including reflection and singular matrices.
 * A second rotation preserves shear that a single Phaser position/rotation/scale cannot express.
 */
export function factorAffine(matrix: Affine, result: AffineFactors): AffineFactors {
  const magnitude = Math.max(Math.abs(matrix.a), Math.abs(matrix.b), Math.abs(matrix.c), Math.abs(matrix.d));
  if (magnitude === 0) {
    result.rotation = result.innerRotation = 0;
    result.scaleX = result.scaleY = 0;
    result.innerScale = 1;
    return result;
  }
  // Keep the singular values normalized and apply magnitude in the inner factor,
  // avoiding overflow when finite coefficients have a singular value above Number.MAX_VALUE.
  const a = matrix.a / magnitude;
  const b = matrix.b / magnitude;
  const c = matrix.c / magnitude;
  const d = matrix.d / magnitude;
  const p = (a + d) / 2;
  const q = (b - c) / 2;
  const r = (a - d) / 2;
  const s = (b + c) / 2;
  const first = Math.atan2(q, p);
  const second = Math.atan2(s, r);
  result.rotation = (first + second) / 2;
  result.innerRotation = (first - second) / 2;
  result.scaleX = Math.hypot(p, q) + Math.hypot(r, s);
  // The determinant retains small second axes more accurately than subtracting singular values.
  result.scaleY = (a * d - b * c) / result.scaleX;
  result.innerScale = magnitude;
  return result;
}
