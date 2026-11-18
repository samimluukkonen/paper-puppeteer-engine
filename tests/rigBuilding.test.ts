import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import { createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import { AttachmentController } from '../src/devtools/rig-editor/AttachmentController.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { sameRigTopology } from '../src/devtools/shared/boneHierarchy.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    invalidate() {}
    draw() {}
    destroy() {}
  },
}));

afterEach(() => vi.unstubAllGlobals());

function draft() {
  return createNewCharacter({ name: 'Branch creature', id: 'branch-creature' });
}

test('builds a named root, arbitrary nested bones, slots and default artwork without editing JSON', () => {
  const { rig: state, definition } = draft();
  state.renameBone('root', 'base');
  state.createBone('branch', 'base');
  state.createBone('tip');
  state.editBoneFields('branch', { x: 24, y: -30, rotation: 0.3, length: 18 });
  state.createSlot('tip-art', 'tip');
  assert.isUndefined(state.resolvedAttachment('tip-art'));
  state.createAttachment({ id: 'leaf-visual', texture: 'artist-imported-leaf' });
  state.assignAttachment('tip-art', 'leaf-visual');
  state.editSpriteFields('leaf-visual', { originX: 0.1, originY: 0.75, x: -5, y: 3 }, true);
  state.editSlotFields('tip-art', { rotation: 0.2, scaleX: 1.5, depth: 7 });
  assert.deepEqual(state.hierarchy(), [
    { id: 'base', depth: 0 },
    { id: 'branch', depth: 1 },
    { id: 'tip', depth: 2 },
  ]);
  assert.deepEqual(state.childrenOf('branch'), ['tip']);
  assert.equal(state.activeSkin, 'default');
  assert.equal(state.resolvedAttachment('tip-art'), 'leaf-visual');
  assert.deepEqual(state.validationIssues(), []);
  const loaded = parseRigDefinition(JSON.parse(state.exportJson(false)));
  assert.equal(loaded.getBone('tip').parent, 'branch');
  assert.equal(loaded.getSlot('tip-art').bone, 'tip');
  assert.equal(loaded.getAttachment('leaf-visual').originX, 0.1);
  assert.equal(loaded.getAttachment('leaf-visual').x, -5);
  assert.deepEqual(JSON.parse(state.exportSkinJson('default', false)), {
    version: 1,
    name: 'default',
    slots: { 'tip-art': 'leaf-visual' },
  });
  assert.deepEqual(definition.rig.bones, [{ id: 'root' }]);
  assert.deepEqual(definition.textures, {});
});

test('hierarchy validation rejects duplicate IDs, missing parents, cycles, self parenting and root removal atomically', () => {
  const { rig: state } = draft();
  state.createBone('branch', 'root');
  state.createBone('tip');
  const before = state.workingCopy;
  const history = state.historyLength;
  for (const action of [
    () => state.createBone('tip'),
    () => state.createBone('bad', 'missing'),
    () => state.createBone(''),
    () => state.renameBone('tip', 'branch'),
    () => state.reparentBone('branch', 'tip'),
    () => state.reparentBone('tip', 'tip'),
    () => state.reparentBone('root', 'branch'),
    () => state.removeBone('root'),
    () => state.createSlot('bad', 'missing'),
    () => state.editBoneFields('tip', { x: Infinity }),
    () => state.editBone('tip', 'length', -1),
  ]) {
    assert.throws(action);
    assert.strictEqual(state.workingCopy, before);
    assert.equal(state.historyLength, history);
  }
});

