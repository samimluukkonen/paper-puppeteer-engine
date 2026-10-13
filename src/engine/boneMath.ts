/** Unit direction for finite joint offsets; zero offsets have no recoverable direction. */
export function normalizeBoneDirection(x: number, y: number): { x: number; y: number } | undefined {
  const magnitude = Math.max(Math.abs(x), Math.abs(y));
  if (magnitude === 0) return undefined;
  const distance = Math.hypot(x, y);
  // Keep ordinary rounding unchanged. Scale extreme offsets before normalization
  // so neither an overflowing norm nor subnormal rounding changes the direction.
  if (Number.isFinite(distance) && distance >= 2.2250738585072014e-308) return { x: x / distance, y: y / distance };
  const scaledX = x / magnitude;
  const scaledY = y / magnitude;
  const scaledDistance = Math.hypot(scaledX, scaledY);
  return { x: scaledX / scaledDistance, y: scaledY / scaledDistance };
}
