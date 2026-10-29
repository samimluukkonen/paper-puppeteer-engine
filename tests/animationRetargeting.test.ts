import { describe, expect, test } from 'vitest';
import { composeAffine, transformToAffine, type Affine } from '../src/engine/affineMath.js';
import { compileClip, type AnimationClip } from '../src/engine/AnimationClip.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import { retargetAnimation, type RetargetInput, type RetargetOptions } from '../src/engine/animationRetargeting.js';
import { serializeAnimationDefinition } from '../src/engine/authoredSerialization.js';
import { parseAnimationClip } from '../src/engine/externalData.js';
import { evaluateIKClip } from '../src/engine/ik/AnimationIKPose.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { freezeData } from '../src/engine/readonlyData.js';
import { Rig } from '../src/engine/Rig.js';
import { createRigBoneMapping, type IdentifiedRig } from '../src/engine/rigBoneMapping.js';
import { evaluateRootMotion } from '../src/engine/rootMotion.js';
import { createTransform, type JointTransform, type RigDefinition } from '../src/engine/types.js';

const bezier = { mode: 'bezier', control1: { x: 0.15, y: 0.05 }, control2: { x: 0.65, y: 0.9 } } as const;
const fixture = (id = 'source', factor = 1, renamed = false): IdentifiedRig => ({
  id,
  rig: {
    root: renamed ? 'base' : 'root',
    bones: [
      { id: renamed ? 'base' : 'root', x: 3, y: -2, rotation: 0.1 },
      { id: renamed ? 'hips' : 'pelvis', parent: renamed ? 'base' : 'root', y: 10 * factor, rotation: 0.2 },
      { id: renamed ? 'upper' : 'arm', parent: renamed ? 'hips' : 'pelvis', x: 12 * factor, rotation: 0.3 },
      { id: renamed ? 'tip' : 'hand', parent: renamed ? 'upper' : 'arm', x: 8 * factor },
    ],
  },
});
const clip = (): AnimationClip => ({
  name: 'cut',
  duration: 1000,
  loop: true,
  interpolation: 'linear',
  library: { displayName: 'Sword cut', description: 'Authored motion', tags: ['combat'] },
  playback: { mode: 'stepped', fps: 12 },
  tracks: {
    root: [
      { time: 0, x: 3 },
      { time: 1000, x: 13 },
    ],
    pelvis: [
      { time: 0, y: 10 },
      { time: 1000, y: 12 },
    ],
    arm: [
      {
        time: 0,
        x: 12,
        rotation: 0.3,
        scaleX: 1,
        curves: { x: bezier, rotation: bezier, scaleX: { mode: 'stepped' } },
      },
      { time: 800, x: 15, rotation: 1.3, scaleX: 1.4 },
      { time: 1000, y: 2, curves: { y: bezier } },
    ],
  },
  rootMotion: {
    translationKeys: [
      { time: 0, x: 5, curves: { x: bezier } },
      { time: 1000, x: 25 },
    ],
  },
  events: [{ time: 500, name: 'cut', data: { bone: 'arm', nested: { ids: ['source'] } } }],
});
const options: RetargetOptions = { name: 'target-cut', rootMotion: 'preserve' };
function input(
  source = fixture(),
  target = fixture('target'),
  animation = clip(),
  overrides: Partial<RetargetOptions> = {},
): RetargetInput {
  return {
    sourceRig: source,
    targetRig: target,
    sourceAnimation: animation,
    boneMapping: createRigBoneMapping(
      source,
      target,
      source.rig.bones.slice(0, target.rig.bones.length).map((bone, index) => ({
        sourceBoneId: bone.id,
        targetBoneId: target.rig.bones[index]!.id,
      })),
      'map',
      'Correspondence',
    ),
    options: { ...options, ...overrides },
  };
}
function success(request: RetargetInput): AnimationClip {
  const result = retargetAnimation(request);
  expect(result.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
  expect(result.animation).not.toBeNull();
  return result.animation!;
}
function sample(animation: AnimationClip, rig: IdentifiedRig, time: number, id: string) {
  return evaluateClip(compileClip(animation, new Rig(rig.rig)), time).get(id)!;
}
function worldPose(rig: RigDefinition, poses: Map<string, Partial<JointTransform>>, facing = 1): Map<string, Affine> {
  const matrices = new Map<string, Affine>();
  const empty = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  const actor = { ...empty(), a: facing };
  for (const bone of new Rig(rig).bones) {
    const local = transformToAffine({ ...createTransform(bone), ...poses.get(bone.id) }, empty());
    matrices.set(bone.id, composeAffine(local, bone.parent ? matrices.get(bone.parent) : actor, empty()));
  }
  return matrices;
}

test('identical effective rigs preserve authored values exactly and return independent editable data', () => {
  const request = freezeData(input());
  const before = JSON.stringify(request);
  const result = retargetAnimation(request);
  const originalResult = structuredClone(result);
  expect(result.animation).toEqual({ ...clip(), name: options.name });
  expect(result.skippedTracks).toEqual([]);
  expect(result.compatibilityWarnings).toEqual([]);
  expect(result.diagnostics.map(({ code }) => code)).toEqual(['event-payload-unmapped']);
  const animation = result.animation!;
  expect(Object.isFrozen(animation)).toBe(false);
  animation.tracks.arm![0]!.rotation = 2;
  (animation.tracks.arm![0]!.curves!.x as { control1: { x: number } }).control1.x = 0.3;
  (animation.library!.tags as string[]).push('edited');
  (animation.events![0]!.data as { nested: { ids: string[] } }).nested.ids.push('edited');
  Object.assign(animation.rootMotion!.translationKeys[0]!, { x: 100 });
  expect(JSON.stringify(request)).toBe(before);
  expect(retargetAnimation(request)).toEqual(originalResult);
});

test('explicitly mapped different IDs, orientations and proportions use rest-relative local transforms', () => {
  const source = fixture(),
    base = fixture('target', 2, true);
  const target = {
    ...base,
    rig: {
      ...base.rig,
      bones: base.rig.bones.map((bone) => ({ ...bone, rotation: (bone.rotation ?? 0) + 0.7, scaleX: 2 })),
    },
  };
  const request = input(source, target);
  const animation = success(request);
  expect(Object.keys(animation.tracks)).toEqual(['upper', 'hips', 'base']);
  expect(animation.tracks.upper![0]).toMatchObject({ x: 24, rotation: 1, scaleX: 2 });
  expect(animation.tracks.upper![1]).toMatchObject({ x: 30, rotation: 2, scaleX: 2.8 });
  expect(animation.tracks.hips![1]!.y).toBe(24);
  expect(animation.tracks.base![1]!.x).toBe(13);
  expect(animation.tracks.upper![2]!.y).toBe(4);
  expect(animation.rootMotion).toEqual(request.sourceAnimation.rootMotion);
  expect(retargetAnimation(request).compatibilityWarnings.map(({ code }) => code)).toContain('orientation-difference');
});

test('parent and child rest deltas compose in the target hierarchy, for both actor facings', () => {
  const source = fixture(),
    base = fixture('target', 1, true);
  const target = {
    ...base,
    rig: { ...base.rig, bones: base.rig.bones.map((bone) => ({ ...bone, rotation: (bone.rotation ?? 0) + 0.4 })) },
  };
  const animation: AnimationClip = {
    ...clip(),
    tracks: { pelvis: [{ time: 0, rotation: 0.7 }], arm: [{ time: 0, rotation: 0.9 }] },
  };
  const output = success(input(source, target, animation));
  const targetPose = evaluateClip(compileClip(output, new Rig(target.rig)), 0);
  expect(targetPose.get('hips')!.rotation).toBeCloseTo(1.1, 12);
  expect(targetPose.get('upper')!.rotation).toBeCloseTo(1.3, 12);
  const expected = new Map([
    ['hips', { rotation: 1.1 }],
    ['upper', { rotation: 1.3 }],
  ]);
  for (const facing of [1, -1]) {
    const actualWorld = worldPose(target.rig, targetPose, facing),
      expectedWorld = worldPose(target.rig, expected, facing);
    for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const)
      expect(actualWorld.get('tip')![key]).toBeCloseTo(expectedWorld.get('tip')![key], 10);
  }
  const right = worldPose(target.rig, targetPose, 1).get('tip')!,
    left = worldPose(target.rig, targetPose, -1).get('tip')!;
  expect(left.tx).toBeCloseTo(-right.tx, 12);
  expect(left.ty).toBeCloseTo(right.ty, 12);
});

