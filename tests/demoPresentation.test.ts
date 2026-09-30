import { assert, test } from 'vitest';
import { idle, walk } from '../src/demo/demoAnimations.js';
import {
  demoArmRotations,
  demoHipPositions,
  demoRenderOrder,
  demoShoulderPositions,
} from '../src/demo/demoPresentation.js';
import { demoRig } from '../src/demo/demoRig.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig(demoRig);
const body = [
  'torso',
  'pelvis',
  'head',
  'leftThigh',
  'leftLowerLeg',
  'leftFoot',
  'rightThigh',
  'rightLowerLeg',
  'rightFoot',
];

for (const facing of ['left', 'right'] as const) {
  test(`idle facing ${facing} keeps the intended slight shoulder tilt throughout the cycle`, () => {
    const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    const player = new AnimationPlayer(rig, joints);
    for (const clip of [idle, walk]) {
      player.addAnimation(clip);
      player.play(clip.name);
      for (let time = 0; time <= clip.duration; time += 10) {
        player.sample(time);
        const sampled = {
          leftUpperArm: joints.get('leftUpperArm')!.pose.rotation,
          rightUpperArm: joints.get('rightUpperArm')!.pose.rotation,
        };
        const presented = demoArmRotations(clip.name, facing, sampled);
        if (clip.name === 'idle' && facing === 'right') {
          const torso = joints.get('torso')!.pose.rotation;
          const leftElbowShift = -60 * Math.sin(torso + presented.leftUpperArm);
          const rightElbowShift = -60 * Math.sin(torso + presented.rightUpperArm);
          assert.isAbove(leftElbowShift, 3);
          assert.isBelow(leftElbowShift, 15);
          assert.isBelow(rightElbowShift, -3);
          assert.isAbove(rightElbowShift, -15);
        } else assert.deepEqual(presented, sampled);
      }
    }
  });

  test(`walk facing ${facing} puts the whole far arm behind every body part`, () => {
    const order = demoRenderOrder(rig, 'walk', facing);
    const rear = facing === 'right' ? 'left' : 'right';
    const front = facing === 'right' ? 'right' : 'left';
    assert.strictEqual(new Set(order).size, rig.bones.length);
    assert.deepEqual([...order].sort(), rig.bones.map((bone) => bone.id).sort());
    for (const part of ['UpperArm', 'Forearm', 'Hand']) {
      for (const id of body) {
        assert.isBelow(order.indexOf(`${rear}${part}`), order.indexOf(id));
        assert.isAbove(order.indexOf(`${front}${part}`), order.indexOf(id));
      }
    }
  });

  test(`walk facing ${facing} reverses shoulder positions independently of arm depth`, () => {
    const shoulders = demoShoulderPositions(rig, 'walk', facing);
    const mirror = facing === 'right' ? 1 : -1;
    assert.isAbove(mirror * shoulders.leftUpperArm, 0);
    assert.isBelow(mirror * shoulders.rightUpperArm, 0);
    const order = demoRenderOrder(rig, 'walk', facing);
    const rear = facing === 'right' ? 'leftHand' : 'rightHand';
    const front = facing === 'right' ? 'rightHand' : 'leftHand';
    assert.isBelow(order.indexOf(rear), order.indexOf('torso'));
    assert.isAbove(order.indexOf(front), order.indexOf('torso'));
  });

  test(`walk facing ${facing} draws the entire near leg in front of the pelvis and far leg`, () => {
    const order = demoRenderOrder(rig, 'walk', facing);
    const rear = facing === 'left' ? 'right' : 'left';
    const front = facing === 'left' ? 'left' : 'right';
    for (const rearPart of ['Thigh', 'LowerLeg', 'Foot']) {
      assert.isBelow(order.indexOf(`${rear}${rearPart}`), order.indexOf('pelvis'));
      for (const frontPart of ['Thigh', 'LowerLeg', 'Foot']) {
        assert.isBelow(order.indexOf(`${rear}${rearPart}`), order.indexOf(`${front}${frontPart}`));
      }
    }
    for (const part of ['Thigh', 'LowerLeg', 'Foot']) {
      assert.isAbove(order.indexOf(`${front}${part}`), order.indexOf('pelvis'));
      assert.isBelow(order.indexOf(`${front}${part}`), order.indexOf('torso'));
    }
  });

  for (const clip of [idle, walk]) {
    test(`${clip.name} facing ${facing} keeps the corrected right elbow bend throughout the cycle`, () => {
      const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
      const player = new AnimationPlayer(rig, joints);
      player.addAnimation(clip);
      player.play(clip.name);
      const mirror = facing === 'right' ? 1 : -1;
      for (let time = 0; time <= clip.duration; time += 10) {
        player.sample(time);
        const screenBend = mirror * joints.get('rightForearm')!.pose.rotation;
        const minimumBend = clip.name === 'idle' ? 0.1 : 0.25;
        if (facing === 'left') assert.isAbove(screenBend, minimumBend);
        else assert.isBelow(screenBend, -minimumBend);
      }
    });
  }
}

