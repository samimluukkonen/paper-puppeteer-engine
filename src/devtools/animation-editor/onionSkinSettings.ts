/** Transient scene preferences, never authored animation data or history. Zero hides a direction. */
export interface OnionSkinSettings {
  readonly enabled: boolean;
  readonly previousCount: number;
  readonly nextCount: number;
  readonly frameSpacing: number;
  readonly previousOpacity: number;
  readonly nextOpacity: number;
  readonly previousTint: number;
  readonly nextTint: number;
}

export const DEFAULT_ONION_SKIN_SETTINGS: OnionSkinSettings = Object.freeze({
  enabled: false,
  previousCount: 1,
  nextCount: 1,
  frameSpacing: 1,
  previousOpacity: 0.22,
  nextOpacity: 0.22,
  previousTint: 0x65a9ed,
  nextTint: 0xf0a15d,
});

function bounded(value: number | undefined, fallback: number, min: number, max: number, integer = false): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const clamped = Math.max(min, Math.min(max, value));
  return integer ? Math.round(clamped) : clamped;
}

/** Finite inputs clamp to control bounds; absent/nonfinite inputs retain the current preference. */
export function updateOnionSkinSettings(
  current: OnionSkinSettings,
  patch: Partial<OnionSkinSettings>,
): OnionSkinSettings {
  return Object.freeze({
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    previousCount: bounded(patch.previousCount, current.previousCount, 0, 3, true),
    nextCount: bounded(patch.nextCount, current.nextCount, 0, 3, true),
    frameSpacing: bounded(patch.frameSpacing, current.frameSpacing, 1, 5, true),
    previousOpacity: bounded(patch.previousOpacity, current.previousOpacity, 0.05, 0.6),
    nextOpacity: bounded(patch.nextOpacity, current.nextOpacity, 0.05, 0.6),
    previousTint: bounded(patch.previousTint, current.previousTint, 0, 0xffffff, true),
    nextTint: bounded(patch.nextTint, current.nextTint, 0, 0xffffff, true),
  });
}
