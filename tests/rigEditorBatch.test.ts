import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorInputController } from '../src/devtools/rig-editor/RigEditorInputController.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import * as externalData from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { rigDefinitionSchema } from '../src/engine/schemas.js';

vi.mock('phaser', () => ({ default: { Scenes: { Events: { UPDATE: 'update' } } } }));
vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    invalidate() {}
    draw() {}
    pick() {}
    destroy() {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('blur stops panning without adding history or closing an unrelated inspector edit', () => {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }));
  state.selectBone('root');
  state.beginOperation();
  state.editBone('root', 'x', 2);
  const input = { on: vi.fn(), off: vi.fn() };
  const camera = { scrollX: 0, scrollY: 0, zoom: 1 };
  const redraw = vi.fn();
  const controller = new RigEditorInputController(
    { input, cameras: { main: camera } } as unknown as Phaser.Scene,
    {} as Puppet,
    { state, editBone: vi.fn(), undo: vi.fn(), redo: vi.fn(), refresh: vi.fn() },
    {} as RigEditorOverlay,
    vi.fn(),
    redraw,
  );
  controller.enable();
  browser.dispatchEvent(new Event('blur'));
  assert.isTrue(state.validationPending);
  state.endOperation();
  const emit = (event: string, id = 1) => {
    const [, handler, context] = input.on.mock.calls.find(([name]) => name === event)!;
    handler.call(context, {
      id,
      x: 10,
      y: 10,
      prevPosition: { x: 0, y: 0 },
      isDown: true,
      middleButtonDown: () => true,
    });
  };
  emit('pointerdown');
  emit('pointermove');
  assert.equal(camera.scrollX, -10);
  browser.dispatchEvent(new Event('blur'));
  emit('pointermove');
  assert.equal(camera.scrollX, -10);
  emit('pointerdown', 2);
  emit('pointermove', 2);
  assert.equal(camera.scrollX, -20);
  assert.equal(state.historyLength, 1);
  assert.deepEqual(state.selection, { type: 'bone', id: 'root' });
  controller.disable();
});

const dragCases = (['pointerup', 'pointerupoutside', 'disable', 'blur', 'hidden', 'pagehide'] as const).flatMap(
  (finish) => (['bone', 'slot', 'sprite', 'attachment'] as const).map((type) => ({ type, finish })),
);

