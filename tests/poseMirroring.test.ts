import { assert, test } from 'vitest';
import { getEvaluatedAnimationPose } from '../src/devtools/animation-editor/animationValues.js';
import {
  type BoneSymmetryMapping,
  type BoneSymmetryPair,
  createBoneSymmetryMapping,
  inferBoneSymmetryPairs,
} from '../src/devtools/shared/boneSymmetry.js';
import { freezeData } from '../src/devtools/shared/editorData.js';
import { type MirrorDirection, mirrorPose } from '../src/devtools/shared/poseMirroring.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import type { AnimationPose } from '../src/engine/AnimationPose.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { createTransform, type JointTransform, transformProperties } from '../src/engine/types.js';
import { demoRig, walk } from './helpers/demoCharacter.js';

const tolerance = 1e-9;
const pair = (leftBoneId: string, rightBoneId: string): BoneSymmetryPair => ({ leftBoneId, rightBoneId });
function mappingFor(rig: Rig, pairs = inferBoneSymmetryPairs(rig).pairs): BoneSymmetryMapping {
  const result = createBoneSymmetryMapping(rig, { manualPairs: pairs });
  assert.isTrue(result.success);
  return result.mapping;
}
function mirrored(
  pose: AnimationPose,
  rig: Rig,
  direction: MirrorDirection = 'left-to-right',
  mapping = mappingFor(rig),
) {
  const result = mirrorPose(pose, rig, mapping, direction);
  assert.isTrue(result.success, JSON.stringify(result.issues));
  return result.pose;
}
function near(actual: Partial<JointTransform>, expected: Partial<JointTransform>): void {
  for (const property of transformProperties) {
    if (expected[property] !== undefined) assert.closeTo(actual[property]!, expected[property], tolerance, property);
  }
}
function simpleRig(left: Partial<JointTransform> = {}, right: Partial<JointTransform> = {}): Rig {
  return new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'leftArm', parent: 'root', x: 10, y: 3, ...left },
      { id: 'rightArm', parent: 'root', x: -12, y: 5, ...right },
      { id: 'head', parent: 'root', y: -20 },
    ],
  });
}
function bindPose(rig: Rig): AnimationPose {
  return new Map(rig.bones.map((bone) => [bone.id, createTransform(bone)]));
}

// Independent point composition checks the actual T R S joint hierarchy, including local axis endpoints.
function worldPoint(rig: Rig, pose: AnimationPose, id: string, point = { x: 0, y: 0 }): { x: number; y: number } {
  const bone = rig.getBone(id);
  const transform = { ...createTransform(bone), ...pose.get(id) };
  const x = point.x * transform.scaleX;
  const y = point.y * transform.scaleY;
  const parentPoint = {
    x: transform.x + Math.cos(transform.rotation) * x - Math.sin(transform.rotation) * y,
    y: transform.y + Math.sin(transform.rotation) * x + Math.cos(transform.rotation) * y,
  };
  return bone.parent === undefined ? parentPoint : worldPoint(rig, pose, bone.parent, parentPoint);
}

test.each(['left-to-right', 'right-to-left', 'swap'] as const)(
  '%s mirrors rest-relative translations and rotations',
  (direction) => {
    const rig = simpleRig({ rotation: 0.3, scaleX: 2, scaleY: 3 }, { rotation: -0.3, scaleX: 4, scaleY: 5 });
    const pose = bindPose(rig);
    pose.set('leftArm', { x: 14, y: 9, rotation: 0.5, scaleX: 3, scaleY: 6 });
    pose.set('rightArm', { x: -15, y: 7, rotation: 0.2, scaleX: 8, scaleY: 2.5 });
    const output = mirrored(pose, rig, direction);
    if (direction !== 'right-to-left')
      near(output.get('rightArm')!, { x: -16, y: 11, rotation: -0.5, scaleX: 6, scaleY: 10 });
    else assert.deepEqual(output.get('rightArm'), pose.get('rightArm'));
    if (direction !== 'left-to-right')
      near(output.get('leftArm')!, { x: 13, y: 5, rotation: -0.2, scaleX: 4, scaleY: 1.5 });
    else assert.deepEqual(output.get('leftArm'), pose.get('leftArm'));
  },
);

