import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { createCharacterDocuments } from '../src/devtools/animation-editor/characterDocuments.js';
import { poseRigSignature } from '../src/devtools/animation-editor/PoseLibrary.js';
import { PoseLibraryController } from '../src/devtools/animation-editor/PoseLibraryController.js';
import { buildCharacterDraft } from '../src/devtools/project/editorDrafts.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { createBoneSymmetryMapping } from '../src/devtools/shared/boneSymmetry.js';
import {
  buildCharacterPackage,
  capturePackage,
  validatePackage,
  type PackageSnapshot,
} from '../src/devtools/shared/package/characterPackage.js';
import { PackageFingerprints } from '../src/devtools/shared/package/PackageFingerprints.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { parsePoseDefinition } from '../src/engine/Pose.js';
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

function fixture() {
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['first.json', 'second.json'],
      poses: ['poses/preset.json'],
      textures: {},
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [
        { id: 'root' },
        { id: 'arm', parent: 'root', x: 10 },
        { id: 'forearm', parent: 'arm', x: 50 },
        { id: 'hand', parent: 'forearm', x: 40 },
      ],
      ik: [{ name: 'reach', rootBone: 'arm', middleBone: 'forearm', endBone: 'hand', target: { x: 55, y: 40 } }],
    },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    animations: {
      'first.json': {
        version: 1,
        name: 'first',
        duration: 1050,
        loop: false,
        tracks: {
          root: [{ time: 0, x: 2 }],
          arm: [
            { time: 0, rotation: 0.1 },
            { time: 1050, rotation: 0.9 },
          ],
        },
        ikTracks: { reach: [{ time: 0, x: 55, y: 40, mix: 0.5 }] },
      },
      'second.json': {
        version: 1,
        name: 'second',
        duration: 1050,
        loop: false,
        tracks: {
          root: [{ time: 0, y: 22 }],
          hand: [{ time: 0, rotation: 0.3 }],
          arm: [{ time: 375, rotation: -0.4, y: 8 }],
        },
        ikTracks: { reach: [{ time: 0, x: 65, y: 25, mix: 0.25 }] },
      },
    },
    poses: { 'poses/preset.json': { version: 1, name: 'Old preset', bones: { arm: { rotation: 0.7 } } } },
  });
  const documents = createCharacterDocuments(definition);
  const state = documents.animation;
  state.selectAnimation('first');
  const snapshot = (): PackageSnapshot => ({
    definition,
    rig: documents.rig.recoveryDraft,
    skins: documents.rig.standaloneSkins,
    animations: state.packageAnimations(),
    poses: state.poseLibrary.packagePoses(),
    replacements: [],
  });
  return { definition, documents, state, snapshot };
}

test('save full FK pose at a continuous playhead, with stable identity and no animation edit', () => {
  const { state, definition } = fixture();
  state.setCurrentTime(0.375);
  const before = state.workingAnimation;
  const history = state.historyLength;
  const source = JSON.stringify(definition.poses);
  const id = state.saveCurrentPose('Sword ready');
  const saved = state.poseLibrary.get(id).pose;
  assert.deepEqual(Object.keys(saved.bones), ['root', 'arm', 'forearm', 'hand']);
  assert.deepEqual(saved.bones.arm, state.getEvaluatedBoneTransform('arm'));
  assert.deepEqual(saved.bones.hand, createTransform(definition.rig.getBone('hand')));
  assert.deepEqual(saved.library, {
    id,
    characterId: 'hero',
    space: 'fk-local',
    rigSignature: poseRigSignature(state.rig!),
  });
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, history);
  assert.isFalse(state.dirty);
  assert.equal(JSON.stringify(definition.poses), source);
  assert.deepEqual(parsePoseDefinition(JSON.parse(JSON.stringify(saved)), definition.rig), saved);
});

