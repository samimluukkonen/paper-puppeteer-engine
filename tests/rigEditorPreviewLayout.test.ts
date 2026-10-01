import { assert, test } from 'vitest';
import { demoAuthoringLayout } from '../src/demo/demoPresentation.js';
import { demoRig } from '../src/demo/demoRig.js';
import { applyDemoRightFacingPreview } from '../src/devtools/rig-editor/demoPreviewLayout.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';

test('rig editor preview matches the demo right-facing limb layout without changing authored values', () => {
  const source = new Rig(demoRig);
  const state = new RigEditorState(source);
  const joints = new Map(state.rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  let order: readonly string[] = [];
  let syncs = 0;
  applyDemoRightFacingPreview({
    rig: state.rig,
    getBone: (id) => joints.get(id)!,
    setRenderOrder: (value) => {
      order = value;
    },
    syncPose: () => {
      syncs += 1;
    },
  });

  const expected = demoAuthoringLayout(source, 'right');
  assert.deepEqual(order, expected.order);
  assert.isBelow(order.indexOf('leftHand'), order.indexOf('torso'));
  assert.isAbove(order.indexOf('rightHand'), order.indexOf('torso'));
  assert.isBelow(order.indexOf('leftFoot'), order.indexOf('pelvis'));
  assert.isAbove(order.indexOf('rightFoot'), order.indexOf('pelvis'));
  assert.isBelow(order.indexOf('rightFoot'), order.indexOf('torso'));
  for (const [id, x] of Object.entries(expected.positions)) assert.equal(joints.get(id)?.pose.x, x);
  for (const [id, rotation] of Object.entries(expected.rotations))
    assert.equal(joints.get(id)?.pose.rotation, rotation);
  assert.equal(syncs, 1);
  assert.equal(source.getBone('leftUpperArm').x, demoRig.bones.find((bone) => bone.id === 'leftUpperArm')?.x);
  assert.equal(
    source.getBone('leftUpperArm').rotation,
    demoRig.bones.find((bone) => bone.id === 'leftUpperArm')?.rotation,
  );
  assert.notEqual(joints.get('leftUpperArm')?.pose.x, source.getBone('leftUpperArm').x);
});