test('sparse poses resolve absent bones and properties from bind, including overwriting the destination with rest', () => {
  const rig = simpleRig({ rotation: 0.4 }, { rotation: -0.1 });
  const pose: AnimationPose = new Map([['rightArm', { rotation: 1 }]]);
  const output = mirrored(pose, rig);
  near(output.get('rightArm')!, createTransform(rig.getBone('rightArm')));
  assert.isFalse(output.has('leftArm'));
  const rotated = mirrored(new Map([['leftArm', { rotation: 0.9 }]]), rig);
  near(rotated.get('rightArm')!, { x: -12, y: 5, rotation: -0.6, scaleX: 1, scaleY: 1 });
});

test('unpaired/root values and sparse shape are preserved in detached output entries', () => {
  const rig = simpleRig();
  const pose: AnimationPose = new Map([
    ['root', { x: 44, y: -30, rotation: 0.2, scaleX: 2 }],
    ['head', { rotation: 0.8 }],
    ['leftArm', { rotation: 0.3 }],
  ]);
  const output = mirrored(pose, rig, 'swap');
  for (const id of ['root', 'head']) {
    assert.deepEqual(output.get(id), pose.get(id));
    assert.notStrictEqual(output.get(id), pose.get(id));
  }
  near(output.get('rightArm')!, { x: -12, y: 5, rotation: -0.3 });
});

test.each([Math.PI - 0.1, Math.PI, Math.PI + 0.1, 8 * Math.PI + 0.2])(
  'rotation %s uses the evaluator shortest-path convention',
  (rotation) => {
    const rig = simpleRig();
    const output = mirrored(new Map([['leftArm', { rotation }]]), rig);
    const actual = output.get('rightArm')!.rotation!;
    assert.isAtLeast(actual, -Math.PI);
    assert.isBelow(actual, Math.PI);
    assert.closeTo(Math.cos(actual), Math.cos(-rotation), tolerance);
    assert.closeTo(Math.sin(actual), Math.sin(-rotation), tolerance);
  },
);

const nestedRig = new Rig({
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'leftUpperArm', parent: 'root', x: 15, y: -8, rotation: 0.3, length: 30, scaleX: 1.2, scaleY: 0.8 },
    { id: 'leftForearm', parent: 'leftUpperArm', x: 0, y: 99, rotation: -0.2, length: 20 },
    { id: 'leftHand', parent: 'leftForearm', x: 7, y: 14, rotation: 0.1 },
    { id: 'rightUpperArm', parent: 'root', x: -15, y: -8, rotation: -0.3, length: 30, scaleX: 1.2, scaleY: 0.8 },
    { id: 'rightForearm', parent: 'rightUpperArm', x: 0, y: 99, rotation: 0.2, length: 20 },
    { id: 'rightHand', parent: 'rightForearm', x: -7, y: 14, rotation: -0.1 },
  ],
});

test('nested transforms reflect joint positions and both local axes without applying parent motion twice', () => {
  const pose = bindPose(nestedRig);
  for (const id of ['leftUpperArm', 'leftForearm', 'leftHand']) {
    const values = pose.get(id)!;
    values.x! += 3;
    values.y! += 2;
    values.rotation! += 0.4;
    values.scaleX! *= 1.5;
    values.scaleY! *= 0.7;
  }
  const output = mirrored(pose, nestedRig);
  assert.closeTo(output.get('rightForearm')!.y!, 32, tolerance); // Rig resolved the authored y=99 to length=30.
  for (const { leftBoneId, rightBoneId } of mappingFor(nestedRig).pairs) {
    for (const point of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]) {
      const source = worldPoint(nestedRig, pose, leftBoneId, point);
      const target = worldPoint(nestedRig, output, rightBoneId, { x: -point.x, y: point.y });
      assert.closeTo(target.x, -source.x, tolerance);
      assert.closeTo(target.y, source.y, tolerance);
    }
  }
});

test('an animated unpaired parent carries the bind reflection axis without reflecting its authored motion', () => {
  const pose = bindPose(nestedRig);
  pose.set('root', { x: 60, y: 40, rotation: 0.6, scaleX: 2, scaleY: 3 });
  pose.get('leftUpperArm')!.rotation! += 0.5;
  const output = mirrored(pose, nestedRig);
  const sourceWithoutRoot = worldPoint(nestedRig, new Map([...pose, ['root', createTransform()]]), 'leftHand');
  const target = worldPoint(nestedRig, output, 'rightHand');
  const expectedX = 60 - Math.cos(0.6) * 2 * sourceWithoutRoot.x - Math.sin(0.6) * 3 * sourceWithoutRoot.y;
  const expectedY = 40 - Math.sin(0.6) * 2 * sourceWithoutRoot.x + Math.cos(0.6) * 3 * sourceWithoutRoot.y;
  assert.closeTo(target.x, expectedX, tolerance);
  assert.closeTo(target.y, expectedY, tolerance);
  assert.deepEqual(output.get('root'), pose.get('root'));
});

