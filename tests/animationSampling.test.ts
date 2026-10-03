import { assert, test } from 'vitest';
import { sampleProperty } from '../src/engine/AnimationClip.js';
import { ClipPoseBuffer } from '../src/engine/AnimationPose.js';
import { AnimationPlayer, type CompiledClip, compileClip, evaluateClip, Joint, Rig } from '../src/engine/core.js';

test('precompiled clips reject unknown bones before changing joint poses', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root', x: 3 }] });
  const otherRig = new Rig({ root: 'other', bones: [{ id: 'other' }] });
  const joint = new Joint('root', rig.getBone('root'));
  joint.pose.x = 42;
  const clip = compileClip(
    { name: 'incompatible', duration: 100, loop: false, tracks: { other: [{ time: 0, x: 10 }] } },
    otherRig,
  );
  assert.throws(
    () => new AnimationPlayer(rig, new Map([['root', joint]]), [clip]),
    /Animation "incompatible" references unknown bone "other"/,
  );
  assert.equal(joint.pose.x, 42);
});

test('precompiled clips can be reused by compatible rigs without recompilation', () => {
  const sourceRig = new Rig({ root: 'root', bones: [{ id: 'root', x: 3 }] });
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', x: 8 },
      { id: 'extra', parent: 'root' },
    ],
  });
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const clip = compileClip(
    {
      name: 'move',
      duration: 100,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 100, x: 10 },
        ],
      },
    },
    sourceRig,
  );
  const player = new AnimationPlayer(rig, joints, [clip]);
  player.play('move');
  player.update(50);
  assert.equal(joints.get('root')!.pose.x, 5);
  assert.deepEqual(joints.get('extra')!.pose, joints.get('extra')!.bindPose);
});

test.each([NaN, Infinity, -Infinity])('sampling rejects nonfinite time %s before changing buffered poses', (time) => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip = compileClip(
    {
      name: 'preview',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 10 },
        ],
      },
    },
    rig,
  );
  const empty = compileClip({ name: 'empty', duration: 1000, loop: false, tracks: {} }, rig);
  for (const compiled of [clip, empty]) {
    assert.throws(() => evaluateClip(compiled, time), /Sample time must be a finite number/);
    const buffer = new ClipPoseBuffer();
    assert.throws(() => buffer.evaluate(compiled, time), /Sample time must be a finite number/);
    const held = buffer.evaluate(compiled, 500);
    const snapshot = structuredClone(held);
    assert.throws(() => buffer.evaluate(compiled, time), /Sample time must be a finite number/);
    assert.deepEqual(held, snapshot);
  }
});

test('the public core API compiles and evaluates an authored clip without runtime player state', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root', x: 3 }] });
  const compiled: CompiledClip = compileClip(
    {
      name: 'preview',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 10 },
        ],
      },
    },
    rig,
  );
  assert.deepEqual(evaluateClip(compiled, 500).get('root'), { x: 5 });
  assert.deepEqual(evaluateClip(compiled, 200).get('root'), { x: 2 });
  assert.equal(rig.getBone('root').x, 3);
});

test('dense tracks interpolate the correct interval when seeking in both directions', () => {
  const keys = Array.from({ length: 512 }, (_, index) => ({ time: index * 17, value: index ** 2 }));
  for (const index of [510, 1, 256, 42, 0, 509]) {
    assert.equal(sampleProperty(keys, index * 17), index ** 2);
    assert.closeTo(sampleProperty(keys, (index + 0.25) * 17), index ** 2 * 0.75 + (index + 1) ** 2 * 0.25, 1e-8);
  }
  assert.equal(sampleProperty(keys, -20), 0);
  assert.equal(sampleProperty(keys, 10000), 511 ** 2);
});

test('nonuniform key spacing, single keys, and empty tracks keep their sampling behavior', () => {
  const keys = [
    { time: 10, value: 1 },
    { time: 20, value: 3 },
    { time: 80, value: 9 },
  ];
  assert.equal(sampleProperty(keys, 15), 2);
  assert.equal(sampleProperty(keys, 20), 3);
  assert.equal(sampleProperty(keys, 50), 6);
  assert.equal(sampleProperty(keys, 80), 9);
  assert.equal(sampleProperty([{ time: 10, value: 7 }], 0), 7);
  assert.equal(sampleProperty([{ time: 10, value: 7 }], 100), 7);
  assert.throws(() => sampleProperty([], 0), /empty property track/);
});

test('exact angular keys retain the shortest-path equivalent angle until past the final key', () => {
  const degrees = (value: number) => (value * Math.PI) / 180;
  const keys = [
    { time: 0, value: degrees(179) },
    { time: 100, value: degrees(-179) },
  ];
  assert.closeTo(sampleProperty(keys, 50, 'rotation'), Math.PI, 1e-12);
  assert.closeTo(sampleProperty(keys, 100, 'rotation'), degrees(181), 1e-12);
  assert.equal(sampleProperty(keys, 101, 'rotation'), degrees(-179));
});
