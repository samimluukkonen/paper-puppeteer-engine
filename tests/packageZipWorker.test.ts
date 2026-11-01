import { afterEach, assert, expect, test, vi } from 'vitest';
import { decodePackageZip, encodePackageZip } from '../src/devtools/shared/package/packageZip.js';
import {
  type PackageZipRequest,
  type PackageZipResponse,
  processPackageZip,
} from '../src/devtools/shared/package/packageZipTasks.js';
import { packageZipWorker } from '../src/devtools/shared/package/packageZipWorkerClient.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(post?: (request: PackageZipRequest) => void) {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<PackageZipResponse>) => void) | null = null;
    onerror: ((event: Pick<ErrorEvent, 'message' | 'preventDefault'>) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    request: PackageZipRequest | undefined;
    readonly postMessage = vi.fn((request: PackageZipRequest, transfer?: Transferable[]) => {
      post?.(request);
      this.request = structuredClone(request, { transfer: transfer ?? [] });
    });
    readonly terminate = vi.fn();
    constructor(
      readonly url: URL,
      readonly options: WorkerOptions,
    ) {
      workers.push(this);
    }
    respond(request: PackageZipRequest = this.request!): void {
      this.onmessage!(new MessageEvent('message', { data: { success: true, result: processPackageZip(request) } }));
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const signal = new AbortController();
  const files = new Map([['character.json', new TextEncoder().encode('{"version":1}')]]);
  return { workers, signal, files };
}

test('ZIP CRC32 matches the standard check vector and validates corruption after round trip', () => {
  const files = new Map([['check.txt', new TextEncoder().encode('123456789')]]);
  const bytes = encodePackageZip(files);
  assert.equal(new DataView(bytes.buffer).getUint32(14, true), 0xcbf43926);
  assert.deepEqual(decodePackageZip(bytes), files);
  const contentStart = 30 + 'check.txt'.length;
  bytes[contentStart] = bytes[contentStart]! ^ 1;
  assert.throws(() => decodePackageZip(bytes), /CRC mismatch/);
});

test('encode runs in a module worker and returns an independent archive checkpoint', async () => {
  const { files, signal, workers } = fixture();
  const task = packageZipWorker.encode(files, signal.signal);
  const worker = workers[0]!;
  assert.include(worker.url.pathname, 'packageZip.worker.ts');
  assert.equal(worker.options.type, 'module');
  assert.deepEqual(worker.postMessage.mock.calls, [[{ operation: 'encode', files }]]);
  worker.respond();
  const result = await task;
  assert.deepEqual(result.files, files);
  assert.notStrictEqual(result.files.get('character.json'), files.get('character.json'));
  assert.deepEqual(decodePackageZip(result.bytes), result.files);
  assert.equal(worker.terminate.mock.calls.length, 1);
  assert.isNull(worker.onmessage);
  assert.isNull(worker.onerror);
  assert.isNull(worker.onmessageerror);
  signal.abort();
  assert.equal(worker.terminate.mock.calls.length, 1);
});

test('decode runs in the worker and leaves caller-owned input bytes intact', async () => {
  const { files, signal, workers } = fixture();
  const bytes = encodePackageZip(files);
  const task = packageZipWorker.decode(bytes, signal.signal);
  const worker = workers[0]!;
  assert.deepEqual(worker.postMessage.mock.calls, [[{ operation: 'decode', bytes }]]);
  worker.respond();
  assert.deepEqual(await task, files);
  assert.deepEqual(decodePackageZip(bytes), files);
  assert.equal(worker.terminate.mock.calls.length, 1);
});

test.each(['reply', 'abort', 'validation'] as const)(
  'owned decode transfers its buffer and handles %s without retaining caller input',
  async (outcome) => {
    const { files, signal, workers } = fixture();
    const bytes = encodePackageZip(files);
    const buffer = bytes.buffer;
    const expected = bytes.slice();
    const task = packageZipWorker.decodeOwned(bytes, signal.signal);
    const worker = workers[0]!;
    assert.strictEqual(worker.postMessage.mock.calls[0]![0].operation, 'decode');
    assert.strictEqual(worker.postMessage.mock.calls[0]![1]![0], buffer);
    assert.equal(buffer.byteLength, 0);
    const received = worker.request!;
    assert.equal(received.operation, 'decode');
    if (received.operation !== 'decode') throw new Error('Expected a decode request.');
    assert.deepEqual(received.bytes, expected);
    if (outcome === 'reply') {
      worker.respond();
      assert.deepEqual(await task, files);
    } else if (outcome === 'abort') {
      const lateReply = worker.onmessage!;
      const reason = new Error('Import cancelled');
      const failure = expect(task).rejects.toBe(reason);
      signal.abort(reason);
      lateReply(new MessageEvent('message', { data: { success: true, result: processPackageZip(received) } }));
      await failure;
    } else {
      const failure = expect(task).rejects.toThrow(/Invalid archive/);
      worker.onmessage!(new MessageEvent('message', { data: { success: false, message: 'Invalid archive' } }));
      await failure;
    }
    assert.equal(worker.terminate.mock.calls.length, 1);
    assert.isNull(worker.onmessage);
    assert.isNull(worker.onerror);
    assert.isNull(worker.onmessageerror);
  },
);

test.each(['encode', 'decode'] as const)(
  'aborting %s terminates the worker and ignores late replies',
  async (operation) => {
    const { files, signal, workers } = fixture();
    const request: PackageZipRequest =
      operation === 'encode' ? { operation, files } : { operation, bytes: encodePackageZip(files) };
    const task =
      operation === 'encode'
        ? packageZipWorker.encode(files, signal.signal)
        : packageZipWorker.decode(encodePackageZip(files), signal.signal);
    const worker = workers[0]!;
    const lateReply = worker.onmessage!;
    const reason = new Error('Session changed');
    const failure = expect(task).rejects.toBe(reason);
    signal.abort(reason);
    lateReply(new MessageEvent('message', { data: { success: true, result: processPackageZip(request) } }));
    await failure;
    assert.equal(worker.terminate.mock.calls.length, 1);
    assert.isNull(worker.onmessage);
  },
);

test('already aborted tasks never construct a worker or detach owned input', async () => {
  const { files, signal, workers } = fixture();
  const bytes = encodePackageZip(files);
  signal.abort(new Error('Cancelled before starting'));
  await expect(packageZipWorker.encode(files, signal.signal)).rejects.toThrow(/before starting/);
  await expect(packageZipWorker.decodeOwned(bytes, signal.signal)).rejects.toThrow(/before starting/);
  assert.deepEqual(decodePackageZip(bytes), files);
  assert.equal(workers.length, 0);
});

test.each(['error', 'messageerror', 'validation'] as const)(
  'worker %s failures reject and release the task',
  async (kind) => {
    const { files, signal, workers } = fixture();
    const task = packageZipWorker.encode(files, signal.signal);
    const worker = workers[0]!;
    const failure = expect(task).rejects.toThrow(
      kind === 'messageerror' ? /read the package ZIP result/ : /Invalid archive/,
    );
    if (kind === 'error') worker.onerror!({ message: 'Invalid archive', preventDefault: vi.fn() });
    else if (kind === 'messageerror') worker.onmessageerror!();
    else worker.onmessage!(new MessageEvent('message', { data: { success: false, message: 'Invalid archive' } }));
    await failure;
    assert.equal(worker.terminate.mock.calls.length, 1);
    signal.abort();
    assert.equal(worker.terminate.mock.calls.length, 1);
  },
);

test.each(['encode', 'decodeOwned'] as const)(
  'posting %s failures release the worker and preserve input',
  async (operation) => {
    const error = new Error('Could not clone');
    const { files, signal, workers } = fixture(() => {
      throw error;
    });
    const bytes = encodePackageZip(files);
    await expect(
      operation === 'encode'
        ? packageZipWorker.encode(files, signal.signal)
        : packageZipWorker.decodeOwned(bytes, signal.signal),
    ).rejects.toBe(error);
    assert.deepEqual(decodePackageZip(bytes), files);
    assert.equal(workers[0]!.terminate.mock.calls.length, 1);
  },
);
