/** Canonical source identity for owned editor data; array order remains meaningful. */
export function draftSource(data: unknown): string {
  const source = JSON.stringify(data, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
  if (source === undefined) throw new Error('A draft source must be serializable.');
  return source;
}

/** Accept earlier raw JSON fingerprints without mistaking formatting for authored changes. */
export function sameDraftSource(stored: string, current: string): boolean {
  if (stored === current) return true;
  try {
    const before: unknown = JSON.parse(stored);
    const after: unknown = JSON.parse(current);
    return draftSource(before) === draftSource(after);
  } catch {
    return false;
  }
}
