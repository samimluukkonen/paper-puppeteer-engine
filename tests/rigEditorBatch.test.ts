import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import * as externalData from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { rigDefinitionSchema } from '../src/engine/schemas.js';

vi.mock('phaser', () => ({ default: { Scenes: { Events: { UPDATE: 'update' } } } }));
vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    draw() {}
    pick() {}
    destroy() {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const dragCases = (['pointerup', 'pointerupoutside', 'disable'] as const).flatMap((finish) =>
  (['bone', 'slot', 'sprite', 'attachment'] as const).map((type) => ({ type, finish })),
);

test.each(dragCases)(
  '$type drag synchronizes once per move and validates the final grouped edit after $finish',
  ({ type, finish }) => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
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
    const emit = (event: string, x: number, y: number) => {
      const [, handler, context] = input.on.mock.calls.find(([name]) => name === event)!;
      handler.call(context, { x, y, isDown: true, leftButtonDown: () => true, middleButtonDown: () => false });
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
    assert.equal(validate.mock.calls.length, 0, 'full validation waits until the drag finishes');
    assert.isTrue(editor.state.validationPending);
    assert.equal(puppet.syncPose.mock.calls.length, 2);
    assert.equal(parse.mock.calls.length, 0, 'refresh does not rebuild and parse a rig');
    assert.equal(onChange.mock.calls.length, 2);
    assert.isFalse(editor.state.canUndo);
    if (finish === 'disable') {
      editor.disable();
      editor.disable();
      editor.enable();
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
    editor.disable();
  },
);
