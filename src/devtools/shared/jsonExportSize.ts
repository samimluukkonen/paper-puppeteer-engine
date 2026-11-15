import { DEFAULT_MAX_JSON_BYTES, JsonInputLimitError, validateInputLimit, isFullyFrozen } from '../../engine/core.js';

const sizes = new WeakMap<object, Map<number, number>>();
const encoder = new TextEncoder();
const stringBytes = (value: string): number => encoder.encode(JSON.stringify(value)).byteLength;

/** Count the two-space JSON export, reusing unchanged immutable branches at the same indentation. */
function formattedBytes(value: unknown, depth: number): number {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const text = JSON.stringify(value);
    return encoder.encode(text).byteLength;
  }
  if (typeof value !== 'object') throw new Error('Export size checks require validated JSON data.');
  const cached = sizes.get(value)?.get(depth);
  if (cached !== undefined) return cached;
  const array = Array.isArray(value);
  const entries: [string, unknown][] = Object.entries(value);
  // Brackets plus closing newline/indentation; each entry adds its leading newline,
  // indentation and separator. Empty containers have no formatting whitespace.
  let bytes = entries.length ? 3 + 2 * depth : 2;
  for (const [index, [key, child]] of entries.entries()) {
    bytes += 1 + 2 * (depth + 1) + (index > 0 ? 1 : 0);
    if (!array) bytes += stringBytes(key) + 2;
    bytes += formattedBytes(child, depth + 1);
  }
  if (isFullyFrozen(value)) {
    let depths = sizes.get(value);
    if (!depths) sizes.set(value, (depths = new Map<number, number>()));
    depths.set(depth, bytes);
  }
  return bytes;
}

/** Input must already be validated JSON. Include the exported trailing newline. */
export function assertJsonExportSize(value: unknown, maxBytes = DEFAULT_MAX_JSON_BYTES): void {
  validateInputLimit(maxBytes, 'JSON byte limit');
  if (formattedBytes(value, 0) + 1 > maxBytes)
    throw new JsonInputLimitError(`JSON exceeds the ${maxBytes}-byte size limit.`);
}