test('rotation wrap, authored turn representatives, Bézier/step metadata and sparse key times retain evaluator fidelity', () => {
  const source = fixture(),
    targetBase = fixture('target', 2, true);
  const target = {
    ...targetBase,
    rig: {
      ...targetBase.rig,
      bones: targetBase.rig.bones.map((bone) => ({ ...bone, rotation: (bone.rotation ?? 0) + 0.4 })),
    },
  };
  const animation = clip();
  animation.tracks = {
    arm: [
      {
        time: 0,
        rotation: 3.1 + 4 * Math.PI,
        x: 13,
        scaleY: 1,
        curves: { rotation: bezier, x: bezier, scaleY: { mode: 'stepped' } },
      },
      { time: 500, x: 15 },
      { time: 1000, rotation: -3.1 + 4 * Math.PI, x: 18, scaleY: 2 },
    ],
  };
  const output = success(input(source, target, animation));
  expect(output.duration).toBe(animation.duration);
  expect(output.playback).toEqual(animation.playback);
  expect(output.tracks.upper!.map(({ time, curves }) => ({ time, curves }))).toEqual(
    animation.tracks.arm!.map(({ time, curves }) => ({ time, curves })),
  );
  expect(output.tracks.upper![0]!.rotation).toBeCloseTo(3.5 + 4 * Math.PI, 12);
  for (const time of [0, 1, 123.456, 499.999, 500, 777, 999.999, 1000]) {
    const from = sample(animation, source, time, 'arm'),
      to = sample(output, target, time, 'upper');
    expect(to.x).toBeCloseTo(24 + (from.x! - 12) * 2, 10);
    expect(to.scaleY).toBe(from.scaleY);
    // Angular samples can differ by complete turns at exact endpoints; this conversion adds a fixed 0.4 radians.
    expect(to.rotation! - from.rotation!).toBeCloseTo(0.4, 10);
  }
});

