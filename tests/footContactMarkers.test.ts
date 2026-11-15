import { assert, test, vi } from 'vitest';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { type Affine, composeAffine, localToWorld, transformToAffine } from '../src/engine/affineMath.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import {
  createFootContactMarker,
  getFootContactWorldPosition,
  parseRigDefinition,
  serializeRigDefinition,
  validateRigDefinition,
  type FootContactMarker,
  type RigDefinition,
} from '../src/engine/core.js';
import { IsolatedIKSampler } from '../src/engine/ik/IsolatedIKSampler.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { createTransform } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const marker: FootContactMarker = { id: 'contact', name: 'Sole', boneId: 'tip', localX: 2, localY: 3 };
function definition(): RigDefinition {
  return {
    root: 'base',
    bones: [
      { id: 'base', x: 10, y: 20 },
      { id: 'segment', parent: 'base', y: 10 },
      { id: 'tip', parent: 'segment', y: 10, length: 5 },
    ],
    ik: [{ name: 'reach', rootBone: 'base', middleBone: 'segment', endBone: 'tip', target: { x: 20, y: 30 } }],
  };
}
function file(markers: readonly FootContactMarker[] = [marker]) {
  return { version: 1 as const, ...definition(), footContactMarkers: markers };
}
function near(actual: { x: number; y: number } | undefined, x: number, y: number) {
  assert.isDefined(actual);
  assert.closeTo(actual.x, x, 1e-9);
  assert.closeTo(actual.y, y, 1e-9);
}

test('creation seeds normalized child endpoints, leaf length and origin without changing rig or IK', () => {
  const source = definition();
  source.bones = source.bones.map((bone) => (bone.id === 'segment' ? { ...bone, length: 8 } : bone));
  const before = structuredClone(source);
  let candidate = createFootContactMarker(source, { id: 'one', name: 'Contact 1', boneId: 'segment' });
  candidate = createFootContactMarker(candidate, { id: 'two', name: 'Contact 2', boneId: 'tip' });
  candidate = createFootContactMarker(candidate, {
    id: 'three',
    name: 'Contact 3',
    boneId: 'tip',
    localX: -4,
    localY: 0,
  });
  assert.deepEqual(
    candidate.footContactMarkers?.map(({ localX, localY }) => [localX, localY]),
    [
      [0, 8],
      [0, 5],
      [-4, 0],
    ],
  );
  const origin = createFootContactMarker({ root: 'q', bones: [{ id: 'q' }] }, { id: 'q', name: 'Origin', boneId: 'q' });
  assert.deepEqual(origin.footContactMarkers?.[0], { id: 'q', name: 'Origin', boneId: 'q', localX: 0, localY: 0 });
  assert.deepEqual(source, before);
  assert.deepEqual(candidate.ik, source.ik);
  assert.deepEqual(candidate.bones, source.bones);
  assert.throws(() => createFootContactMarker(candidate, { id: 'one', name: 'Duplicate', boneId: 'tip' }), /Duplicate/);
  assert.throws(
    () => createFootContactMarker(source, { id: 'missing', name: 'Missing', boneId: 'absent' }),
    /Unknown bone/,
  );
});

test.each([
  { ...marker, boneId: 'absent' },
  { ...marker, localX: NaN },
  { ...marker, localY: Infinity },
  { ...marker, localY: '3' },
  { ...marker, localX: null },
  { ...marker, id: '' },
  { ...marker, name: '' },
  { ...marker, unsupported: true },
  { id: 'incomplete' },
])('invalid marker structure or references reject safely: %j', (invalid) => {
  assert.isNotEmpty(validateRigDefinition({ ...file(), footContactMarkers: [invalid] }));
  assert.throws(() => parseRigDefinition({ ...file(), footContactMarkers: [invalid] }));
  assert.throws(() => new Rig({ ...definition(), footContactMarkers: [invalid] } as unknown as RigDefinition));
});

test('duplicate IDs report their exact path; arbitrary multiple markers may share a bone and name', () => {
  const duplicate = file([marker, { ...marker, localY: 9 }]);
  assert.include(
    validateRigDefinition(duplicate).map((issue) => issue.path),
    'footContactMarkers[1].id',
  );
  assert.throws(() => new Rig(duplicate), /Duplicate foot contact marker/);
  const valid = parseRigDefinition(file([marker, { ...marker, id: 'other' }]));
  assert.lengthOf(valid.footContactMarkers!, 2);
  assert.deepEqual(getFootContactWorldPosition(marker, valid, new Map()), { x: 12, y: 43 });
});

