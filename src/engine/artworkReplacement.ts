/** Logical artwork identities are independent of filenames and skin/slot selection. */
export type ArtworkReference = `bone:${string}` | `attachment:${string}`;

export interface ArtworkReplacement {
  readonly textureKey: string;
  /** Multipliers on the authored normalized origin; 1 preserves normalized coordinates. */
  readonly originScaleX: number;
  readonly originScaleY: number;
}

export interface ArtworkUsage {
  readonly reference: ArtworkReference;
  readonly texture: string;
  readonly frame?: string | number | undefined;
  readonly slots: readonly string[];
  readonly skins: readonly string[];
}

export type ArtworkAlignmentPolicy = 'normalized' | 'pixels' | 'manual';

/** Pixel preservation composes across replacements rather than resetting to the source size. */
export function replacementOriginScale(
  policy: ArtworkAlignmentPolicy,
  previous: { width: number; height: number; originScaleX: number; originScaleY: number },
  next: { width: number; height: number },
): Pick<ArtworkReplacement, 'originScaleX' | 'originScaleY'> {
  return {
    originScaleX: previous.originScaleX * (policy === 'pixels' ? previous.width / next.width : 1),
    originScaleY: previous.originScaleY * (policy === 'pixels' ? previous.height / next.height : 1),
  };
}
