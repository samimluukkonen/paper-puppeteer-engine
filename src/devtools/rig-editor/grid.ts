import { type Affine, localToWorld, type Point, worldToLocal } from './coordinates.js';

export interface GridLine {
  start: Point;
  end: Point;
  /** Zero is the local axis; every other index is also a snap multiple. */
  index: number;
}

function readableStride(minimum: number): number {
  const scale = 10 ** Math.floor(Math.log10(minimum));
  for (const choice of [1, 2, 5, 10]) {
    const stride = choice * scale;
    if (stride >= minimum) return stride;
  }
  return 10 * scale;
}

/** Screen-space lines for a local snapping grid; show each step when pixels permit. */
export function gridLines(localToScreen: Affine, width: number, height: number, snap: number): GridLine[] {
  if (
    snap <= 0 ||
    width <= 0 ||
    height <= 0 ||
    ![snap, width, height, ...(Object.values(localToScreen) as unknown[])].every(Number.isFinite)
  )
    return [];
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((corner) => worldToLocal(corner, localToScreen));
  if (corners.some((corner) => !corner || !Number.isFinite(corner.x) || !Number.isFinite(corner.y))) return [];
  const points = corners as Point[];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const xPixels = Math.hypot(localToScreen.a, localToScreen.b) * snap;
  const yPixels = Math.hypot(localToScreen.c, localToScreen.d) * snap;
  const xStride = readableStride(Math.max(1, 0.95 / xPixels, (maxX - minX) / (snap * 800)));
  const yStride = readableStride(Math.max(1, 0.95 / yPixels, (maxY - minY) / (snap * 800)));
  const lines: GridLine[] = [];
  const add = (minimum: number, maximum: number, stride: number, vertical: boolean): void => {
    const first = Math.ceil(minimum / (snap * stride)) * stride;
    const last = Math.floor(maximum / (snap * stride)) * stride;
    if (![first, last, stride].every(Number.isFinite)) return;
    let index = first;
    // Bound work even when rounding expands the range. At large coordinates,
    // adding a stride can leave the index unchanged because of precision loss.
    for (let count = 0; count <= 800 && index <= last; count += 1) {
      const coordinate = index * snap;
      lines.push({
        index,
        start: localToWorld(vertical ? { x: coordinate, y: minY } : { x: minX, y: coordinate }, localToScreen),
        end: localToWorld(vertical ? { x: coordinate, y: maxY } : { x: maxX, y: coordinate }, localToScreen),
      });
      const next = index + stride;
      if (next <= index) break;
      index = next;
    }
  };
  add(minX, maxX, xStride, true);
  add(minY, maxY, yStride, false);
  return lines;
}
