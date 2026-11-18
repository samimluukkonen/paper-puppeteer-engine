import { assert, test, vi } from 'vitest';
import { createCharacterDocuments, createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import { workspaceGuideHost } from '../src/devtools/animation-editor/workspaceGuideHost.js';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { getGuidesForEditor } from '../src/devtools/shared/guides/registry.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { demoCharacter } from './helpers/demoCharacter.js';

const guides = getGuidesForEditor('rig');
const counts = {
  'rig-new-character': 3,
  'rig-creating-bones': 5,
  'rig-joint-editing': 6,
  'rig-importing-artwork': 5,
  'rig-aligning-sprites': 5,
  'rig-creating-mesh': 5,
  'rig-mesh-geometry': 8,
  'rig-weight-painting': 9,
  'rig-slots-attachments': 5,
  'rig-skins': 5,
  'rig-ik-constraints': 8,
  'rig-exporting': 4,
  'rig-foot-contact-markers': 5,
};

test('Rig Editor catalog covers the thirteen implemented tasks with declared targets', () => {
  assert.deepEqual(Object.fromEntries(guides.map((guide) => [guide.id, guide.steps.length])), counts);
  const anchors = new Set<string>(Object.values(GUIDE_TARGETS));
  for (const guide of guides) {
    for (const step of guide.steps) {
      assert.isTrue(anchors.has(step.targetId), `${guide.id}/${step.id}`);
      assert.equal(step.preparation, 'reveal-target', 'only UI reveal preparation is registered');
      assert.isNotEmpty(step.description);
    }
  }
});

function workspace(existing: boolean) {
  const documents = existing
    ? createCharacterDocuments(demoCharacter)
    : createNewCharacter({ name: 'Empty rig', id: 'empty-rig' });
  documents.animation.setEditorMode('rig');
  const navigate = vi.fn(() => true);
  const launcher = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'rig',
      getAnimation: () => documents.animation,
      getRig: () => documents.rig,
      navigate,
    }),
  );
  return { ...documents, launcher, navigate };
}

test('root-only rigs offer creation tasks and explain artwork and IK prerequisites; facts update after authoring', () => {
  const { rig, launcher } = workspace(false);
  for (const guide of guides) {
    const availability = launcher.getAvailability(guide.id);
    if (
      [
        'rig-aligning-sprites',
        'rig-ik-constraints',
        'rig-creating-mesh',
        'rig-mesh-geometry',
        'rig-weight-painting',
      ].includes(guide.id)
    ) {
      assert.isFalse(availability.available);
      assert.isFalse(launcher.launch(guide.id).ok);
    } else assert.isTrue(availability.available, guide.id);
  }
  assert.include(JSON.stringify(launcher.getAvailability('rig-aligning-sprites')), 'Importing Artwork');
  assert.include(JSON.stringify(launcher.getAvailability('rig-ik-constraints')), 'three connected bones');
  rig.createBone('middle', 'root');
  rig.editBone('middle', 'x', 20);
  rig.createBone('end', 'middle');
  rig.editBone('end', 'x', 20);
  rig.createIKConstraint({ name: 'reach', rootBone: 'root', middleBone: 'middle', endBone: 'end' });
  rig.createAttachment({ id: 'image', texture: 'new-art' });
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-mesh-geometry').available);
  rig.createSlot('art', 'root');
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('rig-mesh-geometry').available);
  assert.isTrue(launcher.getAvailability('rig-aligning-sprites').available);
  assert.isTrue(launcher.getAvailability('rig-ik-constraints').available);
  rig.removeIKConstraint('reach');
  rig.removeAttachment('image');
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-aligning-sprites').available);
  assert.isFalse(launcher.getAvailability('rig-mesh-geometry').available);
  assert.isFalse(launcher.getAvailability('rig-ik-constraints').available);
});

test('an unloaded workspace can teach New Character while document-dependent guides explain the requirement', () => {
  const launcher = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'rig',
      getAnimation: () => undefined,
      getRig: () => undefined,
      navigate: () => true,
    }),
  );
  for (const guide of guides) {
    const availability = launcher.getAvailability(guide.id);
    if (guide.id === 'rig-new-character') assert.isTrue(availability.available);
    else assert.deepEqual(availability, { available: false, reason: 'Load or create a character first.' });
  }
  assert.isTrue(launcher.launch('rig-new-character').ok);
  assert.isTrue(launcher.controller.exit().ok);
});

