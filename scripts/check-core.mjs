import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

// Lint runs before declarations are built; use source types while loading the package at runtime.
const coreSpecifier = 'paper-puppeteer-engine/core';
const {
  AnimationPlayer,
  AnimationStateController,
  CharacterLoader,
  compileClip,
  evaluateClip,
  Joint,
  Rig,
  solveTwoBoneIK,
  validatePoseDefinition,
  validateRigDefinition,
} = /** @type {typeof import('../src/engine/core.ts')} */ (await import(coreSpecifier));

// Exercise the built subpath in plain Node, with no browser globals or Phaser mock.
assert.equal(typeof globalThis.window, 'undefined');
const serializationSpecifier = 'paper-puppeteer-engine/serialization';
const serialization = /** @type {typeof import('../src/engine/serialization.ts')} */ (
  await import(serializationSpecifier)
);
assert.strictEqual(serialization.validateRigDefinition, validateRigDefinition);
const dataSpecifier = 'paper-puppeteer-engine/data';
const data = /** @type {typeof import('../src/engine/data.ts')} */ (await import(dataSpecifier));
assert.deepEqual(Object.keys(data), [], '/data is a type-only entry.');
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
const controller = new AnimationStateController(player, {
  initialState: 'idle',
  states: { idle: { animation: 'test', loop: true }, action: { animation: 'test' } },
});
controller.playAction('action');
player.update(1000);
assert.equal(controller.currentState, 'idle');
assert.equal(controller.currentAction, undefined);
assert.equal(player.getPlaybackStatus().loop, true);
controller.dispose();
const awaitedPlayback = player.playAndWait('test');
const playbackId = player.getPlaybackStatus().playbackId;
player.update(1000);
const outcome = await awaitedPlayback;
assert.equal(outcome.status, 'completed');
assert.equal(outcome.playback.playbackId, playbackId);
assert.deepEqual(await player.waitForPlayback(), outcome);
const abort = new AbortController();
const cancelledPlayback = player.playAndWait('test', { signal: abort.signal });
abort.abort();
assert.equal((await cancelledPlayback).status, 'cancelled');
assert.equal(player.isPlaying, true);
await assert.rejects(player.playAndWait('test', { loop: true }), /loop: false/);
const solved = solveTwoBoneIK({
  root: { x: 0, y: 0 },
  target: { x: 60, y: 70 },
  lengthA: 60,
  lengthB: 50,
  bendDirection: 1,
});
assert.ok(Number.isFinite(solved.rootRotation));
assert.ok(Number.isFinite(solved.middleRotation));
player.dispose();
assert.equal(player.isDisposed, true);
console.log(
  'Built /core, /serialization and /data work in Node: loading, validation, async animation, IK, and disposal.',
);
