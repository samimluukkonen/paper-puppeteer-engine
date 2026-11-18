import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import { AttachmentController } from '../src/devtools/rig-editor/AttachmentController.js';
import { createRigWorkspaceController } from '../src/devtools/rig-editor/RigWorkspaceController.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import type { RigJsonDefinition } from '../src/engine/externalData.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';
import { paperDollIK } from '../src/shared/paperDollIK.js';
import { puppetScene } from './helpers/puppetScene.js';
import { EditorElement, stubRigEditorDom } from './helpers/rigEditorDom.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      sys = { isActive: () => true };
    },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Math: {
      Vector2: class {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
      },
    },
  },
}));
vi.mock('../src/shared/loadSceneCharacter.js', () => ({ loadSceneCharacter: vi.fn() }));
vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    invalidate() {}
    draw() {}
    destroy() {}
  },
}));
const sessions: { scene: AnimationEditorScene; controller: ReturnType<typeof createRigWorkspaceController> }[] = [];
afterEach(() => {
  for (const { scene, controller } of sessions.splice(0)) {
    controller.dispose();
    scene.events.emit('shutdown');
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function panelFixture(withSlots = false) {
  const element = stubRigEditorDom();
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/rig-editor/' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    confirm: () => true,
  });
  const file: RigJsonDefinition = {
    version: 1,
    root: 'root',
    bones: [
      { id: 'root', sprite: { texture: 'body' } },
      ...paperDollIK.flatMap((chain) => [
        { id: chain.rootBone, parent: 'root' },
        { id: chain.middleBone, parent: chain.rootBone, y: 20 },
        { id: chain.endBone, parent: chain.middleBone, y: 20 },
      ]),
    ],
    ...(withSlots
      ? {
          slots: [
            { id: 'root', bone: 'root' },
            { id: 'other', bone: 'root' },
          ],
        }
      : {}),
    skins: [{ version: 1, name: 'default', slots: {} }],
  };
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'test-character',
      rig: 'original.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      textures: { body: 'body.png' },
      animations: [],
    },
    rig: file,
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
  });
  vi.mocked(loadSceneCharacter).mockResolvedValue(definition);
  const error = vi.fn();
  const ready = vi.fn();
  const scene = new AnimationEditorScene(
    (state) => {
      state.setEditorMode('rig');
      render();
      ready();
    },
    error,
    { ikChains: paperDollIK },
    undefined,
    () => render(),
  );
  const controller = createRigWorkspaceController(
    element('#editor-app') as unknown as HTMLElement,
    () => scene,
    () => {},
  );
  const render = () => {
    if (scene.rigEditor) controller.render(scene.rigEditor);
  };
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  sessions.push({ scene, controller });
  scene.create();
  await vi.waitFor(() => {
    assert.deepEqual(error.mock.calls, []);
    assert.equal(ready.mock.calls.length, 1);
  });
  scene.reloadRig(file, 'working.json');
  const editor = scene.rigEditor!;
  const puppet = Reflect.get(scene, 'puppet') as Puppet;
  const disable = vi.spyOn(editor, 'disable');
  const destroy = vi.spyOn(puppet, 'destroy');
  return { scene, editor, puppet, file, element, disable, destroy, controller };
}

async function editNumber(element: ReturnType<typeof stubRigEditorDom>, bone: string, field: string, values: number[]) {
  const button = element('#hierarchy').children.find((child) => child.textContent === bone)!;
  if (button.getAttribute('aria-selected') !== 'true') await button.click();
  const input = new EditorElement();
  input.type = 'number';
  input.dataset = { scope: 'bone', field };
  const inspector = element('#inspector');
  await inspector.dispatch('focusin', input);
  for (const value of values) {
    input.value = String(value);
    await inspector.dispatch('input', input);
  }
  await inspector.dispatch('change', input);
  await inspector.dispatch('focusout', input);
}

test.each(['original', 'exported', 'imported'] as const)(
  'visibility controls retain the shared editor after reloading the %s rig',
  async (source) => {
    const { scene, editor, file, element, puppet } = await panelFixture();
    const controls = element('#visibility').querySelectorAll('input');
    const artwork = controls.find((input) => input.dataset.visibility === 'artwork')!;
    artwork.checked = false;
    await artwork.dispatch('change');
    element('#opacity').value = '0.25';
    await element('#opacity').dispatch('change');
    if (source === 'exported') {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await element('#log-json').click();
      await element('#reload-exported').click();
    } else if (source === 'imported') {
      element('#load-json').files = [{ name: 'imported.json', text: async () => JSON.stringify(file) }];
      await element('#load-json').dispatch('change');
    } else await element('#reload-original').click();
    assert.strictEqual(scene.rigEditor, editor);
    assert.deepEqual(element('#visibility').querySelectorAll('input'), controls);
    assert.isFalse(artwork.checked);
    assert.equal(element('#opacity').value, '0.25');
    for (const control of controls) {
      const key = control.dataset.visibility as keyof typeof editor.state.visibility;
      const original = editor.state.visibility[key];
      control.checked = !original;
      await control.dispatch('change');
      assert.equal(editor.state.visibility[key], !original);
      control.checked = original;
      await control.dispatch('change');
    }
    artwork.checked = true;
    await artwork.dispatch('change');
    assert.equal(puppet.getBone('root').sprite!.alpha, 0.25);
    assert.isFalse(editor.state.dirty);
  },
);

