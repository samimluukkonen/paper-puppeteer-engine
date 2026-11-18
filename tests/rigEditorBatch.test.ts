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

type PointerListener = (this: unknown, pointer: unknown) => void;

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
  const input = {
    on: vi.fn<(event: string, listener: PointerListener, context: unknown) => void>(),
    off: vi.fn(),
  };
  const camera = { scrollX: 0, scrollY: 0, zoom: 1 };
  const redraw = vi.fn();
  const controller = new RigEditorInputController(
    { input, cameras: { main: camera } } as unknown as Phaser.Scene,
    {} as Puppet,
    {
      state,
      editBone: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      refresh: vi.fn(),
      moveCharacter: vi.fn(),
      previewArtwork: vi.fn(),
      finishArtworkGesture: vi.fn(),
    },
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

const dragCases: {
  type: 'bone' | 'slot' | 'sprite' | 'attachment';
  finish: 'pointerup' | 'pointerupoutside' | 'disable' | 'blur' | 'hidden' | 'pagehide';
}[] = (['pointerup', 'pointerupoutside'] as const).flatMap((finish) =>
  (['bone', 'slot'] as const).map((type) => ({ type, finish })),
);

test.each([
  { mode: 'joint' as const, zoom: 0.5 },
  { mode: 'sprite' as const, zoom: 2 },
])('background drag moves only the preview in $mode mode at zoom $zoom', ({ mode, zoom }) => {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }));
  state.selectBone('root');
  state.editMode = mode;
  state.gridSnap = 10;
  const input = {
    on: vi.fn<(event: string, listener: PointerListener, context: unknown) => void>(),
    off: vi.fn(),
  };
  const container = { x: 380, y: 435, parentContainer: null };
  const camera = {
    scrollX: 30,
    scrollY: 50,
    zoom,
    getWorldPoint: (x: number, y: number) => ({ x: x / zoom + 30, y: y / zoom + 50 }),
  };
  const moveCharacter = vi.fn((x: number, y: number) => Object.assign(container, { x, y }));
  const controller = new RigEditorInputController(
    { input, cameras: { main: camera } } as unknown as Phaser.Scene,
    { container, getBone: () => ({}) } as unknown as Puppet,
    {
      state,
      editBone: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      refresh: vi.fn(),
      moveCharacter,
      previewArtwork: vi.fn(),
      finishArtworkGesture: vi.fn(),
    },
    { pick: () => null } as unknown as RigEditorOverlay,
    vi.fn(),
    vi.fn(),
  );
  controller.enable();
  const emit = (event: string, x: number, y: number, id = 1) => {
    const [, handler, context] = input.on.mock.calls.find(([name]) => name === event)!;
    handler.call(context, { id, x, y, isDown: true, leftButtonDown: () => true, middleButtonDown: () => false });
  };
  const exported = state.exportJson(false);
  emit('pointerdown', 10, 10);
  emit('pointermove', 12, 12);
  assert.equal(moveCharacter.mock.calls.length, 0, 'click jitter must not move the character');
  emit('pointermove', 37, 29);
  assert.equal(container.x, 380 + 27 / zoom);
  assert.equal(container.y, 435 + 19 / zoom);
  emit('pointerup', 37, 29, 2);
  emit('pointermove', 100, 100, 2);
  assert.equal(moveCharacter.mock.calls.length, 1, 'another pointer cannot take over');
  emit('pointerupoutside', 37, 29);
  emit('pointermove', 50, 50);
  assert.equal(moveCharacter.mock.calls.length, 1, 'release outside stops the drag');
  assert.deepEqual(state.selection, { type: 'bone', id: 'root' });
  assert.equal(camera.scrollX, 30);
  assert.equal(camera.scrollY, 50);
  assert.equal(state.exportJson(false), exported);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  emit('pointerdown', 10, 10);
  emit('pointermove', 20, 20);
  browser.dispatchEvent(new Event('blur'));
  emit('pointermove', 30, 30);
  assert.equal(moveCharacter.mock.calls.length, 2, 'blur stops the drag');
  emit('pointerdown', 10, 10);
  emit('pointerup', 10, 10);
  assert.isNull(state.selection, 'a background click still clears selection');
  emit('pointerdown', 10, 10);
  emit('pointermove', 20, 20);
  assert.equal(moveCharacter.mock.calls.length, 3, 'background dragging also works without a selection');
  controller.disable();
});

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
      getArtworkReplacement: () => undefined,
      setArtworkOrigin: (_reference: string, _asset: string, image: Phaser.GameObjects.Image, x: number, y: number) =>
        image.setOrigin(x, y),
      rig,
      getBone: () => bone,
      getSlotImage: () => image,
      getSlotMesh: () => undefined,
      getAttachment: () => 'part',
      resetToBindPose: vi.fn().mockReturnThis(),
      setFacing: vi.fn().mockReturnThis(),
      posePipeline: { preparePose: vi.fn(), syncPose: vi.fn(), markPoseDirty: vi.fn() },
      // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
      editPose: Puppet.prototype.editPose,
      attachPoseSource: vi.fn(() => vi.fn()),
      setRenderOrder: vi.fn(),
      // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
      setSlotTransform: Puppet.prototype.setSlotTransform,
      setSlotDepth: vi.fn(),
      clearSlotDepth: vi.fn(),
      renderer: { setSlotTransform: vi.fn() },
    };
    const input = {
      on: vi.fn<(event: string, listener: PointerListener, context: unknown) => void>(),
      off: vi.fn(),
    };
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
    editor.state.editMode = type === 'sprite' || type === 'attachment' ? 'sprite' : type === 'slot' ? 'slot' : 'joint';
    editor.state.gridSnap = 5;
    vi.spyOn(RigEditorOverlay.prototype, 'pick').mockReturnValue(type === 'attachment' ? null : selection);
    editor.enable();
    puppet.posePipeline.syncPose.mockClear();
    const emit = (event: string, x: number, y: number, id = 1) => {
      const [, handler, context] = input.on.mock.calls.filter(([name]) => name === event).at(-1)!;
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
    assert.equal(puppet.posePipeline.syncPose.mock.calls.length, 2);
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
    assert.equal(current().x, 30, 'a new pointer can start another gesture after interruption');
    assert.equal(current().y, 40);
    editor.undo();
    emit('pointermove', 100, 100, 2);
    emit('pointerup', 100, 100, 2);
    assert.equal(current().x, 20, 'undo ends an active drag before restoring history');
    assert.equal(current().y, 30);
    assert.isTrue(editor.state.canRedo, 'later pointer events preserve the redo branch');
    emit('pointerdown', 0, 0, 3);
    editor.redo();
    emit('pointermove', 100, 100, 3);
    emit('pointerup', 100, 100, 3);
    assert.equal(current().x, 30, 'redo also ends an active gesture');
    assert.equal(current().y, 40);
    assert.equal(editor.state.historyLength, 2);
    editor.disable();
    const notifications = onChange.mock.calls.length;
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('visibilitychange'));
    assert.equal(onChange.mock.calls.length, notifications, 'disabled input ignores interruption events');
  },
);
