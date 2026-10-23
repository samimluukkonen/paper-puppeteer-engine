import { assert, expect, test, vi } from 'vitest';
import { readJsonResponse } from '../src/engine/jsonInput.js';
import { readResponseBytes } from '../src/engine/resourceInput.js';
import { readSceneResource } from '../src/engine/sceneResource.js';

test.each(['json', 'binary'])(
  '%s cancellation releases the reader even when underlying cancellation stalls',
  async (kind) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel }));
    const controller = new AbortController();
    const reason = new Error('Stopped by host');
    const pending =
      kind === 'json'
        ? readJsonResponse(response, 100, controller.signal, () => {})
        : readResponseBytes(response, {
            maxBytes: 100,
            signal: controller.signal,
            limitError: () => new Error('limit'),
          });
    const rejected = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    assert.equal(cancel.mock.calls.length, 1);
    assert.isFalse(response.body!.locked);
  },
);

test('scene deadlines reject ignored cancellation and clean up a late custom-fetch body', async () => {
  vi.useFakeTimers();
  try {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const loading = readSceneResource('https://example.test/scene.json', fetcher, 100).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    const error = await loading;
    assert.instanceOf(error, DOMException);
    assert.equal(error.name, 'TimeoutError');
    const cancel = vi.fn();
    complete(new Response(new ReadableStream({ cancel })));
    await Promise.resolve();
    assert.deepEqual(cancel.mock.calls, [[error]]);
    assert.equal(vi.getTimerCount(), 0);
  } finally {
    vi.useRealTimers();
  }
});

test.each([undefined, '1', '999'])('scene size failures cancel promptly with declared length %s', async (length) => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel,
    }),
    { headers: length ? { 'content-length': length } : {} },
  );
  const fetcher: typeof fetch = () => Promise.resolve(response);
  await expect(readSceneResource('https://example.test/scene.zip', fetcher, 4)).rejects.toThrow(/exceeds 4 bytes/);
  assert.equal(cancel.mock.calls.length, 1);
  assert.isFalse(response.body!.locked);
});
