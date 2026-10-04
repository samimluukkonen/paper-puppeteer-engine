import { readFileSync } from 'node:fs';
import { assert, test } from 'vitest';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { parseAnimationClip, parseRigDefinition } from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import { transformProperties } from '../src/engine/types.js';

const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../public/characters/random-paperdoll-sketch/${path}`, import.meta.url), 'utf8'));
const rig = parseRigDefinition(read('rig.json'));
const walk = parseAnimationClip(read('animations/walk.json'), rig);

function fixture() {
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(rig, joints);
  player.addAnimation(walk);
  player.play('walk');
  const position = (id: string) => {
    const chain: Joint[] = [];
    let current: string | undefined = id;
    while (current) {
      chain.unshift(joints.get(current)!);
      current = rig.getBone(current).parent;
    }
    let x = 0;
    let y = 0;
    let rotation = 0;
    for (const { pose } of chain) {
      x += Math.cos(rotation) * pose.x - Math.sin(rotation) * pose.y;
      y += Math.sin(rotation) * pose.x + Math.cos(rotation) * pose.y;
      rotation += pose.rotation;
    }
    return { x, y, rotation };
  };
  return { joints, player, position };
}

test('sketch walk keeps both knees bending backward throughout the cycle', () => {
  const { player, position } = fixture();
  for (let time = 0; time <= walk.duration; time += 10) {
    player.sample(time);
    for (const side of ['left', 'right']) {
      const hip = position(`${side}Thigh`);
      const knee = position(`${side}LowerLeg`);
      const ankle = position(`${side}Foot`);
      const chordX = hip.x + ((ankle.x - hip.x) * (knee.y - hip.y)) / (ankle.y - hip.y);
      assert.isAbove(knee.x - chordX, 0, `${side} knee reverses at ${time}ms`);
    }
  }
});

test('sketch walk advances each foot during contact and lifts it on the return step', () => {
  const { player, position } = fixture();
  for (const [side, phase] of [
    ['left', 0],
    ['right', walk.duration / 2],
  ] as const) {
    const samples = [0, 250, 500, 750].map((offset) => {
      player.sample((phase + offset) % walk.duration);
      const hip = position(`${side}Thigh`);
      const ankle = position(`${side}Foot`);
      assert.isBelow(Math.abs(ankle.rotation), 0.15, `${side} foot tilts excessively at ${offset}ms`);
      return { x: ankle.x - hip.x, y: ankle.y };
    });
    assert.isAbove(samples[0]!.x, samples[1]!.x);
    assert.isAbove(samples[1]!.x, samples[2]!.x);
    assert.isBelow(samples[3]!.y, samples[1]!.y - 10, `${side} swing foot never lifts`);
  }
});

test('sketch walk loops without moving the hip anchors or changing the final pose', () => {
  const { joints, player } = fixture();
  const anchors = ['leftThigh', 'rightThigh'].map((id) => ({ id, ...joints.get(id)!.pose }));
  player.sample(0);
  const first = [...joints.values()].map((joint) => ({ ...joint.pose }));
  for (let time = 0; time <= walk.duration; time += 10) {
    player.sample(time);
    for (const anchor of anchors) {
      assert.equal(joints.get(anchor.id)!.pose.x, anchor.x);
      assert.equal(joints.get(anchor.id)!.pose.y, anchor.y);
    }
  }
  for (const [index, joint] of [...joints.values()].entries())
    for (const property of transformProperties)
      assert.approximately(joint.pose[property], first[index]![property], 1e-8);
});
