import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { TimelineSessionController } from '../src/devtools/animation-editor/TimelineSessionController.js';
import { DEFAULT_MAX_JSON_BYTES } from '../src/engine/jsonInput.js';
import { Rig } from '../src/engine/Rig.js';
import { EditorElement, stubRigEditorDom } from './helpers/rigEditorDom.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const file = (name = 'imported', x = 8) =>
  JSON.stringify({
    version: 1,
    name,
    duration: 1250,
    loop: false,
    tracks: { root: [{ time: 0, x }] },
    events: [{ time: 500, name: 'event', data: null }],
  });
function fixture() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [{ name: 'old', duration: 1000, loop: true, tracks: {} }]);
  state.selectAnimation('old');
  state.setBonePropertyKeyframe('root', 'x', 33);
  const query = stubRigEditorDom();
  vi.stubGlobal('Option', EditorElement);
  vi.stubGlobal('window', { confirm: vi.fn(() => true) });
  Object.assign(query('#animation-import-text'), { focus: vi.fn() });
  const controller = new TimelineSessionController(query('#editor-app') as unknown as HTMLElement, () => state, {
    endScrub() {},
  });
  controller.bind('test');
  return { state, query, controller };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('paste UI cancels without replacement, preserves invalid text, and updates selection and clean controls on success', async () => {
  const { state, query, controller } = fixture();
  const before = state.workingAnimation;
  await query('#animation-import-paste').click();
  query('#animation-import-text').value = file();
  await query('#animation-import-cancel').click();
  assert.equal(query('#animation-import-text').value, '');
  assert.strictEqual(state.workingAnimation, before);
  query('#animation-import-text').value = '{bad';
  await query('#animation-import-submit').click();
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(query('#animation-import-text').value, '{bad');
  assert.match(query('#animation-import-feedback').textContent, /Invalid JSON/);
  query('#animation-import-text').value = file();
  await query('#animation-import-submit').click();
  assert.equal(state.selectedAnimationId, 'imported');
  assert.equal(query('#animation-selection').value, 'imported');
  assert.equal(query('#animation-import-text').value, '');
  assert.match(query('#animation-import-feedback').textContent, /Clean session/);
  assert.equal(query('#animation-dirty').textContent, 'No unsaved changes');
  assert.isTrue(query('#animation-undo').disabled);
  assert.equal(query('#current-time').textContent, '0.000 / 1.250 s');
  controller.dispose();
});

test('file and paste controls use the same state import path and allow rechoosing the same file', async () => {
  const { state, query, controller } = fixture();
  const imported = vi.spyOn(state, 'importJson');
  const json = file();
  query('#animation-import-file').files = [{ name: 'animation.json', text: async () => json }];
  query('#animation-import-file').value = 'animation.json';
  await query('#animation-import-file').dispatch('change');
  await vi.waitFor(() => assert.equal(imported.mock.calls.length, 1));
  assert.equal(imported.mock.calls[0]?.[0], json);
  assert.isFunction(imported.mock.calls[0]?.[1]?.confirmDiscard);
  assert.equal(query('#animation-import-file').value, '');
  const source = state.sourceAnimation;
  await query('#animation-import-file').dispatch('change');
  await vi.waitFor(() => assert.equal(imported.mock.calls.length, 2));
  assert.notStrictEqual(state.sourceAnimation, source);
  controller.dispose();
});

test('oversized file and paste imports preserve dirty state and history', async () => {
  const { state, query, controller } = fixture();
  const before = state.workingAnimation;
  const text = vi.fn(async () => file());
  query('#animation-import-file').files = [{ name: 'large.json', size: DEFAULT_MAX_JSON_BYTES + 1, text }];
  await query('#animation-import-file').dispatch('change');
  await vi.waitFor(() => assert.match(query('#animation-import-feedback').textContent, /size limit/));
  assert.equal(text.mock.calls.length, 0);
  query('#animation-import-text').value = ' '.repeat(DEFAULT_MAX_JSON_BYTES + 1);
  await query('#animation-import-submit').click();
  assert.match(query('#animation-import-feedback').textContent, /size limit/);
  assert.strictEqual(state.workingAnimation, before);
  assert.isTrue(state.dirty);
  assert.isTrue(state.canUndo);
  assert.equal(vi.mocked(window.confirm).mock.calls.length, 0);
  controller.dispose();
});

test('file syntax/validation/read failures preserve the session and report useful feedback', async () => {
  const { state, query, controller } = fixture();
  for (const [text, message] of [
    [async () => '{bad', /Invalid JSON/],
    [async () => file().replace('"root":', '"missing":'), /missing/],
    [
      async () => {
        throw new Error('Read denied');
      },
      /Could not read animation file: Read denied/,
    ],
  ] as const) {
    const before = state.workingAnimation;
    query('#animation-import-file').files = [{ name: 'animation.json', text }];
    await query('#animation-import-file').dispatch('change');
    await vi.waitFor(() => assert.match(query('#animation-import-feedback').textContent, message));
    assert.strictEqual(state.workingAnimation, before);
    assert.isTrue(state.dirty);
    assert.isTrue(state.canUndo);
  }
  controller.dispose();
});

for (const action of [
  'paste',
  'reload',
  'revert',
  'switch-back',
  'bind',
  'dispose',
  'cancel',
  'edit',
  'direct-import',
  'new-file',
] as const) {
  test(`a pending file read cannot replace state after ${action}`, async () => {
    const { state, query, controller } = fixture();
    const pending = deferred<string>();
    query('#animation-import-file').files = [{ name: 'slow.json', text: () => pending.promise }];
    await query('#animation-import-file').dispatch('change');
    if (action === 'paste') {
      query('#animation-import-text').value = file('pasted');
      await query('#animation-import-submit').click();
    }
    if (action === 'reload') await query('#animation-reload-export').click();
    if (action === 'revert') state.revertAnimation({ discardChanges: true });
    if (action === 'switch-back') {
      state.selectAnimation(null, { discardChanges: true });
      state.selectAnimation('old');
    }
    if (action === 'bind') controller.bind('other');
    if (action === 'dispose') controller.dispose();
    if (action === 'cancel') await query('#animation-import-cancel').click();
    if (action === 'edit') state.setBonePropertyKeyframe('root', 'x', 99);
    if (action === 'direct-import') state.importJson(file());
    if (action === 'new-file') {
      query('#animation-import-file').files = [{ name: 'fast.json', text: async () => file('fast') }];
      await query('#animation-import-file').dispatch('change');
      await vi.waitFor(() => assert.equal(state.selectedAnimationId, 'fast'));
    }
    const before = state.workingAnimation;
    pending.resolve(file('slow'));
    await pending.promise;
    await Promise.resolve();
    assert.strictEqual(state.workingAnimation, before);
    controller.dispose();
  });
}

test('clipboard export completing after a same-name import cannot change its clean baseline or feedback', async () => {
  const { state, query, controller } = fixture();
  const pending = deferred<void>();
  vi.stubGlobal('navigator', { clipboard: { writeText: () => pending.promise } });
  await query('#animation-copy-json').click();
  query('#animation-import-text').value = file('old');
  await query('#animation-import-submit').click();
  const imported = state.sourceAnimation;
  const feedback = query('#animation-import-feedback').textContent;
  pending.resolve();
  await pending.promise;
  assert.isFalse(state.dirty);
  assert.strictEqual(state.sourceAnimation, imported);
  assert.equal(query('#animation-import-feedback').textContent, feedback);
  assert.equal(query('#animation-export-feedback').textContent, '');
  controller.dispose();
});