test.each(dragCases)(
  '$type drag synchronizes once per move and validates the final grouped edit after $finish',
  ({ type, finish }) => {
    const browser = new EventTarget();
    vi.stubGlobal('window', browser);
    const document = { visibilityState: 'visible' };
    vi.stubGlobal('document', document);
    const rig = new Rig({
      root: 'root',
      bones: [{ id: 'root', sprite: { texture: 'part' } }],
      slots: [
        { id: 'visual', bone: 'root' },
        { id: 'other', bone: 'root' },
      ],
      attachments: [{ id: 'part', texture: 'part' }],
    });
    const frame = { getWorldTransformMatrix: () => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }) };
    const image = {
      ...frame,
      parentContainer: frame,
      width: 100,
      height: 100,
      originX: 0.5,
      originY: 0.5,
      setPosition: vi.fn().mockReturnThis(),
      setOrigin: vi.fn().mockReturnThis(),
      setAlpha: vi.fn().mockReturnThis(),
    };
    const bone = Object.assign(new Joint('root'), { container: { ...frame, parentContainer: frame }, sprite: image });
    const puppet = {
      rig,
      getBone: () => bone,
      getSlotImage: () => image,
      getAttachment: () => 'part',
      resetToBindPose: vi.fn().mockReturnThis(),
      setFacing: vi.fn().mockReturnThis(),
      preparePose: vi.fn(),
      syncPose: vi.fn(),
      setRenderOrder: vi.fn(),
      setSlotTransform: Puppet.prototype.setSlotTransform,
      setSlotDepth: vi.fn(),
      clearSlotDepth: vi.fn(),
      renderer: { setSlotTransform: vi.fn() },
    };
    const input = { on: vi.fn(), off: vi.fn() };
    const scene = {
      input,
      events: { on: vi.fn(), off: vi.fn() },
      cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } },
    };
    const onChange = vi.fn(() => {
      editor.state.validationIssues();
      return editor.state.dirty;
    });
    const editor = new RigEditor(scene as unknown as Phaser.Scene, puppet as unknown as Puppet, onChange);
    const selection =
      type === 'slot' || type === 'attachment'
        ? { type: 'slot' as const, id: 'visual' }
        : { type: 'bone' as const, id: 'root' };
    editor.state.selection = selection;
    editor.state.editMode = type === 'sprite' || type === 'attachment' ? 'sprite' : 'joint';
    editor.state.gridSnap = 5;
    vi.spyOn(RigEditorOverlay.prototype, 'pick').mockReturnValue(type === 'attachment' ? null : selection);
    editor.enable();
    puppet.syncPose.mockClear();
    const emit = (event: string, x: number, y: number, id = 1) => {
      const [, handler, context] = input.on.mock.calls.find(([name]) => name === event)!;
      handler.call(context, { id, x, y, isDown: true, leftButtonDown: () => true, middleButtonDown: () => false });
    };
    const validate = vi.spyOn(externalData, 'validateRigDefinition');
    const parse = vi.spyOn(rigDefinitionSchema, 'parse');
    emit('pointerdown', 0, 0);
    validate.mockClear();
    onChange.mockClear();
    for (const [x, y] of [
      [12, 18],
      [22, 28],
    ]) {
      emit('pointermove', x!, y!);
    }
    // Another touch must neither take over the gesture nor commit its history.
    emit('pointerdown', 200, 200, 2);
    emit('pointermove', 300, 300, 2);
    emit('pointerup', 300, 300, 2);
    emit('pointerupoutside', 300, 300, 2);
    assert.equal(validate.mock.calls.length, 0, 'full validation waits until the drag finishes');
    assert.isTrue(editor.state.validationPending);
    assert.equal(puppet.syncPose.mock.calls.length, 2);
    assert.equal(parse.mock.calls.length, 0, 'refresh does not rebuild and parse a rig');
    assert.equal(onChange.mock.calls.length, 2);
    assert.isFalse(editor.state.canUndo);
    browser.dispatchEvent(new Event('visibilitychange'));
    assert.isTrue(editor.state.validationPending, 'becoming visible must not interrupt editing');
    if (finish === 'disable') {
      editor.disable();
      editor.disable();
      editor.enable();
    } else if (finish === 'blur' || finish === 'pagehide' || finish === 'hidden') {
      if (finish === 'hidden') document.visibilityState = 'hidden';
      browser.dispatchEvent(new Event(finish === 'hidden' ? 'visibilitychange' : finish));
      browser.dispatchEvent(new Event('blur'));
      browser.dispatchEvent(new Event('pagehide'));
    } else {
      emit(finish, 22, 28);
      emit('pointerup', 22, 28);
    }
    emit('pointermove', 100, 100);
    assert.equal(validate.mock.calls.length, 1, 'finishing the drag validates the final edit once');
    assert.isFalse(editor.state.validationPending);
    assert.isTrue(editor.state.canUndo);
    assert.equal(editor.state.historyLength, 1);
    const current = () =>
      type === 'bone'
        ? editor.state.getBone('root')
        : type === 'slot'
          ? editor.state.getSlot('visual')
          : type === 'sprite'
            ? editor.state.getBone('root').sprite!
            : editor.state.getAttachment('part');
    assert.equal(current().x, 20);
    assert.equal(current().y, 30);
    editor.undo();
    assert.isUndefined(current().x);
    assert.isUndefined(current().y);
    editor.redo();
    assert.equal(current().x, 20);
    assert.equal(current().y, 30);
    emit('pointerdown', 0, 0, 2);
    emit('pointermove', 10, 10, 2);
    emit('pointerup', 10, 10, 2);
    assert.equal(current().x, 30, 'a new pointer can start another gesture after interruption');
    assert.equal(current().y, 40);
    assert.equal(editor.state.historyLength, 2);
    editor.disable();
    const notifications = onChange.mock.calls.length;
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('visibilitychange'));
    assert.equal(onChange.mock.calls.length, notifications, 'disabled input ignores interruption events');
  },
);
