import { afterEach, assert, test, vi } from 'vitest';
import { IKBakeController } from '../src/devtools/animation-editor/IKBakeController.js';
import {
  planIKBake,
  type IKBakePlanningRequest,
  type IKBakePlanningResult,
} from '../src/devtools/animation-editor/ikBakePlanning.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { ikBakeEditor } from './helpers/ikBakeEditor.js';

afterEach(() => vi.useRealTimers());

function pendingEditor() {
  vi.useFakeTimers();
  const fixture = ikBakeEditor();
  fixture.controller.dispose();
  const jobs: {
    request: IKBakePlanningRequest;
    resolve(result: IKBakePlanningResult): void;
    reject(error: unknown): void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  let runtime: TwoBoneIKConstraint[] = [];
  const start = vi.fn((request: IKBakePlanningRequest) => {
    let resolve!: (result: IKBakePlanningResult) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<IKBakePlanningResult>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    // Simulate a late reply even after cancellation to exercise the controller's own stale-result guard.
    const cancel = vi.fn();
    jobs.push({ request: structuredClone(request), resolve, reject, cancel });
    return { result, cancel };
  });
  const controller = new IKBakeController(fixture.show, () => runtime, start);
  controller.bind(fixture.state);
  const finish = async (index: number) => {
    const job = jobs[index]!;
    job.resolve(planIKBake(job.request));
    await vi.advanceTimersByTimeAsync(0);
  };
  return {
    ...fixture,
    controller,
    jobs,
    start,
    finish,
    setRuntime: (value: TwoBoneIKConstraint[]) => {
      runtime = value;
    },
  };
}

test('closed panels do not plan and rapid option edits start only the latest job', async () => {
  const { controller, state, jobs, start, finish } = pendingEditor();
  controller.setConstraint('arm', true);
  controller.setFPS('5');
  state.keyframes.setBonePropertyKeyframe('upper', 'rotation', 0.3);
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(start.mock.calls.length, 0);
  assert.isFalse(controller.getSnapshot().pending);
  controller.setPanelOpen(true);
  assert.isTrue(controller.getSnapshot().pending);
  controller.setFPS('12');
  controller.setFPS('20');
  await vi.advanceTimersByTimeAsync(199);
  assert.equal(start.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.request.fps, 20);
  assert.isFalse(controller.commit());
  await finish(0);
  assert.isFalse(controller.getSnapshot().pending);
  assert.isTrue(controller.getSnapshot().plan?.success);
  controller.dispose();
});

test('authored edits cancel in-flight work and a late reply cannot publish the old candidate', async () => {
  const { controller, state, jobs, finish } = pendingEditor();
  controller.setPanelOpen(true);
  controller.setConstraint('arm', true);
  await vi.advanceTimersByTimeAsync(200);
  state.keyframes.setBonePropertyKeyframe('upper', 'rotation', 0.4);
  assert.equal(jobs[0]!.cancel.mock.calls.length, 1);
  await finish(0);
  assert.isNull(controller.getSnapshot().plan);
  assert.isTrue(controller.getSnapshot().pending);
  await vi.advanceTimersByTimeAsync(200);
  await finish(1);
  assert.isTrue(controller.getSnapshot().plan?.success);
  assert.equal(jobs[1]!.request.animation.tracks.upper![0]!.rotation, 0.4);
  controller.dispose();
});

test.each(['close', 'unbind', 'dispose', 'replace'] as const)(
  '%s cancels debounce and active jobs without accepting late results',
  async (action) => {
    const { controller, state, jobs, start, finish } = pendingEditor();
    const stop = () => {
      if (action === 'close') controller.setPanelOpen(false);
      else if (action === 'replace') state.selectAnimation('other');
      else controller[action]();
    };
    controller.setPanelOpen(true);
    controller.setConstraint('arm', true);
    stop();
    await vi.advanceTimersByTimeAsync(200);
    assert.equal(start.mock.calls.length, 0);
    controller.bind(state);
    controller.setPanelOpen(true);
    controller.setConstraint('arm', true);
    await vi.advanceTimersByTimeAsync(200);
    if (action === 'replace') state.selectAnimation('reach');
    else stop();
    assert.equal(jobs[0]!.cancel.mock.calls.length, 1);
    const snapshot = controller.getSnapshot();
    await finish(0);
    assert.strictEqual(controller.getSnapshot(), snapshot);
    assert.isNull(controller.getSnapshot().plan);
    assert.isFalse(controller.getSnapshot().pending);
    controller.dispose();
  },
);

test('runtime ownership changes during debounce prevent the worker from starting', async () => {
  const { rig, controller, start, setRuntime } = pendingEditor();
  const runtime = rig.ik!.map(
    (definition) =>
      new TwoBoneIKConstraint(definition, rig, new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]))),
  );
  setRuntime(runtime);
  controller.setPanelOpen(true);
  controller.setConstraint('arm', true);
  runtime[0]!.setTarget(1, 1);
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(start.mock.calls.length, 0);
  assert.isFalse(controller.getSnapshot().pending);
  assert.include(controller.getSnapshot().issues[0]!.message, 'runtime state');
  controller.dispose();
});

test('runtime ownership is checked again when a worker replies, without invoking providers', async () => {
  const { rig, controller, jobs, setRuntime, finish } = pendingEditor();
  const runtime = rig.ik!.map(
    (definition) =>
      new TwoBoneIKConstraint(definition, rig, new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]))),
  );
  setRuntime(runtime);
  controller.setPanelOpen(true);
  controller.setConstraint('arm', true);
  await vi.advanceTimersByTimeAsync(200);
  const provider = vi.fn(() => ({ x: 1, y: 1 }));
  runtime[0]!.setTargetProvider(provider);
  await finish(0);
  assert.equal(jobs[0]!.cancel.mock.calls.length, 1);
  assert.isNull(controller.getSnapshot().plan);
  assert.include(controller.getSnapshot().issues[0]!.message, 'runtime state');
  assert.equal(provider.mock.calls.length, 0);
  controller.dispose();
});

test('worker failures clear pending state and a later request can recover', async () => {
  const { controller, jobs, finish } = pendingEditor();
  controller.setPanelOpen(true);
  controller.setConstraint('arm', true);
  await vi.advanceTimersByTimeAsync(200);
  jobs[0]!.reject(new Error('Worker failed'));
  await vi.advanceTimersByTimeAsync(0);
  assert.isFalse(controller.getSnapshot().pending);
  assert.isNull(controller.getSnapshot().plan);
  assert.include(controller.getSnapshot().issues[0]!.message, 'Worker failed');
  controller.setFPS('5');
  await vi.advanceTimersByTimeAsync(200);
  await finish(1);
  assert.isTrue(controller.getSnapshot().plan?.success);
  controller.dispose();
});

test('a source edit during pause prevents installation of a previously verified candidate', async () => {
  const { controller, state, finish } = pendingEditor();
  controller.setPanelOpen(true);
  controller.setConstraint('arm', true);
  await vi.advanceTimersByTimeAsync(200);
  await finish(0);
  state.playback.play();
  let edited = false;
  const release = state.subscribe(() => {
    if (!state.playback.isPlaying && !edited) {
      edited = true;
      state.keyframes.setBonePropertyKeyframe('upper', 'rotation', 0.8);
    }
  });
  assert.isFalse(controller.commit());
  assert.equal(state.historyLength, 1);
  assert.equal(state.workingAnimation!.tracks.upper![0]!.rotation, 0.8);
  assert.isUndefined(state.workingAnimation!.disabledIKConstraints);
  release();
  controller.dispose();
});
