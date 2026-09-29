import { assert, test } from 'vitest';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { IKPoseState } from '../src/engine/ik/IKPoseState.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import type { IKTarget, TwoBoneIKDefinition } from '../src/engine/ik/types.js';
import type { JointTransform, RigDefinition } from '../src/engine/types.js';

const definition: TwoBoneIKDefinition = {
  name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', bendDirection: 1,
};

function fixture(bones?: RigDefinition['bones']) {
  const rig = new Rig({ root: 'root', bones: bones ?? [
    { id: 'root' }, { id: 'upper', parent: 'root', x: 20, y: 10, rotation: 0.1 },
    { id: 'lower', parent: 'upper', y: 60, rotation: 0.2 },
    { id: 'hand', parent: 'lower', y: 50 },
  ] });
  const joints = new Map(rig.bones.map(bone => [bone.id, new Joint(bone.id, bone)]));
  const constraint = new TwoBoneIKConstraint(definition, rig, joints);
  return { rig, joints, constraint };
}

function transform(pose: JointTransform, point: IKTarget): IKTarget {
  const x = point.x * pose.scaleX;
  const y = point.y * pose.scaleY;
  return { x: pose.x + Math.cos(pose.rotation) * x - Math.sin(pose.rotation) * y,
    y: pose.y + Math.sin(pose.rotation) * x + Math.cos(pose.rotation) * y };
}

function endPosition(joints: ReadonlyMap<string, Joint>): IKTarget {
  return transform(joints.get('upper')!.pose, transform(joints.get('lower')!.pose, joints.get('hand')!.pose));
}

const identity = { worldToParent: (_id: string, point: IKTarget): IKTarget => point };

test('constraint priority can change when the leading arm switches', () => {
  const { constraint } = fixture();
  constraint.priority = 1;
  assert.strictEqual(constraint.priority, 1);
  assert.throws(() => { constraint.priority = Number.NaN; }, /finite/);
  assert.strictEqual(constraint.priority, 1);
});

test('constraint solves downward sprite axes and leaves hand orientation/clip data alone', () => {
  const { joints, constraint } = fixture();
  const handRotation = joints.get('hand')!.pose.rotation;
  constraint.target = { x: 80, y: 75 };
  constraint.apply(identity);
  const actual = endPosition(joints);
  assert.approximately(actual.x, 80, 1e-8);
  assert.approximately(actual.y, 75, 1e-8);
  assert.strictEqual(constraint.status, 'solved');
  assert.strictEqual(joints.get('hand')!.pose.rotation, handRotation);
});

test('end offset places the palm at the target while the wrist stays behind it', () => {
  for (const scaleX of [-1, 1]) {
    const { rig, joints } = fixture([
      { id: 'root' }, { id: 'upper', parent: 'root', x: 20, y: 10, scaleX },
      { id: 'lower', parent: 'upper', y: 60, scaleY: 1.1 },
      { id: 'hand', parent: 'lower', y: 50, rotation: 0.25, scaleY: 0.8 },
    ]);
    const sourceOffset = { x: 0, y: 20 };
    const constraint = new TwoBoneIKConstraint({ ...definition, endOffset: sourceOffset }, rig, joints);
    sourceOffset.y = 99;
    assert.strictEqual(constraint.endOffset.y, 20);
    constraint.setTarget(75, 70).apply(identity);
    const palm = transform(joints.get('upper')!.pose,
      transform(joints.get('lower')!.pose,
        transform(joints.get('hand')!.pose, constraint.endOffset)));
    assert.strictEqual(constraint.status, 'solved');
    assert.approximately(palm.x, 75, 1e-8);
    assert.approximately(palm.y, 70, 1e-8);
    const wristGap = Math.hypot(palm.x - endPosition(joints).x,
      palm.y - endPosition(joints).y);
    assert.isAbove(wristGap, 16);
    assert.isBelow(wristGap, 18);
  }
});

