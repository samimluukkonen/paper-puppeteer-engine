import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { createAnimationVariation } from '../src/devtools/animation-editor/animationVariation.js';
import { mirrorCurrentPoseToKeys } from '../src/devtools/animation-editor/keyframeMirroring.js';
import { createBoneSymmetryMapping } from '../src/devtools/shared/boneSymmetry.js';
import { Actor } from '../src/engine/Actor.js';
import { localToWorld, worldToLocal } from '../src/engine/affineMath.js';
import { compileClip, type AnimationClip, type CompiledClip } from '../src/engine/AnimationClip.js';
import { AnimationLayerEvaluator, type AnimationLayer } from '../src/engine/AnimationLayerEvaluator.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { serializeAnimationDefinition } from '../src/engine/authoredSerialization.js';
import { sampleIKBake, generateBakedBoneKeys, commitIKBake } from '../src/engine/core.js';
import { parseAnimationClip } from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import { createRectangleMeshAttachment, meshAttachmentToBindPose } from '../src/engine/meshAttachments.js';
import { boneBindMatrix } from '../src/engine/meshBindPose.js';
import {
  emptyMeshDeformation,
  emptyMeshVertexOffsets,
  evaluateMeshDeformation,
  blendMeshDeformation,
  MeshDeformationClipBuffer,
  sampleMeshDeformation,
  meshDeformationIssues,
  type MeshDeformationKey,
} from '../src/engine/meshDeformation.js';
import { subdivideMeshEdge } from '../src/engine/meshEditing.js';
import { createMeshSkinBinding, deformMesh } from '../src/engine/meshSkinning.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture(rigid = false) {
  const base: RigDefinition = {
    root: 'root',
    bones: [
      { id: 'root', x: 7, y: -2 },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', x: 20 },
      { id: 'tip', parent: 'lower', x: 20 },
    ],
    slots: [{ id: 'sleeve', bone: 'upper', x: 3, y: 2, rotation: 0.2, scaleX: -1.2, scaleY: 0.8 }],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'tip', target: { x: 25, y: 16 }, mix: 1 }],
  };
  const mesh = createRectangleMeshAttachment(
    { id: 'mesh', texture: 'paper', x: 4, y: -3, rotation: 0.15, scaleX: 0.8, scaleY: 1.1 },
    { width: 20, height: 10 },
    base,
    'upper',
  );
  const weighted = {
    ...mesh,
    vertices: mesh.vertices.map((vertex) => ({
      ...vertex,
      influences: rigid
        ? [{ boneId: 'upper', weight: 1 }]
        : [
            { boneId: 'upper', weight: 0.4 },
            { boneId: 'lower', weight: 0.6 },
          ],
    })),
  };
  const rig = new Rig({
    ...base,
    attachments: [weighted],
    skins: [{ version: 1, name: 'default', slots: { sleeve: 'mesh' } }],
  });
  const keys: MeshDeformationKey[] = [
    { time: 0, offsets: {} },
    { time: 500, offsets: { 'top-left': { x: 6, y: -4 }, 'bottom-right': { x: -2, y: 3 } } },
    { time: 1000, offsets: {} },
  ];
  const clip: AnimationClip = {
    name: 'sword-cut',
    duration: 1000,
    loop: false,
    tracks: {
      lower: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 1.2 },
      ],
    },
    deformationTracks: { mesh: keys },
  };
  return { base, rig, mesh: weighted, clip, keys };
}

function player(rig: Rig, ...clips: AnimationClip[]) {
  return new AnimationPlayer(
    rig,
    new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)])),
    clips.map((clip) => compileClip(clip, rig)),
  );
}

test('hold overlays sample mesh channels without advancing or mutating the cinematic deformation', () => {
  const { rig, clip } = fixture();
  const idle = { ...clip, name: 'idle' };
  const before = JSON.stringify(idle);
  const animation = player(rig, clip, idle);
  try {
    animation.play(clip.name);
    animation.update(100);
    animation.pause();
    const cinematic = animation.meshDeformation;
    animation.beginDialogueIdle('idle');
    animation.sampleDialogueIdle(1500);
    assert.deepEqual(animation.meshDeformation.get('mesh')?.get('top-left'), { x: 6, y: -4 });
    assert.equal(animation.elapsedTime, 100);
    animation.endDialogueIdle();
    assert.deepEqual(
      [...animation.meshDeformation].map(([id, offsets]) => [id, [...offsets]]),
      [...cinematic].map(([id, offsets]) => [id, [...offsets]]),
    );
    assert.equal(JSON.stringify(idle), before);
    animation.play('idle', { fadeDuration: 0 });
    assert.isFalse(animation.getPlaybackStatus()!.loop);
  } finally {
    animation.dispose();
  }
});