test('save selected bones only, reject empty/unknown selection, duplicate/invalid names and temporary drafts', () => {
  const { state } = fixture();
  const id = state.saveCurrentPose('Partial', ['arm', 'hand', 'arm']);
  assert.deepEqual(Object.keys(state.poseLibrary.get(id).pose.bones), ['arm', 'hand']);
  assert.throws(() => state.saveCurrentPose('Empty', []), /Select at least/);
  assert.throws(() => state.saveCurrentPose('Missing', ['ghost']), /Unknown bone/);
  assert.throws(() => state.saveCurrentPose('Partial'), /already exists/);
  assert.throws(() => state.saveCurrentPose('  '));
  state.selectBone('arm');
  state.setTemporaryBoneProperty('rotation', 2);
  assert.throws(() => state.saveCurrentPose('Draft'), /temporary edits/);
  assert.isFalse(state.previewLibraryPose(id));
  assert.isFalse(state.applyLibraryPose(id));
  assert.equal(state.poseLibrary.poses.length, 2);
});

test('non-destructive preview and cancel restore rendered animation, including unrelated bones and IK tracks', () => {
  const { state, definition } = fixture();
  const id = state.saveCurrentPose('Partial', ['arm']);
  state.selectAnimation('second');
  state.setCurrentTime(0.375);
  const puppet = new Puppet(puppetScene(), { rig: definition.rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  const before = state.workingAnimation;
  const history = state.historyLength;
  const original = puppet.exportPose('Original', { onlyChanged: false });
  try {
    assert.isTrue(state.previewLibraryPose(id));
    assert.strictEqual(state.workingAnimation, before);
    assert.equal(state.historyLength, history);
    assert.isFalse(state.dirty);
    const projected = puppet.exportPose('Projected', { onlyChanged: false });
    assert.equal(projected.bones.arm!.rotation, 0.1);
    assert.equal(projected.bones.root!.y, original.bones.root!.y);
    assert.equal(projected.bones.hand!.rotation, original.bones.hand!.rotation);
    state.cancelPosePreview();
    assert.deepEqual(puppet.exportPose('Original', { onlyChanged: false }), original);
    assert.strictEqual(state.workingAnimation, before);
    assert.isFalse(state.canUndo);
  } finally {
    preview.dispose();
    puppet.destroy();
  }
});

test('apply overwrites relevant keys at exact milliseconds as one Undo/Redo edit, preserving other tracks and animations', () => {
  const { state } = fixture();
  state.setCurrentTime(0.375);
  const id = state.saveCurrentPose('Partial', ['arm']);
  const first = state.workingAnimation;
  const value = state.poseLibrary.get(id).pose.bones.arm!.rotation;
  state.selectAnimation('second');
  state.setCurrentTime(0.375);
  const second = state.workingAnimation!;
  const oldRoot = second.tracks.root;
  const ik = second.ikTracks;
  assert.isTrue(state.previewLibraryPose(id));
  assert.isTrue(state.applyLibraryPose(id));
  const applied = state.workingAnimation!;
  assert.isNull(state.previewedPose);
  assert.equal(state.historyLength, 1);
  assert.equal(applied.tracks.arm!.find((key) => key.time === 375)?.rotation, value);
  assert.equal(applied.tracks.arm!.length, 1);
  assert.strictEqual(applied.tracks.root, oldRoot);
  assert.strictEqual(applied.ikTracks, ik);
  assert.equal(applied.tracks.hand![0]!.rotation, 0.3);
  assert.isTrue(state.undo());
  assert.deepEqual(state.workingAnimation, second);
  assert.isTrue(state.redo());
  assert.deepEqual(state.workingAnimation, applied);
  state.selectAnimation('first', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, first);
  state.selectAnimation('second', { keepChanges: true });
  assert.deepEqual(state.workingAnimation, applied);
});

test('stepped FK capture samples held frames; apply preserves the precise endpoint time', () => {
  const { state } = fixture();
  state.setAuthoredPlaybackMode('stepped');
  state.setAuthoredFPS(10);
  state.setCurrentTime(0.375);
  const id = state.saveCurrentPose('Stepped', ['arm']);
  assert.approximately(state.poseLibrary.get(id).pose.bones.arm!.rotation!, 0.1 + (0.8 * 300) / 1050, 1e-12);
  state.setCurrentTime(1.05);
  state.applyLibraryPose(id);
  assert.equal(state.workingAnimation!.tracks.arm!.at(-1)!.time, 1050);
});

test('IK solves once after preview/apply: capture stores FK, never final IK rotations or animated target channels', () => {
  const { state, definition } = fixture();
  state.setCurrentTime(0.375);
  const puppet = new Puppet(puppetScene(), { rig: definition.rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  try {
    const fk = state.getEvaluatedBoneTransform('arm')!.rotation;
    assert.notEqual(puppet.getBone('arm').pose.rotation, fk);
    const id = state.saveCurrentPose('Reach', ['arm', 'forearm']);
    const saved = state.poseLibrary.get(id).pose;
    assert.equal(saved.bones.arm!.rotation, fk);
    assert.isFalse('ikTracks' in saved);
    state.selectAnimation('second');
    state.setCurrentTime(0.375);
    const ik = state.workingAnimation!.ikTracks;
    state.previewLibraryPose(id);
    const previewRotations = [puppet.getBone('arm').pose.rotation, puppet.getBone('forearm').pose.rotation];
    state.applyLibraryPose(id);
    assert.deepEqual([puppet.getBone('arm').pose.rotation, puppet.getBone('forearm').pose.rotation], previewRotations);
    assert.strictEqual(state.workingAnimation!.ikTracks, ik);
    assert.equal(state.getEvaluatedBoneTransform('arm')!.rotation, fk);
    preview.refresh(true);
    preview.refresh(true);
    assert.deepEqual([puppet.getBone('arm').pose.rotation, puppet.getBone('forearm').pose.rotation], previewRotations);
  } finally {
    preview.dispose();
    puppet.destroy();
  }
});

test('exact compatibility rejects foreign characters, changed hierarchy/bind/IK and missing bones, without edits', () => {
  const { state, definition } = fixture();
  const id = state.saveCurrentPose('Exact', ['arm']);
  const pose = state.poseLibrary.get(id).pose;
  for (const file of [
    { ...definition.rigFile!, bones: definition.rigFile!.bones.filter((bone) => bone.id !== 'hand') },
    {
      ...definition.rigFile!,
      bones: definition.rigFile!.bones.map((bone) => (bone.id === 'arm' ? { ...bone, x: 42 } : bone)),
    },
    {
      ...definition.rigFile!,
      bones: definition.rigFile!.bones.map((bone) => (bone.id === 'hand' ? { ...bone, parent: 'arm' } : bone)),
    },
    { ...definition.rigFile!, ik: [] },
  ]) {
    // Missing hand invalidates the old IK; omit it for this incompatible test rig.
    const rig = new Rig({ ...file, ik: [] });
    assert.match(state.poseLibrary.compatibility(id, rig)!, /changed/);
    state.updatePreviewRig(rig);
    const before = state.workingAnimation;
    assert.isFalse(state.previewLibraryPose(id));
    assert.isFalse(state.applyLibraryPose(id));
    assert.strictEqual(state.workingAnimation, before);
  }
  const missing = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  assert.match(state.poseLibrary.compatibility(id, missing)!, /Missing bones: arm/);
  const foreign = new AnimationEditorState(definition.rig, definition.animations, {
    characterId: 'other',
    poses: [pose],
  });
  foreign.selectAnimation('first');
  assert.match(foreign.poseLibrary.compatibility(id, foreign.rig)!, /different character/);
  assert.isFalse(foreign.applyLibraryPose(id));
  assert.equal(
    poseRigSignature(
      new Rig({ root: definition.rig.root, bones: [...definition.rig.bones].reverse(), ik: definition.rig.ik ?? [] }),
    ),
    pose.library!.rigSignature,
  );
});

test('legacy sparse presets remain unchanged, preview/apply only stored properties and gain IDs on explicit rename', () => {
  const { state, definition, snapshot } = fixture();
  const preset = state.poseLibrary.poses[0]!;
  assert.deepEqual(snapshot().poses, definition.poses);
  assert.isUndefined(preset.pose.library);
  assert.isTrue(state.applyLibraryPose(preset.id));
  assert.equal(state.workingAnimation!.tracks.arm![0]!.rotation, 0.7);
  assert.isUndefined(state.workingAnimation!.tracks.arm![0]!.x);
  state.poseLibrary.rename(preset.id, 'Renamed preset');
  assert.equal(state.poseLibrary.get(preset.id).pose.library!.id, preset.id);
  assert.deepEqual(state.poseLibrary.get(preset.id).pose.bones, preset.pose.bones);
  assert.isTrue(state.poseLibrary.undo());
  assert.deepEqual(snapshot().poses, definition.poses);
});

test('library save/rename/delete use their own bounded history and invalidate previews', () => {
  const { state } = fixture();
  const id = state.saveCurrentPose('One');
  const before = state.workingAnimation;
  state.previewLibraryPose(id);
  state.poseLibrary.rename(id, 'Two');
  assert.isNull(state.previewedPose);
  assert.equal(state.poseLibrary.get(id).pose.name, 'Two');
  state.poseLibrary.delete(id);
  assert.throws(() => state.poseLibrary.get(id), /available pose/);
  state.poseLibrary.undo();
  assert.equal(state.poseLibrary.get(id).pose.name, 'Two');
  state.poseLibrary.undo();
  assert.equal(state.poseLibrary.get(id).pose.name, 'One');
  state.poseLibrary.undo();
  assert.equal(state.poseLibrary.poses.length, 1);
  state.poseLibrary.redo();
  assert.equal(state.poseLibrary.get(id).pose.name, 'One');
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.canUndo);
});

test('preview clears on clip/rig/mode/authoring/Undo boundaries; closing/unbinding restores view state', () => {
  const { state, definition } = fixture();
  const id = state.saveCurrentPose('One');
  const controller = new PoseLibraryController();
  controller.bind(state);
  state.previewLibraryPose(id);
  state.selectAnimation('second');
  assert.isNull(state.previewedPose);
  state.previewLibraryPose(id);
  state.undo();
  assert.isNull(state.previewedPose);
  state.previewLibraryPose(id);
  state.setEditorMode('rig-tweak');
  assert.isNull(state.previewedPose);
  state.setEditorMode('animation');
  state.previewLibraryPose(id);
  state.selectBone('arm');
  state.setTemporaryBoneProperty('rotation', 1);
  assert.isNull(state.previewedPose);
  state.cancelTransformEdit();
  state.previewLibraryPose(id);
  state.updatePreviewRig(new Rig(definition.rig));
  assert.isNull(state.previewedPose);
  state.previewLibraryPose(id);
  controller.unbind();
  assert.isNull(state.previewedPose);
  controller.dispose();
});

test('portable character/project ZIPs and local autosave retain IDs, edited presets, partial values and source isolation', async () => {
  const { state, definition, snapshot } = fixture();
  const original = JSON.stringify(definition.poses);
  const id = state.saveCurrentPose('Portable', ['arm']);
  state.poseLibrary.rename(state.poseLibrary.poses[0]!.id, 'Old renamed');
  const captured = capturePackage(snapshot());
  state.poseLibrary.rename(id, 'Newer edit');
  assert.equal(captured.poses!.find((pose) => pose.library?.id === id)!.name, 'Portable');
  const files = await buildCharacterPackage(captured);
  const reloaded = await validatePackage(decodePackageZip(encodePackageZip(files)));
  assert.deepEqual(reloaded.poses, captured.poses);
  assert.equal(reloaded.manifest!.poses![0], 'poses/preset.json');
  const project = new ProjectWorkspace('Poses');
  await project.addCharacter(files);
  const exported = await buildProjectPackage(project);
  const restored = await importProjectPackage(decodePackageZip(encodePackageZip(exported.files)));
  assert.deepEqual(restored.character('hero').definition.poses, captured.poses);
  const recovered = await importProjectPackage(await buildCharacterDraft(captured, 'draft'));
  assert.deepEqual(recovered.character('hero').definition.poses, captured.poses);
  const next = createCharacterDocuments(reloaded).animation;
  next.selectAnimation('second');
  assert.isUndefined(next.poseLibrary.compatibility(id, next.rig));
  assert.isTrue(next.applyLibraryPose(id));
  assert.equal(JSON.stringify(definition.poses), original);
});

test('project validation, dependents, checkpoints and autosave fingerprints follow current library revisions', async () => {
  const { state, snapshot } = fixture();
  const project = new ProjectWorkspace('Poses');
  await project.addCharacter(await buildCharacterPackage(snapshot()));
  project.character('hero').capture = snapshot;
  const exported = await buildProjectPackage(project);
  project.markExported(project.definition, exported.characters, []);
  assert.isFalse(project.characterDirty('hero'));
  const before = project.autosaveRevision;
  const fingerprints = new PackageFingerprints();
  const baseline = fingerprints.compute(snapshot());
  const id = state.saveCurrentPose('Extra', ['hand']);
  assert.isTrue(project.characterDirty('hero'));
  assert.notEqual(project.autosaveRevision, before);
  assert.notEqual(fingerprints.compute(snapshot()).Poses, baseline.Poses);
  assert.isTrue(
    project.dependents({ kind: 'bone', owner: 'hero', id: 'hand' }).some(({ label }) => label.includes('Extra')),
  );
  state.poseLibrary.rename(id, 'Changed');
  assert.isTrue(
    project.dependents({ kind: 'bone', owner: 'hero', id: 'hand' }).some(({ label }) => label.includes('Changed')),
  );
  state.poseLibrary.delete(id);
  state.poseLibrary.undo();
  state.poseLibrary.undo();
  state.poseLibrary.undo();
  assert.equal(project.autosaveRevision, before);
  assert.isFalse(project.characterDirty('hero'));
});

test('applied FK keys remain editable and work with the existing mirror command', () => {
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root', x: 20 }, { id: 'rightArm', parent: 'root', x: -20 }],
  });
  const state = new AnimationEditorState(rig, [
    { name: 'source', duration: 1000, loop: false, tracks: { leftArm: [{ time: 0, rotation: 0.5 }] } },
    { name: 'target', duration: 1000, loop: false, tracks: {} },
  ]);
  state.setSymmetryMapping(
    createBoneSymmetryMapping(rig, { manualPairs: [{ leftBoneId: 'leftArm', rightBoneId: 'rightArm' }] }).mapping!,
  );
  state.selectAnimation('source');
  const id = state.saveCurrentPose('Left arm', ['leftArm']);
  state.selectAnimation('target');
  state.selectBone('leftArm');
  assert.isTrue(state.applyLibraryPose(id));
  assert.isTrue(state.mirrorCurrentPoseToKeys('left-to-right'));
  assert.equal(state.getEvaluatedBonePropertyValue('rightArm', 'rotation'), -0.5);
  assert.isTrue(state.setBonePropertyKeyframe('leftArm', 'rotation', 0.8));
  assert.equal(state.getEvaluatedBonePropertyValue('leftArm', 'rotation'), 0.8);
});

test('metadata validates at the existing pose/character boundaries and duplicate stable IDs reject', () => {
  const { state, definition } = fixture();
  const id = state.saveCurrentPose('Metadata', ['arm']);
  const saved = state.poseLibrary.get(id).pose;
  assert.throws(
    () => parsePoseDefinition({ ...saved, library: { ...saved.library, space: 'post-ik' } }, definition.rig),
    /space/,
  );
  const data = {
    manifest: { ...definition.manifest!, animations: [], poses: ['one.json', 'two.json'] },
    rig: definition.rigFile!,
    skins: { 'skin.json': definition.standaloneSkins[0] },
    poses: { 'one.json': saved, 'two.json': { ...saved, name: 'Other' } },
  };
  assert.throws(() => CharacterDefinition.fromData(data), /Duplicate pose library ID/);
});

test('deleting every pose exports an empty library and no-op rename preserves legacy JSON/checkpoints', async () => {
  const { state, definition, snapshot } = fixture();
  const preset = state.poseLibrary.poses[0]!;
  state.poseLibrary.rename(preset.id, preset.pose.name);
  assert.isFalse(state.poseLibrary.canUndo);
  assert.deepEqual(state.poseLibrary.packagePoses(), definition.poses);
  state.poseLibrary.delete(preset.id);
  const restored = await validatePackage(await buildCharacterPackage(snapshot()));
  assert.deepEqual(restored.poses, []);
  assert.deepEqual(restored.manifest!.poses, []);
});

test('library history cannot restore missing-bone references after a separate rig edit', () => {
  const { state, definition } = fixture();
  const preset = state.poseLibrary.poses[0]!;
  state.poseLibrary.delete(preset.id);
  state.updatePreviewRig(new Rig({ root: 'root', bones: [{ id: 'root' }] }));
  assert.throws(() => state.poseLibrary.undo(), /Undo the rig changes first/);
  assert.equal(state.poseLibrary.poses.length, 0);
  assert.isTrue(state.poseLibrary.canUndo);
  state.updatePreviewRig(definition.rig);
  assert.isTrue(state.poseLibrary.undo());
  assert.equal(state.poseLibrary.get(preset.id).pose.name, preset.pose.name);
});
