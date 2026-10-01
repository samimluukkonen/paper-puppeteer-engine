import { assert, test } from 'vitest';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { Rig } from '../src/engine/Rig.js';

const source = new Rig({
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'pelvis', parent: 'root', x: 4 },
    { id: 'arm', parent: 'pelvis', y: 20, sprite: { texture: 'arm', x: 3 } },
  ],
  slots: [{ id: 'handVisual', bone: 'arm', y: 5 }],
  attachments: [{ id: 'hand', texture: 'hand' }],
  skins: [{ version: 1, name: 'default', slots: { handVisual: 'hand' } }],
});

test('editor selection validates bones and slots and can be cleared', () => {
  const state = new RigEditorState(source);
  state.selectBone('arm');
  assert.deepEqual(state.selection, { type: 'bone', id: 'arm' });
  state.selectSlot('handVisual');
  assert.deepEqual(state.selection, { type: 'slot', id: 'handVisual' });
  state.clearSelection();
  assert.equal(state.selection, null);
  assert.throws(() => state.selectBone('missing'));
  assert.throws(() => state.selectSlot('missing'));
});

test('hierarchy is parent first and the working copy is independent', () => {
  const state = new RigEditorState(source);
  assert.deepEqual(state.childrenOf('pelvis'), ['arm']);
  assert.deepEqual(state.hierarchy(), [
    { id: 'root', depth: 0 },
    { id: 'pelvis', depth: 1 },
    { id: 'arm', depth: 2 },
  ]);
  (state.workingCopy.bones[2]!.sprite as { x: number }).x = 99;
  (state.workingCopy.slots![0] as { y: number }).y = 88;
  (state.workingCopy.skins![0]!.slots as Record<string, string>).handVisual = 'other';
  assert.equal(source.getBone('arm').sprite?.x, 3);
  assert.equal(source.slots[0]?.y, 5);
  assert.equal(source.skins[0]?.slots.handVisual, 'hand');
});