test('neutral, sparse shape snapshots, multiple vertices, endpoints and all supported curves', () => {
  const { keys } = fixture();
  assert.equal(evaluateMeshDeformation({}, 100).size, 0);
  assert.equal(sampleMeshDeformation([], 100).size, 0);
  assert.equal(sampleMeshDeformation(keys, -100).size, 0);
  assert.deepEqual(sampleMeshDeformation(keys, 250).get('top-left'), { x: 3, y: -2 });
  assert.deepEqual(sampleMeshDeformation(keys, 250).get('bottom-right'), { x: -1, y: 1.5 });
  assert.equal(sampleMeshDeformation(keys, 1000).size, 0);
  assert.equal(sampleMeshDeformation(keys, 1500).size, 0);
  const one = [{ time: 500, offsets: { 'top-left': { x: 2, y: 4 } } }];
  assert.deepEqual(sampleMeshDeformation(one, 0).get('top-left'), { x: 2, y: 4 });
  const sparse = [
    { ...keys[1]!, curve: { mode: 'stepped' as const } },
    { time: 1000, offsets: {} },
  ];
  assert.deepEqual(sampleMeshDeformation(sparse, 999).get('top-left'), { x: 6, y: -4 });
  assert.equal(sampleMeshDeformation(sparse, 1000).size, 0);
  const bezier = [
    { ...keys[0]!, curve: { mode: 'bezier' as const, control1: { x: 0, y: 0 }, control2: { x: 1, y: 0 } } },
    keys[1]!,
  ];
  assert.closeTo(sampleMeshDeformation(bezier, 250).get('top-left')!.x, 0.75, 1e-8);
  assert.throws(() => sampleMeshDeformation(keys, NaN));
});

test('corrections precede inverse bind and skinning with reflected/nonuniform transforms', () => {
  const { mesh } = fixture();
  const binding = createMeshSkinBinding(mesh, 'sleeve');
  const matrices = new Map(mesh.bindPose.bones.map((bone) => [bone.id, boneBindMatrix(mesh.bindPose, bone.id)]));
  const offsets = new Map([['top-left', { x: 8, y: -7 }]]);
  const before = structuredClone(mesh);
  const output = deformMesh(binding, (id) => matrices.get(id), [], offsets);
  const expected = meshAttachmentToBindPose(mesh, 'sleeve', { x: mesh.vertices[0]!.x + 8, y: mesh.vertices[0]!.y - 7 });
  assert.closeTo(output[0]!, expected.x, 1e-10);
  assert.closeTo(output[1]!, expected.y, 1e-10);
  assert.deepEqual(mesh, before);
  const neutral = deformMesh(binding, (id) => matrices.get(id));
  assert.notEqual(output[0], neutral[0]);
  assert.deepEqual(output.slice(4), neutral.slice(4));
  assert.equal(output[2], neutral[2]);
  assert.equal(output[3], neutral[3]);
});