test('end offset can move the contact point without changing the target', () => {
  const { rig, joints } = fixture([
    { id: 'root' }, { id: 'upper', parent: 'root', x: 20, y: 10 },
    { id: 'lower', parent: 'upper', y: 60 },
    { id: 'hand', parent: 'lower', y: 50 },
  ]);
  const constraint = new TwoBoneIKConstraint({ ...definition, endOffset: { x: 0, y: 20 } }, rig, joints);
  const offset = { x: 0, y: 15 };
  constraint.setEndOffset(offset);
  offset.y = 99;
  constraint.setTarget(75, 70).apply(identity);
  const palm = transform(joints.get('upper')!.pose,
    transform(joints.get('lower')!.pose,
      transform(joints.get('hand')!.pose, constraint.endOffset)));
  assert.strictEqual(constraint.endOffset.y, 15);
  assert.strictEqual(constraint.status, 'solved');
  assert.approximately(palm.x, 75, 1e-8);
  assert.approximately(palm.y, 70, 1e-8);
});

test('off-axis child offsets, reflected root scales and middle scale use actual effective lengths', () => {
  for (const scaleX of [-1.5, 1.5]) {
    for (const scaleY of [-1.5, 1.5]) {
      const { joints, constraint } = fixture([
        { id: 'root' }, { id: 'upper', parent: 'root', x: 20, y: 10, scaleX, scaleY },
        { id: 'lower', parent: 'upper', x: 36, y: 48, scaleX: 0.8, scaleY: -1.1 },
        { id: 'hand', parent: 'lower', x: -30, y: 40 },
      ]);
      constraint.setTarget(90, 60).apply(identity);
      const actual = endPosition(joints);
      assert.approximately(actual.x, 90, 1e-8);
      assert.approximately(actual.y, 60, 1e-8);
      assert.approximately(constraint.lengthA, 90, 1e-8);
      assert.approximately(constraint.lengthB, 1.5 * Math.hypot(24, 44), 1e-8);
    }
  }
});

test('coordinate adapter supports translated, rotated, nonuniformly scaled and mirrored ancestors', () => {
  for (const scaleX of [-2.2, 2.2]) {
    const { joints, constraint } = fixture();
    const ancestor = { x: 400, y: 300, rotation: 0.65, scaleX, scaleY: 0.7 };
    const local = { x: 80, y: 75 };
    constraint.setTarget(transform(ancestor, local));
    constraint.apply({ worldToParent: (_id, point) => {
      const dx = point.x - ancestor.x;
      const dy = point.y - ancestor.y;
      return { x: (Math.cos(ancestor.rotation) * dx + Math.sin(ancestor.rotation) * dy) / ancestor.scaleX,
        y: (-Math.sin(ancestor.rotation) * dx + Math.cos(ancestor.rotation) * dy) / ancestor.scaleY };
    } });
    const expected = transform(ancestor, local);
    const actual = transform(ancestor, endPosition(joints));
    assert.approximately(actual.x, expected.x, 1e-8);
    assert.approximately(actual.y, expected.y, 1e-8);
  }
});

test('explicit lengths establish logical child offsets independent of sprites', () => {
  const { rig, joints, constraint } = fixture([
    { id: 'root' }, { id: 'upper', parent: 'root', length: 52 },
    { id: 'lower', parent: 'upper', x: 3, y: 4, length: 43 },
    { id: 'hand', parent: 'lower' },
  ]);
  assert.approximately(Math.hypot(rig.getBone('lower').x!, rig.getBone('lower').y!), 52, 1e-8);
  assert.strictEqual(rig.getBone('hand').y, 43);
  constraint.setTarget(40, 50).apply(identity);
  assert.approximately(endPosition(joints).x, 40, 1e-8);
  assert.approximately(endPosition(joints).y, 50, 1e-8);
  assert.strictEqual(constraint.lengthA, 52);
  assert.strictEqual(constraint.lengthB, 43);
  assert.throws(() => new Rig({ root: 'root', bones: [{ id: 'root', length: -1 }] }), /negative/);
  assert.throws(() => new Rig({ root: 'root', bones: [{ id: 'root', length: NaN }] }), /finite/);
});

test('partial IK stays constant over repeated stopped passes and disabling restores authored rotation', () => {
  const { joints, constraint } = fixture();
  const state = new IKPoseState();
  const affected = [joints.get('upper')!, joints.get('lower')!];
  const base = affected.map(joint => joint.pose.rotation);
  constraint.mix = 0.5;
  constraint.setTarget(80, 75);
  let first: number[] = [];
  for (let frame = 0; frame < 100; frame += 1) {
    state.restore();
    state.capture(affected);
    constraint.apply(identity);
    state.commit();
    const pose = affected.map(joint => joint.pose.rotation);
    if (frame === 0) first = pose;
    else assert.deepEqual(pose, first);
  }
  constraint.enabled = false;
  state.restore();
  constraint.apply(identity);
  assert.deepEqual(affected.map(joint => joint.pose.rotation), base);
});

