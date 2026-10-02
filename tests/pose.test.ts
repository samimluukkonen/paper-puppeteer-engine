import { assert, test } from 'vitest';
import { Joint } from '../src/engine/Joint.js';
import { applyPoseToJoints, parsePoseDefinition, serializePose } from '../src/engine/Pose.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({
  root: 'torso',
  bones: [
    { id: 'torso', rotation: 0.2 },
    { id: 'arm', parent: 'torso', x: 5, y: 10 },
  ],
});
const joints = () => new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
const source = { version: 1 as const, name: 'guard', bones: { arm: { rotation: 1, x: 8 } } };

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