test('runtime/editor parity, final FK/IK, facing, Actor/Puppet placement and deterministic direct seeks', () => {
  for (const rigid of [false, true])
    for (const ik of [false, true]) {
      const { rig, mesh, clip } = fixture(rigid);
      const animation: AnimationClip = {
        ...clip,
        ikTracks: { arm: [{ time: 0, mix: ik ? 1 : 0 }] },
        rootMotion: {
          translationKeys: [
            { time: 0, x: 0 },
            { time: 1000, x: 35 },
          ],
        },
      };
      const runtime = new Puppet(puppetScene(), {
        rig,
        animations: [animation],
        skin: 'default',
        autoUpdate: false,
        x: 100,
        y: -30,
        facing: 'left',
        scale: 1.5,
      });
      const previewPuppet = new Puppet(puppetScene(), {
        rig,
        skin: 'default',
        autoUpdate: false,
        x: 100,
        y: -30,
        facing: 'left',
        scale: 1.5,
      });
      const state = new AnimationEditorState(rig, [animation]);
      state.selectAnimation(animation.name);
      const preview = new AnimationEditorPreview(state, previewPuppet);
      runtime.play(animation.name);
      const original = structuredClone(mesh);
      let held: number[] | undefined;
      for (const time of [250, 800, 0, 1000, 250]) {
        runtime.sampleAnimation(time, { mode: 'playback' });
        state.setCurrentTime(time / 1000);
        const actual = runtime.getSlotMesh('sleeve')!;
        assert.deepEqual(actual.vertices, previewPuppet.getSlotMesh('sleeve')!.vertices);
        const offset = sampleMeshDeformation(clip.deformationTracks!.mesh!, time).get('top-left') ?? { x: 0, y: 0 };
        const vertex = mesh.vertices[0]!;
        const point = meshAttachmentToBindPose(mesh, 'sleeve', { x: vertex.x + offset.x, y: vertex.y + offset.y });
        const expected = { x: 0, y: 0 };
        for (const influence of vertex.influences) {
          const local = worldToLocal(point, boneBindMatrix(mesh.bindPose, influence.boneId))!;
          const posed = localToWorld(local, runtime.getBone(influence.boneId).container.getWorldTransformMatrix());
          expected.x += influence.weight * posed.x;
          expected.y += influence.weight * posed.y;
        }
        const world = localToWorld(
          { x: actual.vertices[0]!, y: actual.vertices[1]! },
          actual.getWorldTransformMatrix(),
        );
        assert.closeTo(world.x, expected.x, 1e-8);
        assert.closeTo(world.y, expected.y, 1e-8);
        if (time === 250) {
          if (held) assert.deepEqual(actual.vertices, held);
          else held = [...actual.vertices];
        }
      }
      assert.deepEqual(mesh, original);
      assert.equal(state.historyLength, 0);
      assert.isFalse(state.dirty);
      preview.dispose();
      runtime.destroy();
      previewPuppet.destroy();
    }
});

test('stepped samples and endpoint semantics match ordinary playback; sampling never mutates keys', () => {
  const { rig, clip } = fixture();
  const animation = { ...clip, playback: { mode: 'stepped' as const, fps: 2 } };
  const runtime = player(rig, animation);
  runtime.play(clip.name);
  runtime.sample(490, { mode: 'playback' });
  assert.equal(runtime.meshDeformation.get('mesh')!.size, 0);
  runtime.sample(750, { mode: 'playback' });
  assert.deepEqual(runtime.meshDeformation.get('mesh')!.get('top-left'), { x: 6, y: -4 });
  runtime.sample(1000, { mode: 'playback' });
  assert.equal(runtime.meshDeformation.get('mesh')!.size, 0);
  runtime.sample(250);
  assert.deepEqual(runtime.meshDeformation.get('mesh')!.get('top-left'), { x: 3, y: -2 });
  runtime.dispose();
});

test('layer fades, interrupted fades, neutral clips, weights and masks retain deterministic corrections', () => {
  const { rig, clip } = fixture();
  const shape = { ...clip, deformationTracks: { mesh: [{ time: 0, offsets: { 'top-left': { x: 10, y: 0 } } }] } };
  const neutral = { ...clip, name: 'neutral', deformationTracks: {} };
  const runtime = player(rig, shape, neutral);
  runtime.play(shape.name);
  assert.equal(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 10);
  runtime.play(neutral.name, { fadeDuration: 100 });
  runtime.update(50);
  assert.closeTo(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 5, 1e-8);
  runtime.play(shape.name, { fadeDuration: 100 });
  runtime.update(50);
  assert.closeTo(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 7.5, 1e-8);
  runtime.play(neutral.name);
  assert.equal(runtime.meshDeformation.size, 0);
  runtime.setLayerWeight('overlay', 0.5);
  runtime.play(shape.name, { layer: 'overlay' });
  assert.closeTo(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 5, 1e-8);
  runtime.setLayerWeight('overlay', 0);
  assert.equal(runtime.meshDeformation.size, 0);
  runtime.dispose();
});

