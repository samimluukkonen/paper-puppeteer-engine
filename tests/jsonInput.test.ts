import { assert, expect, test, vi } from 'vitest';
import {
  assertJsonInputSize,
  countJsonBytes,
  JsonInputLimitError,
  readJsonFile,
  readJsonResponse,
} from '../src/engine/jsonInput.js';

test.each([
  null,
  [true, false, 0, -0, -2.5, 1e30],
  { 'é\u0000': ['\\\"\b\t\n\f\r', '雪🙂', '\ud800', '\udc00', '\ud800x\udc00'] },
  { empty: {}, array: [], nested: { text: 'hello' } },
])('counts compact JSON bytes without serializing entire documents: %j', (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  assert.equal(countJsonBytes(value, bytes), bytes);
  assert.throws(() => countJsonBytes(value, bytes - 1), JsonInputLimitError);
});

test('bounded JSON counting stops before traversing the remainder of an oversized document', () => {
  const value = {
    first: 'large',
    get later(): never {
      throw new Error('Do not traverse after overflow');
    },
  };
  assert.throws(() => countJsonBytes(value, 4), JsonInputLimitError);
});

test('text limits measure UTF-8 bytes, with exact boundaries accepted', () => {
  assert.doesNotThrow(() => assertJsonInputSize('"é"', 4));
  assert.throws(() => assertJsonInputSize('"é"', 3), JsonInputLimitError);
  assert.throws(() => assertJsonInputSize('large', 1), JsonInputLimitError);
});

test('oversized files are rejected before reading; actual text is also checked', async () => {
  const text = vi.fn(async () => '"é"');
  await expect(readJsonFile({ size: 5, text }, 4)).rejects.toThrow(/size limit/);
  assert.equal(text.mock.calls.length, 0);
  await expect(readJsonFile({ size: 1, text }, 3)).rejects.toThrow(/size limit/);
  assert.equal(await readJsonFile({ size: 4, text }, 4), '"é"');
});

test('streaming JSON preserves Unicode split across chunks and accepts an exact byte limit', async () => {
  const bytes = new TextEncoder().encode('"é"');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
  );
  const count = vi.fn<(bytes: number) => void>();
  assert.equal(await readJsonResponse(response, 4, new AbortController().signal, count), 'é');
  assert.equal(
    count.mock.calls.reduce((sum, [bytes]) => sum + bytes, 0),
    4,
  );
});

test.each([undefined, '1', '999'])(
  'response size limits reject and cancel the stream with Content-Length %s',
  async (length) => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('"oversized"'));
        },
        cancel,
      }),
      { headers: length ? { 'content-length': length } : {} },
    );
    const error: unknown = await readJsonResponse(response, 4, new AbortController().signal, () => {}).catch(
      (error: unknown) => error,
    );
    assert.instanceOf(error, JsonInputLimitError);
    assert.deepEqual(cancel.mock.calls, [[error]]);
    assert.isFalse(response.body!.locked);
  },
);

test('an aggregate-budget failure cancels the stream and preserves the original error', async () => {
  const reason = new JsonInputLimitError('aggregate');
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
      },
      cancel,
    }),
  );
  const error: unknown = await readJsonResponse(response, 10, new AbortController().signal, () => {
    throw reason;
  }).catch((error: unknown) => error);
  assert.strictEqual(error, reason);
  assert.deepEqual(cancel.mock.calls, [[reason]]);
});
