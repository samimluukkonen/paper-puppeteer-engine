import { assert, test } from 'vitest';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { parseRigDefinition, type RigJsonDefinition, validateRigDefinition } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

const file: RigJsonDefinition = {
  version: 1,
  name: 'test-rig',
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'arm', parent: 'root', x: 10, length: 20, sprite: { texture: 'arm', x: 0.123456789 } },
    { id: 'hand', parent: 'arm', y: 20 },
  ],
  slots: [{ id: 'weapon', bone: 'hand', x: 2, depth: 15 }],
  attachments: [{ id: 'sword', texture: 'sword', originX: 0.13333333333333333 }],
  skins: [{ version: 1, name: 'default', slots: { weapon: 'sword' } }],
};
const make = () => new RigEditorState(parseRigDefinition(file), file);

test.each([40, 0])('reset selected restores length and child offsets after editing length to %s', (length) => {
  const state = make();
  const original = structuredClone(state.workingCopy);
  state.editBone('arm', 'length', 40);
  state.editBone('arm', 'length', length);
  const edited = structuredClone(state.workingCopy);
  const historyLength = state.historyLength;
  assert.isTrue(state.dirty);
  state.selectBone('arm');
  state.resetSelected();
  assert.deepEqual(state.workingCopy, original);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, historyLength + 1);
  assert.deepEqual(new Rig(state.exportRig(false)).getBone('hand'), state.source.getBone('hand'));
  state.undo();
  assert.deepEqual(state.workingCopy, edited);
  assert.isTrue(state.dirty);
  state.redo();
  assert.deepEqual(state.workingCopy, original);
  assert.isFalse(state.dirty);
});

test('reset after restoring the original length keeps the session clean without a redundant history entry', () => {
  const state = make();
  state.editBone('arm', 'length', 40);
  state.editBone('arm', 'length', 20);
  assert.isFalse(state.dirty);
  const historyLength = state.historyLength;
  state.selectBone('arm');
  state.resetSelected();
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, historyLength);
});

test.each([undefined, 20, 0])('length reset from initial length %s restores every direct child offset', (length) => {
  const state = new RigEditorState(
    new Rig({
      root: 'root',
      bones: [
        { id: 'root', ...(length === undefined ? {} : { length }) },
        { id: 'diagonal', parent: 'root', x: 12, y: -16 },
        { id: 'implicit', parent: 'root' },
        { id: 'tip', parent: 'diagonal', y: 7 },
      ],
    }),
  );
  const original = structuredClone(state.workingCopy);
  state.editBone('root', 'length', 40);
  state.selectBone('root');
  state.resetSelected();
  assert.deepEqual(state.workingCopy, original);
  assert.isFalse(state.dirty);
});

test('length reset preserves other child edits and descendants', () => {
  const state = make();
  state.editBone('arm', 'length', 40);
  state.editBone('hand', 'rotation', 0.5);
  state.editBone('hand', 'scaleX', 2);
  state.editSlot('weapon', 'x', 8);
  state.selectBone('arm');
  state.resetSelected();
  assert.equal(state.getBone('arm').length, 20);
  assert.equal(state.getBone('hand').x, state.source.getBone('hand').x);
  assert.equal(state.getBone('hand').y, 20);
  assert.equal(state.getBone('hand').rotation, 0.5);
  assert.equal(state.getBone('hand').scaleX, 2);
  assert.equal(state.getSlot('weapon').x, 8);
  assert.isTrue(state.dirty);
});

test('resetting a parent without length preserves independent child translations', () => {
  const state = make();
  state.editBone('root', 'rotation', 0.5);
  state.editBone('arm', 'x', 17);
  state.selectBone('root');
  state.resetSelected();
  assert.isUndefined(state.getBone('root').rotation);
  assert.equal(state.getBone('arm').x, 17);
});

test('history covers edits, redo, branch invalidation, and one drag gesture', () => {
  const state = make();
  assert.isFalse(state.dirty);
  state.editBone('arm', 'x', 12);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.isTrue(state.undo());
  assert.equal(state.getBone('arm').x, 10);
  assert.isFalse(state.dirty);
  assert.isTrue(state.redo());
  assert.equal(state.getBone('arm').x, 12);
  state.beginOperation();
  for (const x of [13, 14, 15]) {
    state.editBone('arm', 'x', x);
    state.editBone('arm', 'y', x / 2);
  }
  state.endOperation();
  assert.equal(state.historyLength, 2);
  state.undo();
  assert.equal(state.getBone('arm').x, 12);
  assert.equal(state.getBone('arm').y, undefined);
  state.editBone('arm', 'rotation', 0.25);
  assert.isFalse(state.canRedo);
});

test('length, sprite, origin, slot, scale and depth edits undo together', () => {
  const state = make();
  state.beginOperation();
  state.editBone('arm', 'length', 35);
  state.editBone('arm', 'rotation', 0.4);
  state.editBone('arm', 'scaleX', 1.5);
  state.editBone('arm', 'depth', 3);
  state.editSprite('arm', 'x', 4);
  state.editSprite('arm', 'originY', 0.2);
  state.editSlot('weapon', 'x', 5);
  state.editSlot('weapon', 'depth', 30);
  state.editSprite('sword', 'originX', 0.4, true);
  state.endOperation();
  assert.equal(state.getBone('hand').y, 35);
  state.undo();
  assert.equal(state.getBone('hand').y, 20);
  assert.equal(state.getBone('arm').rotation, undefined);
  assert.equal(state.getBone('arm').scaleX, undefined);
  assert.equal(state.getBone('arm').depth, undefined);
  assert.equal(state.getBone('arm').sprite?.x, 0.123456789);
  assert.equal(state.getSlot('weapon').depth, 15);
  assert.equal(state.getAttachment('sword').originX, 0.13333333333333333);
});

