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
  createRigBoneMapping,
  createRectangleMeshAttachment,
  createMeshSkinBinding,
  deformMesh,
  evaluateClip,
  evaluateRootMotionAtElapsedTime,
  getRootMotionDelta,
  getDialogueAtTime,
  inspectMeshDeformation,
  Joint,
  Rig,
  retargetAnimation,
  StoryPlayer,
  parseStoryDefinition,
  serializeStoryDefinition,
  solveTwoBoneIK,
  validatePoseDefinition,
  validateRigDefinition,
} = /** @type {typeof import('../src/engine/core.ts')} */ (await import(coreSpecifier));

// Exercise the built subpath in plain Node, with no browser globals or Phaser mock.
assert.equal(typeof globalThis.window, 'undefined');
const storyDraft = { version: 1, id: 'film', name: 'Film', scenes: [] };
assert.deepEqual(parseStoryDefinition(JSON.parse(serializeStoryDefinition(storyDraft))), storyDraft);
const storyPlayer = new StoryPlayer(storyDraft, {
  scenes: new Map(),
  loadScene: async () => {
    throw new Error('Empty story must not load a scene.');
  },
});
await assert.rejects(storyPlayer.start(), /Empty story/);
storyPlayer.dispose();
assert.equal(storyPlayer.status, 'disposed');
const subtitle = { id: 'line', text: 'Hello\nWorld', time: 500, duration: 500 };
assert.equal(getDialogueAtTime({ dialogue: [subtitle] }, 750).line.text, 'Hello\nWorld');
assert.equal(getDialogueAtTime({ dialogue: [subtitle] }, 1000), undefined);
const serializationSpecifier = 'paper-puppeteer-engine/serialization';
const serialization = /** @type {typeof import('../src/engine/serialization.ts')} */ (
  await import(serializationSpecifier)
);
assert.strictEqual(serialization.validateRigDefinition, validateRigDefinition);
const dataSpecifier = 'paper-puppeteer-engine/data';
const data = /** @type {typeof import('../src/engine/data.ts')} */ (await import(dataSpecifier));
assert.deepEqual(Object.keys(data), [], '/data is a type-only entry.');
// Standalone mesh consumer: metadata loading, authored serialization and deterministic CPU skinning.
const meshRest = {
  root: 'root',
  bones: [{ id: 'root' }, { id: 'tip', parent: 'root', x: 10 }],
  slots: [{ id: 'cloth', bone: 'root' }],
};
// Retarget through the built renderer-independent entry and validate the resulting authored JSON.
const retargetSource = { id: 'source', rig: meshRest };
const retargetTarget = {
  id: 'target',
  rig: { ...meshRest, bones: [{ id: 'root' }, { id: 'tip', parent: 'root', x: 20, rotation: 0.5 }] },
};
const retargeted = retargetAnimation({
  sourceAnimation: {
    name: 'source-clip',
    duration: 100,
    loop: false,
    tracks: {
      tip: [
        { time: 0, x: 12, rotation: 0.2 },
        { time: 100, x: 16, rotation: 1.2 },
      ],
    },
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0 },
        { time: 100, x: 20 },
      ],
    },
    events: [{ time: 50, name: 'cut' }],
  },
  sourceRig: retargetSource,
  targetRig: retargetTarget,
  boneMapping: createRigBoneMapping(
    retargetSource,
    retargetTarget,
    [
      { sourceBoneId: 'root', targetBoneId: 'root' },
      { sourceBoneId: 'tip', targetBoneId: 'tip' },
    ],
    'map',
    'Built core smoke',
  ),
  options: { name: 'retargeted', rootMotion: 'preserve' },
});
assert.ok(retargeted.animation);
assert.equal(retargeted.animation.tracks.tip[0].x, 24);
assert.equal(retargeted.animation.tracks.tip[0].rotation, 0.7);
assert.doesNotThrow(() =>
  serialization.serializeAnimationDefinition({ version: 1, ...retargeted.animation }, retargetTarget.rig),
);
// Reload exported retargeted data into the actual installed evaluator, outside the editors.
const retargetRig = new Rig(retargetTarget.rig);
const reloadedRetarget = serialization.parseAnimationClip(
  JSON.parse(serialization.serializeAnimationDefinition({ version: 1, ...retargeted.animation }, retargetRig)),
  retargetRig,
);
const retargetJoints = new Map(retargetRig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
const retargetPlayer = new AnimationPlayer(retargetRig, retargetJoints, [compileClip(reloadedRetarget, retargetRig)]);
let retargetEvents = 0;
retargetPlayer.onAnimationEvent(() => retargetEvents++);
retargetPlayer.play('retargeted');
for (const time of [25, 100, 0, 75, 25]) retargetPlayer.sample(time);
assert.equal(retargetJoints.get('tip').pose.x, 26);
assert.ok(Math.abs(retargetJoints.get('tip').pose.rotation - 0.95) < 1e-10);
assert.deepEqual(retargetPlayer.sampleRootMotion(25), { x: 5, y: 0 });
assert.equal(retargetEvents, 0, 'Sampling reloaded motion never delivers animation events.');
retargetPlayer.update(75);
assert.equal(retargetEvents, 1, 'Ordinary standalone playback retains event timing.');
retargetPlayer.dispose();
const mesh = createRectangleMeshAttachment({ id: 'cloth', texture: 'paper' }, { width: 20, height: 10 }, meshRest);
mesh.vertices = mesh.vertices.map((vertex) => ({
  ...vertex,
  influences: [
    { boneId: 'root', weight: 0.25 },
    { boneId: 'tip', weight: 0.75 },
  ],
}));
const meshDocuments = new Map([
  [
    'character.json',
    {
      version: 1,
      id: 'mesh',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['bend.json'],
      textures: { paper: 'paper.png' },
    },
  ],
  ['rig.json', { version: 1, ...meshRest, attachments: [mesh] }],
  ['skin.json', { version: 1, name: 'default', slots: { cloth: 'cloth' } }],
  [
    'bend.json',
    {
      version: 1,
      name: 'bend',
      duration: 1000,
      loop: false,
      tracks: {},
      deformationTracks: {
        cloth: [
          { time: 0, offsets: {} },
          { time: 1000, offsets: { 'top-left': { x: 8, y: -4 } } },
        ],
      },
    },
  ],
]);
const meshCharacter = await CharacterLoader.load('https://mesh.invalid/character.json', (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return Promise.resolve(Response.json(meshDocuments.get(new URL(url).pathname.slice(1))));
});
assert.deepEqual(
  serialization.parseRigDefinition(JSON.parse(serialization.serializeRigDefinition(meshCharacter.rigFile))).attachments,
  [mesh],
);
assert.deepEqual(
  serialization.parseAnimationClip(
    JSON.parse(serialization.serializeAnimationDefinition(meshDocuments.get('bend.json'), meshCharacter.rig)),
    meshCharacter.rig,
  ).deformationTracks,
  meshCharacter.animations[0].deformationTracks,
);
const meshPlayer = new AnimationPlayer(
  meshCharacter.rig,
  new Map(meshCharacter.rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)])),
  meshCharacter.compiledAnimations,
);
const binding = createMeshSkinBinding(mesh, 'cloth');
const matrices = new Map([
  ['root', { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }],
  ['tip', { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 0 }],
]);
meshPlayer.play('bend');
/** @type {number[]} */
const meshOutput = [];
for (const time of [500, 1000, 0, 500]) {
  meshPlayer.sample(time);
  assert.strictEqual(
    deformMesh(binding, (id) => matrices.get(id), meshOutput, meshPlayer.meshDeformation.get('cloth')),
    meshOutput,
  );
  assert.equal(meshOutput[0], -10 + time * 0.008);
  assert.equal(meshOutput[1], -5 - time * 0.004);
}
meshPlayer.sample(0);
deformMesh(binding, (id) => matrices.get(id), meshOutput, meshPlayer.meshDeformation.get('cloth'));
assert.deepEqual(inspectMeshDeformation(mesh, meshOutput), []);
assert.throws(() => inspectMeshDeformation(mesh, []), /buffer size/);
meshPlayer.dispose();
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
// Authored travel survives serialization and works through the actual installed /core entry.
const rootClip = serialization.parseAnimationClip(
  {
    version: 1,
    ...clip,
    rootMotion: {
      translationKeys: [
        { time: 0, x: 10, y: 20 },
        { time: 1000, x: 90, y: -20 },
      ],
    },
  },
  rig,
);
assert.deepEqual(evaluateRootMotionAtElapsedTime(rootClip, 2500, { loop: true }), { x: 200, y: -100 });
assert.deepEqual(getRootMotionDelta(rootClip, 1100, 900, { loop: true }), { x: -16, y: 8 });
const placement = { x: 100, y: 200 };
let origin = { ...placement };
const rootPlayer = new AnimationPlayer(rig, new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)])), [], {
  rootMotion: {
    validate() {},
    begin() {
      origin = { ...placement };
    },
    apply(displacement) {
      // A host transforms canonical offsets once; this example faces left at scale 2.
      placement.x = origin.x - displacement.x * 2;
      placement.y = origin.y + displacement.y * 2;
    },
  },
});
rootPlayer.addAnimation(rootClip);
rootPlayer.play(rootClip.name, { rootMotion: 'apply', loop: true });
rootPlayer.update(2500);
assert.deepEqual(placement, { x: -300, y: 0 });
rootPlayer.sample(100);
assert.deepEqual(placement, { x: -300, y: 0 }, 'Skeletal sampling cannot apply translation twice.');
rootPlayer.stop();
rootPlayer.update(500);
assert.deepEqual(placement, { x: -300, y: 0 });
rootPlayer.dispose();
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
  'Built /core, /serialization and /data work in Node: loading, validation, FK retargeting, mesh round trips/skinning/seeking, async animation, IK, and disposal.',
);