test('strict validation rejects invalid references, malformed offsets, timelines, curves and compiled ownership', () => {
  const { rig, clip } = fixture();
  for (const deformationTracks of [
    { missing: [{ time: 0, offsets: {} }] },
    { mesh: [{ time: 0, offsets: { absent: { x: 1, y: 2 } } }] },
    { mesh: [{ time: 0, offsets: { 'top-left': { x: Infinity, y: 0 } } }] },
    { mesh: [{ time: -1, offsets: {} }] },
    { mesh: [{ time: 1001, offsets: {} }] },
    {
      mesh: [
        { time: 0, offsets: {} },
        { time: 0, offsets: {} },
      ],
    },
    {
      mesh: [
        { time: 0, offsets: {}, curve: { mode: 'bezier', control1: { x: 0.8, y: 0 }, control2: { x: 0.2, y: 1 } } },
      ],
    },
  ])
    assert.throws(() => compileClip({ ...clip, deformationTracks } as AnimationClip, rig));
  const source = structuredClone(clip);
  const compiled = compileClip(source, rig);
  source.deformationTracks = {};
  assert.equal(compiled.deformationTracks!.mesh!.length, 3);
  assert.isTrue(Object.isFrozen(compiled.deformationTracks!.mesh![1]!.offsets));
  const external: CompiledClip = {
    ...compiled,
    deformationTracks: { mesh: [{ time: 0, offsets: { 'top-left': { x: 4, y: 0 } } }] },
  };
  const runtime = new AnimationPlayer(rig, new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)])), [
    external,
  ]);
  runtime.play(clip.name);
  assert.equal(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 4);
  assert.throws(
    () => new AnimationPlayer(new Rig({ root: rig.root, bones: rig.bones, ik: rig.ik! }), new Map(), [compiled]),
  );
  runtime.dispose();
});

test('topology changes preserve IDs across subdivision/reordering and flag deleted or replaced vertices', () => {
  const { rig, mesh, clip } = fixture();
  const subdivided = subdivideMeshEdge(mesh, 0, 1, rig);
  assert.deepEqual(meshDeformationIssues(clip.deformationTracks, { attachments: [subdivided] }), []);
  const remapped = {
    ...mesh,
    vertices: [...mesh.vertices].reverse(),
    triangles: mesh.triangles.map((index) => mesh.vertices.length - 1 - index),
  };
  assert.deepEqual(meshDeformationIssues(clip.deformationTracks, { attachments: [remapped] }), []);
  const changed = {
    ...mesh,
    vertices: mesh.vertices.map((vertex, index) => (index === 0 ? { ...vertex, id: 'replacement' } : vertex)),
  };
  assert.match(
    meshDeformationIssues(clip.deformationTracks, { attachments: [changed] })[0]!.message,
    /topology.*top-left/,
  );
  const updated = new Rig({ root: rig.root, bones: rig.bones, slots: rig.slots, attachments: [changed] });
  assert.throws(() => compileClip(clip, updated), /topology/);
});

test('editor edits, provisional cancellation, atomic history, copy/paste, duplication and export/reload preserve unrelated data', () => {
  const { rig, clip } = fixture();
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation(clip.name);
  const baseline = state.exportJson();
  state.selectDeformation('mesh', 0.5);
  assert.isTrue(state.setMeshOffsets({ 'top-left': { x: 8, y: -6 } }));
  assert.equal(state.historyLength, 1);
  assert.deepEqual(state.workingAnimation!.tracks, clip.tracks);
  assert.deepEqual(state.workingAnimation!.deformationTracks!.mesh![1]!.offsets['bottom-right'], { x: -2, y: 3 });
  const authored = state.exportJson();
  state.beginDeformationEdit();
  state.previewMeshOffsets({ 'top-left': { x: 99, y: 0 } });
  assert.equal(state.exportJson(), authored);
  assert.notStrictEqual(state.previewAnimation, state.workingAnimation);
  state.cancelDeformationEdit();
  assert.equal(state.exportJson(), authored);
  state.beginDeformationEdit();
  state.previewMeshOffsets({ 'top-left': { x: 9, y: 0 } });
  state.previewMeshOffsets({ 'top-left': { x: 10, y: 0 } });
  state.commitDeformationEdit();
  assert.equal(state.historyLength, 2);
  state.undo();
  assert.equal(state.exportJson(), authored);
  state.undo();
  assert.equal(state.exportJson(), baseline);
  state.redo();
  assert.equal(state.exportJson(), authored);
  state.selectDeformation('mesh', 0.5);
  assert.isTrue(state.copyTimelineSelection());
  state.setCurrentTime(0.75);
  assert.isTrue(state.pasteTimelineClipboard());
  assert.equal(state.workingAnimation!.deformationTracks!.mesh!.length, 4);
  assert.isTrue(state.duplicateTimelineSelection());
  assert.equal(state.workingAnimation!.deformationTracks!.mesh!.length, 5);
  assert.isTrue(state.deleteTimelineSelection());
  assert.equal(state.workingAnimation!.deformationTracks!.mesh!.length, 4);
  const output = state.exportJson();
  const loaded = parseAnimationClip(JSON.parse(output), rig);
  assert.deepEqual(loaded.deformationTracks, state.workingAnimation!.deformationTracks);
  assert.deepEqual(JSON.parse(serializeAnimationDefinition(JSON.parse(output), rig)), JSON.parse(output));
});

