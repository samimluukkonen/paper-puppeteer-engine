import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AnimationPlayer,
  CharacterLoader,
  compileClip,
  evaluateClip,
  Joint,
  Rig,
  solveTwoBoneIK,
  validatePoseDefinition,
  validateRigDefinition,
} from 'paper-puppeteer-engine/core';
import { z } from 'zod';

// Exercise the built subpath in plain Node, with no browser globals or Phaser mock.
assert.equal(typeof globalThis.window, 'undefined');
// Consumers and the library must share the installed Zod runtime and error class.
assert.throws(() => new Rig({ root: 'root', bones: [{ id: 'root', x: NaN }] }), z.ZodError);
const character = await CharacterLoader.load(
  process.argv[2] ?? new URL('../public/characters/demo-puppet/character.json', import.meta.url).href,
  async (url) => new Response(await readFile(new URL(url), 'utf8')),
);
const rig = character.rig;
assert.deepEqual(validatePoseDefinition({ version: 1, name: 'rest', bones: { [rig.root]: { x: 1 } } }, rig), []);
assert.equal(
  validatePoseDefinition({ version: 1, name: 'bad', bones: { missing: { x: 1 } } }, rig)[0].path,
  'bones.missing',
);
assert.deepEqual(validateRigDefinition({ version: 1, root: rig.root, bones: rig.bones }), []);
assert.ok(validateRigDefinition({ version: 1, root: 'missing', bones: rig.bones }).length > 0);
const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
const player = new AnimationPlayer(rig, joints);
const clip = {
  name: 'test',
  duration: 1000,
  loop: false,
  tracks: {
    [rig.root]: [
      { time: 0, x: 0 },
      { time: 1000, x: 10 },
    ],
  },
};
const compiled = compileClip(clip, rig);
assert.equal(evaluateClip(compiled, 500).get(rig.root).x, 5);
player.addAnimation(clip);
player.play('test');
player.update(500);
assert.equal(joints.get(rig.root).pose.x, 5);
const solved = solveTwoBoneIK({
  root: { x: 0, y: 0 },
  target: { x: 60, y: 70 },
  lengthA: 60,
  lengthB: 50,
  bendDirection: 1,
});
assert.ok(Number.isFinite(solved.rootRotation));
assert.ok(Number.isFinite(solved.middleRotation));
console.log('Built /core package works in Node: character loading, validation, animation, and IK.');
