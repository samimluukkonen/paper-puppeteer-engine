import { assert, test } from 'vitest';
import { evaluateIKTarget } from '../src/devtools/animation-editor/ikInspectorSampling.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { validateRigDefinition } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';
import type { BoneDefinition, RigDefinition } from '../src/engine/types.js';

function chain(length: number): BoneDefinition[] {
  return Array.from({ length }, (_, index) => ({
    id: `bone-${index}`,
    ...(index === 0 ? {} : { parent: `bone-${index - 1}` }),
  }));
}

test.each(['parent-first', 'child-first'])(
  'deep %s rigs validate, construct, and populate the editor hierarchy',
  (order) => {
    const bones = chain(12_000);
    const ids = bones.map((bone) => bone.id);
    const definition = { root: 'bone-0', bones: order === 'child-first' ? bones.reverse() : bones };
    assert.deepEqual(validateRigDefinition({ version: 1, ...definition }), []);
    const rig = new Rig(definition);
    assert.deepEqual(
      rig.bones.map((bone) => bone.id),
      ids,
    );
    assert.deepEqual(rig.renderOrder, ids);
    const state = new RigEditorState(rig);
    assert.deepEqual(
      state.hierarchy(),
      ids.map((id, depth) => ({ id, depth })),
    );
  },
);

test('a deep cycle reports validation errors without overflowing the call stack', () => {
  const bones = chain(12_000);
  bones[1]!.parent = bones.at(-1)!.id;
  bones.reverse();
  const definition = { root: 'bone-0', bones };
  const issues = validateRigDefinition({ version: 1, ...definition });
  assert.lengthOf(issues, 1);
  assert.equal(issues[0]!.severity, 'error');
  assert.match(issues[0]!.message, /Circular hierarchy/);
  assert.throws(() => new Rig(definition), /cycle/);
});

test('IK inspection handles a deep valid hierarchy without recursive ancestor transforms', () => {
  const bones = chain(12_000).map((bone, index) => ({ ...bone, x: index === 0 ? 0 : 1 }));
  const rig = new Rig({
    root: 'bone-0',
    bones,
    ik: [{ name: 'tip', rootBone: 'bone-11997', middleBone: 'bone-11998', endBone: 'bone-11999' }],
  });
  const animation = { name: 'deep', duration: 1000, loop: false, tracks: {} };
  assert.deepEqual(evaluateIKTarget(animation, rig, 'tip', 0), { x: 11999, y: 0, mix: 1 });
});

test('iterative traversal preserves stable sibling order, nested sprite depths, and hierarchy depths', () => {
  const definition: RigDefinition = {
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'a', parent: 'root', sprite: { texture: 'art', depth: 10 } },
      { id: 'a-child', parent: 'a' },
      { id: 'b', parent: 'root' },
      { id: 'c', parent: 'root', depth: -1 },
      { id: 'c-child', parent: 'c' },
    ],
  };
  const rig = new Rig(definition);
  assert.deepEqual(rig.renderOrder, ['c', 'c-child', 'root', 'a-child', 'a', 'b']);
  assert.deepEqual(new RigEditorState(rig).hierarchy(), [
    { id: 'root', depth: 0 },
    { id: 'a', depth: 1 },
    { id: 'a-child', depth: 2 },
    { id: 'b', depth: 1 },
    { id: 'c', depth: 1 },
    { id: 'c-child', depth: 2 },
  ]);
});