test('a rotated shared bind parent converts character reflection into its own local axes', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', rotation: Math.PI / 4 },
      { id: 'leftArm', parent: 'root', x: 10 },
      { id: 'rightArm', parent: 'root', x: -10 },
    ],
  });
  const pose: AnimationPose = new Map([['leftArm', { x: 13, y: 4, rotation: 0.2 }]]);
  // R(-pi/4) F R(pi/4) sends (3,4) to (4,3), not (-3,4).
  near(mirrored(pose, rig).get('rightArm')!, { x: -6, y: 3, rotation: -0.2 });
  const scaled = mirrored(new Map([['leftArm', { scaleX: 2, scaleY: 3 }]]), rig);
  near(scaled.get('rightArm')!, { scaleX: 3, scaleY: 2 });
});

test('asymmetric bind rotations and offsets keep their own rest pose and convert child translation between frames', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'leftUpperArm', parent: 'root', x: 12, rotation: 0.3 },
      { id: 'rightUpperArm', parent: 'root', x: -18, rotation: 0.8 },
      { id: 'leftHand', parent: 'leftUpperArm', x: 2, y: 20, rotation: 0.5 },
      { id: 'rightHand', parent: 'rightUpperArm', x: -4, y: 25, rotation: 0.2 },
    ],
  });
  const rest = bindPose(rig);
  const restOutput = mirrored(rest, rig, 'swap');
  for (const bone of rig.bones) near(restOutput.get(bone.id)!, rest.get(bone.id)!);
  const pose = bindPose(rig);
  pose.get('leftUpperArm')!.rotation! += 0.4;
  pose.get('leftHand')!.rotation! += 0.6;
  pose.get('leftHand')!.x! += 3;
  pose.get('leftHand')!.y! += 7;
  const output = mirrored(pose, rig);
  near(output.get('rightUpperArm')!, { x: -18, rotation: 0.4 });
  near(output.get('rightHand')!, {
    x: -4 - 3 * Math.cos(1.1) + 7 * Math.sin(1.1),
    y: 25 + 3 * Math.sin(1.1) + 7 * Math.cos(1.1),
    rotation: -0.4,
  });
});

test('existing signed bind axes retain destination signs without adding artwork reflections', () => {
  const rig = simpleRig({ scaleX: -2 }, { scaleY: -3 });
  const pose: AnimationPose = new Map([['leftArm', { scaleX: -4, scaleY: 1.5, rotation: 0.3 }]]);
  near(mirrored(pose, rig).get('rightArm')!, { scaleX: 2, scaleY: -4.5, rotation: -0.3 });
});

test.each([0, -1])('animated scale %s reports unsupported axis collapse/sign changes', (scaleX) => {
  const rig = simpleRig();
  const result = mirrorPose(new Map([['leftArm', { scaleX }]]), rig, mappingFor(rig), 'left-to-right');
  assert.isFalse(result.success);
  assert.isNull(result.pose);
  assert.equal(result.issues[0]!.code, 'unsupported-scale');
});

test.each(['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const)(
  'nonfinite source %s returns structured diagnostics',
  (property) => {
    const rig = simpleRig();
    const result = mirrorPose(new Map([['leftArm', { [property]: NaN }]]), rig, mappingFor(rig), 'left-to-right');
    assert.isFalse(result.success);
    assert.isNull(result.pose);
    assert.equal(result.issues[0]!.code, 'invalid-transform');
    assert.deepEqual(result.issues[0]!.boneIds, ['leftArm', 'rightArm']);
  },
);

test('a nonrepresentable nonuniform scale returns a shear error instead of approximating', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', rotation: Math.PI / 6 },
      { id: 'leftArm', parent: 'root' },
      { id: 'rightArm', parent: 'root' },
    ],
  });
  const result = mirrorPose(new Map([['leftArm', { scaleX: 2 }]]), rig, mappingFor(rig), 'left-to-right');
  assert.isFalse(result.success);
  assert.isNull(result.pose);
  assert.equal(result.issues[0]!.code, 'unsupported-shear');
  near(mirrored(new Map([['leftArm', { scaleX: 2, scaleY: 2 }]]), rig).get('rightArm')!, { scaleX: 2, scaleY: 2 });
});

