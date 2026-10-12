import { rejects } from 'node:assert/strict';
import { afterEach, assert, test, vi } from 'vitest';
import type { IKBakePlanningResult } from '../src/devtools/animation-editor/ikBakePlanning.js';
import { startIKBakePlanning } from '../src/devtools/animation-editor/ikBakeWorkerClient.js';

afterEach(() => vi.unstubAllGlobals());

function workerFixture() {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<IKBakePlanningResult>) => void) | null = null;
    onerror: ((event: Pick<ErrorEvent, 'message' | 'preventDefault'>) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    readonly postMessage = vi.fn();
    readonly terminate = vi.fn();
    constructor(
      readonly url: URL,
      readonly options: WorkerOptions,
    ) {
      workers.push(this);
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const request = {
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animation: { name: 'idle', duration: 1000, loop: false, tracks: {} },
    constraintIds: ['arm'],
    fps: 10,
  };
  const task = startIKBakePlanning(request);
  return { task, request, worker: workers[0]! };
}

test('the client posts one snapshot to a module worker and releases it after the reply', async () => {
  const { task, request, worker } = workerFixture();
  assert.include(worker.url.pathname, 'ikBake.worker.ts');
  assert.equal(worker.options.type, 'module');
  assert.deepEqual(worker.postMessage.mock.calls, [[request]]);
  const result: IKBakePlanningResult = {
    success: false,
    issues: [{ severity: 'error', message: 'Invalid selection' }],
  };
  worker.onmessage!(new MessageEvent('message', { data: result }));
  assert.strictEqual(await task.result, result);
  assert.equal(worker.terminate.mock.calls.length, 1);
  assert.isNull(worker.onmessage);
  assert.isNull(worker.onerror);
  assert.isNull(worker.onmessageerror);
  task.cancel();
  assert.equal(worker.terminate.mock.calls.length, 1);
});

test('cancellation terminates computation and settles its promise without allowing late replies', async () => {
  const { task, worker } = workerFixture();
  const lateReply = worker.onmessage!;
  const failure = rejects(task.result, /cancelled/);
  task.cancel();
  task.cancel();
  lateReply(new MessageEvent('message', { data: { success: false, issues: [] } }));
  await failure;
  assert.equal(worker.terminate.mock.calls.length, 1);
  assert.isNull(worker.onmessage);
});

test.each(['error', 'messageerror'] as const)('worker %s rejects the request and clears listeners', async (event) => {
  const { task, worker } = workerFixture();
  const failure = rejects(task.result, event === 'error' ? /Worker failed/ : /read the bake result/);
  if (event === 'error') worker.onerror!({ message: 'Worker failed', preventDefault: vi.fn() });
  else worker.onmessageerror!();
  await failure;
  assert.equal(worker.terminate.mock.calls.length, 1);
  assert.isNull(worker.onmessage);
});
