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
