import { afterEach, assert, test, vi } from 'vitest';
import type { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { createSessionController } from '../src/devtools/rig-editor/SessionController.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => {
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
  const session = createSessionController({ querySelector } as unknown as HTMLElement, () => ({
    characterId: 'test-character',
    rigFilename: 'rig.json',
    reloadRig: vi.fn(),
    reloadOriginal: vi.fn(),
  }));
  const load = () => {
    const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root', x: 0 }] }));
    const editor = { state, exportJson: (save: boolean) => state.exportJson(save) } as RigEditor;
    session.updateStatus(editor);
    return state;
  };
  const state = load();
  const copy = () => querySelector('#copy-json').click();
  const feedback = querySelector('#action-feedback');
  return { state, load, copy, writeText, resolve, reject, feedback, querySelector };
}

test('clipboard completion saves the captured snapshot and leaves later edits dirty', async () => {
  const { state, copy, writeText, resolve, feedback, querySelector } = await fixture();
  state.editBone('root', 'x', 1.123456789);
  copy();
  assert.equal(JSON.parse(writeText.mock.calls[0]![0]!).bones[0].x, 1.123457);
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
