import { assert, expect, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { importAnimationJson, verifyAnimationRoundTrip } from '../src/devtools/animation-editor/animationImport.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import { createAnimationVariation } from '../src/devtools/animation-editor/animationVariation.js';
import { setBonePropertyKeyframes } from '../src/devtools/animation-editor/keyframeEdits.js';
import { mirrorSelectedKeyframes } from '../src/devtools/animation-editor/keyframeMirroring.js';
import { inspectEditorAnimation } from '../src/devtools/animation-editor/validatedAnimation.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { createBoneSymmetryMapping } from '../src/devtools/shared/boneSymmetry.js';
import { buildCharacterPackage, validatePackage } from '../src/devtools/shared/package/characterPackage.js';
import { Actor } from '../src/engine/Actor.js';
import { ownCompiledClip } from '../src/engine/AnimationClip.js';
import {
  type AnimationClip,
  CharacterDefinition,
  compileClip,
  evaluateClip,
  evaluateIKClip,
  evaluateRootMotion,
  parseAnimationClip,
  Rig,
  type RootMotionDefinition,
  sampleRootMotion,
  serializeAnimationDefinition,
  validateAnimationDefinition,
} from '../src/engine/core.js';
import { inspectAnimationDefinition } from '../src/engine/externalData.js';
import { JsonWorkloadBudget } from '../src/engine/jsonWorkloadLimits.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

// Deliberately distinguish bone array order, named root, pelvis and Actor origin.
const rigData = {
  root: 'origin',
  bones: [
    { id: 'pelvis', parent: 'origin', y: 10 },
    { id: 'origin', x: 4 },
    { id: 'knee', parent: 'pelvis', x: 10 },
    { id: 'foot', parent: 'knee', x: 10 },
  ],
  ik: [{ name: 'leg', rootBone: 'pelvis', middleBone: 'knee', endBone: 'foot' }],
};
const rig = new Rig(rigData);
const ease = { mode: 'bezier', control1: { x: 0, y: 0 }, control2: { x: 0, y: 1 } } as const;
const zero = { x: 0, y: 0 };

function animation(rootMotion?: RootMotionDefinition): AnimationClip {
  return {
    name: 'step',
    duration: 1000,
    loop: false,
    tracks: {
      origin: [
        { time: 0, x: 4 },
        { time: 1000, x: 8 },
      ],
      pelvis: [
        { time: 0, y: 10 },
        { time: 1000, y: 20 },
      ],
    },
    ikTracks: {
      leg: [
        { time: 0, x: 15, y: 5, mix: 0.5 },
        { time: 1000, x: 10, y: 10, mix: 1 },
      ],
    },
    ...(rootMotion ? { rootMotion } : {}),
  };
}

const motion: RootMotionDefinition = {
  translationKeys: [
    { time: 0, x: 10, y: 20, curves: { x: ease, y: { mode: 'stepped' } } },
    { time: 500, y: -80 },
    { time: 1000, x: 110, y: 20 },
  ],
};

test.each([undefined, { translationKeys: [] }])('absent and empty tracks stay optional (%j)', (rootMotion) => {
  const source = animation(rootMotion);
  const loaded = parseAnimationClip({ version: 1, ...source }, rig);
  const compiled = compileClip(loaded, rig);
  for (const time of [-1, 0, 250, 1000, 2000]) {
    assert.deepEqual(sampleRootMotion(compiled, time), zero);
    assert.deepEqual(evaluateRootMotion(compiled, time), zero);
  }
  assert.deepEqual(loaded, source);
  assert.equal(Object.hasOwn(compiled, 'rootMotion'), rootMotion !== undefined);
});

test('a single late key holds its raw offset but contributes no start-normalized travel', () => {
  const clip = compileClip(animation({ translationKeys: [{ time: 400, x: -45, y: 70 }] }), rig);
  for (const time of [-1, 0, 100, 400, 800, 1000, 2000]) {
    assert.deepEqual(sampleRootMotion(clip, time), { x: -45, y: 70 });
    assert.deepEqual(evaluateRootMotion(clip, time), zero);
  }
});

test.each([
  { name: 'forward/down', end: { x: 90, y: 40 } },
  { name: 'backward/up', end: { x: -90, y: -40 } },
  { name: 'stationary', end: zero },
])('$name interpolates independently from skeletal keys', ({ end }) => {
  const clip = compileClip(
    animation({
      translationKeys: [
        { time: 0, ...zero },
        { time: 900, ...end },
      ],
    }),
    rig,
  );
  assert.deepEqual(evaluateRootMotion(clip, 450), { x: end.x / 2, y: end.y / 2 });
  assert.deepEqual(evaluateRootMotion(clip, 1000), end);
});

test('several sparse keys reuse outgoing curves and each channel has independent timing', () => {
  const clip = compileClip(animation(motion), rig);
  assert.deepEqual(sampleRootMotion(clip, 0), { x: 10, y: 20 });
  const at125 = evaluateRootMotion(clip, 125);
  assert.closeTo(at125.x, 50, 1e-10); // Bézier x(t)=t^3, y(t)=3t^2-2t^3 at t=.5
  assert.equal(at125.y, 0);
  assert.closeTo(evaluateRootMotion(clip, 500).x, 88.988157484231, 1e-10);
  assert.equal(evaluateRootMotion(clip, 500).y, -100);
  assert.deepEqual(evaluateRootMotion(clip, 1000), { x: 100, y: 0 });
  for (const time of [800, 0, 500, 1000, 50]) {
    evaluateRootMotion(clip, time);
    assert.deepEqual(evaluateRootMotion(clip, 125), at125);
  }
});

test('looping is a caller clock policy; exact end, clamping and return motion stay explicit', () => {
  const source = animation({
    translationKeys: [
      { time: 100, x: 30 },
      { time: 500, x: 90 },
      { time: 900, x: -10 },
    ],
  });
  for (const loop of [false, true]) {
    const clip = compileClip({ ...source, loop }, rig);
    assert.deepEqual(evaluateRootMotion(clip, -100), zero);
    assert.deepEqual(evaluateRootMotion(clip, 500), { x: 60, y: 0 });
    assert.deepEqual(evaluateRootMotion(clip, 1000), { x: -40, y: 0 });
    assert.deepEqual(evaluateRootMotion(clip, 2000), { x: -40, y: 0 });
    assert.deepEqual(evaluateRootMotion(clip, 2000 % clip.duration), zero);
  }
});

test('unkeyed channels are zero and constant/return tracks have zero net displacement', () => {
  for (const translationKeys of [
    [
      { time: 0, y: -20 },
      { time: 1000, y: -20 },
    ],
    [
      { time: 0, y: 10 },
      { time: 400, y: -80 },
      { time: 1000, y: 10 },
    ],
  ]) {
    const clip = compileClip(animation({ translationKeys }), rig);
    assert.deepEqual(evaluateRootMotion(clip, 1000), zero);
    assert.equal(sampleRootMotion(clip, 400).x, 0);
  }
});

const invalidMotion: unknown[] = [
  null,
  [],
  {},
  { translationKeys: null },
  { translationKeys: {} },
  { translationKeys: [], rotation: 0 },
  { translationKeys: [null] },
  { translationKeys: [{}] },
  { translationKeys: [{ time: 0 }] },
  { translationKeys: [{ time: 0, x: 1, id: 'unsupported' }] },
  { translationKeys: [{ time: 0, rotation: 1 }] },
  { translationKeys: [{ time: 0, scaleX: 1 }] },
  { translationKeys: [{ time: '0', x: 1 }] },
  { translationKeys: [{ time: -1, x: 1 }] },
  { translationKeys: [{ time: 1001, x: 1 }] },
  {
    translationKeys: [
      { time: 1, x: 1 },
      { time: 0, y: 2 },
    ],
  },
  {
    translationKeys: [
      { time: 0, x: 1 },
      { time: 0, y: 2 },
    ],
  },
  { translationKeys: [{ time: 0, x: 1, curves: { y: ease } }] },
  { translationKeys: [{ time: 0, x: 1, curves: { rotation: ease } }] },
  { translationKeys: [{ time: 0, x: 1, curves: { x: { mode: 'unsupported' } } }] },
  { translationKeys: [{ time: 0, x: 1, curves: { x: { mode: 'linear', control1: { x: 0, y: 0 } } } }] },
  {
    translationKeys: [
      { time: 0, x: 1, curves: { x: { ...ease, control1: { x: 0.9, y: 0 }, control2: { x: 0.1, y: 1 } } } },
    ],
  },
  { translationKeys: [{ time: 0, x: 1, curves: { x: { ...ease, control1: { x: 0, y: -1 } } } }] },
  ...[NaN, Infinity, -Infinity].flatMap((value) => [
    { translationKeys: [{ time: value, x: 1 }] },
    { translationKeys: [{ time: 0, x: value }] },
    { translationKeys: [{ time: 0, y: value }] },
    { translationKeys: [{ time: 0, x: 1, curves: { x: { ...ease, control2: { x: 1, y: value } } } }] },
  ]),
];
test.each(invalidMotion.map((rootMotion) => ({ rootMotion })))(
  'rejects invalid authored and external compiled data (%j)',
  ({ rootMotion }) => {
    const input = { ...animation(), rootMotion };
    assert.isNotEmpty(validateAnimationDefinition({ version: 1, ...input }, rig));
    assert.isUndefined(inspectAnimationDefinition({ version: 1, ...input }).data);
    assert.throws(() => parseAnimationClip({ version: 1, ...input }, rig));
    assert.throws(() => compileClip(input as never, rig));
    assert.throws(() => ownCompiledClip({ ...compileClip(animation(), rig), rootMotion } as never));
  },
);

test('nonfinite sample times and unrepresentable normalized displacement reject explicitly', () => {
  const clip = compileClip(animation(motion), rig);
  for (const time of [NaN, Infinity, -Infinity]) {
    assert.throws(() => sampleRootMotion(clip, time), /finite/);
    assert.throws(() => evaluateRootMotion(clip, time), /finite/);
  }
  const extreme = compileClip(
    animation({
      translationKeys: [
        { time: 0, x: -Number.MAX_VALUE },
        { time: 1000, x: Number.MAX_VALUE },
      ],
    }),
    rig,
  );
  assert.equal(sampleRootMotion(extreme, 500).x, 0);
  assert.throws(() => evaluateRootMotion(extreme, 1000), /finite/);
});

test('compiled ownership isolates deeply nested controls and mutable input is never cached', () => {
  const source = animation(structuredClone(motion));
  const compiled = compileClip(source, rig);
  const external = { ...compiled, rootMotion: structuredClone(motion) };
  const owned = ownCompiledClip(external);
  const raw = external.rootMotion.translationKeys[0]!;
  const curve = raw.curves!.x!;
  if (curve.mode !== 'bezier') throw new Error('Expected Bézier');
  Object.assign(curve.control1, { x: 1 });
  assert.isFalse(Object.isFrozen(curve.control1));
  assert.isTrue(Object.isFrozen(owned.rootMotion!.translationKeys));
  assert.isTrue(Object.isFrozen(owned.rootMotion!.translationKeys[0]!.curves!.x));
  assert.closeTo(evaluateRootMotion(owned, 125).x, 50, 1e-10);
  const mutable = {
    duration: 1000,
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
  };
  assert.equal(evaluateRootMotion(mutable, 500).x, 50);
  mutable.rootMotion.translationKeys[1]!.x = -100;
  assert.equal(evaluateRootMotion(mutable, 500).x, -50);
});

test('version-1 JSON export preserves root, pelvis and IK data deterministically', () => {
  const source = animation(motion);
  const file = { version: 1, ...source };
  assert.deepEqual(parseAnimationClip(JSON.parse(serializeAnimationDefinition(file, rig)), rig), source);
  const exported = serializeAnimation(file, rig);
  assert.isTrue(exported.success);
  if (!exported.success) throw new Error('Export failed');
  assert.deepEqual(parseAnimationClip(JSON.parse(exported.json), rig), source);
  assert.equal(serializeAnimationDefinition(file, rig), serializeAnimationDefinition({ ...source, version: 1 }, rig));
  const roundTrip = verifyAnimationRoundTrip(file, rig);
  assert.isTrue(roundTrip.success);
  if (!roundTrip.success) throw new Error('Round trip failed');
  assert.isTrue(roundTrip.equivalent);
  assert.deepEqual(roundTrip.data.rootMotion, motion);
  const imported = importAnimationJson(exported.json, rig);
  assert.isTrue(imported.success);
  if (!imported.success) throw new Error('Import failed');
  assert.deepEqual(imported.data.tracks, source.tracks);
  assert.deepEqual(imported.data.ikTracks, source.ikTracks);
});

test('editor serialization retains distinct close root-key times and canonical curve order', () => {
  const source = animation({
    translationKeys: [
      { time: 0.1, x: 10, y: 20, curves: { y: ease, x: { mode: 'linear' } } },
      { time: 0.10000000000000002, x: 20 },
    ],
  });
  const result = serializeAnimation({ version: 1, ...source }, rig);
  assert.isTrue(result.success);
  if (!result.success) throw new Error('Export failed');
  assert.deepEqual(result.data.rootMotion, source.rootMotion);
  assert.deepEqual(Object.keys(result.data.rootMotion!.translationKeys[0]!.curves!), ['x', 'y']);
  assert.deepEqual(serializeAnimation(result.data, rig), result);
});

test('whole-clip variations scale root times; unrelated edits and history preserve root motion', () => {
  const source = inspectEditorAnimation({ version: 1, ...animation(motion) }, rig).data!;
  const variation = createAnimationVariation(source, rig, { name: 'slower', timeScale: 2 });
  assert.equal(variation.duration, 2000);
  assert.deepEqual(
    variation.rootMotion!.translationKeys.map((key) => key.time),
    [0, 1000, 2000],
  );
  assert.deepEqual(evaluateRootMotion(variation, 250), evaluateRootMotion(source, 125));
  assert.notStrictEqual(variation.rootMotion, source.rootMotion);
  const edited = setBonePropertyKeyframes(source, rig, [{ boneId: 'pelvis', property: 'y', timeMs: 0, value: 42 }]);
  assert.deepEqual(edited.rootMotion, motion);
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation(source.name);
  assert.isTrue(state.setBonePropertyKeyframe('pelvis', 'y', 42, 0));
  assert.isTrue(state.undo());
  assert.deepEqual(state.workingAnimation!.rootMotion, motion);
  assert.isTrue(state.redo());
  assert.deepEqual(state.packageAnimations()[0]!.rootMotion, motion);
});

test.each(['left', 'right'] as const)(
  'bone mirroring and %s facing leave root motion separate from runtime placement',
  (facing) => {
    const mirrorRig = new Rig({
      root: 'root',
      bones: [{ id: 'root' }, { id: 'left', parent: 'root' }, { id: 'right', parent: 'root' }],
    });
    const mapping = createBoneSymmetryMapping(mirrorRig, {
      automaticCandidates: [{ leftBoneId: 'left', rightBoneId: 'right' }],
    }).mapping!;
    const mirrored = mirrorSelectedKeyframes(
      { ...animation(motion), tracks: { left: [{ time: 0, x: 10 }] }, ikTracks: {} },
      mirrorRig,
      mapping,
      [{ boneId: 'left', property: 'x', timeMs: 0 }],
      'left-to-right',
    ).animation;
    assert.deepEqual(mirrored.rootMotion, motion);
    const withMotion = compileClip(animation(motion), rig);
    const legacy = compileClip(animation(), rig);
    const puppet = new Puppet(puppetScene(), {
      rig,
      animations: [animation(motion)],
      x: 123,
      y: 456,
      scale: 2,
      facing,
      autoUpdate: false,
    });
    const actor = new Actor({ id: 'hero', puppet });
    try {
      actor.play('step');
      for (const time of [0, 125, 500, 1000, 200]) {
        assert.deepEqual(evaluateClip(withMotion, time), evaluateClip(legacy, time));
        assert.deepEqual([...evaluateIKClip(withMotion, time)], [...evaluateIKClip(legacy, time)]);
        puppet.posePipeline.player.sample(time);
        assert.deepEqual(actor.position, { x: 123, y: 456 });
        assert.deepEqual(actor.worldPosition, { x: 123, y: 456 });
        assert.equal(puppet.container.scaleX, facing === 'left' ? -2 : 2);
      }
      puppet.update(250);
      assert.deepEqual(actor.position, { x: 123, y: 456 });
    } finally {
      actor.dispose();
      puppet.destroy();
    }
  },
);

test('external workload limits count root, bone and IK rows cumulatively across clips', () => {
  const budget = new JsonWorkloadBudget({ maxKeyframes: 10 });
  budget.checkAnimation(animation(motion)); // 4 bone + 2 IK + 3 root = 9
  assert.throws(() => budget.checkAnimation({ rootMotion: { translationKeys: [{}, {}] } }), /10-keyframe/);
  const imported = importAnimationJson(JSON.stringify({ version: 1, ...animation(motion) }), rig, { maxKeyframes: 8 });
  assert.isFalse(imported.success);
});

test('character ZIPs and project archives retain root motion, skeleton and IK independently', async () => {
  const clip = animation(motion);
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['step.json'],
      textures: {},
    },
    rig: { version: 1, ...rigData },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    animations: { 'step.json': { version: 1, ...clip } },
  });
  const snapshot = {
    definition,
    rig: definition.rigFile!,
    skins: definition.standaloneSkins,
    animations: definition.animations,
    replacements: [],
  };
  const before = structuredClone(clip);
  const files = await buildCharacterPackage(snapshot);
  const restored = await validatePackage(decodePackageZip(encodePackageZip(files)));
  assert.deepEqual(restored.animations[0], clip);
  const project = new ProjectWorkspace('Root motion');
  await project.addCharacter(files);
  const exported = await buildProjectPackage(project);
  const reloaded = await importProjectPackage(decodePackageZip(encodePackageZip(exported.files)));
  assert.deepEqual(reloaded.captureCharacter('hero').animations[0], clip);
  const again = await buildProjectPackage(reloaded);
  assert.deepEqual(again.files, exported.files);
  assert.deepEqual(clip, before);
  const bad = new Map(files);
  bad.set(
    'step.json',
    new TextEncoder().encode(
      JSON.stringify({ version: 1, ...clip, rootMotion: { translationKeys: [{ time: 1001, x: 10 }] } }),
    ),
  );
  await expect(validatePackage(bad)).rejects.toThrow(/rootMotion/);
});
