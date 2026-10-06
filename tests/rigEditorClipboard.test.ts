import { afterEach, assert, test, vi } from 'vitest';
import type { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import type { RigEditorScene } from '../src/devtools/rig-editor/RigEditorScene.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { createSessionController } from '../src/devtools/rig-editor/SessionController.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const elements = new Map<string, ReturnType<typeof element>>();
  function element() {
    const listeners = new Map<string, () => void>();
    return {
      textContent: '',
      childElementCount: 0,
      style: {},
      dataset: {},
      classList: { toggle: vi.fn() },
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      click: () => listeners.get('click')!(),
      append: vi.fn(),
      replaceChildren: vi.fn(),
      setAttribute: vi.fn(),
      querySelectorAll: () => [],
    };
  }
  const querySelector = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector)!;
  };
  vi.stubGlobal('document', { querySelector, createElement: element });
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const writeText = vi.fn((_json: string) => pending);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const scene = {
    characterId: 'test-character',
    rigFilename: 'rig.json',
    reloadRig: vi.fn<RigEditorScene['reloadRig']>(),
    reloadOriginal: vi.fn(),
  };
  vi.stubGlobal('window', { confirm: () => true });
  const session = createSessionController({ querySelector } as unknown as HTMLElement, () => scene);
  const load = () => {
    const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root', x: 0 }] }));
    const editor = { state, exportJson: (save: boolean) => state.exportJson(save) } as RigEditor;
    session.updateStatus(editor);
    return state;
  };
  const state = load();
  const copy = () => querySelector('#copy-json').click();
  const feedback = querySelector('#action-feedback');
  return { state, load, copy, writeText, resolve, reject, feedback, querySelector, scene };
}

test('clipboard completion saves the captured snapshot and leaves later edits dirty', async () => {
  const { state, copy, writeText, resolve, feedback, querySelector } = await fixture();
  state.editBone('root', 'x', 1.123456789);
  copy();
  assert.equal(parseRigDefinition(JSON.parse(writeText.mock.calls[0]![0])).bones[0]!.x, 1.123457);
  state.editBone('root', 'x', 2);
  resolve();
  await vi.waitFor(() => assert.equal(feedback.textContent, 'Rig JSON copied.'));
  assert.isTrue(state.dirty);
  assert.equal(querySelector('#dirty-status').textContent, 'Unsaved changes *');
  state.undo();
  assert.isFalse(state.dirty);
  state.redo();
  assert.isTrue(state.dirty);
});

test('clipboard completion does not mark a replacement session saved', async () => {
  const { state, load, copy, resolve, feedback } = await fixture();
  state.editBone('root', 'x', 1);
  copy();
  const replacement = load();
  replacement.editBone('root', 'x', 2);
  resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.isTrue(replacement.dirty);
  assert.notEqual(feedback.textContent, 'Rig JSON copied.');
});

test('clipboard rejection preserves the previous saved baseline', async () => {
  const { state, copy, reject, feedback } = await fixture();
  state.editBone('root', 'x', 1);
  copy();
  reject(new Error('Clipboard write failed'));
  await vi.waitFor(() => assert.include(feedback.textContent, 'Clipboard write failed'));
  assert.isTrue(state.dirty);
  state.undo();
  assert.isFalse(state.dirty);
});

test('a rejected copy cannot overwrite feedback from a replacement session', async () => {
  const { load, copy, reject, feedback } = await fixture();
  copy();
  const replacement = load();
  replacement.editBone('root', 'x', 2);
  feedback.textContent = 'Replacement session ready.';
  reject(new Error('Old clipboard write failed'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(feedback.textContent, 'Replacement session ready.');
  assert.isTrue(replacement.dirty);
});

test('an older rejected copy cannot overwrite a newer successful export', async () => {
  const { state, copy, reject, writeText, feedback } = await fixture();
  state.editBone('root', 'x', 1);
  copy();
  state.editBone('root', 'x', 2);
  writeText.mockResolvedValueOnce(undefined);
  copy();
  await vi.waitFor(() => assert.equal(feedback.textContent, 'Rig JSON copied.'));
  reject(new Error('Old clipboard write failed'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(feedback.textContent, 'Rig JSON copied.');
  assert.isFalse(state.dirty);
});

test('clipboard completion clears dirty state when the exported rig is unchanged', async () => {
  const { state, copy, resolve, feedback, querySelector } = await fixture();
  state.editBone('root', 'x', 1);
  copy();
  assert.isTrue(state.dirty);
  resolve();
  await vi.waitFor(() => assert.equal(feedback.textContent, 'Rig JSON copied.'));
  assert.isFalse(state.dirty);
  assert.equal(querySelector('#dirty-status').textContent, 'No changes');
});

test('a rejected copy preserves the last successfully exported rig and filename', async () => {
  const { state, copy, reject, feedback, querySelector, scene } = await fixture();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  querySelector('#log-json').click();
  state.editBone('root', 'x', 25);
  scene.rigFilename = 'failed-copy.json';
  copy();
  reject(new Error('Clipboard write failed'));
  await vi.waitFor(() => assert.include(feedback.textContent, 'Clipboard write failed'));
  querySelector('#reload-exported').click();
  const [rig, filename] = scene.reloadRig.mock.calls[0]!;
  assert.equal(rig.bones[0]!.x, 0);
  assert.equal(filename, 'rig.json');
});

test('a rejected first copy does not create an exported rig', async () => {
  const { copy, reject, feedback, querySelector, scene } = await fixture();
  copy();
  reject(new Error('Clipboard write failed'));
  await vi.waitFor(() => assert.include(feedback.textContent, 'Clipboard write failed'));
  querySelector('#reload-exported').click();
  assert.include(feedback.textContent, 'Export the rig first');
  assert.equal(scene.reloadRig.mock.calls.length, 0);
});

test('an older pending copy cannot replace a newer successful export', async () => {
  const { state, copy, resolve, writeText, feedback, querySelector, scene } = await fixture();
  state.editBone('root', 'x', 1);
  copy();
  state.editBone('root', 'x', 2);
  writeText.mockResolvedValueOnce(undefined);
  copy();
  await vi.waitFor(() => assert.equal(feedback.textContent, 'Rig JSON copied.'));
  resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.isFalse(state.dirty);
  querySelector('#reload-exported').click();
  assert.equal(scene.reloadRig.mock.calls[0]![0].bones[0]!.x, 2);
});
