/** Default character texture limits. Phaser-free so the /core barrel's declarations stay Phaser-free. */
export const DEFAULT_CHARACTER_TEXTURE_LIMITS = Object.freeze({
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalImageBytes: 50 * 1024 * 1024,
  maxImageDimension: 8192,
  maxImagePixels: 16 * 1024 * 1024,
  maxTotalImagePixels: 64 * 1024 * 1024,
});
