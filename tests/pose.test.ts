import { assert, test } from 'vitest';
import { UnsupportedFormatVersionError } from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import {
  applyPoseToJoints,
  PoseValidationError,
  parsePoseDefinition,
  serializePose,
  validatePoseDefinition,
} from '../src/engine/Pose.js';
import { Rig } from '../src/engine/Rig.js';
import type { JointTransform } from '../src/engine/types.js';

const rig = new Rig({
  root: 'torso',
  bones: [
    { id: 'torso', rotation: 0.2 },
    { id: 'arm', parent: 'torso', x: 5, y: 10 },
  ],
});
const joints = () => new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
const source = { version: 1 as const, name: 'guard', bones: { arm: { rotation: 1, x: 8 } } };

test('pose parsing rejects throwing accessors before reading versions or transforms', () => {
  for (const field of ['version', 'name', 'bones']) {
    let reads = 0;
    const input = Object.defineProperty({ ...source }, field, {
      enumerable: true,
      get() {
        reads++;
        throw new Error('getter invoked');
      },
    });
    assert.throws(() => parsePoseDefinition(input, rig), PoseValidationError);
    assert.equal(reads, 0);
  }
  const transform = Object.defineProperty({}, 'rotation', {
    enumerable: true,
    get() {
      throw new Error('getter invoked');
    },
  });
  assert.throws(() => parsePoseDefinition({ ...source, bones: { arm: transform } }, rig), PoseValidationError);
  const inherited: unknown = Object.create({
    get version() {
      throw new Error('inherited getter invoked');
    },
  });
  assert.throws(() => parsePoseDefinition(inherited, rig), PoseValidationError);
});

test('reserved bone identifiers fail explicitly while own Object prototype names round trip', () => {
  assert.throws(() => new Rig({ root: '__proto__', bones: [{ id: '__proto__' }] }), /reserved/);
  assert.throws(
    () => parsePoseDefinition(JSON.parse('{"version":1,"name":"bad","bones":{"__proto__":{"x":1}}}'), rig),
    /reserved/,
  );
  const invalid = new Map([['__proto__', new Joint('__proto__', {})]]);
  assert.throws(() => serializePose('saved', invalid, { onlyChanged: false }), /reserved/);
  for (const id of ['toString', 'constructor', 'prototype']) {
    const namedRig = new Rig({ root: id, bones: [{ id }] });
    const state = new Map([[id, new Joint(id, {})]]);
    state.get(id)!.pose.x = 5;
    const pose = serializePose('saved', state);
    assert.ok(Object.hasOwn(pose.bones, id));
    assert.deepEqual(parsePoseDefinition(JSON.parse(JSON.stringify(pose)), namedRig), pose);
  }
});

test('parse valid sparse pose and reject unknown bones, versions and scalar values', () => {
  assert.deepEqual(parsePoseDefinition(source, rig), source);
  assert.throws(() => parsePoseDefinition({ ...source, version: 2 }, rig), /Unsupported pose format version/);
  assert.throws(() => parsePoseDefinition({ ...source, bones: { ghost: { rotation: 1 } } }, rig), /Unknown bone/);
  assert.throws(() => parsePoseDefinition({ ...source, bones: { arm: { rotation: NaN } } }, rig), /rotation/);
  assert.throws(() => parsePoseDefinition({ ...source, bones: { arm: { rotation: '1' } } }, rig), /rotation/);
  assert.throws(() => parsePoseDefinition({ ...source, bones: { arm: { rotation: undefined } } }, rig), /JSON value/);
});

test('pose validation retains individual field and reference paths without throwing', () => {
  assert.deepEqual(validatePoseDefinition(source, rig), []);
  const references = validatePoseDefinition({ ...source, bones: { ghost: { x: 1 }, other: { y: 2 } } }, rig);
  assert.deepEqual(
    references.map(({ severity, path }) => ({ severity, path })),
    [
      { severity: 'error', path: 'bones.ghost' },
      { severity: 'error', path: 'bones.other' },
    ],
  );
  const fields = validatePoseDefinition({ ...source, bones: { arm: { x: 'invalid', rotation: 'invalid' } } }, rig);
  assert.deepEqual(
    fields
      .map(({ path }) => {
        if (typeof path !== 'string') throw new Error('Validation issue must include a field path.');
        return path;
      })
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    ['bones.arm.rotation', 'bones.arm.x'],
  );
  assert.deepEqual(
    validatePoseDefinition({ ...source, bones: { arm: { extra: 1 } } }, rig).map(({ path }) => path),
    ['bones.arm.extra'],
  );
  const { version: _version, ...missingVersion } = source;
  assert.deepEqual(
    validatePoseDefinition(missingVersion, rig).map(({ path }) => path),
    ['version'],
  );
  const unsupported = { ...source, version: 2 };
  assert.equal(validatePoseDefinition(unsupported, rig).length, 1);
  assert.throws(() => parsePoseDefinition(unsupported, rig), UnsupportedFormatVersionError);
  const cyclic: Record<string, unknown> = { ...source };
  cyclic.extra = cyclic;
  assert.ok(
    validatePoseDefinition(cyclic, rig).some(({ path, message }) => path === 'extra' && /Cyclic/.test(message)),
  );
});

test('partial poses preserve underlying values and mix endpoints', () => {
  const pose = parsePoseDefinition(source, rig);
  const atZero = joints();
  atZero.get('arm')!.pose.rotation = 0.4;
  applyPoseToJoints(pose, atZero, 0);
  assert.equal(atZero.get('arm')!.pose.rotation, 0.4);
  assert.equal(atZero.get('arm')!.pose.y, 10);
  const atOne = joints();
  applyPoseToJoints(pose, atOne, 1);
  assert.equal(atOne.get('arm')!.pose.rotation, 1);
  assert.equal(atOne.get('arm')!.pose.x, 8);
  assert.equal(atOne.get('torso')!.pose.rotation, 0.2);
  const half = joints();
  applyPoseToJoints(pose, half, 0.5);
  assert.equal(half.get('arm')!.pose.rotation, 0.5);
});

test.each([1, -1])('static pose blending takes the shortest rotation across the angle boundary (%s)', (direction) => {
  const state = joints();
  const from = (direction * 179 * Math.PI) / 180;
  const to = -from;
  state.get('arm')!.pose.rotation = from;
  const pose = parsePoseDefinition({ ...source, bones: { arm: { rotation: to, x: 9 } } }, rig);
  const underlying = new Map<string, Partial<JointTransform>>();
  applyPoseToJoints(pose, state, 0.5, underlying);
  assert.closeTo(state.get('arm')!.pose.rotation, direction * Math.PI, 1e-12);
  assert.equal(state.get('arm')!.pose.x, 7);
  assert.equal(underlying.get('arm')!.rotation, from);
  state.get('arm')!.pose.rotation = from;
  applyPoseToJoints(pose, state, 0);
  assert.equal(state.get('arm')!.pose.rotation, from);
  applyPoseToJoints(pose, state, 1);
  assert.equal(state.get('arm')!.pose.rotation, to);
});

test('bind reset, sparse serialization and JSON round trip', () => {
  const state = joints();
  applyPoseToJoints(parsePoseDefinition(source, rig), state);
  state.get('torso')!.pose.rotation += 0.00001;
  const exported = serializePose('saved', state);
  assert.deepEqual(exported.bones, { arm: { x: 8, rotation: 1 } });
  assert.deepEqual(parsePoseDefinition(JSON.parse(JSON.stringify(exported)), rig), exported);
  for (const joint of state.values()) joint.reset();
  assert.deepEqual(serializePose('bind', state).bones, {});
});
