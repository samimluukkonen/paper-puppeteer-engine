import { assert, test, vi } from 'vitest';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { getGuidesForEditor } from '../src/devtools/shared/guides/registry.js';
import { workspaceGuideHost } from '../src/devtools/shared/guides/workspaceGuideHost.js';
import { createCharacterDocuments, createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import { demoCharacter } from './helpers/demoCharacter.js';

const guides = getGuidesForEditor('rig');
const counts = {
  'rig-new-character': 3,
  'rig-creating-bones': 5,
  'rig-joint-editing': 6,
  'rig-importing-artwork': 5,
  'rig-aligning-sprites': 5,
  'rig-slots-attachments': 5,
  'rig-skins': 5,
  'rig-ik-constraints': 6,
  'rig-exporting': 4,
  'rig-foot-contact-markers': 5,
};

test('Rig Editor catalog covers the ten implemented tasks with bounded steps and declared targets', () => {
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
    if (['rig-aligning-sprites', 'rig-ik-constraints'].includes(guide.id)) {
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
  assert.isTrue(launcher.getAvailability('rig-aligning-sprites').available);
  assert.isTrue(launcher.getAvailability('rig-ik-constraints').available);
  rig.removeIKConstraint('reach');
  rig.removeAttachment('image');
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('rig-aligning-sprites').available);
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
      animation.setBonePropertyKeyframe(rig.workingCopy.root, 'x', 23);
    }
    const before = {
      rig: rig.workingCopy,
      rigJson: JSON.stringify(rig.workingCopy),
      rigHistory: rig.historyLength,
      rigDirty: rig.dirty,
      skin: rig.activeSkin,
      selection: rig.selection,
      ik: rig.selectedIKConstraintId,
      animation: animation.workingAnimation,
      animationHistory: animation.historyLength,
      animationDirty: animation.dirty,
      time: animation.currentTime,
      playing: animation.isPlaying,
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
    assert.strictEqual(animation.workingAnimation, before.animation);
    assert.equal(animation.historyLength, before.animationHistory);
    assert.equal(animation.dirty, before.animationDirty);
    assert.equal(animation.currentTime, before.time);
    assert.equal(animation.isPlaying, before.playing);
    assert.lengthOf(authored.mock.calls, 0);
  },
);
