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

export function localToWorld(point: Point, matrix: Affine): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

export function worldToLocal(point: Point, matrix: Affine): Point | undefined {
  if (![point.x, point.y, ...Object.values(matrix)].every(Number.isFinite)) return undefined;
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
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  const x = point.x - matrix.tx;
  const y = point.y - matrix.ty;
  const local = { x: (d * x - c * y) / det / scaleX, y: (a * y - b * x) / det / scaleY };
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : undefined;
}