test('JSON round trips retain IDs, order, exact coordinates and IK; runtime snapshots own frozen markers', () => {
  const source = file([marker, { ...marker, id: 'second', localX: -0.123456789012345 }]);
  const before = structuredClone(source);
  const rig = parseRigDefinition(source);
  const roundTrip = parseRigDefinition(JSON.parse(serializeRigDefinition(source)) as unknown);
  assert.deepEqual(roundTrip.footContactMarkers, source.footContactMarkers);
  assert.deepEqual(roundTrip.ik, source.ik);
  assert.isTrue(Object.isFrozen(rig.footContactMarkers));
  assert.isTrue(Object.isFrozen(rig.footContactMarkers![0]));
  assert.strictEqual(new Rig(rig).footContactMarkers, rig.footContactMarkers);
  source.footContactMarkers = [];
  assert.deepEqual(rig.footContactMarkers, before.footContactMarkers);
});

test('absent and explicitly empty collections retain their existing version-1 shape', () => {
  for (const source of [{ version: 1 as const, ...definition() }, file([])]) {
    const parsed = parseRigDefinition(source);
    assert.equal(Object.hasOwn(parsed, 'footContactMarkers'), Object.hasOwn(source, 'footContactMarkers'));
    assert.deepEqual(JSON.parse(serializeRigDefinition(source)), source);
    const state = new RigEditorState(parsed, source);
    assert.equal(
      Object.hasOwn(state.exportRig(false), 'footContactMarkers'),
      Object.hasOwn(source, 'footContactMarkers'),
    );
  }
});