test('selected and full reset are undoable, and export becomes the saved baseline', () => {
  const state = make();
  state.editBone('arm', 'x', 17);
  state.editSlot('weapon', 'x', 8);
  state.editSprite('sword', 'x', 3, true);
  state.selectSlot('weapon');
  state.resetSelected('sword');
  assert.equal(state.getSlot('weapon').x, 2);
  assert.equal(state.getAttachment('sword').x, undefined);
  state.undo();
  assert.equal(state.getSlot('weapon').x, 8);
  assert.equal(state.getAttachment('sword').x, 3);
  state.selectBone('arm');
  state.resetSelected();
  assert.equal(state.getBone('arm').x, 10);
  state.undo();
  assert.equal(state.getBone('arm').x, 17);
  state.resetRig();
  assert.isFalse(state.dirty);
  state.undo();
  assert.isTrue(state.dirty);
  state.exportJson(false);
  assert.isTrue(state.dirty);
  state.markSaved();
  assert.isFalse(state.dirty);
  state.undo();
  assert.isTrue(state.dirty);
});

test('snapping changes interactive values only when enabled', () => {
  const state = make();
  assert.equal(state.snapTranslation(2.63), 2.63);
  assert.equal(state.snapRotation(0.123), 0.123);
  state.gridSnap = 5;
  state.rotationSnap = 15;
  assert.equal(state.snapTranslation(7.6), 10);
  assert.closeTo(state.snapRotation(0.31), Math.PI / 12, 1e-12);
  assert.equal(state.getBone('arm').x, 10);
  state.editBone('arm', 'x', 2.63);
  assert.equal(state.getBone('arm').x, 2.63);
});

test('export is stable, data-only, valid, and preserves unedited precision', () => {
  const state = make();
  state.editBone('arm', 'rotation', 0.49999999999999994);
  state.editSprite('sword', 'x', 3.123456789, true);
  const json = state.exportJson();
  assert.equal(json, state.exportJson());
  const result = JSON.parse(json) as RigJsonDefinition;
  assert.equal(result.version, 1);
  assert.equal(result.name, 'test-rig');
  assert.equal(result.bones[1]?.rotation, 0.5);
  assert.equal(result.bones[1]?.sprite?.x, 0.123456789);
  assert.equal(result.attachments?.[0]?.originX, 0.13333333333333333);
  assert.equal(result.attachments?.[0]?.x, 3.123457);
  assert.isFalse(json.includes('container'));
  assert.deepEqual(validateRigDefinition(result), []);
  assert.equal(parseRigDefinition(result).getBone('arm').rotation, 0.5);
});

test('invalid rig blocks export with issue details', () => {
  const state = make();
  (state.workingCopy.slots![0] as { bone: string }).bone = 'missing';
  assert.throws(() => state.exportJson(), /slots\[0\]\.bone.*unknown bone/);
});

test('sample rig edits survive serialize, parse, and runtime rig recreation', () => {
  const original = import.meta.glob('../public/characters/demo-puppet/rig.json', { eager: true, import: 'default' })[
    '../public/characters/demo-puppet/rig.json'
  ] as RigJsonDefinition;
  const state = new RigEditorState(parseRigDefinition(original), original);
  state.editBone('rightUpperArm', 'x', 43);
  state.editBone('rightForearm', 'x', 2);
  state.editBone('rightForearm', 'rotation', 0.35);
  state.editSprite('rightForearmDefault', 'x', 3.25, true);
  state.editBone('rightUpperArm', 'length', 62);
  state.editSlot('rightHandItem', 'x', 4);
  state.editBone('rightUpperArm', 'depth', 5);
  state.undo();
  assert.equal(state.getBone('rightUpperArm').depth, 3);
  state.redo();
  state.gridSnap = 5;
  state.rotationSnap = 5;
  state.editBone('rightUpperArm', 'y', state.snapTranslation(-84));
  state.editBone('rightForearm', 'rotation', state.snapRotation(0.35));
  const exported = JSON.parse(state.exportJson()) as RigJsonDefinition;
  assert.deepEqual(validateRigDefinition(exported), []);
  const recreated = new Rig(exported);
  assert.equal(recreated.getBone('rightUpperArm').x, 43);
  assert.equal(recreated.getBone('rightUpperArm').y, -85);
  assert.equal(recreated.getBone('rightUpperArm').length, 62);
  assert.equal(recreated.getBone('rightUpperArm').depth, 5);
  assert.closeTo(recreated.getBone('rightForearm').rotation ?? 0, state.snapRotation(0.35), 1e-6);
  assert.equal(recreated.attachments.find((entry) => entry.id === 'rightForearmDefault')?.x, 3.25);
  assert.equal(recreated.slots.find((entry) => entry.id === 'rightHandItem')?.x, 4);
  const preview = new Rig(state.workingCopy);
  assert.deepEqual(recreated.renderOrder, preview.renderOrder);
  for (const bone of preview.bones) {
    const loaded = recreated.getBone(bone.id);
    for (const field of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'length', 'depth'] as const)
      assert.closeTo(loaded[field] ?? 0, bone[field] ?? 0, 1e-5, `${bone.id}.${field}`);
  }
});
