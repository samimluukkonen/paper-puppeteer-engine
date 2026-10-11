import { describe, expect, test, vi } from 'vitest';
import { importAnimationJson, verifyAnimationRoundTrip } from '../src/devtools/animation-editor/animationImport.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import { setBonePropertyKeyframe } from '../src/devtools/animation-editor/keyframeEdits.js';
import { inspectEditorAnimation } from '../src/devtools/animation-editor/validatedAnimation.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { draftSource } from '../src/devtools/shared/draftSource.js';
import { localToWorld, worldToLocal } from '../src/engine/affineMath.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import {
  AnimationValidationError,
  parseAnimationClip,
  parseRigDefinition,
  validateAnimationDefinition,
  validateRigDefinition,
  type AnimationJsonDefinition,
  type RigJsonDefinition,
} from '../src/engine/externalData.js';
import {
  createIKAnimationTrack,
  findIKPropertyKeyframe,
  getIKKeyedPropertiesAtTime,
  getIKPropertyKeyframes,
  moveIKPropertyKeyframe,
  removeIKPropertyKeyframe,
  setIKPropertyKeyframe,
} from '../src/engine/ik/animationKeyframes.js';
import { KEYFRAME_TIME_TOLERANCE_MS } from '../src/engine/keyframeAuthoring.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rigFile = (): RigJsonDefinition => ({
  version: 1,
  root: 'root',
  bones: [{ id: 'root' }, { id: 'middle', parent: 'root', x: 10 }, { id: 'end', parent: 'middle', x: 10 }],
  ik: [{ name: 'arm', rootBone: 'root', middleBone: 'middle', endBone: 'end', mix: 0.5 }],
});
const rig = parseRigDefinition(rigFile());
const animation = (): AnimationJsonDefinition => ({
  version: 1,
  name: 'reach',
  duration: 1000,
  loop: false,
  interpolation: 'linear',
  playback: { mode: 'stepped', fps: 12 },
  tracks: {
    root: [
      { time: 0, rotation: 0 },
      { time: 1000, rotation: 0.2 },
    ],
  },
});

test('creates IK placeholders and sorted sparse x/y/mix channels without default positions', () => {
  const source = animation();
  let working = createIKAnimationTrack(source, rig, 'arm');
  expect(working.ikTracks).toEqual({ arm: [] });
  expect(createIKAnimationTrack(working, rig, 'arm')).toBe(working);
  expect(getIKPropertyKeyframes(working, rig, 'arm', 'x')).toEqual([]);
  working = setIKPropertyKeyframe(working, rig, 'arm', 'x', 700, -14);
  working = setIKPropertyKeyframe(working, rig, 'arm', 'y', 200, 21);
  working = setIKPropertyKeyframe(working, rig, 'arm', 'mix', 200, 1);
  expect(working.ikTracks).toEqual({
    arm: [
      { time: 200, y: 21, mix: 1 },
      { time: 700, x: -14 },
    ],
  });
  expect(getIKPropertyKeyframes(working, rig, 'arm', 'mix')).toEqual([{ time: 200, value: 1 }]);
  expect(getIKKeyedPropertiesAtTime(working, rig, 'arm', 200)).toEqual(['y', 'mix']);
  expect(source.ikTracks).toBeUndefined();
});

test('updates with shared tolerance, deletes only a channel and drops final empty tracks', () => {
  const near = KEYFRAME_TIME_TOLERANCE_MS / 2;
  let working = setIKPropertyKeyframe(animation(), rig, 'arm', 'x', 200, 2);
  working = setIKPropertyKeyframe(working, rig, 'arm', 'y', 200 + near, 4);
  working = setIKPropertyKeyframe(working, rig, 'arm', 'x', 200 + near, 9);
  expect(working.ikTracks?.arm).toEqual([{ time: 200, x: 9, y: 4 }]);
  expect(findIKPropertyKeyframe(working, rig, 'arm', 'x', 200 + near)).toEqual({ time: 200, value: 9 });
  expect(findIKPropertyKeyframe(working, rig, 'arm', 'x', NaN)).toBeUndefined();
  expect(setIKPropertyKeyframe(working, rig, 'arm', 'x', 200, 9)).toBe(working);
  working = removeIKPropertyKeyframe(working, rig, 'arm', 'x', 200);
  expect(working.ikTracks?.arm).toEqual([{ time: 200, y: 4 }]);
  expect(removeIKPropertyKeyframe(working, rig, 'arm', 'x', 200)).toBe(working);
  expect(removeIKPropertyKeyframe(working, rig, 'arm', 'y', 200).ikTracks).toEqual({});
});