test.each([false, true])(
  'every available guide navigates, finishes and exits at every step without authoring; existing=%s',
  (existing) => {
    const { rig, animation, launcher } = workspace(existing);
    rig.editBone(rig.workingCopy.root, 'x', 19);
    if (animation.animationIds.length) {
      animation.selectAnimation(animation.animationIds[0]!);
      animation.keyframes.setBonePropertyKeyframe(rig.workingCopy.root, 'x', 23);
    }
    const before = {
      rig: rig.workingCopy,
      rigJson: JSON.stringify(rig.workingCopy),
      rigHistory: rig.historyLength,
      rigDirty: rig.dirty,
      skin: rig.activeSkin,
      selection: rig.selection,
      ik: rig.selectedIKConstraintId,
      editMode: rig.editMode,
      meshVertex: rig.selectedMeshVertexId,
      meshEdge: rig.selectedMeshEdge,
      animation: animation.workingAnimation,
      animationHistory: animation.historyLength,
      animationDirty: animation.dirty,
      time: animation.currentTime,
      playing: animation.playback.isPlaying,
    };
    const authored = vi.fn();
    animation.subscribe(authored);
    const targets = { resolve: () => ({ x: 1, y: 2, width: 300, height: 400 }), reveal: vi.fn(() => true) };
    for (const guide of guides) {
      if (!launcher.getAvailability(guide.id).available) continue;
      for (let exitAt = 0; exitAt < guide.steps.length; exitAt++) {
        assert.isTrue(launcher.launch(guide.id).ok);
        for (let index = 0; index <= exitAt; index++) {
          assert.strictEqual(launcher.controller.getSnapshot().currentStep, guide.steps[index]);
          assert.isTrue(launcher.controller.prepareCurrentStep(targets).ok);
          assert.deepEqual(targets.reveal.mock.lastCall, [guide.steps[index]!.targetId]);
          if (index < exitAt) assert.isTrue(launcher.controller.next().ok);
        }
        assert.isTrue(launcher.controller.exit().ok);
      }
      launcher.launch(guide.id);
      for (let index = 1; index < guide.steps.length; index++) assert.isTrue(launcher.controller.next().ok);
      assert.isTrue(launcher.controller.previous().ok);
      assert.isTrue(launcher.controller.next().ok);
      assert.isTrue(launcher.controller.finish().ok);
    }
    assert.strictEqual(rig.workingCopy, before.rig);
    assert.equal(JSON.stringify(rig.workingCopy), before.rigJson);
    assert.equal(rig.historyLength, before.rigHistory);
    assert.equal(rig.dirty, before.rigDirty);
    assert.equal(rig.activeSkin, before.skin);
    assert.strictEqual(rig.selection, before.selection);
    assert.equal(rig.selectedIKConstraintId, before.ik);
    assert.equal(rig.editMode, before.editMode);
    assert.equal(rig.selectedMeshVertexId, before.meshVertex);
    assert.strictEqual(rig.selectedMeshEdge, before.meshEdge);
    assert.strictEqual(animation.workingAnimation, before.animation);
    assert.equal(animation.historyLength, before.animationHistory);
    assert.equal(animation.dirty, before.animationDirty);
    assert.equal(animation.currentTime, before.time);
    assert.equal(animation.playback.isPlaying, before.playing);
    assert.lengthOf(authored.mock.calls, 0);
  },
);

test('mesh guide rejects atlas-only artwork and accepts an existing mesh without a rigid source', () => {
  const { rig, launcher } = workspace(false);
  rig.createSlot('art', 'root');
  rig.createAttachment({ id: 'atlas', texture: 'art', frame: 'sleeve' });
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-mesh-geometry').available);
  assert.equal(launcher.getPrerequisiteGuide('rig-mesh-geometry')?.id, 'rig-slots-attachments');
  rig.removeAttachment('atlas');
  rig.createAttachment(
    createRectangleMeshAttachment({ id: 'mesh', texture: 'art' }, { width: 40, height: 80 }, rig.workingCopy),
  );
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('rig-mesh-geometry').available);
  rig.beginOperation();
  rig.editSlot('art', 'depth', 1);
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-mesh-geometry').available);
  rig.cancelOperation();
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('rig-mesh-geometry').available);
});

test('mesh guide preserves an authored mesh, vertex and edge selection, mode, skin and history', () => {
  const { rig, launcher } = workspace(true);
  const slot = rig.workingCopy.slots!.find((entry) => rig.resolvedAttachment(entry.id))!;
  rig.selectSlot(slot.id);
  rig.convertSelectedSpriteToMesh({ width: 40, height: 80 });
  rig.selectedMeshEdge = [0, 2];
  rig.subdivideSelectedMeshEdge();
  rig.selectedMeshEdge = [0, 4];
  const copy = rig.workingCopy,
    history = rig.historyLength,
    skin = rig.activeSkin;
  const selected = rig.selection,
    vertex = rig.selectedMeshVertexId,
    edge = rig.selectedMeshEdge;
  const before = JSON.stringify(copy);
  assert.isTrue(launcher.launch('rig-mesh-geometry').ok);
  for (let i = 0; i < 7; ++i) assert.isTrue(launcher.controller.next().ok);
  assert.isTrue(launcher.controller.finish().ok);
  assert.strictEqual(rig.workingCopy, copy);
  assert.equal(JSON.stringify(rig.workingCopy), before);
  assert.equal(rig.historyLength, history);
  assert.equal(rig.activeSkin, skin);
  assert.strictEqual(rig.selection, selected);
  assert.equal(rig.selectedMeshVertexId, vertex);
  assert.strictEqual(rig.selectedMeshEdge, edge);
  assert.equal(rig.editMode, 'mesh');
});