test('reparenting and leaf deletion preserve data, indexes, selection and individual undo/redo entries', () => {
  const { rig: state } = draft();
  state.createBone('a', 'root');
  state.createBone('leaf', 'a');
  state.createBone('b', 'root');
  state.editBoneFields('leaf', { x: 13, y: 20, rotation: 0.7 });
  state.reparentBone('leaf', 'b');
  assert.deepEqual(state.childrenOf('a'), []);
  assert.deepEqual(state.childrenOf('b'), ['leaf']);
  assert.equal(state.getBone('leaf').x, 13);
  state.undo();
  assert.equal(state.getBone('leaf').parent, 'a');
  state.redo();
  assert.equal(state.getBone('leaf').parent, 'b');
  state.selectBone('leaf');
  state.removeBone('leaf');
  assert.isNull(state.selection);
  assert.throws(() => state.selectBone('leaf'), /Unknown bone/);
  state.undo();
  assert.equal(state.getBone('leaf').parent, 'b');
  state.redo();
  assert.deepEqual(state.childrenOf('b'), []);
});

test('deletion reports children, slots, skin mappings, artwork and IK without cascading authored data', () => {
  const state = new RigEditorState(
    new Rig({
      root: 'root',
      bones: [
        { id: 'root' },
        { id: 'a', parent: 'root' },
        { id: 'b', parent: 'a', y: 20 },
        { id: 'c', parent: 'b', y: 20 },
      ],
      slots: [{ id: 'visual', bone: 'c' }],
      skins: [{ version: 1, name: 'default', slots: { visual: null } }],
      ik: [{ name: 'chain', rootBone: 'a', middleBone: 'b', endBone: 'c' }],
    }),
  );
  const before = state.workingCopy;
  assert.throws(() => state.removeBone('a'), /child bone.*IK constraint/);
  assert.throws(() => state.removeBone('c'), /slot.*IK constraint/);
  assert.throws(() => state.renameBone('c', 'renamed'), /IK constraint/);
  assert.throws(() => state.reparentBone('c', 'root'));
  assert.throws(() => state.removeSlot('visual'), /skin "default"/);
  assert.strictEqual(state.workingCopy, before);
  assert.equal(state.historyLength, 0);
  state.assignAttachment('visual', undefined);
  state.removeSlot('visual');
  assert.deepEqual(state.rig.slots, []);
  state.undo();
  assert.equal(state.getSlot('visual').bone, 'c');
});

test('renaming preserves child/slot references and zero-length directions through history', () => {
  const { rig: state } = draft();
  state.createBone('branch', 'root');
  state.createBone('tip');
  state.createSlot('visual', 'branch');
  state.editBoneFields('branch', { x: 12, y: 16 });
  state.editBone('root', 'length', 0);
  state.renameBone('branch', 'limb');
  assert.equal(state.getBone('tip').parent, 'limb');
  assert.equal(state.getSlot('visual').bone, 'limb');
  state.undo();
  assert.equal(state.getBone('tip').parent, 'branch');
  state.redo();
  state.editBone('root', 'length', 20);
  assert.deepEqual([state.getBone('limb').x, state.getBone('limb').y], [12, 16]);
});

test('structural recovery survives fresh draft initialization, supports undo, and validates new joint directions', () => {
  const { rig: state } = draft();
  state.renameBone('root', 'base');
  state.createBone('arm', 'base');
  state.createSlot('visual', 'arm');
  state.editBoneFields('arm', { x: 3, y: 4 });
  state.editBone('base', 'length', 0);
  const recovery: unknown = JSON.parse(JSON.stringify(state.createRecoveryDraft()));
  const restored = draft().rig;
  assert.isTrue(restored.restoreDraft(recovery));
  assert.deepEqual(restored.workingCopy, state.workingCopy);
  assert.deepEqual(restored.hierarchy(), state.hierarchy());
  assert.equal(restored.historyLength, 1);
  restored.undo();
  assert.deepEqual(restored.hierarchy(), [{ id: 'root', depth: 0 }]);
  restored.redo();
  restored.editBone('base', 'length', 10);
  assert.deepEqual([restored.getBone('arm').x, restored.getBone('arm').y], [6, 8]);
  assert.isTrue(restored.canRestoreDraft(restored.exportRig(false)), 'current-topology JSON can be reimported');
});

