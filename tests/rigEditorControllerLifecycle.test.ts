import { afterEach, assert, test, vi } from 'vitest';
import { createControlsController } from '../src/devtools/rig-editor/ControlsController.js';
import { createHierarchyController } from '../src/devtools/rig-editor/HierarchyController.js';
import { createInspectorController } from '../src/devtools/rig-editor/InspectorController.js';
import type { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { createSessionController } from '../src/devtools/rig-editor/SessionController.js';
import { Rig } from '../src/engine/Rig.js';
import { EditorElement, stubRigEditorDom } from './helpers/rigEditorDom.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function editor() {
  const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }));
  const controls = {
    state,
    refresh: vi.fn(),
    undo: vi.fn(),
    exportRig: (save: boolean) => state.exportRig(save),
    editBone: vi.fn<RigEditor['editBone']>((id, field, value) => state.editBone(id, field, value)),
  } satisfies Pick<RigEditor, 'state' | 'refresh' | 'undo' | 'exportRig' | 'editBone'>;
  return { ...controls, runtime: controls as unknown as RigEditor };
}

test('rig file imports reject excess hierarchy work without replacing the working session', async () => {
  const query = stubRigEditorDom();
  const current = editor();
  const scene = { characterId: 'test', rigFilename: 'rig.json', reloadRig: vi.fn(), reloadOriginal: vi.fn() };
  const controller = createSessionController(
    query('#editor-app') as unknown as HTMLElement,
    () => scene,
    () => {},
    { maxBoneDepth: 1 },
  );
  controller.updateStatus(current.runtime);
  const json = JSON.stringify({ version: 1, root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] });
  query('#load-json').files = [{ name: 'rig.json', size: json.length, text: async () => json }];
  await query('#load-json').dispatch('change');
  await vi.waitFor(() => assert.match(query('#action-feedback').textContent, /1-level bone hierarchy limit/));
  assert.equal(scene.reloadRig.mock.calls.length, 0);
  assert.isFalse(current.state.dirty);
  controller.dispose();
});

test('controls can remount on the same host without mutating the disposed editor', async () => {
  const query = stubRigEditorDom();
  const app = query('#editor-app') as unknown as HTMLElement;
  const old = editor();
  const first = createControlsController(app, vi.fn());
  first.render(old.runtime);
  const oldCheckbox = query('#visibility').querySelectorAll('input')[0]!;
  first.dispose();
  first.dispose();
  first.render(old.runtime);
  assert.equal(query('#visibility').childElementCount, 0);

  const current = editor();
  const second = createControlsController(app, vi.fn());
  second.render(current.runtime);
  oldCheckbox.checked = false;
  await oldCheckbox.dispatch('change');
  query('#opacity').value = '0.5';
  await query('#opacity').dispatch('change');
  assert.equal(old.state.artworkOpacity, 1);
  assert.isTrue(old.state.visibility.artwork);
  assert.equal(old.refresh.mock.calls.length, 0);
  assert.equal(current.state.artworkOpacity, 0.5);
  assert.equal(current.refresh.mock.calls.length, 1);
  second.dispose();
});

test('hierarchy replacement and disposal release detached button handlers', async () => {
  const query = stubRigEditorDom();
  const host = query('#hierarchy');
  const controller = createHierarchyController(host as unknown as HTMLElement);
  const old = editor();
  controller.render(old.runtime);
  const oldButton = host.children[0]!;
  const current = editor();
  controller.render(current.runtime);
  const button = host.children[0]!;
  await oldButton.click();
  assert.equal(old.refresh.mock.calls.length, 0);
  await button.click();
  assert.deepEqual(current.state.selection, { type: 'bone', id: 'root' });
  assert.equal(current.refresh.mock.calls.length, 1);
  controller.dispose();
  controller.dispose();
  controller.render(current.runtime);
  await button.click();
  assert.equal(host.childElementCount, 0);
  assert.equal(current.refresh.mock.calls.length, 1);
});

test('inspector disposal closes an edit and prevents duplicate handlers on remount', async () => {
  const query = stubRigEditorDom();
  const host = query('#inspector');
  const old = editor();
  old.state.selectBone('root');
  const first = createInspectorController(host as unknown as HTMLElement, vi.fn());
  first.render(old.runtime);
  const input = new EditorElement();
  input.type = 'number';
  input.dataset = { scope: 'bone', field: 'x' };
  input.value = '2';
  await host.dispatch('focusin', input);
  await host.dispatch('input', input);
  assert.isFalse(old.state.canUndo);
  first.dispose();
  first.dispose();
  assert.isTrue(old.state.canUndo);

  const current = editor();
  current.state.selectBone('root');
  const second = createInspectorController(host as unknown as HTMLElement, vi.fn());
  second.render(current.runtime);
  input.value = '3';
  await host.dispatch('input', input);
  assert.equal(old.state.getBone('root').x, 2);
  assert.equal(old.editBone.mock.calls.length, 1);
  assert.equal(current.state.getBone('root').x, 3);
  assert.equal(current.editBone.mock.calls.length, 1);
  second.dispose();
});