test('weight guide requires a valid selected mesh in Paint mode and directs artists to mesh setup', () => {
  const { rig, launcher } = workspace(true);
  assert.isFalse(launcher.getAvailability('rig-weight-painting').available);
  assert.equal(launcher.getPrerequisiteGuide('rig-weight-painting')?.id, 'rig-mesh-geometry');
  const slot = rig.workingCopy.slots!.find((entry) => rig.resolvedAttachment(entry.id))!;
  rig.selectSlot(slot.id);
  rig.convertSelectedSpriteToMesh({ width: 40, height: 80 });
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-weight-painting').available);
  rig.editMode = 'weights';
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('rig-weight-painting').available);
  rig.selectBone(rig.workingCopy.root);
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-weight-painting').available);
  rig.selectSlot(slot.id);
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('rig-weight-painting').available);
  rig.beginOperation();
  rig.editSlot(slot.id, 'depth', 1);
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-weight-painting').available);
  rig.cancelOperation();
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('rig-weight-painting').available);
  rig.selectSkin(rig.defaultSkin);
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-weight-painting').available);
});

test('weight guide reveals every step and exits without changing painted data, settings, selection or history', () => {
  const { rig, animation, launcher } = workspace(true);
  const slot = rig.workingCopy.slots!.find((entry) => rig.resolvedAttachment(entry.id))!;
  rig.selectSlot(slot.id);
  rig.convertSelectedSpriteToMesh({ width: 40, height: 80 });
  rig.selectedMeshEdge = [0, 2];
  rig.subdivideSelectedMeshEdge();
  rig.editMode = 'weights';
  rig.selectWeightBone(rig.workingCopy.bones.find((bone) => bone.id !== rig.meshSlotBoneId)!.id);
  rig.editSelectedVertexWeight(0.65);
  rig.brushRadius = 47;
  rig.brushStrength = 0.35;
  rig.brushErase = true;
  rig.setWeightInfluenceLimit(3);
  const before = {
    copy: rig.workingCopy,
    history: rig.historyLength,
    skin: rig.activeSkin,
    selection: rig.selection,
    vertex: rig.selectedMeshVertexId,
    bone: rig.weightBoneId,
    animation: animation.workingAnimation,
    animationHistory: animation.historyLength,
  };
  const targets = { resolve: () => ({ x: 1, y: 2, width: 100, height: 28 }), reveal: vi.fn(() => true) };
  const guide = guides.find((entry) => entry.id === 'rig-weight-painting')!;
  for (let exitAt = 0; exitAt < guide.steps.length; exitAt++) {
    assert.isTrue(launcher.launch(guide.id).ok);
    for (let index = 0; index <= exitAt; index++) {
      assert.isTrue(launcher.controller.prepareCurrentStep(targets).ok);
      assert.deepEqual(targets.reveal.mock.lastCall, [guide.steps[index]!.targetId]);
      if (index < exitAt) assert.isTrue(launcher.controller.next().ok);
    }
    assert.isTrue(launcher.controller.exit().ok);
  }
  assert.isTrue(launcher.launch(guide.id).ok);
  for (let i = 1; i < guide.steps.length; i++) assert.isTrue(launcher.controller.next().ok);
  assert.isTrue(launcher.controller.previous().ok);
  assert.isTrue(launcher.controller.next().ok);
  assert.isTrue(launcher.controller.finish().ok);
  assert.strictEqual(rig.workingCopy, before.copy);
  assert.equal(rig.historyLength, before.history);
  assert.equal(rig.activeSkin, before.skin);
  assert.strictEqual(rig.selection, before.selection);
  assert.equal(rig.selectedMeshVertexId, before.vertex);
  assert.equal(rig.weightBoneId, before.bone);
  assert.equal(rig.editMode, 'weights');
  assert.equal(rig.brushRadius, 47);
  assert.equal(rig.brushStrength, 0.35);
  assert.isTrue(rig.brushErase);
  assert.equal(rig.weightInfluenceLimit, 3);
  assert.strictEqual(animation.workingAnimation, before.animation);
  assert.equal(animation.historyLength, before.animationHistory);
  rig.undo();
  assert.isFalse(
    rig.selectedMesh!.vertices.some((vertex) =>
      vertex.influences?.some((entry) => entry.boneId === before.bone && entry.weight === 0.65),
    ),
  );
  rig.redo();
  assert.deepEqual(rig.workingCopy, before.copy);
});
