import { assert, test } from 'vitest';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { walk } from '../src/demo/demoAnimations.js';
import { demoRig } from '../src/demo/demoRig.js';
import { demoHipPositions } from '../src/demo/demoPresentation.js';
import { demoWalkFootIK } from '../src/demo/demoFootTargets.js';

const ground = { left: { x: 404, y: 517 }, right: { x: 356, y: 517 } };
const sides = ['left', 'right'] as const;

test('walking IK holds contact, releases for heel rise, and blends into the next step', () => {
  const animated = { left: { x: 420, y: 520 }, right: { x: 340, y: 506 } };
  const contact = demoWalkFootIK(0, ground, animated);
  assert.strictEqual(contact.left.mix, 1);
  assert.strictEqual(contact.left.target.x, animated.left.x);
  assert.strictEqual(contact.left.target.y, ground.left.y);
  assert.strictEqual(contact.right.target.y, animated.right.y);
  const toeOff = demoWalkFootIK(500, ground, animated);
  assert.isAbove(toeOff.left.mix, 0);
  assert.isBelow(toeOff.left.mix, 1);
  assert.strictEqual(demoWalkFootIK(600, ground, animated).left.mix, 0);
  assert.strictEqual(demoWalkFootIK(800, ground, animated).left.mix, 0);
  const landing = demoWalkFootIK(950, ground, animated);
  assert.isAbove(landing.left.mix, 0);
  assert.isBelow(landing.left.mix, 1);
  assert.deepEqual(demoWalkFootIK(1000, ground, animated), contact);
  assert.strictEqual(contact.right.mix, toeOff.left.mix);
});

for (const facing of ['left', 'right'] as const) {
  test(`planted walk preserves the authored swing and heel rise facing ${facing}`, () => {
    const rig = new Rig(demoRig);
    const joints = new Map(rig.bones.map(bone => [bone.id, new Joint(bone.id, bone)]));
    const player = new AnimationPlayer(rig, joints);
    player.addAnimation(walk);
    player.play('walk');
    const constraints = Object.fromEntries(sides.map(side => [side, new TwoBoneIKConstraint({
      name: `${side}LegIK`, rootBone: `${side}Thigh`,
      middleBone: `${side}LowerLeg`, endBone: `${side}Foot`, bendDirection: 1,
    }, rig, joints)])) as Record<(typeof sides)[number], TwoBoneIKConstraint>;
    const direction = facing === 'right' ? 1 : -1;
    const samples: { x: number; y: number }[] = [];
    for (let time = 0; time < walk.duration; time += 10) {
      player.sample(time);
      for (const [id, x] of Object.entries(demoHipPositions(rig, facing))) joints.get(id)!.pose.x = x;
      const pelvisY = joints.get('pelvis')!.pose.y;
      const bodyX = 380 + 7 * Math.sin(time / 1000);
      const bodyY = 362 + 3 * Math.sin(time / 700);
      const ankle = (side: 'left' | 'right') => {
        const thigh = joints.get(`${side}Thigh`)!.pose;
        const shin = joints.get(`${side}LowerLeg`)!.pose;
        const foot = joints.get(`${side}Foot`)!.pose;
        return {
          x: bodyX + direction * 1.08 * (thigh.x
            - shin.y * Math.sin(thigh.rotation)
            - foot.y * Math.sin(thigh.rotation + shin.rotation)),
          y: bodyY + 1.08 * (pelvisY + thigh.y
            + shin.y * Math.cos(thigh.rotation)
            + foot.y * Math.cos(thigh.rotation + shin.rotation)),
        };
      };
      const animated = { left: ankle('left'), right: ankle('right') };
      const feet = demoWalkFootIK(time, ground, animated);
      for (const side of sides) {
        const constraint = constraints[side];
        const thigh = joints.get(`${side}Thigh`)!.pose;
        const shin = joints.get(`${side}LowerLeg`)!.pose;
        const authored = { thigh: thigh.rotation, shin: shin.rotation };
        constraint.mix = feet[side].mix;
        constraint.setTarget(feet[side].target).apply({ worldToParent: (_id, point) => ({
          x: (point.x - bodyX) / (direction * 1.08),
          y: (point.y - bodyY) / 1.08 - pelvisY,
        }) });
        const actual = ankle(side);
        assert.isBelow(Math.abs(thigh.rotation - authored.thigh), 0.2,
          `${side} thigh strays from the authored walk at ${time}ms`);
        assert.isBelow(Math.abs(shin.rotation - authored.shin), 0.3,
          `${side} knee strays from the authored walk at ${time}ms`);
        if (feet[side].mix === 1) {
          assert.strictEqual(constraint.status, 'solved', `${side} at ${time}ms`);
          assert.approximately(actual.x, feet[side].target.x, 1e-6);
          assert.approximately(actual.y, feet[side].target.y, 1e-6);
        }
        if (feet[side].mix === 0) {
          assert.strictEqual(thigh.rotation, authored.thigh);
          assert.strictEqual(shin.rotation, authored.shin);
          assert.approximately(actual.x, animated[side].x, 1e-6);
          assert.approximately(actual.y, animated[side].y, 1e-6);
        }
        if (side === 'left') samples.push(actual);
      }
    }
    const forward = facing === 'right' ? 1 : -1;
    assert.isAbove(forward * (samples[0]!.x - samples[500 / 10]!.x), 50);
    assert.isBelow(samples[600 / 10]!.y, samples[400 / 10]!.y - 4,
      'the heel should rise after planted contact');
    assert.isBelow(samples[700 / 10]!.y, samples[600 / 10]!.y - 8,
      'the authored return swing should clear the ground');
  });
}