test('an inspector depth edit updates draw order and undo restores the rig and panel', async () => {
  const { editor, puppet, element } = await panelFixture();
  const bone = paperDollIK[0]!.rootBone;
  const before = editor.exportJson(false);
  const order = [...editor.state.rig.renderOrder];
  await editNumber(element, bone, 'depth', [-5, -8]);
  const editedOrder = new Rig(editor.state.workingCopy).renderOrder;
  assert.notDeepEqual(editedOrder, order);
  assert.deepEqual(puppet.getRenderOrder(), editedOrder);
  assert.equal(editor.state.getBone(bone).depth, -8);
  assert.equal(editor.state.historyLength, 1);
  assert.equal(element('#dirty-status').textContent, 'Unsaved changes *');
  assert.isFalse(element('#undo').disabled);

  await element('#undo').click();
  assert.equal(editor.exportJson(false), before);
  assert.deepEqual(puppet.getRenderOrder(), order);
  assert.equal(element('#dirty-status').textContent, 'No changes');
  assert.isTrue(element('#undo').disabled);
  assert.isFalse(element('#redo').disabled);
  assert.include(element('#inspector').innerHTML, 'value="0" data-scope="bone" data-field="depth"');

  await element('#redo').click();
  assert.equal(editor.state.getBone(bone).depth, -8);
  assert.deepEqual(puppet.getRenderOrder(), editedOrder);
});

test('an oversized rig file is rejected before reading and preserves the active session', async () => {
  const { scene, editor, element } = await panelFixture();
  await editNumber(element, 'root', 'x', [5]);
  const before = editor.exportJson(false);
  const text = vi.fn(async () => '{}');
  const input = element('#load-json');
  input.files = [{ name: 'large.json', size: 10 * 1024 * 1024 + 1, text }];
  await input.dispatch('change');
  assert.match(element('#action-feedback').textContent, /size limit/);
  assert.equal(text.mock.calls.length, 0);
  assert.strictEqual(scene.rigEditor, editor);
  assert.equal(editor.exportJson(false), before);
  assert.isTrue(editor.state.dirty);
  await element('#undo').click();
  assert.isFalse(editor.state.dirty);
  assert.isFalse(editor.state.canUndo);
});

test.each(['malformed JSON', 'invalid rig', 'incompatible preview'])(
  'a failed import (%s) keeps the panel editable and its history usable',
  async (failure) => {
    const { scene, editor, puppet, file, disable, destroy, element } = await panelFixture();
    await editNumber(element, 'root', 'x', [5]);
    const before = editor.exportJson(false);
    const imported = structuredClone(file);
    let json: string;
    if (failure === 'malformed JSON') json = '{';
    else if (failure === 'invalid rig') json = JSON.stringify({ ...file, root: 'missing' });
    else {
      imported.bones.find((bone) => bone.id === paperDollIK[0]!.middleBone)!.parent = 'root';
      json = JSON.stringify(imported);
    }
    const input = element('#load-json');
    input.value = 'failed.json';
    input.files = [{ name: 'failed.json', text: async () => json }];
    await input.dispatch('change');
    assert.include(element('#action-feedback').textContent, 'Could not load rig:');
    assert.equal(input.value, '');
    assert.strictEqual(scene.rigEditor, editor);
    assert.equal(scene.rigFilename, 'working.json');
    assert.equal(editor.exportJson(false), before);
    assert.equal(disable.mock.calls.length, 0);
    assert.equal(destroy.mock.calls.length, 0);

    await editNumber(element, 'root', 'x', [22]);
    assert.equal(editor.state.getBone('root').x, 22);
    assert.equal(puppet.getBone('root').pose.x, 22);
    assert.equal(element('#dirty-status').textContent, 'Unsaved changes *');
    await element('#undo').click();
    assert.equal(editor.exportJson(false), before);
    assert.equal(puppet.getBone('root').pose.x, 5);
    await element('#undo').click();
    assert.equal(puppet.getBone('root').pose.x, 0);
    assert.equal(element('#dirty-status').textContent, 'No changes');
  },
);