test.each(['root', 'leftArm', 'rightArm'])('zero bind scale on %s is rejected', (id) => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', ...(id === 'root' ? { scaleX: 0 } : {}) },
      { id: 'leftArm', parent: 'root', ...(id === 'leftArm' ? { scaleX: 0 } : {}) },
      { id: 'rightArm', parent: 'root', ...(id === 'rightArm' ? { scaleX: 0 } : {}) },
    ],
  });
  const result = mirrorPose(new Map(), rig, mappingFor(rig), 'left-to-right');
  assert.isFalse(result.success);
  assert.equal(result.issues[0]!.code, 'singular-transform');
});

test('finite input overflow is rejected atomically, including failures in the second half of swap', () => {
  const rig = simpleRig();
  const pose: AnimationPose = new Map([
    ['leftArm', { rotation: 0.3 }],
    ['rightArm', { x: Infinity }],
  ]);
  const result = mirrorPose(pose, rig, mappingFor(rig), 'swap');
  assert.isFalse(result.success);
  assert.isNull(result.pose);
  assert.deepEqual(pose.get('leftArm'), { rotation: 0.3 });
  const extremeRig = simpleRig({ scaleX: 0.5 }, { scaleX: 2 });
  const extreme = mirrorPose(
    new Map([['leftArm', { scaleX: Number.MAX_VALUE }]]),
    extremeRig,
    mappingFor(extremeRig),
    'left-to-right',
  );
  assert.isFalse(extreme.success);
  assert.equal(extreme.issues[0]!.code, 'non-finite-result');
});

test.each(['missing-bone', 'self-pair', 'multiple-partners', 'invalid-reciprocal', 'rig-mismatch'] as const)(
  'invalid mapping %s fails existing validation',
  (code) => {
    const rig = simpleRig();
    const valid = mappingFor(rig);
    const pairs =
      code === 'missing-bone'
        ? [pair('leftArm', 'missing')]
        : code === 'self-pair'
          ? [pair('leftArm', 'leftArm')]
          : code === 'multiple-partners'
            ? [...valid.pairs, pair('leftArm', 'head')]
            : valid.pairs;
    const mapping: BoneSymmetryMapping = {
      ...valid,
      pairs,
      ...(code === 'invalid-reciprocal' ? { getMirroredBoneId: () => null } : {}),
      ...(code === 'rig-mismatch' ? { rig: simpleRig() } : {}),
    };
    const result = mirrorPose(new Map(), rig, mapping, 'swap');
    assert.isFalse(result.success);
    assert.isNull(result.pose);
    assert.isTrue(result.issues.some((issue) => issue.code === code));
  },
);

test('hierarchy warnings block pose mirroring and root/ancestor pairing', () => {
  for (const pairs of [[pair('leftUpperArm', 'rightHand')], [pair('root', 'rightUpperArm')]]) {
    const mapping = mappingFor(nestedRig, pairs);
    const result = mirrorPose(bindPose(nestedRig), nestedRig, mapping, 'swap');
    assert.isFalse(result.success);
    assert.isTrue(result.issues.some((issue) => issue.code === 'parent-mismatch'));
    assert.isTrue(result.issues.every((issue) => issue.severity === 'error'));
  }
});

test('an empty mapping is a detached no-op and an unknown direction is reported', () => {
  const rig = simpleRig();
  const pose = bindPose(rig);
  const mapping = mappingFor(rig, []);
  const result = mirrored(pose, rig, 'swap', mapping);
  assert.deepEqual(result, pose);
  assert.notStrictEqual(result, pose);
  // Deliberately exercise an untyped caller at the API boundary.
  const invalid = mirrorPose(pose, rig, mapping, 'invalid' as MirrorDirection);
  assert.isFalse(invalid.success);
  assert.equal(invalid.issues[0]!.code, 'invalid-direction');
});