test('IK operates after sparse animation without modifying keys or leaking solved rotations', () => {
  const { rig, joints, constraint } = fixture();
  const player = new AnimationPlayer(rig, joints);
  const keys = [{ time: 0, rotation: 0.4 }, { time: 1000, rotation: 0.8 }];
  player.addAnimation({ name: 'pose', duration: 1000, loop: true, tracks: { upper: keys } });
  player.play('pose');
  const state = new IKPoseState();
  const affected = [joints.get('upper')!, joints.get('lower')!];
  constraint.setTarget(80, 75);
  for (let frame = 0; frame < 5; frame += 1) {
    state.restore();
    player.update(100);
    state.capture(affected);
    constraint.apply(identity);
    state.commit();
  }
  state.restore();
  assert.approximately(joints.get('upper')!.pose.rotation, 0.6, 1e-8);
  assert.strictEqual(joints.get('lower')!.pose.rotation, 0.2);
  assert.deepEqual(keys, [{ time: 0, rotation: 0.4 }, { time: 1000, rotation: 0.8 }]);
});

test('explicit pose edits survive restoration and target providers update every pass', () => {
  const { joints, constraint } = fixture();
  const state = new IKPoseState();
  let target = { x: 80, y: 75 };
  constraint.setTargetProvider(() => target);
  state.capture([joints.get('upper')!]);
  constraint.apply(identity);
  state.commit();
  joints.get('upper')!.pose.rotation = 0.3;
  state.restore();
  assert.strictEqual(joints.get('upper')!.pose.rotation, 0.3);
  target = { x: 50, y: 100 };
  constraint.apply(identity);
  assert.approximately(endPosition(joints).x, 50, 1e-8);
  assert.approximately(endPosition(joints).y, 100, 1e-8);
});

test('mix zero leaves both joints untouched and mix one reaches the target', () => {
  const { joints, constraint } = fixture();
  constraint.setTarget(80, 75);
  constraint.mix = 0;
  constraint.apply(identity);
  assert.strictEqual(joints.get('upper')!.pose.rotation, 0.1);
  assert.strictEqual(joints.get('lower')!.pose.rotation, 0.2);
  constraint.mix = 1;
  constraint.apply(identity);
  assert.approximately(endPosition(joints).x, 80, 1e-8);
  assert.approximately(endPosition(joints).y, 75, 1e-8);
});

test('singular transforms and unsupported internal scale leave the pose finite and report their status', () => {
  const { joints, constraint } = fixture();
  constraint.setTarget(80, 75).apply({ worldToParent: () => undefined });
  assert.strictEqual(constraint.status, 'singular-transform');
  joints.get('upper')!.pose.scaleX = 0;
  constraint.apply(identity);
  assert.strictEqual(constraint.status, 'singular-transform');
  joints.get('upper')!.pose.scaleX = 2;
  constraint.apply(identity);
  assert.strictEqual(constraint.status, 'unsupported-scale');
  assert.strictEqual(joints.get('upper')!.pose.rotation, 0.1);
});

test('constraint rejects disconnected chains and invalid configuration/targets', () => {
  const { rig, joints, constraint } = fixture();
  assert.throws(() => new TwoBoneIKConstraint({ ...definition, middleBone: 'hand', endBone: 'lower' }, rig, joints), /connected/);
  assert.throws(() => new TwoBoneIKConstraint({ ...definition, priority: NaN }, rig, joints), /finite/);
  assert.throws(() => new TwoBoneIKConstraint({ ...definition, endOffset: { x: 0, y: Infinity } }, rig, joints), /finite/);
  assert.throws(() => { constraint.mix = 2; }, /between/);
  assert.throws(() => constraint.setTarget(Infinity, 0), /finite/);
  const source = { x: 5, y: 6 };
  constraint.target = source;
  source.x = 99;
  assert.strictEqual(constraint.target.x, 5);
  constraint.target = undefined;
  constraint.apply(identity);
  assert.strictEqual(constraint.status, 'inactive');
});