test('moves replace destination channel collisions, retain siblings and clamp time like bone keys', () => {
  const source = {
    ...animation(),
    ikTracks: {
      arm: [
        { time: 100, x: 1, y: 3 },
        { time: 300, x: 5, mix: 0 },
        { time: 300 + KEYFRAME_TIME_TOLERANCE_MS / 2, x: 7, y: 8 },
      ],
    },
  };
  const moved = moveIKPropertyKeyframe(source, rig, 'arm', 'x', 100, 300);
  expect(moved.ikTracks.arm).toEqual([
    { time: 100, y: 3 },
    { time: 300, x: 1, mix: 0 },
    { time: 300 + KEYFRAME_TIME_TOLERANCE_MS / 2, y: 8 },
  ]);
  const clamped = moveIKPropertyKeyframe(moved, rig, 'arm', 'x', 300, 2000);
  expect(findIKPropertyKeyframe(clamped, rig, 'arm', 'x', 1000)?.value).toBe(1);
  expect(moveIKPropertyKeyframe(moved, rig, 'arm', 'x', 500, 800)).toBe(moved);
  expect(source.ikTracks.arm[0]?.x).toBe(1);
});

describe('structured authored validation', () => {
  test.each([
    [{ time: -1, x: 0 }, '[0].time'],
    [{ time: 1001, x: 0 }, '[0].time'],
    [{ time: NaN, x: 0 }, '[0].time'],
    [{ time: Infinity, x: 0 }, '[0].time'],
    [{ time: 0, x: NaN }, '[0].x'],
    [{ time: 0, y: Infinity }, '[0].y'],
    [{ time: 0, mix: -0.1 }, '[0].mix'],
    [{ time: 0, mix: 1.1 }, '[0].mix'],
    [{ time: 0, mix: NaN }, '[0].mix'],
    [{ time: 0 }, '[0]'],
    [{ time: 0, x: 1, rotation: 3 }, '[0].rotation'],
  ])('rejects invalid row %j', (key, suffix) => {
    const file = { ...animation(), ikTracks: { arm: [key] } };
    expect(validateAnimationDefinition(file, rig).some((issue) => issue.path === `ikTracks.arm${suffix}`)).toBe(true);
    expect(() => parseAnimationClip(file, rig)).toThrow(AnimationValidationError);
  });
  test('rejects duplicate/descending times without sorting and validates even empty constraint references', () => {
    for (const times of [
      [300, 300],
      [300, 100],
    ]) {
      expect(
        validateAnimationDefinition({ ...animation(), ikTracks: { arm: times.map((time) => ({ time, x: 1 })) } }, rig),
      ).toEqual([expect.objectContaining({ path: 'ikTracks.arm[1].time' })]);
    }
    expect(validateAnimationDefinition({ ...animation(), ikTracks: { missing: [] } }, rig)).toEqual([
      expect.objectContaining({ path: 'ikTracks.missing' }),
    ]);
    const noIK = new Rig({ root: 'root', bones: rig.bones });
    expect(validateAnimationDefinition({ ...animation(), ikTracks: { arm: [] } }, noIK)).toHaveLength(1);
    expect(validateAnimationDefinition({ ...animation(), ikTracks: { arm: [] } }, rig)).toEqual([]);
  });
  test('rejects invalid edits and references before modifying the source', () => {
    const source = animation();
    for (const value of [-0.1, 1.1, Infinity, NaN])
      expect(() => setIKPropertyKeyframe(source, rig, 'arm', 'mix', 0, value)).toThrow(AnimationValidationError);
    for (const time of [-1, 1001, Infinity, NaN])
      expect(() => setIKPropertyKeyframe(source, rig, 'arm', 'x', time, 1)).toThrow();
    expect(() => createIKAnimationTrack(source, rig, 'missing')).toThrow(AnimationValidationError);
    expect(() => getIKPropertyKeyframes(source, rig, 'missing', 'mix')).toThrow(AnimationValidationError);
    expect(() => moveIKPropertyKeyframe(source, rig, 'arm', 'x', 0, Infinity)).toThrow();
    expect(source).toEqual(animation());
  });
  test('rig constraint names are unique, stable strings and chains must be connected', () => {
    const file = rigFile();
    expect(validateRigDefinition({ ...file, ik: [...file.ik!, ...file.ik!] })).toEqual([
      expect.objectContaining({ path: 'ik[1].name' }),
    ]);
    expect(validateRigDefinition({ ...file, ik: [{ ...file.ik![0], endBone: 'missing' }] })[0]?.path).toBe(
      'ik[0].endBone',
    );
    expect(
      validateRigDefinition({ ...file, ik: [{ ...file.ik![0], middleBone: 'end', endBone: 'middle' }] })[0]?.path,
    ).toBe('ik[0]');
    expect(validateRigDefinition({ ...file, ik: [{ ...file.ik![0], name: '' }] })[0]?.path).toBe('ik[0].name');
  });
});

