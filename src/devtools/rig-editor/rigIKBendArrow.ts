import type { Affine, Point, BendDirection } from '../../engine/data.js';

/** Screen-sized signed-turn indicator in the start bone's basis, including reflection/shear.
 * `basis` maps start-bone vectors to the screen; translation is deliberately unused.
 */
export function rigIKBendArrow(center: Point, axis: Point, bend: BendDirection, basis: Affine) {
  const start = Math.atan2(axis.y, axis.x);
  const arc: Point[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const angle = start + bend * (index / 8) * Math.PI * 0.75;
    const x = basis.a * Math.cos(angle) + basis.c * Math.sin(angle);
    const y = basis.b * Math.cos(angle) + basis.d * Math.sin(angle);
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length === 0) return { arc: [], head: [] };
    arc.push({ x: center.x + (20 * x) / length, y: center.y + (20 * y) / length });
  }
  const tip = arc[8]!;
  const previous = arc[7]!;
  const length = Math.hypot(tip.x - previous.x, tip.y - previous.y);
  if (length === 0) return { arc: [], head: [] };
  const dx = (tip.x - previous.x) / length;
  const dy = (tip.y - previous.y) / length;
  return {
    arc,
    head: [
      { x: tip.x - dx * 7 + dy * 4, y: tip.y - dy * 7 - dx * 4 },
      tip,
      { x: tip.x - dx * 7 - dy * 4, y: tip.y - dy * 7 + dx * 4 },
    ],
  };
}