test('variations scale shape times and mirroring preserves corrections without retargeting vertices', () => {
  const { rig, clip } = fixture();
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation(clip.name);
  const source = state.workingAnimation!;
  const varied = createAnimationVariation(source, rig, { name: 'heavy-cut', timeScale: 2 });
  assert.deepEqual(
    varied.deformationTracks!.mesh!.map((key) => key.time),
    [0, 1000, 2000],
  );
  assert.deepEqual(varied.deformationTracks!.mesh![1]!.offsets, source.deformationTracks!.mesh![1]!.offsets);
  const symmetry = createBoneSymmetryMapping(rig).mapping;
  const mirrored = mirrorCurrentPoseToKeys(source, rig, symmetry!, 500, 'swap', { boneIds: [] });
  assert.deepEqual(mirrored.animation.deformationTracks, source.deformationTracks);
});

test('Actor root travel applies once after correction skinning; clips without corrections restore ordinary meshes', () => {
  const { rig, clip } = fixture();
  const animation = {
    ...clip,
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0, y: 0 },
        { time: 1000, x: 40, y: 10 },
      ],
    },
  };
  const neutral = { ...clip, name: 'neutral', deformationTracks: {} };
  const puppet = new Puppet(puppetScene(), {
    rig,
    animations: [animation, neutral],
    skin: 'default',
    autoUpdate: false,
    x: 100,
    y: 50,
    facing: 'left',
    scale: 2,
  });
  const actor = new Actor({ id: 'swordsman', puppet });
  actor.play(animation.name, { rootMotion: 'apply' });
  puppet.update(500);
  assert.closeTo(puppet.container.x, 60, 1e-8);
  assert.closeTo(puppet.container.y, 60, 1e-8);
  const geometry = [...puppet.getSlotMesh('sleeve')!.vertices];
  puppet.sampleAnimation(500);
  assert.deepEqual(puppet.getSlotMesh('sleeve')!.vertices, geometry);
  puppet.play('neutral');
  puppet.sampleAnimation(500);
  assert.notDeepEqual(puppet.getSlotMesh('sleeve')!.vertices, geometry);
  assert.equal(puppet.meshDeformation.size, 0);
  puppet.resetPose();
  assert.equal(puppet.meshDeformation.size, 0);
  actor.dispose();
  puppet.destroy();
});

test('IK bake, Pose Library application and bone diagnostics keep authored correction tracks intact', () => {
  const { rig, clip } = fixture();
  const animation = {
    ...clip,
    ikTracks: {
      arm: [
        { time: 0, x: 25, y: 16 },
        { time: 1000, x: 18, y: 25 },
      ],
    },
  };
  const samples = sampleIKBake(animation, rig, ['arm'], { fps: 4 });
  const plan = generateBakedBoneKeys(samples, rig, { animation });
  assert.isTrue(plan.success);
  const result = commitIKBake(animation, plan, rig);
  assert.isTrue(result.success);
  if (!result.success) return;
  assert.deepEqual(result.animation.deformationTracks, animation.deformationTracks);
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation(animation.name);
  const pose = state.saveCurrentPose('Guard');
  assert.isTrue(state.applyLibraryPose(pose));
  assert.deepEqual(state.workingAnimation!.deformationTracks, animation.deformationTracks);
});