test('local, pelvis and Actor translations follow separate policies without extracting or duplicating motion', () => {
  const source = fixture(),
    target = fixture('target', 2, true);
  const request = input(source, target, clip(), {
    translation: 'preserve-delta',
    pelvis: { sourceBoneIds: ['pelvis'], translation: 'scale-by-character' },
    rootMotion: 'scale-by-character',
  });
  const result = retargetAnimation(request),
    output = result.animation!;
  expect(result.characterSizeRatio).toBeCloseTo(2, 12);
  expect(output.tracks.upper![1]!.x).toBe(27);
  expect(output.tracks.hips![1]!.y).toBe(24);
  expect(output.tracks.base![1]!.x).toBe(13);
  expect(evaluateRootMotion(output, 1000)).toEqual({ x: 40, y: 0 });
  expect(output.rootMotion!.translationKeys[0]!.curves).toEqual(clip().rootMotion!.translationKeys[0]!.curves);
  const omit = retargetAnimation({ ...request, options: { ...request.options, rootMotion: 'omit' } });
  expect(omit.animation!.rootMotion).toBeUndefined();
  expect(omit.skippedTracks).toContainEqual(expect.objectContaining({ kind: 'root-motion' }));
  const preservePelvis = success(
    input(source, target, clip(), { pelvis: { sourceBoneIds: ['pelvis'], translation: 'preserve-delta' } }),
  );
  expect(preservePelvis.tracks.hips![1]!.y).toBe(22);
});

test('character ratio uses mapped puppet-space rest edges including ancestor scale; extra branches do not bias it', () => {
  const source = fixture(),
    base = fixture('target', 2);
  const target = {
    ...base,
    rig: {
      ...base.rig,
      bones: [
        ...base.rig.bones.map((bone) => (bone.id === 'root' ? { ...bone, scaleX: 3, scaleY: 3 } : bone)),
        { id: 'extra', parent: 'root', x: 10000 },
      ],
    },
  };
  expect(
    retargetAnimation(input(source, target, clip(), { rootMotion: 'scale-by-character' })).characterSizeRatio,
  ).toBeCloseTo(6, 12);
});