test('mirror inputs remain immutable, output is owned, and results are deterministic regardless of pair order', () => {
  const rig = nestedRig;
  const mapping = mappingFor(rig);
  const pose = bindPose(rig);
  for (const values of pose.values()) Object.freeze(values);
  const original = JSON.stringify([...pose]);
  const rigJson = JSON.stringify(rig);
  const first = mirrored(pose, rig, 'swap', mapping);
  const second = mirrored(pose, rig, 'swap', mappingFor(rig, [...mapping.pairs].reverse()));
  assert.deepEqual(first, second);
  assert.deepEqual(first, mirrored(pose, rig, 'swap', mapping));
  first.get('root')!.x = 500;
  first.get('rightHand')!.rotation = 1;
  first.clear();
  assert.equal(JSON.stringify([...pose]), original);
  assert.equal(JSON.stringify(rig), rigJson);
  assert.isTrue(Object.isFrozen(mapping.pairs));
});

test('swapping twice and copying back round-trip supported nested poses and world transforms', () => {
  const pose = bindPose(nestedRig);
  for (const values of pose.values()) {
    values.x! += 4;
    values.y! -= 2;
    values.rotation! += 0.7;
    values.scaleX! *= 1.1;
    values.scaleY! *= 0.9;
  }
  const twice = mirrored(mirrored(pose, nestedRig, 'swap'), nestedRig, 'swap');
  const copiedBack = mirrored(mirrored(pose, nestedRig), nestedRig, 'right-to-left');
  for (const bone of nestedRig.bones) {
    near(twice.get(bone.id)!, pose.get(bone.id)!);
    if (bone.id.startsWith('left')) near(copiedBack.get(bone.id)!, pose.get(bone.id)!);
    const expected = worldPoint(nestedRig, pose, bone.id);
    const actual = worldPoint(nestedRig, twice, bone.id);
    assert.closeTo(actual.x, expected.x, tolerance);
    assert.closeTo(actual.y, expected.y, tolerance);
  }
});

test('shipped animation samples mirror before IK without modifying authored JSON, slots, attachments or constraints', () => {
  const animation = freezeData(walk);
  const originalAnimation = JSON.stringify(animation);
  const originalRig = JSON.stringify(demoRig);
  const mapping = mappingFor(demoRig);
  const pose = getEvaluatedAnimationPose(animation, demoRig, 250);
  const joints = new Map(demoRig.bones.map((bone) => [bone.id, new Joint(bone.id, { ...bone, ...pose.get(bone.id) })]));
  const constraint = new TwoBoneIKConstraint(
    {
      name: 'leftArm',
      rootBone: 'leftUpperArm',
      middleBone: 'leftForearm',
      endBone: 'leftHand',
      bendDirection: 1,
    },
    demoRig,
    joints,
  );
  constraint.setTarget(0, 0);
  const settings = {
    mix: constraint.mix,
    target: constraint.target,
    enabled: constraint.enabled,
    bend: constraint.bendDirection,
  };
  const before = mirrored(pose, demoRig, 'swap', mapping);
  constraint.apply({ worldToParent: (_id, point) => point });
  assert.notEqual(joints.get('leftUpperArm')!.pose.rotation, pose.get('leftUpperArm')!.rotation);
  assert.deepEqual(mirrored(pose, demoRig, 'swap', mapping), before);
  assert.deepEqual(
    { mix: constraint.mix, target: constraint.target, enabled: constraint.enabled, bend: constraint.bendDirection },
    settings,
  );
  assert.equal(JSON.stringify(animation), originalAnimation);
  assert.equal(JSON.stringify(demoRig), originalRig);
  for (const direction of ['left-to-right', 'right-to-left', 'swap'] as const)
    for (const time of [0, 125, 500, 1000])
      assert.isTrue(
        mirrorPose(getEvaluatedAnimationPose(animation, demoRig, time), demoRig, mapping, direction).success,
      );
});

test('the evaluator supplies authored absolute values rather than accumulated IK joint rotations', () => {
  const rig = simpleRig({ rotation: 0.2 }, { rotation: -0.2 });
  const animation: AnimationClip = {
    name: 'wave',
    duration: 1000,
    loop: false,
    tracks: {
      leftArm: [
        { time: 0, rotation: 0.2 },
        { time: 1000, rotation: 0.8 },
      ],
    },
    events: [{ time: 500, name: 'ignored-by-pose-sampling' }],
  };
  const original = JSON.stringify(animation);
  const pose = getEvaluatedAnimationPose(animation, rig, 500);
  near(mirrored(pose, rig).get('rightArm')!, { rotation: -0.5 });
  assert.equal(JSON.stringify(animation), original);
});
