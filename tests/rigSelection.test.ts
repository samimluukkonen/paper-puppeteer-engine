import { assert, test } from 'vitest';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';

const skeleton: RigDefinition = {
  root: 'body',
  bones: [
    { id: 'body', x: 10, y: 20 },
    { id: 'thigh', parent: 'body', x: -5 },
    { id: 'shin', parent: 'thigh', y: 50 },
    { id: 'foot', parent: 'shin', y: 45 },
  ],
  slots: [{ id: 'art', bone: 'body' }],
};

function state() {
  const state = new RigEditorState(new Rig(skeleton));
  state.createIKConstraint({ name: 'legIK', rootBone: 'thigh', middleBone: 'shin', endBone: 'foot' });
  state.createFootContactMarker({ id: 'heel', name: 'Heel', boneId: 'foot' });
  return state;
}
const selected = (state: RigEditorState) => [
  state.selection,
  state.selectedIKConstraintId,
  state.selectedFootContactMarkerId,
];

test('bone, slot, IK constraint and foot-contact marker selections replace each other', () => {
  const editor = state();
  const cases = [
    [() => editor.selectBone('shin'), [{ type: 'bone', id: 'shin' }, null, null]],
    [() => editor.selectSlot('art'), [{ type: 'slot', id: 'art' }, null, null]],
    [() => editor.selectIKConstraint('legIK'), [null, 'legIK', null]],
    [() => editor.selectFootContactMarker('heel'), [null, null, 'heel']],
    [() => editor.clearSelection(), [null, null, null]],
  ] as const;
  for (const [before] of cases)
    for (const [select, expected] of cases) {
      before();
      select();
      assert.deepEqual(selected(editor), [...expected]);
    }
});

test('assigning a bone or slot selection directly replaces an IK or marker selection', () => {
  const editor = state();
  editor.selectIKConstraint('legIK');
  editor.selection = { type: 'bone', id: 'body' };
  assert.deepEqual(selected(editor), [{ type: 'bone', id: 'body' }, null, null]);
  editor.selectFootContactMarker('heel');
  editor.selection = null;
  assert.deepEqual(selected(editor), [null, null, null]);
});

test('removing the selected item clears the selection', () => {
  const editor = state();
  editor.selectIKConstraint('legIK');
  editor.removeIKConstraint('legIK');
  assert.deepEqual(selected(editor), [null, null, null]);
  editor.selectFootContactMarker('heel');
  editor.removeFootContactMarker('heel');
  assert.deepEqual(selected(editor), [null, null, null]);
});
