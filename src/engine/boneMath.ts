import type { BoneDefinition } from './types.js';

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

/** Resolve the logical joint offset using the parent's explicit length, when present. */
export function computeBonePosition(bone: BoneDefinition, parent?: BoneDefinition): { x: number; y: number } {
  const x = bone.x ?? 0;
  const y = bone.y ?? 0;
  const length = parent?.length;
  if (length === undefined) return { x, y };
  const direction = normalizeBoneDirection(x, y) ?? { x: 0, y: 1 };
  return {
    x: direction.x * length,
    y: direction.y * length,
  };
}
