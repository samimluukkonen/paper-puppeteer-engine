/** Keep filenames portable without changing the authored asset identity or manifest path. */
function safeFilename(name: string): string {
  const sanitized = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || /[<>:"/\\|?*]/.test(character) ? '_' : character,
  )
    .join('')
    .replace(/[. ]+$/, '');
  if (!sanitized) return 'animation.json';
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
