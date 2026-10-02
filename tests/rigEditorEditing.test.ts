import { afterEach, assert, test, vi } from 'vitest';
import { localToWorld, worldToLocal } from '../src/devtools/rig-editor/coordinates.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import * as externalData from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => vi.restoreAllMocks());

test('affine coordinate conversion handles translated, rotated and scaled parents independently of camera', () => {
  const parent = { a: 0, b: 2, c: -3, d: 0, tx: 140, ty: -20 };
  const local = { x: 7, y: -4 };
  const world = localToWorld(local, parent);
  assert.deepEqual(world, { x: 152, y: -6 });
  assert.deepEqual(worldToLocal(world, parent), local);
  const camera = { zoom: 2.5, scrollX: 30, scrollY: -50 };
  const screen = { x: (world.x - camera.scrollX) * camera.zoom, y: (world.y - camera.scrollY) * camera.zoom };
  assert.deepEqual(
    worldToLocal({ x: screen.x / camera.zoom + camera.scrollX, y: screen.y / camera.zoom + camera.scrollY }, parent),
    local,
  );
  assert.equal(worldToLocal(world, { ...parent, a: 0, b: 0, c: 0, d: 0 }), undefined);
});

test('editing joint, sprite, length and slot changes only the working rig', () => {
  const source = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'arm', parent: 'root', x: 10, y: 20, length: 30, sprite: { texture: 'arm', x: 2 } },
      { id: 'hand', parent: 'arm', y: 30 },
    ],
    slots: [{ id: 'weapon', bone: 'hand', x: 2 }],
    attachments: [{ id: 'sword', texture: 'sword' }],
  });
  const state = new RigEditorState(source);
  assert.isFalse(state.dirty);
  state.editBone('arm', 'x', 15);
  assert.equal(state.getBone('hand').y, 30);
  state.editSprite('arm', 'x', 9);
  state.editSprite('arm', 'originX', 0.25);
  assert.equal(state.getBone('arm').x, 15);
  state.editBone('arm', 'length', 45);
  assert.equal(state.getBone('hand').y, 45);
  state.editSlot('weapon', 'x', 12);
  state.editSlot('weapon', 'y', -3);
  state.editSlot('weapon', 'rotation', 0.4);
  state.editSlot('weapon', 'scaleX', 1.5);
  state.editSlot('weapon', 'scaleY', 0.8);
  state.editSlot('weapon', 'depth', 31);
  assert.equal(state.getSlot('weapon').x, 12);
  assert.equal(state.getSlot('weapon').y, -3);
  assert.equal(state.getSlot('weapon').rotation, 0.4);
  assert.equal(state.getSlot('weapon').scaleX, 1.5);
  assert.equal(state.getSlot('weapon').scaleY, 0.8);
  assert.equal(state.getSlot('weapon').depth, 31);
  assert.isTrue(state.dirty);
  assert.equal(source.getBone('arm').x, 10);
  assert.equal(source.getBone('arm').sprite?.x, 2);
  assert.equal(source.getBone('arm').sprite?.originX, undefined);
  assert.equal(source.getBone('arm').length, 30);
  assert.equal(source.getBone('hand').y, 30);
  assert.equal(source.slots[0]?.rotation, undefined);
});

test('editor rejects invalid numeric edits without making the rig dirty', () => {
  const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root', sprite: { texture: 'part' } }] }));
  assert.throws(() => state.editBone('root', 'length', -1));
  assert.throws(() => state.editSprite('root', 'originY', 1.2));
  assert.throws(() => state.editBone('root', 'x', Number.POSITIVE_INFINITY));
  assert.isFalse(state.dirty);
});

test('length edits preserve child directions through zero, history, and resets', () => {
  const state = new RigEditorState(
    new Rig({
      root: 'arm',
      bones: [
        { id: 'arm', length: 20 },
        { id: 'hand', parent: 'arm', x: 12, y: -16 },
        { id: 'other', parent: 'arm', x: -16, y: 12 },
      ],
    }),
  );
  const offsets = () => state.workingCopy.bones.slice(1).map(({ x, y }) => [x, y]);
  state.selectBone('arm');
  state.editBone('arm', 'length', 0);
  assert.deepEqual(offsets(), [
    [0, -0],
    [-0, 0],
  ]);
  state.editBone('arm', 'length', 20);
  assert.deepEqual(offsets(), [
    [12, -16],
    [-16, 12],
  ]);
  state.resetSelected();
  assert.deepEqual(offsets(), [
    [12, -16],
    [-16, 12],
  ]);
  state.undo();
  state.redo();
  state.undo();
  state.editBone('arm', 'length', 40);
  assert.deepEqual(offsets(), [
    [24, -32],
    [-32, 24],
  ]);
  state.resetSelected();
  assert.deepEqual(offsets(), [
    [12, -16],
    [-16, 12],
  ]);

  // A different direction on a discarded branch must not leak into a redo at zero.
  state.editBone('arm', 'length', 0);
  state.undo();
  state.editBoneFields('hand', { x: -20, y: 0 });
  state.editBone('arm', 'length', 0);
  state.undo();
  state.undo();
  state.redo();
  state.redo();
  state.editBone('arm', 'length', 20);
  assert.deepEqual(offsets(), [
    [-20, 0],
    [-16, 12],
  ]);
  state.resetRig();
  state.beginOperation();
  state.editBone('arm', 'length', 0);
  state.editBone('arm', 'length', 40);
  state.endOperation();
  assert.deepEqual(offsets(), [
    [24, -32],
    [-32, 24],
  ]);
  state.undo();
  assert.deepEqual(offsets(), [
    [12, -16],
    [-16, 12],
  ]);
});

test.each(['bone', 'slot', 'sprite', 'attachment'] as const)(
  '%s field edits validate the complete patch once and undo together',
  (type) => {
    const state = new RigEditorState(
      new Rig({
        root: 'root',
        bones: [{ id: 'root', sprite: { texture: 'part' } }],
        slots: [{ id: 'visual', bone: 'root' }],
        attachments: [{ id: 'part', texture: 'part' }],
      }),
    );
    const edit = (values: { x: number; y: number }) => {
      if (type === 'bone') state.editBoneFields('root', values);
      else if (type === 'slot') state.editSlotFields('visual', values);
      else state.editSpriteFields(type === 'sprite' ? 'root' : 'part', values, type === 'attachment');
    };
    const current = () =>
      type === 'bone'
        ? state.getBone('root')
        : type === 'slot'
          ? state.getSlot('visual')
          : type === 'sprite'
            ? state.getBone('root').sprite!
            : state.getAttachment('part');
    const validate = vi.spyOn(externalData, 'validateRigDefinition');
    assert.throws(() => edit({ x: 10, y: Number.NaN }), /y must be finite/);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
    assert.equal(validate.mock.calls.length, 0);

    edit({ x: 10, y: 20 });
    assert.equal(current().x, 10);
    assert.equal(current().y, 20);
    assert.equal(validate.mock.calls.length, 1);
    assert.equal(state.historyLength, 1);
    state.undo();
    assert.isUndefined(current().x);
    assert.isUndefined(current().y);
    assert.isFalse(state.dirty);
    state.redo();
    assert.equal(current().x, 10);
    assert.equal(current().y, 20);
  },
);
