import { Rig, sourceDigest } from '../../engine/core.js';

const digestPrefix = 'sha256-v1:';
const digestPattern = /^sha256-v1:[0-9a-f]{64}$/;

/** Project the session rig only; similarly named objects inside event payloads remain authored data. */
function authoredSource(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const source = data as Record<string, unknown>;
  const rig = source.rig;
  if (rig === null || typeof rig !== 'object' || Array.isArray(rig)) return data;
  const record = rig as Record<string, unknown>;
  // Earlier animation drafts serialized the enumerable runtime indexes and derived
  // render order as well as the skeleton. Accept that representation during migration.
  if (
    !(rig instanceof Rig) &&
    !(
      Object.hasOwn(record, 'definitions') &&
      Object.hasOwn(record, 'slotDefinitions') &&
      Object.hasOwn(record, 'attachmentDefinitions') &&
      Array.isArray(record.bones) &&
      Array.isArray(record.renderOrder)
    )
  )
    return data;
  return {
    ...source,
    rig: Object.fromEntries(
      ['root', 'bones', 'slots', 'attachments', 'skins', 'ik']
        .filter((field) => Object.hasOwn(record, field))
        .map((field) => [field, record[field]]),
    ),
  };
}

function canonicalSource(data: unknown): string {
  const source = JSON.stringify(authoredSource(data), (_key, value: unknown) => {
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

/** Fixed-size, versioned identity for owned authored data; array order remains meaningful. */
export function draftSource(data: unknown): string {
  return `${digestPrefix}${sourceDigest(canonicalSource(data))}`;
}

/** Accept earlier raw/canonical JSON fingerprints while preserving authored-change detection. */
export function sameDraftSource(stored: string, current: string): boolean {
  if (stored === current) return true;
  try {
    const identity = (source: string): string => {
      if (digestPattern.test(source)) return source;
      const data: unknown = JSON.parse(source);
      return draftSource(data);
    };
    return identity(stored) === identity(current);
  } catch {
    return false;
  }
}