test('inspector refresh preserves focused text while history restores update the retained field', async () => {
  const query = stubRigEditorDom();
  const host = query('#inspector');
  const current = editor();
  current.state.selectBone('root');
  const input = new EditorElement();
  input.type = 'number';
  input.dataset = { scope: 'bone', field: 'x' };
  vi.spyOn(host, 'querySelectorAll').mockImplementation((selector) =>
    selector === 'input[type="number"]' ? [input] : [],
  );
  const controller = createInspectorController(host as unknown as HTMLElement, vi.fn());
  controller.render(current.runtime);
  assert.equal(input.value, '0');
  Object.assign(document, { activeElement: input });
  input.value = '3.';
  controller.render(current.runtime);
  assert.equal(input.value, '3.');
  await host.dispatch('focusin', input);
  input.value = '3.50';
  await host.dispatch('input', input);
  controller.render(current.runtime);
  assert.equal(input.value, '3.50');
  current.state.endOperation();
  current.state.undo();
  controller.render(current.runtime);
  assert.equal(input.value, '0');
  current.state.redo();
  controller.render(current.runtime);
  assert.equal(input.value, '3.5');
  controller.dispose();
});

test.each(['resolve', 'reject'] as const)(
  'disposed session ignores pending clipboard %s and supports remount',
  async (finish) => {
    const query = stubRigEditorDom();
    const app = query('#editor-app') as unknown as HTMLElement;
    const getScene = () => ({
      characterId: 'test',
      rigFilename: 'rig.json',
      reloadRig: vi.fn(),
      reloadOriginal: vi.fn(),
    });
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      },
    });
    const old = editor();
    old.state.editBone('root', 'x', 2);
    const first = createSessionController(app, getScene);
    first.updateStatus(old.runtime);
    await query('#copy-json').click();
    first.dispose();
    first.dispose();
    assert.isFalse(first.hasUnsavedChanges());
    const current = editor();
    const second = createSessionController(app, getScene);
    second.updateStatus(current.runtime);
    const feedback = query('#action-feedback');
    feedback.textContent = 'New session ready.';
    if (finish === 'resolve') resolve();
    else reject(new Error('Old clipboard failure'));
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(feedback.textContent, 'New session ready.');
    assert.isTrue(old.state.dirty);
    query('#undo').disabled = false;
    await query('#undo').click();
    assert.equal(old.undo.mock.calls.length, 0);
    assert.equal(current.undo.mock.calls.length, 1);
    second.dispose();
  },
);

test('pixel-origin inspector edits use current image dimensions and share focus-based history', async () => {
  const query = stubRigEditorDom();
  const host = query('#inspector');
  const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root', sprite: { texture: 'part' } }] }));
  state.selectBone('root');
  const image = { width: 137, height: 251, scaleX: 1, scaleY: 1, rotation: 0 };
  const current = {
    state,
    getSelectedImage: () => image,
    getJointReference: () => ({ x: 10, y: 20 }),
    editSprite: (id: string, field: 'originX', value: number | undefined) => state.editSprite(id, field, value),
  } as unknown as RigEditor;
  const input = new EditorElement();
  input.type = 'number';
  input.dataset = { scope: 'sprite', field: 'originX', pixels: 'true' };
  vi.spyOn(host, 'querySelectorAll').mockImplementation((selector) =>
    selector === 'input[type="number"]' ? [input] : [],
  );
  const controller = createInspectorController(host as unknown as HTMLElement, vi.fn());
  controller.render(current);
  assert.equal(Number(input.value), 68.5);
  await host.dispatch('focusin', input);
  input.value = '13.123456789';
  await host.dispatch('input', input);
  input.value = '14.987654321';
  await host.dispatch('input', input);
  assert.closeTo(state.getBone('root').sprite!.originX!, 14.987654321 / 137, 1e-15);
  assert.isFalse(state.canUndo);
  await host.dispatch('focusout', input);
  assert.equal(state.historyLength, 1);
  state.undo();
  controller.render(current);
  assert.equal(Number(input.value), 68.5);
  state.redo();
  controller.render(current);
  assert.equal(Number(input.value), 14.987654321);
  image.width = 333;
  controller.render(current);
  assert.closeTo(Number(input.value), (14.987654321 / 137) * 333, 1e-12);
  input.value = '1000';
  await host.dispatch('input', input);
  assert.closeTo(state.getBone('root').sprite!.originX!, 14.987654321 / 137, 1e-15);
  assert.equal(input.reportValidity.mock.calls.length, 1);
  controller.dispose();
});
