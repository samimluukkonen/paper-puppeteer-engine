/**
 * Keep filenames portable without changing the authored asset identity or manifest path.
 * Returns the sanitized `fallback` when nothing is left after sanitizing `name`, and
 * `animation.json` when the fallback sanitizes to nothing too.
 */
export function safeFilename(name: string, fallback = 'animation.json'): string {
  return sanitizeFilename(name) || sanitizeFilename(fallback) || 'animation.json';
}

function sanitizeFilename(name: string): string {
  const sanitized = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || /[<>:"/\\|?*]/.test(character) ? '_' : character,
  )
    .join('')
    .replace(/[. ]+$/, '');
  if (!sanitized) return '';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized) ? `_${sanitized}` : sanitized;
}

/** Export a safe URL basename without query/fragment metadata, preserving literal percent signs. */
export function assetFilename(path: string | undefined, fallback: string): string {
  if (!path) return safeFilename(fallback);
  let basename: string | undefined;
  try {
    basename = new URL(path, 'https://character.invalid/').pathname.split('/').at(-1);
  } catch {
    return safeFilename(fallback);
  }
  if (!basename) return safeFilename(fallback);
  try {
    return safeFilename(decodeURIComponent(basename));
  } catch {
    return safeFilename(basename);
  }
}