test('bone masks exclude partially weighted meshes; invalid topology remains reviewable and explicitly removable', () => {
  const { rig, mesh, clip } = fixture();
  const runtime = player(rig, clip, { ...clip, name: 'neutral', deformationTracks: {} });
  runtime.play('neutral');
  runtime.setLayerMask('overlay', ['upper']);
  runtime.play(clip.name, { layer: 'overlay' });
  runtime.update(500);
  assert.equal(runtime.meshDeformation.size, 0);
  runtime.setLayerMask('overlay', ['upper', 'lower']);
  assert.deepEqual(runtime.meshDeformation.get('mesh')!.get('top-left'), { x: 6, y: -4 });
  runtime.dispose();
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation(clip.name);
  const changed = {
    ...mesh,
    vertices: mesh.vertices.map((vertex, index) => (index === 0 ? { ...vertex, id: 'new' } : vertex)),
  };
  const nextRig = new Rig({ root: rig.root, bones: rig.bones, slots: rig.slots, ik: rig.ik!, attachments: [changed] });
  state.updatePreviewRig(nextRig);
  assert.equal(state.deformationTopologyIssues.length, 1);
  assert.isFalse(state.exportAnimation().success);
  assert.isTrue(state.removeIncompatibleDeformationTracks());
  assert.deepEqual(state.workingAnimation!.deformationTracks, {});
  assert.isTrue(state.exportAnimation().success);
  // The old snapshot is incompatible until the original mesh IDs are restored.
  state.updatePreviewRig(rig);
  assert.isTrue(state.undo());
  assert.deepEqual(state.workingAnimation!.deformationTracks, clip.deformationTracks);
});

test('sparse overlay fades resolve missing shapes against the underlying correction', () => {
  const { rig, clip } = fixture();
  const base = { ...clip, deformationTracks: { mesh: [{ time: 0, offsets: { 'top-left': { x: 10, y: 0 } } }] } };
  const overlay = {
    ...base,
    name: 'overlay-shape',
    deformationTracks: { mesh: [{ time: 0, offsets: { 'top-left': { x: 20, y: 0 } } }] },
  };
  const neutral = { ...clip, name: 'neutral', deformationTracks: {} };
  const runtime = player(rig, base, overlay, neutral);
  runtime.play(base.name);
  runtime.play('neutral', { layer: 'overlay' });
  runtime.play(overlay.name, { layer: 'overlay', fadeDuration: 100 });
  assert.equal(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 10);
  runtime.update(50);
  assert.equal(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 15);
  runtime.update(50);
  assert.equal(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 20);
  runtime.play('neutral', { layer: 'overlay', fadeDuration: 100 });
  runtime.update(50);
  assert.equal(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 15);
  runtime.update(50);
  assert.equal(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, 10);
  runtime.dispose();
});

test('prototype-named mesh and vertex IDs never inherit phantom correction tracks', () => {
  const { rig, mesh, clip } = fixture();
  const renamed = {
    ...mesh,
    id: 'constructor',
    vertices: mesh.vertices.map((vertex, i) => (i === 0 ? { ...vertex, id: 'toString' } : vertex)),
  };
  const nextRig = new Rig({ root: rig.root, bones: rig.bones, slots: rig.slots, attachments: [renamed] });
  const state = new AnimationEditorState(nextRig, [{ ...clip, deformationTracks: {} }]);
  state.selectAnimation(clip.name);
  state.selectDeformation('constructor');
  assert.isTrue(state.setMeshOffsets({ toString: { x: 3, y: 5 } }));
  assert.deepEqual(Object.entries(state.selectedDeformationKey!.offsets).find(([id]) => id === 'toString')?.[1], {
    x: 3,
    y: 5,
  });
  const compiled = compileClip(parseAnimationClip(JSON.parse(state.exportJson()), nextRig), nextRig);
  assert.deepEqual(evaluateMeshDeformation(compiled, 0).get('constructor')!.get('toString'), { x: 3, y: 5 });
});

test('neutral deformation results share immutable empties without losing explicit shape ownership', () => {
  assert.strictEqual(evaluateMeshDeformation({}, 0), emptyMeshDeformation);
  assert.strictEqual(evaluateMeshDeformation({ deformationTracks: {} }, 100), emptyMeshDeformation);
  assert.strictEqual(sampleMeshDeformation([], 0), emptyMeshVertexOffsets);
  assert.strictEqual(sampleMeshDeformation([{ time: 0, offsets: {} }], 0), emptyMeshVertexOffsets);
  assert.strictEqual(blendMeshDeformation(new Map(), new Map(), 0.5), emptyMeshDeformation);
  assert.isTrue(Object.isFrozen(emptyMeshDeformation));
  assert.isFalse('set' in emptyMeshDeformation);
  assert.isFalse('set' in emptyMeshVertexOffsets);
  const owned = evaluateMeshDeformation({ deformationTracks: { mesh: [{ time: 0, offsets: {} }] } }, 0);
  assert.isTrue(owned.has('mesh'));
  assert.strictEqual(owned.get('mesh'), emptyMeshVertexOffsets);
  assert.throws(() => evaluateMeshDeformation({}, NaN));
});