test('live animation references protect deletion, rename, reset and rig undo without changing animation history', () => {
  const { rig: state, animation } = draft();
  state.createBone('animated', 'root');
  animation.updatePreviewRig(new Rig(state.workingCopy));
  assert.isTrue(animation.createAnimation({ name: 'motion' }));
  assert.isTrue(animation.keyframes.setBonePropertyKeyframe('animated', 'rotation', 0.5));
  const tracks = animation.workingAnimation;
  const before = state.workingCopy;
  const history = state.historyLength;
  assert.throws(() => state.removeBone('animated'), /animation "motion"/);
  assert.throws(() => state.renameBone('animated', 'other'), /animation "motion"/);
  assert.throws(() => state.resetRig(), /animation "motion"/);
  assert.throws(() => state.undo(), /animation "motion"/);
  assert.strictEqual(state.workingCopy, before);
  assert.equal(state.historyLength, history);
  assert.strictEqual(animation.workingAnimation, tracks);
});

test('new bones and slots reset numeric fields without relying on original array indexes', () => {
  const { rig: state } = draft();
  state.createBone('a', 'root');
  state.createBone('b', 'root');
  state.removeBone('a');
  state.selectBone('b');
  state.editBoneFields('b', { rotation: 0.4, scaleX: 2 });
  state.resetSelected();
  assert.equal(state.getBone('b').parent, 'root');
  assert.isUndefined(state.getBone('b').rotation);
  state.createSlot('visual', 'b');
  state.editSlot('visual', 'x', 14);
  state.resetSelected();
  assert.deepEqual(state.getSlot('visual'), { id: 'visual', bone: 'b' });
});

test('renamed existing bones retain slot ownership on reset and support current-topology JSON reloads', () => {
  const state = new RigEditorState(
    new Rig({
      root: 'root',
      bones: [{ id: 'root' }, { id: 'child', parent: 'root', x: 3, y: 4 }],
      slots: [{ id: 'visual', bone: 'child', x: 7 }],
    }),
  );
  state.renameBone('child', 'branch');
  state.selectSlot('visual');
  state.editSlot('visual', 'x', 20);
  state.resetSelected();
  assert.deepEqual(state.getSlot('visual'), { id: 'visual', bone: 'branch', x: 7 });
  assert.isTrue(state.restoreDraft(state.exportRig(false)));
  assert.equal(state.getBone('branch').parent, 'root');
  assert.deepEqual(state.validationIssues(), []);
});

test('deleting earlier bones and slots preserves untouched authored precision during serialization', () => {
  const precise = 0.123456789012345;
  const state = new RigEditorState(
    new Rig({
      root: 'root',
      bones: [
        { id: 'root' },
        { id: 'remove', parent: 'root' },
        { id: 'keep', parent: 'root', x: precise, rotation: precise },
      ],
      slots: [
        { id: 'remove-slot', bone: 'root' },
        { id: 'keep-slot', bone: 'keep', x: precise, rotation: precise },
      ],
    }),
  );
  state.removeBone('remove');
  state.removeSlot('remove-slot');
  const loaded = parseRigDefinition(JSON.parse(state.exportJson(false)));
  assert.equal(loaded.getBone('keep').x, precise);
  assert.equal(loaded.getBone('keep').rotation, precise);
  assert.equal(loaded.getSlot('keep-slot').x, precise);
  assert.equal(loaded.getSlot('keep-slot').rotation, precise);
});