test('nested translation, rotation and nonuniform/reflected scale preserve full affine coordinates', () => {
  const rig = new Rig({
    root: 'base',
    bones: [
      { id: 'tip', parent: 'segment', x: 4, y: 5, rotation: Math.PI / 2, scaleX: -2, scaleY: 3 },
      { id: 'base', x: 10, y: 20, rotation: Math.PI / 2, scaleX: 2, scaleY: 3 },
      { id: 'segment', parent: 'base', x: 1, y: 2, rotation: Math.PI / 2, scaleX: 2, scaleY: 1 },
    ],
  });
  // (2,3) -> (-5,1) -> (0,-8) -> (34,20).
  near(getFootContactWorldPosition(marker, rig, new Map()), 34, 20);
  const pose = new Map([['tip', Object.freeze({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })]]);
  near(getFootContactWorldPosition(marker, rig, pose), -8, 16);
  assert.deepEqual(pose.get('tip'), { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
});

test.each(['right', 'left'] as const)(
  'post-IK pure positions match runtime with %s facing and Actor ancestors',
  (facing) => {
    const rig = new Rig(file());
    const puppet = new Puppet(puppetScene(), { rig, x: 50, y: 80, scale: 2, facing, autoUpdate: false });
    // Actor movement uses this outer container; an additional host ancestor may rotate and shear the basis.
    const parent = puppet.container.scene.add.container(100, -40).setRotation(0.4).setScale(3, 2);
    parent.add(puppet.container);
    puppet.container.setRotation(-0.2);
    puppet.posePipeline.syncPose();
    const pose = new Map(rig.bones.map((bone) => [bone.id, Object.freeze({ ...puppet.getBone(bone.id).pose })]));
    const before = structuredClone([...pose]);
    const expected = puppet
      .getBone('tip')
      .container.getWorldTransformMatrix()
      .transformPoint(marker.localX, marker.localY);
    near(
      getFootContactWorldPosition(marker, rig, pose, puppet.container.getWorldTransformMatrix()),
      expected.x,
      expected.y,
    );
    assert.deepEqual([...pose], before);
    assert.deepEqual(puppet.exportRig().footContactMarkers, [marker]);
    puppet.destroy();
  },
);

test('isolated evaluated IK poses use solved rotations and do not mutate sampler output or rig data', () => {
  const rig = new Rig(file());
  const clip = compileClip(
    { name: 'reach', duration: 100, loop: false, tracks: {}, ikTracks: { reach: [{ time: 0, x: 20, y: 30 }] } },
    rig,
  );
  const sample = new IsolatedIKSampler(rig).sample(clip, 0);
  const before = structuredClone([...sample.pose]);
  near(getFootContactWorldPosition({ ...marker, localX: 0, localY: 0 }, rig, sample.pose), 20, 30);
  assert.notDeepEqual(
    getFootContactWorldPosition(marker, rig, sample.pose),
    getFootContactWorldPosition(marker, rig, new Map()),
  );
  assert.deepEqual([...sample.pose], before);
  assert.deepEqual(rig.footContactMarkers, [marker]);
});

test('outer transforms apply facing exactly once and missing bones or overflow produce no position', () => {
  const rig = new Rig(definition());
  const puppet = transformToAffine(createTransform({ x: 30, y: 40, scaleX: -2, scaleY: 2 }), {} as Affine);
  const actor = transformToAffine(createTransform({ x: 100, y: 200, rotation: Math.PI / 2 }), {} as Affine);
  const world = composeAffine(puppet, actor, {} as Affine);
  const expected = localToWorld({ x: 12, y: 43 }, world);
  near(getFootContactWorldPosition(marker, rig, new Map(), world), expected.x, expected.y);
  assert.isUndefined(getFootContactWorldPosition({ ...marker, boneId: 'deleted' }, rig, new Map()));
  assert.isUndefined(getFootContactWorldPosition({ ...marker, localY: Infinity }, rig, new Map()));
  const huge = new Map([['base', { scaleX: Number.MAX_VALUE }]]);
  assert.isUndefined(getFootContactWorldPosition(marker, rig, huge));
  near(getFootContactWorldPosition(marker, rig, new Map([['base', { scaleX: 0 }]])), 10, 43);
});

test('editor exports, recovery and history preserve markers, while referenced bone deletion is refused', () => {
  const source = file();
  const state = new RigEditorState(new Rig(source), source);
  assert.deepEqual(state.exportRig(false).footContactMarkers, [marker]);
  assert.include(state.boneDependencies('tip'), 'foot contact marker "contact"');
  assert.throws(() => state.removeBone('tip'), /foot contact marker/);
  assert.throws(() => state.renameBone('tip', 'renamed'), /foot contact marker/);
  state.createBone('extra', 'base');
  assert.deepEqual(state.recoveryDraft.footContactMarkers, [marker]);
  state.undo();
  assert.deepEqual(state.exportRig(false).footContactMarkers, [marker]);
  state.redo();
  assert.deepEqual(state.exportRig(false).footContactMarkers, [marker]);
  assert.isTrue(state.restoreDraft({ ...state.recoveryDraft, footContactMarkers: [] }));
  assert.deepEqual(state.exportRig(false).footContactMarkers, []);
  state.undo();
  assert.deepEqual(state.exportRig(false).footContactMarkers, [marker]);
});

test('changing contact placement leaves animation keys and evaluated IK behavior identical', () => {
  const source = definition();
  const candidate = createFootContactMarker(source, marker);
  const moved = { ...candidate, footContactMarkers: [{ ...marker, localX: 200, localY: -300 }] };
  const clip = {
    name: 'move',
    duration: 100,
    loop: false,
    tracks: {
      base: [
        { time: 0, x: 10 },
        { time: 100, x: 12 },
      ],
    },
    ikTracks: {
      reach: [
        { time: 0, x: 20, y: 30 },
        { time: 100, x: 23, y: 34 },
      ],
    },
  };
  const before = structuredClone(clip);
  const rigs = [source, candidate, moved].map((entry) => new Rig(entry));
  const samplers = rigs.map((rig) => new IsolatedIKSampler(rig));
  const compiled = rigs.map((rig) => compileClip(clip, rig));
  for (const time of [0, 50, 100]) {
    const samples = samplers.map((sampler, index) => sampler.sample(compiled[index]!, time));
    assert.deepEqual([...samples[1]!.pose], [...samples[0]!.pose]);
    assert.deepEqual([...samples[2]!.pose], [...samples[0]!.pose]);
  }
  assert.deepEqual(clip, before);
  assert.deepEqual(moved.ik, source.ik);
});