test('compiled sparse sampling reuses offsets, isolates players and clears vertices across seeks and clip switches', () => {
  const { rig, clip } = fixture();
  const animation = compileClip(
    {
      ...clip,
      deformationTracks: {
        mesh: [
          { time: 0, offsets: { 'top-left': { x: 2, y: 4 } } },
          { time: 500, offsets: { 'top-left': { x: 6, y: 8 } } },
          { time: 750, offsets: { 'bottom-right': { x: 10, y: -2 } } },
          { time: 1000, offsets: {} },
        ],
      },
    },
    rig,
  );
  const first = new MeshDeformationClipBuffer();
  const second = new MeshDeformationClipBuffer();
  const pose = first.evaluate(animation, 100);
  const offsets = pose.get('mesh')!;
  const vertex = offsets.get('top-left')!;
  first.evaluate(animation, 200);
  assert.strictEqual(first.evaluate(animation, 300), pose);
  assert.strictEqual(pose.get('mesh'), offsets);
  assert.strictEqual(offsets.get('top-left'), vertex);
  assert.closeTo(vertex.x, 4.4, 1e-10);
  second.evaluate(animation, 500);
  assert.closeTo(vertex.x, 4.4, 1e-10);
  for (const time of [800, 1000, 600, -100, 750, 300]) {
    const actual = first.evaluate(animation, time).get('mesh')!;
    const expected = sampleMeshDeformation(animation.deformationTracks!.mesh!, time);
    assert.deepEqual([...actual], [...expected]);
  }
  assert.strictEqual(first.evaluate({}, 0), emptyMeshDeformation);
  assert.deepEqual([...first.evaluate(animation, 200).get('mesh')!], [['top-left', { x: 3.6, y: 5.6 }]]);
});

test('playback reuses blended rendering data while public snapshots stay immutable through fades and resets', () => {
  const { rig, clip } = fixture();
  const neutral = { ...clip, name: 'neutral', deformationTracks: {} };
  const runtime = player(rig, clip, neutral);
  runtime.play(neutral.name);
  runtime.setLayerWeight('overlay', 0.5);
  runtime.play(clip.name, { layer: 'overlay', fadeDuration: 1000 });
  runtime.update(100);
  const live = runtime.getMeshDeformationForRendering();
  const vertices = live.get('mesh')!;
  const vertex = vertices.get('top-left')!;
  const snapshot = runtime.meshDeformation;
  assert.strictEqual(runtime.meshDeformation, snapshot);
  const held = snapshot.get('mesh')!.get('top-left')!;
  assert.isTrue(Object.isFrozen(held));
  assert.isFalse('set' in snapshot);
  assert.isFalse('set' in snapshot.get('mesh')!);
  const expected = { ...held };
  runtime.update(100);
  assert.strictEqual(runtime.getMeshDeformationForRendering(), live);
  assert.strictEqual(live.get('mesh'), vertices);
  assert.strictEqual(vertices.get('top-left'), vertex);
  assert.notEqual(vertex.x, held.x);
  assert.deepEqual(held, expected);
  const beforeInterrupt = vertex.x;
  runtime.play(neutral.name, { layer: 'overlay', fadeDuration: 100 });
  runtime.update(50);
  assert.closeTo(runtime.meshDeformation.get('mesh')!.get('top-left')!.x, beforeInterrupt * 0.5, 1e-10);
  assert.deepEqual(held, expected);
  runtime.clearAllLayers();
  assert.strictEqual(runtime.meshDeformation, emptyMeshDeformation);
  assert.deepEqual(held, expected);
  runtime.play(neutral.name);
  for (let frame = 0; frame < 10; frame++) {
    runtime.update(10);
    assert.strictEqual(runtime.getMeshDeformationForRendering(), emptyMeshDeformation);
    assert.strictEqual(runtime.meshDeformation, emptyMeshDeformation);
  }
  runtime.resetPose();
  assert.strictEqual(runtime.meshDeformation, emptyMeshDeformation);
  runtime.dispose();
});

