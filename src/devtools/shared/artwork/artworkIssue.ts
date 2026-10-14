import type Phaser from 'phaser';

/** Phaser's get() falls back to a placeholder; check existence explicitly for actionable diagnostics. */
export function artworkIssue(
  textures: Phaser.Textures.TextureManager,
  key: string,
  frame?: string | number,
): string | undefined {
  if (!textures.exists(key))
    return `Missing texture "${key}". Add this key and image path to character.json, then reload the character.`;
  if (frame !== undefined && !textures.get(key).has(String(frame)))
    return `Invalid frame "${frame}" in texture "${key}". Choose an existing frame or leave Frame empty for a whole image.`;
  return undefined;
}
