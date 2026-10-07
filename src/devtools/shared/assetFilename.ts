/** Export an asset's URL basename without query/fragment metadata, preserving literal percent signs. */
export function assetFilename(path: string | undefined, fallback: string): string {
  if (!path) return fallback;
  const basename = new URL(path, 'https://character.invalid/').pathname.split('/').at(-1);
  if (!basename) return fallback;
  try {
    return decodeURIComponent(basename);
  } catch {
    return basename;
  }
}
