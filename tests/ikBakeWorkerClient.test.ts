import { rejects } from 'node:assert/strict';
import { afterEach, assert, test, vi } from 'vitest';
import type { IKBakePlanningResult } from '../src/devtools/animation-editor/ikBakePlanning.js';
import {
  IK_BAKE_PLANNING_TIMEOUT_MS,
  startIKBakePlanning,
} from '../src/devtools/animation-editor/ikBakeWorkerClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function workerFixture(failPost = false) {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<IKBakePlanningResult>) => void) | null = null;
    onerror: ((event: Pick<ErrorEvent, 'message' | 'preventDefault'>) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    readonly postMessage = vi.fn(() => {
      if (failPost) throw new Error('Snapshot clone failed');
    });
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

test('a stalled worker is terminated at its deadline and cannot deliver late results', async () => {
  vi.useFakeTimers();
  const { task, worker } = workerFixture();
  const lateReply = worker.onmessage!;
  const failure = rejects(task.result, { name: 'TimeoutError', message: /Lower the sampling FPS/ });
  vi.advanceTimersByTime(IK_BAKE_PLANNING_TIMEOUT_MS - 1);
  assert.equal(worker.terminate.mock.calls.length, 0);
  vi.advanceTimersByTime(1);
  await failure;
  lateReply(new MessageEvent('message', { data: { success: false, issues: [] } }));
  task.cancel();
  assert.equal(worker.terminate.mock.calls.length, 1);
  assert.isNull(worker.onmessage);
  assert.isNull(worker.onerror);
  assert.isNull(worker.onmessageerror);
  assert.equal(vi.getTimerCount(), 0);
});

test.each(['reply', 'cancel', 'error', 'messageerror', 'postMessage'] as const)(
  '%s clears the worker deadline',
  async (outcome) => {
    vi.useFakeTimers();
    const { task, worker } = workerFixture(outcome === 'postMessage');
    const result = task.result.catch((error: unknown) => error);
    if (outcome === 'reply') worker.onmessage!(new MessageEvent('message', { data: { success: false, issues: [] } }));
    else if (outcome === 'cancel') task.cancel();
    else if (outcome === 'error') worker.onerror!({ message: 'Failed', preventDefault: vi.fn() });
    else if (outcome === 'messageerror') worker.onmessageerror!();
    const settled = await result;
    if (outcome === 'postMessage') assert.match(String(settled), /Snapshot clone failed/);
    assert.equal(vi.getTimerCount(), 0);
    const terminations = worker.terminate.mock.calls.length;
    vi.advanceTimersByTime(IK_BAKE_PLANNING_TIMEOUT_MS);
    assert.equal(worker.terminate.mock.calls.length, terminations);
  },
);

test('oversized requests fail before creating a worker or cloning the snapshot', async () => {
  const Worker = vi.fn();
  vi.stubGlobal('Worker', Worker);
  const task = startIKBakePlanning({
    rig: {
      root: 'root',
      bones: [{ id: 'root' }, { id: 'middle', parent: 'root' }, { id: 'end', parent: 'middle' }],
      ik: [{ name: 'arm', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
    },
    animation: { name: 'idle', duration: 1000, loop: false, tracks: {} },
    constraintIds: ['arm'],
    fps: 50_000,
  });
  const result = await task.result;
  assert.isFalse(result.success);
  assert.include(result.issues[0]!.message, 'generated keys');
  assert.equal(Worker.mock.calls.length, 0);
  task.cancel();
});