test('mask eligibility compiles vertex influences once and refreshes for masks and attachment weight edits', () => {
  const { rig, mesh, clip } = fixture();
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const evaluator = new AnimationLayerEvaluator(rig, joints);
  const layer: AnimationLayer = {
    weight: 1,
    stopped: false,
    transition: undefined,
    mask: new Set(['upper']),
    state: {
      playbackId: 1,
      clip: compileClip({ ...clip, tracks: {} }, rig),
      time: 250,
      unwrappedTime: 250,
      rootMotion: 'ignore',
      speed: 1,
      playing: true,
    },
  };
  const maskReads = vi.spyOn(layer.mask!, 'has');
  const layers = new Map([['overlay', layer]]);
  const playback = { mode: 'smooth' } as const;
  let reads = 0;
  evaluator.updateMeshAttachments(
    [
      {
        ...mesh,
        get vertices() {
          reads++;
          return mesh.vertices;
        },
      },
    ],
    layers,
    playback,
  );
  assert.equal(evaluator.deformation.size, 0);
  const compiledReads = reads;
  const eligibilityReads = maskReads.mock.calls.length;
  for (let frame = 0; frame < 10; frame++) evaluator.applyCurrentPose(layers, playback);
  assert.equal(reads, compiledReads);
  assert.equal(maskReads.mock.calls.length, eligibilityReads);
  maskReads.mockRestore();
  layer.mask = new Set(['upper', 'lower']);
  evaluator.applyCurrentPose(layers, playback);
  assert.deepEqual(evaluator.deformation.get('mesh')!.get('top-left'), { x: 3, y: -2 });
  layer.mask = new Set(['upper']);
  evaluator.applyCurrentPose(layers, playback);
  assert.equal(evaluator.deformation.size, 0);
  evaluator.updateMeshAttachments(
    [
      {
        ...mesh,
        vertices: mesh.vertices.map((vertex) => ({
          ...vertex,
          influences: [
            { boneId: 'upper', weight: 1 },
            { boneId: 'lower', weight: 0 },
          ],
        })),
      },
    ],
    layers,
    playback,
  );
  assert.deepEqual(evaluator.deformation.get('mesh')!.get('top-left'), { x: 3, y: -2 });
  evaluator.updateMeshAttachments([mesh], layers, playback);
  assert.equal(evaluator.deformation.size, 0);
  evaluator.updateMeshAttachments(
    [
      {
        ...mesh,
        vertices: mesh.vertices.map(({ influences: _influences, ...vertex }) => vertex),
      },
    ],
    layers,
    playback,
  );
  assert.deepEqual(evaluator.deformation.get('mesh')!.get('top-left'), { x: 3, y: -2 });
  evaluator.dispose();
});

test('runtime and editor-source rendering consume live channels without creating public snapshots', () => {
  const { rig, clip } = fixture();
  const puppet = new Puppet(puppetScene(), { rig, animations: [clip], skin: 'default', autoUpdate: false });
  const snapshotReads = vi.spyOn(puppet.animationPlayer, 'meshDeformation', 'get');
  puppet.play(clip.name);
  puppet.update(100);
  puppet.update(100);
  assert.equal(snapshotReads.mock.calls.length, 0);
  const source = player(rig, clip);
  const sourceReads = vi.spyOn(source, 'meshDeformation', 'get');
  source.play(clip.name);
  source.sample(500);
  const detach = puppet.attachPoseSource(source);
  puppet.syncPose();
  assert.equal(sourceReads.mock.calls.length, 0);
  assert.deepEqual(puppet.meshDeformation.get('mesh')!.get('top-left'), { x: 6, y: -4 });
  assert.equal(sourceReads.mock.calls.length, 1);
  snapshotReads.mockRestore();
  sourceReads.mockRestore();
  detach();
  source.dispose();
  puppet.destroy();
});

test('public sampling sees edits to mutable and shallow frozen authored keys', () => {
  const keys = [{ time: 0, offsets: { vertex: { x: 1, y: 2 } } }];
  const first = sampleMeshDeformation(keys, 0);
  Object.freeze(keys);
  keys[0]!.offsets.vertex.x = 9;
  assert.deepEqual(sampleMeshDeformation(keys, 0).get('vertex'), { x: 9, y: 2 });
  assert.deepEqual(first.get('vertex'), { x: 1, y: 2 });
  const clip = { deformationTracks: { mesh: keys } };
  const pose = evaluateMeshDeformation(clip, 0);
  keys[0]!.offsets.vertex.y = 7;
  assert.deepEqual(evaluateMeshDeformation(clip, 0).get('mesh')!.get('vertex'), { x: 9, y: 7 });
  assert.deepEqual(pose.get('mesh')!.get('vertex'), { x: 9, y: 2 });
});
