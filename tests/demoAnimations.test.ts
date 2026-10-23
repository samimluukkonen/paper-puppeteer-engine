import { assert, test } from 'vitest';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { transformProperties } from '../src/engine/types.js';
import { demoAnimations, demoRig, walk } from './helpers/demoCharacter.js';

interface LegPositions {
  hip: { x: number; y: number };
  knee: { x: number; y: number };
  ankle: { x: number; y: number };
}

function legPositions(joints: ReadonlyMap<string, Joint>, side: 'left' | 'right'): LegPositions {
  const thigh = joints.get(`${side}Thigh`)!.pose;
  const lowerLeg = joints.get(`${side}LowerLeg`)!.pose;
  const foot = joints.get(`${side}Foot`)!.pose;
  const hip = { x: thigh.x, y: thigh.y };
  const knee = {
    x: hip.x - lowerLeg.y * Math.sin(thigh.rotation),
    y: hip.y + lowerLeg.y * Math.cos(thigh.rotation),
  };
  const shinAngle = thigh.rotation + lowerLeg.rotation;
  const ankle = {
    x: knee.x - foot.y * Math.sin(shinAngle),
    y: knee.y + foot.y * Math.cos(shinAngle),
  };
  return { hip, knee, ankle };
}

function fixture() {
  const rig = new Rig(demoRig);
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(rig, joints);
  for (const clip of demoAnimations) player.addAnimation(clip);
  return { rig, joints, player };
}

test('sample walk keeps the idle thigh anchors throughout playback and restart', () => {
  const { joints, player } = fixture();
  player.play('idle');
  const anchors = ['leftThigh', 'rightThigh'].map((id) => {
    const { x, y } = joints.get(id)!.pose;
    return { id, x, y };
  });
  player.play('walk');
  for (let restart = 0; restart < 2; restart += 1) {
    if (restart) player.restart();
    for (let time = 0; time <= walk.duration; time += 10) {
      player.sample(time);
      for (const anchor of anchors) {
        assert.strictEqual(joints.get(anchor.id)!.pose.x, anchor.x);
        assert.strictEqual(joints.get(anchor.id)!.pose.y, anchor.y);
      }
    }
  }
});

test('sample sword stance uses the idle lower-body pose, even after walking', () => {
  const { joints, player } = fixture();
  const lowerBody = ['pelvis', 'leftThigh', 'leftLowerLeg', 'leftFoot', 'rightThigh', 'rightLowerLeg', 'rightFoot'];
  const poseAt = (clip: 'idle' | 'sword', time: number) => {
    player.play(clip);
    player.sample(time);
    return lowerBody.map((id) => ({ id, pose: { ...joints.get(id)!.pose } }));
  };
  for (const time of [0, 250, 900, 1400, 1800]) {
    const idlePose = poseAt('idle', time);
    player.play('walk');
    player.sample(750);
    assert.deepEqual(poseAt('sword', time), idlePose);
  }
});

for (const clip of demoAnimations) {
  for (const facing of ['left', 'right'] as const) {
    test(`${clip.name} bends both knees backward when facing ${facing}`, () => {
      const { joints, player } = fixture();
      player.play(clip.name);
      const forward = facing === 'right' ? 1 : -1;

      for (let time = 0; time <= clip.duration; time += 10) {
        player.sample(time);
        for (const side of ['left', 'right'] as const) {
          const { hip, knee, ankle } = legPositions(joints, side);
          const chordX = hip.x + ((ankle.x - hip.x) * (knee.y - hip.y)) / (ankle.y - hip.y);
          const mirroredKneeX = forward * knee.x;
          const mirroredChordX = forward * chordX;
          assert.isAbove(forward * (mirroredKneeX - mirroredChordX), 0, `${side} knee bends forward at ${time}ms`);
        }
      }
    });
  }
}

for (const side of ['left', 'right'] as const) {
  test(`walk swings the ${side} foot forward and backward, with a lifted return swing`, () => {
    const { joints, player } = fixture();
    player.play('walk');
    const samples: { x: number; y: number }[] = [];
    const phase = side === 'left' ? 0 : walk.duration / 2;
    for (let time = 0; time <= walk.duration; time += 10) {
      player.sample((time + phase) % walk.duration);
      const { hip, ankle } = legPositions(joints, side);
      samples.push({ x: ankle.x - hip.x, y: ankle.y + joints.get('pelvis')!.pose.y });
    }
    const xs = samples.map((point) => point.x);
    assert.isAbove(Math.max(...xs), 30, 'foot never reaches forward');
    assert.isBelow(Math.min(...xs), -30, 'foot never reaches backward');
    const contact = samples[0]!;
    const passing = samples[25]!;
    const trailing = samples[50]!;
    const recovery = samples[75]!;
    assert.isAbove(contact.x, passing.x, 'stance foot must move backward');
    assert.isAbove(passing.x, trailing.x, 'stance foot must move backward');
    assert.isBelow(recovery.y, passing.y - 15, 'return swing must lift the foot');
  });
}

test('walk legs alternate half a cycle apart and meet seamlessly at the loop boundary', () => {
  const { joints, player } = fixture();
  player.play('walk');
  for (let time = 0; time < walk.duration; time += 10) {
    player.sample(time);
    const left = ['Thigh', 'LowerLeg', 'Foot'].map((part) => joints.get(`left${part}`)!.pose.rotation);
    player.sample((time + walk.duration / 2) % walk.duration);
    const right = ['Thigh', 'LowerLeg', 'Foot'].map((part) => joints.get(`right${part}`)!.pose.rotation);
    for (let index = 0; index < left.length; index += 1) {
      assert.approximately(left[index]!, right[index]!, 1e-8);
    }
  }
  player.sample(0);
  const first = [...joints.values()].map((joint) => ({ ...joint.pose }));
  player.sample(walk.duration);
  for (const [index, joint] of [...joints.values()].entries()) {
    for (const property of transformProperties) {
      assert.approximately(joint.pose[property], first[index]![property], 1e-8);
    }
  }
});