test('effective explicit bone lengths drive scaling, zero offsets never divide by zero, unusual ratios warn', () => {
  const make = (id: string, length: number): IdentifiedRig => ({
    id,
    rig: {
      root: 'root',
      bones: [
        { id: 'root', length },
        { id: 'arm', parent: 'root', x: 1 },
      ],
    },
  });
  const animation: AnimationClip = { name: 'move', duration: 10, loop: false, tracks: { arm: [{ time: 0, x: 12 }] } };
  const result = retargetAnimation(input(make('a', 10), make('b', 100), animation));
  expect(result.animation!.tracks.arm![0]!.x).toBe(120);
  expect(result.diagnostics.map(({ code }) => code)).toContain('unusual-proportions');
  const zero = (id: string): IdentifiedRig => ({
    id,
    rig: { root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] },
  });
  const fallback = retargetAnimation(input(zero('a'), zero('b'), animation));
  expect(fallback.animation!.tracks.arm![0]!.x).toBe(12);
  expect(fallback.diagnostics.map(({ code }) => code)).toContain('degenerate-bone-length');
  const scaled = retargetAnimation(
    input(
      zero('a'),
      zero('b'),
      { ...animation, rootMotion: { translationKeys: [{ time: 0, x: 0 }] } },
      { rootMotion: 'scale-by-character' },
    ),
  );
  expect(scaled.animation).toBeNull();
  expect(scaled.diagnostics.map(({ code }) => code)).toContain('conversion-failed');
});

test('FK-only omits source IK IDs/mix/suppression and suppresses every target default/provider constraint', () => {
  const make = (id: string, name: string): IdentifiedRig => {
    const base = fixture(id);
    return {
      ...base,
      rig: {
        ...base.rig,
        ik: [{ name, rootBone: 'pelvis', middleBone: 'arm', endBone: 'hand', target: { x: 10, y: 20 } }],
      },
    };
  };
  const source = make('a', 'source-reach'),
    target = make('b', 'target-reach');
  const request = input(source, target, {
    ...clip(),
    ikTracks: { 'source-reach': [{ time: 0, x: 3, y: 4, mix: 0.8, curves: { x: bezier } }] },
    disabledIKConstraints: ['source-reach'],
  });
  const result = retargetAnimation(request);
  expect(result.animation!.ikTracks).toBeUndefined();
  expect(result.animation!.disabledIKConstraints).toEqual(['target-reach']);
  expect(evaluateIKClip(compileClip(result.animation!, new Rig(target.rig)), 500).get('target-reach')).toEqual({
    disabled: { value: 1, weight: 1 },
  });
  expect(result.skippedTracks.map(({ kind, id }) => [kind, id])).toEqual([
    ['ik', 'source-reach'],
    ['ik-suppression', 'source-reach'],
  ]);
  expect(result.diagnostics.map(({ code }) => code)).toContain('target-ik-disabled');
  expect(result.animation!.tracks).toEqual(clip().tracks);
  expect(retargetAnimation({ ...request, options: { ...options, ik: 'mapped' as 'fk-only' } }).animation).toBeNull();
});

test('mesh corrections require verified complete identity correspondence and an identical full bind basis', () => {
  const base: RigDefinition = { root: 'root', bones: [{ id: 'root' }], slots: [{ id: 'paper', bone: 'root' }] };
  const mesh = createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 20, height: 20 }, base, 'root');
  const source: IdentifiedRig = { id: 'a', rig: { ...base, attachments: [mesh] } };
  const target: IdentifiedRig = { id: 'b', rig: source.rig };
  const animation: AnimationClip = {
    name: 'shape',
    duration: 100,
    loop: false,
    tracks: {},
    deformationTracks: { mesh: [{ time: 0, offsets: { 'top-left': { x: 2, y: 3 } }, curve: bezier }] },
  };
  const kept = success(input(source, target, animation));
  expect(kept.deformationTracks).toEqual(animation.deformationTracks);
  expect(kept.deformationTracks!.mesh).not.toBe(animation.deformationTracks!.mesh);
  const different: IdentifiedRig = {
    ...target,
    rig: {
      ...target.rig,
      attachments: [{ ...mesh, vertices: mesh.vertices.map((vertex) => ({ ...vertex, u: vertex.u * 0.8 })) }],
    },
  };
  const omitted = retargetAnimation(input(source, different, animation));
  expect(omitted.animation!.deformationTracks).toBeUndefined();
  expect(omitted.skippedTracks).toContainEqual(expect.objectContaining({ kind: 'mesh', id: 'mesh' }));
  const missing: IdentifiedRig = { id: 'missing', rig: { ...base } };
  expect(retargetAnimation(input(source, missing, animation)).animation!.deformationTracks).toBeUndefined();
});