test('exports/imports every channel, interpolation metadata and close distinct times deterministically', () => {
  const source = {
    ...animation(),
    ikTracks: {
      arm: [
        { time: 0, x: -3, mix: 0 },
        { time: 200, y: 5, mix: 1 },
        { time: 200 + 1e-10, x: 10 },
        { time: 1000, mix: 0 },
      ],
    },
  };
  const output = serializeAnimation(source, rig);
  expect(output.success).toBe(true);
  if (!output.success) return;
  expect(output.data.ikTracks).toEqual(source.ikTracks);
  const imported = importAnimationJson(output.json, rig);
  expect(imported.success).toBe(true);
  if (!imported.success) return;
  expect(imported.data.ikTracks).toEqual(source.ikTracks);
  expect(imported.data.playback).toEqual(source.playback);
  expect(imported.data.interpolation).toBe('linear');
  expect(verifyAnimationRoundTrip(source, rig)).toMatchObject({ success: true, equivalent: true });
});

test('mutable and frozen source animations, rigs and bind poses remain independent of authored edits and queries', () => {
  const file = rigFile();
  const ownedRig = parseRigDefinition(file);
  const source = setIKPropertyKeyframe(animation(), ownedRig, 'arm', 'x', 0, 3);
  const baseline = structuredClone(source);
  const next = setIKPropertyKeyframe(source, ownedRig, 'arm', 'mix', 0, 1);
  expect(source).toEqual(baseline);
  expect(Object.isFrozen(source)).toBe(false);
  const queried = getIKPropertyKeyframes(next, ownedRig, 'arm', 'mix');
  queried[0] = { time: 0, value: -10 };
  expect(next.ikTracks?.arm?.[0]?.mix).toBe(1);
  const frozen = inspectEditorAnimation(next, ownedRig).data!;
  const edited = setIKPropertyKeyframe(frozen, ownedRig, 'arm', 'x', 100, 10);
  expect(frozen.ikTracks?.arm).toHaveLength(1);
  expect(edited.ikTracks?.arm).toHaveLength(2);
  expect(ownedRig.ik).toEqual(file.ik);
  expect(Object.isFrozen(file.ik)).toBe(false);
  expect(ownedRig.getBone('middle').x).toBe(10);
  expect(new Rig(ownedRig).ik).toBe(ownedRig.ik);
  // A bone edit uses the existing optimized immutable validator and retains IK data.
  expect(setBonePropertyKeyframe(frozen, ownedRig, 'root', 'y', 300, 8).ikTracks).toBe(frozen.ikTracks);
});

test('puppet-local target data survives placement, facing and scaling through existing affine utilities', () => {
  const source = setIKPropertyKeyframe(
    setIKPropertyKeyframe(animation(), rig, 'arm', 'x', 0, 10),
    rig,
    'arm',
    'y',
    0,
    5,
  );
  const local = { x: source.ikTracks!.arm![0]!.x!, y: source.ikTracks!.arm![0]!.y! };
  for (const scaleX of [2, -2]) {
    const matrix = { a: scaleX, b: 0, c: 0, d: 3, tx: 100, ty: 200 };
    const world = localToWorld(local, matrix);
    expect(world).toEqual({ x: 100 + scaleX * 10, y: 215 });
    expect(worldToLocal(world, matrix)).toEqual(local);
  }
  expect(source.ikTracks?.arm).toEqual([{ time: 0, x: 10, y: 5 }]);
});

test('old format-1 files omit IK entirely and runtime evaluation continues to sample only bone tracks', () => {
  const old = animation();
  expect(parseAnimationClip(old, rig).ikTracks).toBeUndefined();
  const output = serializeAnimation(old, rig);
  expect(output.success && Object.hasOwn(output.data, 'ikTracks')).toBe(false);
  const future = { ...old, ikTracks: { arm: [{ time: 0, x: 900, mix: 0 }] } };
  expect(evaluateClip(compileClip(future, rig), 500)).toEqual(evaluateClip(compileClip(old, rig), 500));
  const noIK = parseRigDefinition({ version: 1, root: 'root', bones: [{ id: 'root' }] });
  expect(Object.hasOwn(noIK, 'ik')).toBe(false);
});

test('rig editor export, recovery identity and Puppet registration retain loaded IK definitions', () => {
  const editor = new RigEditorState(rig, rigFile());
  expect(editor.recoveryDraft.ik).toEqual(rigFile().ik);
  expect(editor.exportRig().ik).toEqual(rigFile().ik);
  const different = new Rig({ ...rigFile(), ik: [{ ...rigFile().ik![0]!, name: 'other' }] });
  expect(draftSource({ rig, animation: animation() })).not.toBe(
    draftSource({ rig: different, animation: animation() }),
  );
  const puppet = new Puppet(puppetScene(), { rig });
  expect(puppet.getIK('arm').mix).toBe(0.5);
  expect(puppet.getIK('arm').target).toBeUndefined();
  puppet.destroy();
});