test('runtime reconstruction handles reordered parents, empty slots, artwork alignment and facing', () => {
  const { rig: state, definition } = draft();
  const scene = puppetScene();
  let preview = new Puppet(scene, { definition, autoUpdate: false });
  const editor = new RigEditor(
    scene,
    preview,
    () => {},
    state,
    [],
    [],
    undefined,
    undefined,
    (next) => {
      preview = next;
    },
  );
  editor.refresh();
  editor.setFacing('left');
  for (const [id, parent] of [
    ['a', 'root'],
    ['leaf', 'a'],
    ['b', 'root'],
  ] as const) {
    state.createBone(id, parent);
    editor.refresh();
    assert.equal(preview.getBone(id).id, id);
  }
  state.reparentBone('leaf', 'b');
  editor.refresh();
  assert.equal(preview.getBone('leaf').container.parentContainer, preview.getBone('b').container);
  assert.isTrue(sameRigTopology(preview.rig, state.workingCopy));
  state.createSlot('visual', 'leaf');
  editor.refresh();
  assert.isUndefined(preview.getSlotImage('visual'));
  state.createAttachment({ id: 'chosen', texture: 'artist-image' });
  state.assignAttachment('visual', 'chosen');
  state.editSpriteFields('chosen', { x: -8, y: 3, originX: 0.2, originY: 0.7 }, true);
  editor.refresh();
  assert.equal(preview.getSlotImage('visual')!.texture.key, 'artist-image');
  assert.equal(preview.getSlotImage('visual')!.originX, 0.2);
  assert.equal(preview.getSlotImage('visual')!.x, -8);
  assert.equal(preview.container.scaleX, -1);
  state.editBone('b', 'rotation', 0.4);
  editor.refresh();
  assert.closeTo(preview.getBone('b').pose.rotation, 0.4, 1e-10);
  editor.undo();
  editor.redo();
  state.assignAttachment('visual', undefined);
  state.removeSlot('visual');
  editor.refresh();
  editor.undo();
  assert.isTrue(preview.rig.slots.some((slot) => slot.id === 'visual'));
  preview.destroy();
});

test('cancelled hierarchy dialogs preserve authored snapshots and history', () => {
  const { rig: state, definition } = draft();
  const scene = puppetScene();
  const preview = new Puppet(scene, { definition, autoUpdate: false });
  const editor = new RigEditor(scene, preview, () => {}, state);
  const controller = new AttachmentController();
  controller.bind(editor);
  state.createBone('a', 'root');
  state.createBone('b', 'root');
  state.selectBone('a');
  const before = state.workingCopy;
  const history = state.historyLength;
  const confirm = vi.fn(() => false);
  vi.stubGlobal('window', { confirm });
  controller.reparentBone('b');
  controller.removeBone();
  assert.equal(confirm.mock.calls.length, 2);
  assert.strictEqual(state.workingCopy, before);
  assert.equal(state.historyLength, history);
  assert.equal(controller.getSnapshot().message, 'Operation cancelled.');
  controller.dispose();
  preview.destroy();
});

test('a rejected preview rebuild can be undone and retried without recursion or leaked input listeners', () => {
  const { rig: state, definition } = draft();
  const scene = puppetScene();
  Object.assign(scene, { input: new EventEmitter(), events: new EventEmitter() });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  let preview = new Puppet(scene, { definition, autoUpdate: false });
  let reject = true;
  const rebuilt = vi.fn((next: Puppet) => {
    if (reject) throw new Error('Rebuild rejected');
    preview = next;
  });
  const editor = new RigEditor(scene, preview, () => {}, state, [], [], undefined, undefined, rebuilt);
  editor.enable();
  const listeners = scene.input.listenerCount('pointerdown');
  state.createBone('branch', 'root');
  assert.throws(() => editor.refresh(), /Rebuild rejected/);
  assert.equal(rebuilt.mock.calls.length, 1);
  assert.isFalse(Reflect.get(preview.container, 'isDestroyed'));
  editor.undo();
  assert.equal(editor.actionError, '');
  assert.equal(scene.input.listenerCount('pointerdown'), listeners);
  reject = false;
  state.createBone('branch', 'root');
  editor.refresh();
  assert.equal(preview.getBone('branch').id, 'branch');
  assert.equal(scene.input.listenerCount('pointerdown'), listeners);
  editor.disable();
  preview.destroy();
});