test.each(['success', 'failure'] as const)(
  'an older import %s cannot replace a newer import or its feedback',
  async (outcome) => {
    const { scene, file, element } = await panelFixture();
    let finish!: (json: string) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const input = element('#load-json');
    input.files = [{ name: 'older.json', text: () => pending }];
    const first = input.dispatch('change');
    input.files = [{ name: 'newer.json', text: async () => JSON.stringify(file) }];
    await input.dispatch('change');
    const replacement = scene.rigEditor;
    const feedback = element('#action-feedback').textContent;
    if (outcome === 'success') finish(JSON.stringify(file));
    else fail(new Error('Stale read failed'));
    await first;
    assert.strictEqual(scene.rigEditor, replacement);
    assert.equal(scene.rigFilename, 'newer.json');
    assert.equal(element('#action-feedback').textContent, feedback);
  },
);

test.each(['original', 'exported', 'replacement'] as const)(
  'reloading %s invalidates a pending import',
  async (source) => {
    const { scene, file, element } = await panelFixture();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await element('#log-json').click();
    let finish!: (json: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const input = element('#load-json');
    input.files = [{ name: 'stale.json', text: () => pending }];
    const first = input.dispatch('change');
    if (source === 'replacement') scene.reloadRig(file, 'replacement.json');
    else await element(`#reload-${source}`).click();
    const replacement = scene.rigEditor;
    const filename = scene.rigFilename;
    const feedback = element('#action-feedback').textContent;
    finish(JSON.stringify(file));
    await first;
    assert.strictEqual(scene.rigEditor, replacement);
    assert.equal(scene.rigFilename, filename);
    assert.equal(element('#action-feedback').textContent, feedback);
  },
);

test.each(['hierarchy', 'mesh', 'attachments', 'canvas'] as const)(
  'selection from %s keeps inspector navigation appropriate to its origin',
  async (origin) => {
    const { editor, controller, element } = await panelFixture();
    const app = element('#editor-app');
    vi.spyOn(element('#rig-inspector'), 'matches').mockImplementation(
      (selector) => selector === ':focus-within' && origin !== 'canvas',
    );
    vi.spyOn(app, 'querySelector').mockImplementation((selector) => {
      if (selector === '.workspace-hierarchy:focus-within')
        return origin === 'hierarchy' ? element('#hierarchy') : null;
      return element(selector);
    });
    editor.state.selectBone('root');
    controller.render(editor);
    const panel = element('[data-editor-tab-panel="rig-inspector-selection"]');
    panel.dispatchEvent.mockClear();
    const before = editor.state.workingCopy;
    const history = editor.state.historyLength;
    editor.state.selectBone(paperDollIK[0]!.rootBone);
    controller.render(editor);
    assert.strictEqual(editor.state.workingCopy, before);
    assert.equal(editor.state.historyLength, history);
    if (origin === 'canvas') {
      assert.equal(panel.dispatchEvent.mock.calls.length, 1);
      const event = panel.dispatchEvent.mock.calls[0]![0] as CustomEvent<string>;
      assert.equal(event.type, 'workspace:reveal-tab');
      assert.equal(event.detail, 'rig-inspector-selection');
    } else assert.equal(panel.dispatchEvent.mock.calls.length, 0);
  },
);

test.each(['mesh', 'attachments'] as const)(
  '%s slot selector reveals its own tab without focus and releases that intent for later canvas selections',
  async (tab) => {
    const { editor, controller, element } = await panelFixture(true);
    vi.spyOn(element('#editor-app'), 'querySelector').mockImplementation((selector) =>
      selector.endsWith(':focus-within') ? null : element(selector),
    );
    editor.state.selectBone('root');
    controller.render(editor);
    const target = element(`[data-editor-tab-panel="rig-inspector-${tab}"]`);
    const details = element('[data-editor-tab-panel="rig-inspector-selection"]');
    details.dispatchEvent.mockClear();
    const before = editor.state.workingCopy,
      history = editor.state.historyLength;
    const attachments = new AttachmentController();
    attachments.bind(editor);
    attachments.selectSlot('root', tab);
    assert.equal(editor.state.selectionInspectorTab, tab);
    assert.equal(target.dispatchEvent.mock.calls.length, 1);
    assert.equal((target.dispatchEvent.mock.calls[0]![0] as CustomEvent<string>).detail, `rig-inspector-${tab}`);
    assert.equal(details.dispatchEvent.mock.calls.length, 0);
    assert.strictEqual(editor.state.workingCopy, before);
    assert.equal(editor.state.historyLength, history);
    target.dispatchEvent.mockClear();
    // Canvas code assigns fresh selection objects directly. The old inspector request must not follow the ID.
    for (const id of ['other', 'root']) {
      editor.state.selection = { type: 'slot', id };
      editor.refresh();
      assert.isUndefined(editor.state.selectionInspectorTab);
    }
    assert.equal(details.dispatchEvent.mock.calls.length, 2);
    assert.equal(target.dispatchEvent.mock.calls.length, 0);
    editor.state.selectSlot('root');
    assert.isUndefined(editor.state.selectionInspectorTab);
    attachments.dispose();
  },
);
