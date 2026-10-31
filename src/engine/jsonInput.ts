import { readResponseBody } from './resourceInput.js';

/** Default size limit for externally loaded JSON and editor file/paste imports. */
export const DEFAULT_MAX_JSON_BYTES = 10 * 1024 * 1024;

export class JsonInputLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonInputLimitError';
  }
}

/** @internal Limits are finite positive safe integers, never an implicit unlimited value. */
export function validateInputLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer.`);
  return value;
}

/** Check UTF-8 size before parsing. Reject obviously oversized text before allocating an encoded copy. */
export function assertJsonInputSize(text: string, maxBytes = DEFAULT_MAX_JSON_BYTES): void {
  validateInputLimit(maxBytes, 'JSON byte limit');
  if (text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes)
    throw new JsonInputLimitError(`JSON exceeds the ${maxBytes}-byte size limit.`);
}

/** Compact UTF-8 JSON size for already validated data, without allocating a serialized copy.
 * Stop as soon as the budget is exceeded, including inside a large string or collection.
 */
export function countJsonBytes(input: unknown, maxBytes: number): number {
  validateInputLimit(maxBytes, 'JSON byte limit');
  let bytes = 0;
  const add = (count: number): void => {
    bytes += count;
    if (bytes > maxBytes) throw new JsonInputLimitError(`JSON exceeds the ${maxBytes}-byte size limit.`);
  };
  const string = (value: string): void => {
    // Every UTF-16 code unit requires at least one encoded byte.
    if (value.length > maxBytes - bytes - 2) add(maxBytes + 1);
    add(2);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdfff) {
        const next = value.charCodeAt(index + 1);
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          add(4);
          index++;
        } else add(6); // JSON.stringify escapes lone surrogates.
      } else add(3);
    }
  };
  const visit = (value: unknown): void => {
    if (typeof value === 'string') string(value);
    else if (value === null) add(4);
    else if (typeof value === 'boolean') add(value ? 4 : 5);
    else if (typeof value === 'number') add(String(value).length);
    else if (Array.isArray(value)) {
      add(2);
      for (const [index, child] of value.entries()) {
        if (index) add(1);
        visit(child);
      }
    } else if (typeof value === 'object') {
      add(2);
      let first = true;
      for (const key of Object.keys(value)) {
        if (!first) add(1);
        first = false;
        string(key);
        add(1);
        visit((value as Record<string, unknown>)[key]);
      }
    } else throw new Error('JSON size checks require validated JSON data.');
  };
  visit(input);
  return bytes;
}

/** Reject oversized local files before reading them, and verify the actual text before parsing. */
export async function readJsonFile(
  file: Pick<Blob, 'size' | 'text'>,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<string> {
  validateInputLimit(maxBytes, 'JSON byte limit');
  if (file.size > maxBytes) throw new JsonInputLimitError(`JSON file exceeds the ${maxBytes}-byte size limit.`);
  const text = await file.text();
  assertJsonInputSize(text, maxBytes);
  return text;
}

/** Bound decoded response bytes even without a trustworthy Content-Length, and cancel on failure or abort. */
export async function readJsonResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  countBytes: (bytes: number) => void,
): Promise<unknown> {
  validateInputLimit(maxBytes, 'JSON byte limit');
  const decoder = new TextDecoder();
  const parts: string[] = [];
  await readResponseBody(
    response,
    {
      maxBytes,
      signal,
      countBytes,
      limitError: () => new JsonInputLimitError(`JSON exceeds the ${maxBytes}-byte size limit.`),
    },
    (bytes) => parts.push(decoder.decode(bytes, { stream: true })),
  );
  parts.push(decoder.decode());
  const data: unknown = JSON.parse(parts.join(''));
  signal.throwIfAborted();
  return data;
}