test('partial maps omit only unmapped valid source tracks; stale, duplicate and broken hierarchies fail closed', () => {
  const source = fixture(),
    base = fixture('target');
  const target = { ...base, rig: { ...base.rig, bones: base.rig.bones.slice(0, 2) } };
  const partial = retargetAnimation(input(source, target));
  expect(partial.animation).not.toBeNull();
  expect(partial.animation!.tracks.arm).toBeUndefined();
  expect(partial.skippedTracks).toContainEqual(expect.objectContaining({ kind: 'bone', id: 'arm' }));
  const request = input();
  const stale = retargetAnimation({ ...request, targetRig: fixture('target', 3) });
  expect(stale.animation).toBeNull();
  expect(stale.diagnostics.map(({ code }) => code)).toContain('stale-mapping');
  const duplicate = retargetAnimation({
    ...request,
    boneMapping: { ...request.boneMapping, entries: [...request.boneMapping.entries, request.boneMapping.entries[0]!] },
  });
  expect(duplicate.animation).toBeNull();
  expect(duplicate.diagnostics.map(({ code }) => code)).toContain('duplicate-source');
  const badParent = {
    ...base,
    rig: {
      ...base.rig,
      bones: base.rig.bones.map((bone) => (bone.id === 'hand' ? { ...bone, parent: 'root' } : bone)),
    },
  };
  const broken = retargetAnimation(input(source, badParent));
  expect(broken.animation).toBeNull();
  expect(broken.diagnostics.map(({ code }) => code)).toContain('parent-mismatch');
});

describe('validation and deterministic authored output', () => {
  test('JSON round trip preserves target references, metadata, event payloads and deterministic content', () => {
    const request = input(fixture(), fixture('target', 2, true));
    const a = retargetAnimation(request),
      b = retargetAnimation(request);
    expect(a).toEqual(b);
    const output = a.animation!;
    const json = serializeAnimationDefinition({ version: 1, ...output }, request.targetRig.rig);
    expect(parseAnimationClip(JSON.parse(json), new Rig(request.targetRig.rig))).toEqual(output);
    expect(output.library).toEqual(request.sourceAnimation.library);
    expect(output.events).toEqual(request.sourceAnimation.events);
    const reordered = {
      ...request,
      boneMapping: { ...request.boneMapping, entries: [...request.boneMapping.entries].reverse() },
      sourceAnimation: {
        ...request.sourceAnimation,
        tracks: Object.fromEntries(Object.entries(request.sourceAnimation.tracks).reverse()),
      },
    };
    expect(retargetAnimation(reordered)).toEqual(a);
    expect(
      serializeAnimationDefinition({ version: 1, ...retargetAnimation(reordered).animation }, request.targetRig.rig),
    ).toBe(json);
  });
  test('invalid source channels/timelines, runtime payloads and options return validation diagnostics', () => {
    const request = input();
    for (const animation of [
      { ...clip(), tracks: { unknown: [{ time: 0, rotation: 0 }] } },
      { ...clip(), tracks: { arm: [{ time: 9999, x: 0 }] } },
      { ...clip(), tracks: { arm: [{ time: 0, x: Infinity }] } },
      { ...clip(), events: [{ time: 0, name: 'runtime', data: new Map() }] },
    ]) {
      const result = retargetAnimation({ ...request, sourceAnimation: animation });
      expect(result.animation).toBeNull();
      expect(result.diagnostics.map(({ code }) => code)).toContain('invalid-source-animation');
    }
    expect(
      retargetAnimation({ ...request, options: { ...options, rootMotion: 'invalid' as 'omit' } }).animation,
    ).toBeNull();
    expect(
      retargetAnimation({
        ...request,
        options: { ...options, pelvis: { sourceBoneIds: ['missing'], translation: 'scale-by-character' } },
      }).animation,
    ).toBeNull();
  });
  test('matching rest reflections transfer normally; changed reflection and zero scale are explicit failures', () => {
    const mirror = (id: string, scaleX: number): IdentifiedRig => {
      const base = fixture(id);
      return {
        ...base,
        rig: { ...base.rig, bones: base.rig.bones.map((bone) => (bone.id === 'root' ? { ...bone, scaleX } : bone)) },
      };
    };
    expect(success(input(mirror('a', -1), mirror('b', -1))).tracks).toEqual(clip().tracks);
    const changed = retargetAnimation(input(mirror('a', 1), mirror('b', -1)));
    expect(changed.animation).toBeNull();
    expect(changed.diagnostics.map(({ code }) => code)).toContain('unsupported-rest-reflection');
    const singular = retargetAnimation(input(mirror('a', 0), mirror('b', 1)));
    expect(singular.animation).toBeNull();
    expect(singular.diagnostics.map(({ code }) => code)).toContain('singular-rest-scale');
  });
});
