import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { TimelineSessionController } from '../src/devtools/animation-editor/TimelineSessionController.js';
import { Rig } from '../src/engine/Rig.js';
import { downloadJson } from '../src/shared/downloadJson.js';
import { stubRigEditorDom } from './helpers/rigEditorDom.js';

vi.mock('../src/shared/downloadJson.js', () => ({ downloadJson: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(downloadJson).mockReset();
});

function state() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const current = new AnimationEditorState(rig, [
    { name: 'move', duration: 1000, loop: true, tracks: { root: [{ time: 0, x: 1 }] } },
    { name: 'idle', duration: 1000, loop: false, tracks: {} },
  ]);
  current.selectAnimation('move');
  current.keyframes.setBonePropertyKeyframe('root', 'x', 2);
  return current;
}

function fixture(current = state()) {
  const query = stubRigEditorDom();
  const controller = new TimelineSessionController(query('#editor-app') as unknown as HTMLElement, () => current, {
    endScrub() {},
  });
  return { current, query, controller };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('copy, download and console use identical JSON and save only after success', async () => {
  const { current, query, controller } = fixture();
  const writeText = vi.fn(async (_json: string) => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const json = current.exportJson();
  const working = current.workingAnimation;
  const source = current.sourceAnimation;
  const history = current.historyLength;
  await query('#animation-copy-json').click();
  assert.equal(writeText.mock.calls[0]?.[0], json);
  assert.isFalse(current.dirty);
  assert.equal(query('#animation-export-feedback').textContent, 'Animation JSON copied.');
  await query('#animation-download').click();
  assert.deepEqual(vi.mocked(downloadJson).mock.calls, [[json, 'move.json']]);
  await query('#animation-log-json').click();
  assert.deepEqual(log.mock.calls, [[json]]);
  assert.strictEqual(current.workingAnimation, working);
  assert.strictEqual(current.sourceAnimation, source);
  assert.equal(current.historyLength, history);
  current.undo();
  assert.isTrue(current.dirty);
  current.redo();
  assert.isFalse(current.dirty);
  controller.dispose();
});

test('clipboard unavailable/rejected and failed download preserve dirty state with useful feedback', async () => {
  const { current, query, controller } = fixture();
  vi.stubGlobal('navigator', {});
  await query('#animation-copy-json').click();
  assert.match(query('#animation-export-feedback').textContent, /Clipboard API is unavailable.*Download.*Log/);
  assert.isTrue(current.dirty);
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async () => {
        throw new Error('Denied');
      },
    },
  });
  await query('#animation-copy-json').click();
  assert.match(query('#animation-export-feedback').textContent, /Clipboard access failed.*Download.*Log/);
  assert.isTrue(current.dirty);
  vi.mocked(downloadJson).mockImplementation(() => {
    throw new Error('Download unavailable');
  });
  await query('#animation-download').click();
  assert.match(query('#animation-export-feedback').textContent, /Download unavailable/);
  assert.isTrue(current.dirty);
  controller.dispose();
});

test('delayed copy saves its snapshot and retains edits made while the clipboard is pending', async () => {
  const { current, query, controller } = fixture();
  const pending = deferred();
  vi.stubGlobal('navigator', { clipboard: { writeText: () => pending.promise } });
  const copied = current.workingAnimation;
  await query('#animation-copy-json').click();
  assert.isTrue(current.dirty);
  current.keyframes.setBonePropertyKeyframe('root', 'x', 3);
  pending.resolve();
  await pending.promise;
  assert.isTrue(current.dirty);
  current.undo();
  assert.strictEqual(current.workingAnimation, copied);
  assert.isFalse(current.dirty);
  controller.dispose();
});

test('an older copy cannot replace a newer successful download checkpoint or feedback', async () => {
  const { current, query, controller } = fixture();
  const pending = deferred();
  vi.stubGlobal('navigator', { clipboard: { writeText: () => pending.promise } });
  await query('#animation-copy-json').click();
  current.keyframes.setBonePropertyKeyframe('root', 'x', 3);
  await query('#animation-download').click();
  const feedback = query('#animation-export-feedback').textContent;
  pending.resolve();
  await pending.promise;
  assert.isFalse(current.dirty);
  assert.equal(query('#animation-export-feedback').textContent, feedback);
  current.undo();
  assert.isTrue(current.dirty);
  controller.dispose();
});

for (const action of ['switch', 'switch-back', 'revert', 'discard', 'dispose', 'bind'] as const) {
  test(`pending clipboard completion is ignored after ${action}`, async () => {
    const { current, query, controller } = fixture();
    const pending = deferred();
    vi.stubGlobal('navigator', { clipboard: { writeText: () => pending.promise } });
    await query('#animation-copy-json').click();
    if (action === 'switch') current.selectAnimation('idle', { discardChanges: true });
    if (action === 'switch-back') {
      current.selectAnimation('idle', { discardChanges: true });
      current.selectAnimation('move');
    }
    if (action === 'revert') current.revertAnimation({ discardChanges: true });
    if (action === 'discard') {
      vi.stubGlobal('window', { confirm: () => true });
      await query('#animation-discard').click();
      current.keyframes.setBonePropertyKeyframe('root', 'x', 4);
    }
    if (action === 'dispose') controller.dispose();
    if (action === 'bind') {
      vi.stubGlobal('Option', class {});
      controller.bind('other');
    }
    const dirty = current.dirty;
    const working = current.workingAnimation;
    const feedback = query('#animation-export-feedback').textContent;
    pending.resolve();
    await pending.promise;
    assert.equal(current.dirty, dirty);
    assert.strictEqual(current.workingAnimation, working);
    assert.equal(query('#animation-export-feedback').textContent, feedback);
    controller.dispose();
  });
}

test('validation failures block all destinations and preserve authored state', async () => {
  const { current, query, controller } = fixture();
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(current, 'exportAnimation').mockReturnValue({
    success: false,
    issues: [{ severity: 'error', path: 'tracks.root[0].time', message: 'Invalid time.' }],
  });
  for (const id of ['#animation-copy-json', '#animation-download', '#animation-log-json']) {
    await query(id).click();
    assert.match(query('#animation-export-feedback').textContent, /tracks.root\[0\].time: Invalid time/);
  }
  assert.equal(writeText.mock.calls.length, 0);
  assert.equal(vi.mocked(downloadJson).mock.calls.length, 0);
  assert.equal(log.mock.calls.length, 0);
  assert.isTrue(current.dirty);
  assert.equal(current.historyLength, 1);
  controller.dispose();
});