test('idle reverses shoulders in both directions', () => {
  for (const facing of ['left', 'right'] as const) {
    const idle = demoShoulderPositions(rig, 'idle', facing);
    const mirror = facing === 'right' ? 1 : -1;
    assert.isAbove(mirror * idle.leftUpperArm, 0);
    assert.isBelow(mirror * idle.rightUpperArm, 0);
    assert.deepEqual(idle, demoShoulderPositions(rig, 'walk', facing));
  }
});

test('idle facing right puts the whole left arm behind the character and the right arm in front', () => {
  const order = demoRenderOrder(rig, 'idle', 'right');
  const leftArm = ['leftUpperArm', 'leftForearm', 'leftHand'];
  for (const part of leftArm) {
    for (const id of body) assert.isBelow(order.indexOf(part), order.indexOf(id));
  }
  for (const part of ['UpperArm', 'Forearm', 'Hand']) {
    for (const id of body) assert.isAbove(order.indexOf(`right${part}`), order.indexOf(id));
  }
  const torso = ['pelvis', 'torso', 'head'];
  assert.deepEqual(
    order.filter((id) => torso.includes(id)),
    rig.renderOrder.filter((id) => torso.includes(id)),
  );
  assert.deepEqual([...order].sort(), rig.bones.map((bone) => bone.id).sort());
});

test('idle facing left puts the whole right arm behind the body and the whole left arm in front', () => {
  const order = demoRenderOrder(rig, 'idle', 'left');
  for (const part of ['UpperArm', 'Forearm', 'Hand']) {
    for (const id of body) {
      assert.isBelow(order.indexOf(`right${part}`), order.indexOf(id));
      assert.isAbove(order.indexOf(`left${part}`), order.indexOf(id));
    }
  }
  const torso = ['pelvis', 'torso', 'head'];
  assert.deepEqual(
    order.filter((id) => torso.includes(id)),
    rig.renderOrder.filter((id) => torso.includes(id)),
  );
  assert.deepEqual([...order].sort(), rig.bones.map((bone) => bone.id).sort());
});

test('default rig drawing order respects sibling depth and image placement', () => {
  const order = rig.renderOrder;
  assert.isBelow(order.indexOf('leftHand'), order.indexOf('torso'));
  assert.isBelow(order.indexOf('leftFoot'), order.indexOf('pelvis'));
  assert.isAbove(order.indexOf('rightUpperArm'), order.indexOf('torso'));
});

test('idle swaps hip positions facing right and restores them facing left', () => {
  const right = demoHipPositions(rig, 'right');
  assert.strictEqual(right.leftThigh, rig.getBone('rightThigh').x);
  assert.strictEqual(right.rightThigh, rig.getBone('leftThigh').x);
  const left = demoHipPositions(rig, 'left');
  assert.strictEqual(left.leftThigh, rig.getBone('leftThigh').x);
  assert.strictEqual(left.rightThigh, rig.getBone('rightThigh').x);
  const legs = ['leftThigh', 'leftLowerLeg', 'leftFoot', 'rightThigh', 'rightLowerLeg', 'rightFoot'];
  assert.deepEqual(
    demoRenderOrder(rig, 'idle', 'right').filter((id) => legs.includes(id)),
    rig.renderOrder.filter((id) => legs.includes(id)),
  );
});

test('idle facing left draws the entire left leg in front of the right leg and pelvis', () => {
  const order = demoRenderOrder(rig, 'idle', 'left');
  for (const rearPart of ['Thigh', 'LowerLeg', 'Foot']) {
    for (const frontPart of ['Thigh', 'LowerLeg', 'Foot']) {
      assert.isBelow(order.indexOf(`right${rearPart}`), order.indexOf(`left${frontPart}`));
    }
  }
  for (const part of ['Thigh', 'LowerLeg', 'Foot']) {
    assert.isAbove(order.indexOf(`left${part}`), order.indexOf('pelvis'));
    assert.isBelow(order.indexOf(`left${part}`), order.indexOf('torso'));
    assert.isBelow(order.indexOf(`right${part}`), order.indexOf('pelvis'));
  }
  const hips = demoHipPositions(rig, 'left');
  assert.isBelow(order.indexOf('leftThigh'), order.indexOf('leftLowerLeg'));
  assert.isBelow(order.indexOf('leftLowerLeg'), order.indexOf('leftFoot'));
  assert.strictEqual(hips.leftThigh, rig.getBone('leftThigh').x);
  assert.strictEqual(hips.rightThigh, rig.getBone('rightThigh').x);
});

test('idle facing right draws the entire right leg in front of the pelvis', () => {
  const order = demoRenderOrder(rig, 'idle', 'right');
  for (const part of ['Thigh', 'LowerLeg', 'Foot']) {
    assert.isAbove(order.indexOf(`right${part}`), order.indexOf('pelvis'));
    assert.isBelow(order.indexOf(`right${part}`), order.indexOf('torso'));
    assert.isBelow(order.indexOf(`left${part}`), order.indexOf('pelvis'));
  }
});
