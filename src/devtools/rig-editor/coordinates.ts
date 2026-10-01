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
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  const x = point.x - matrix.tx;
  const y = point.y - matrix.ty;
  return { x: (matrix.d * x - matrix.c * y) / det, y: (-matrix.b * x + matrix.a * y) / det };
}
