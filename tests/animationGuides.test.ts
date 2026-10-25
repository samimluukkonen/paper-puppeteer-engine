import { assert, test, vi } from 'vitest';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { MotionPreviewController } from '../src/devtools/animation-editor/MotionPreviewController.js';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { getGuidesForEditor } from '../src/devtools/shared/guides/registry.js';
import { workspaceGuideHost } from '../src/devtools/shared/guides/workspaceGuideHost.js';
import { createCharacterDocuments, createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import { demoCharacter } from './helpers/demoCharacter.js';

const guides = getGuidesForEditor('animation');
function workspace(existing = false) {
  const documents = existing
    ? createCharacterDocuments(demoCharacter)
    : createNewCharacter({ name: 'Guide rig', id: 'guide-rig' });
  const launcher = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'animation',
      getAnimation: () => documents.animation,
      getRig: () => documents.rig,
      navigate: () => {
        documents.animation.setEditorMode('animation');
        return true;
      },
    }),
  );
  return { ...documents, launcher };
}

test('Animation Editor catalog contains twenty-three bounded task guides, declared anchors and correct categories', () => {
  assert.lengthOf(guides, 23);
  const anchors = new Set<string>(Object.values(GUIDE_TARGETS));
  for (const guide of guides) {
    assert.equal(guide.category, guide.id.startsWith('animation-ik-') ? 'ik' : 'animation');
    assert.isAtLeast(guide.steps.length, 3);
    assert.isAtMost(guide.steps.length, guide.id === 'animation-environment-preview' ? 10 : 7);
    for (const step of guide.steps) {
      assert.isTrue(anchors.has(step.targetId), `${guide.id}/${step.id}`);
      assert.equal(step.preparation, 'reveal-target');
    }
  }
});

test('missing character, no clip, empty clip, bone keys and optional IK have live prerequisite reasons', () => {
  const unloaded = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'animation',
      getAnimation: () => undefined,
      getRig: () => undefined,
      navigate: () => true,
    }),
  );
  for (const guide of guides)
    assert.deepEqual(unloaded.getAvailability(guide.id), {
      available: false,
      reason: 'Load or create a character first.',
    });
  const { animation, rig, launcher } = workspace();
  for (const guide of guides)
    assert.equal(
      launcher.getAvailability(guide.id).available,
      ['animation-new', 'animation-rig-tweak', 'animation-ground-reference'].includes(guide.id),
    );
  animation.createAnimation({ name: 'empty' });
  launcher.refresh();
  for (const guide of guides)
    assert.equal(
      launcher.getAvailability(guide.id).available,
      !['animation-keyframe-editing', 'animation-ik-targets', 'animation-ik-baking'].includes(guide.id),
      guide.id,
    );
  assert.include(
    JSON.stringify(launcher.getAvailability('animation-keyframe-editing')),
    'Create a bone property key first',
  );
  assert.include(JSON.stringify(launcher.getAvailability('animation-ik-targets')), 'Add an IK constraint');
  animation.setBonePropertyKeyframe('root', 'x', 1);
  rig.createBone('segment', 'root');
  rig.editBone('segment', 'x', 20);
  rig.createBone('tip', 'segment');
  rig.editBone('tip', 'x', 20);
  rig.createIKConstraint({ name: 'reach-any-name', rootBone: 'root', middleBone: 'segment', endBone: 'tip' });
  animation.updatePreviewRig(rig.rig);
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('animation-keyframe-editing').available);
  assert.include(JSON.stringify(launcher.getAvailability('animation-ik-targets')), 'select an IK constraint');
  assert.include(JSON.stringify(launcher.getAvailability('animation-ik-baking')), 'Create authored IK');
  animation.selectIKConstraint('reach-any-name');
  animation.setIKPropertyKeyframe('reach-any-name', 'x', 30);
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('animation-ik-targets').available);
  assert.isTrue(launcher.getAvailability('animation-ik-baking').available);
  animation.createAnimation({ name: 'another-empty' });
  launcher.refresh();
  assert.isFalse(launcher.getAvailability('animation-keyframe-editing').available);
  assert.isFalse(launcher.getAvailability('animation-ik-baking').available);
});

test.each(['no-clip', 'empty', 'existing', 'ik', 'draft', 'library'] as const)(
  'all available guides navigate and exit without authoring: %s',
  (kind) => {
    const { animation, rig, launcher } = workspace(kind === 'existing' || kind === 'ik');
    if (kind === 'empty' || kind === 'draft' || kind === 'library') animation.createAnimation({ name: 'empty' });
    if (kind === 'library') {
      const id = animation.saveCurrentPose('Saved pose');
      animation.poseLibrary.rename(id, 'Renamed pose');
      animation.poseLibrary.undo();
    }
    if (kind === 'existing' || kind === 'ik') {
      animation.selectAnimation(animation.animationIds[0]!);
      animation.setBonePropertyKeyframe(rig.workingCopy.root, 'x', 23);
    }
    if (kind === 'ik') {
      const id = rig.workingCopy.ik![0]!.name;
      animation.selectIKConstraint(id);
      animation.setIKPropertyKeyframe(id, 'x', 20);
    }
    if (kind === 'draft') {
      animation.selectBone('root');
      animation.setTemporaryBoneProperty('x', 41);
    }
    rig.editBone(rig.workingCopy.root, 'y', 11);
    launcher.refresh();
    const before = {
      rig: rig.workingCopy,
      clip: animation.workingAnimation,
      ids: animation.animationIds,
      session: animation.sessionRevision,
      preview: animation.previewAnimation,
      json: JSON.stringify(animation.workingAnimation),
      history: animation.historyLength,
      rigHistory: rig.historyLength,
      dirty: animation.dirty,
      rigDirty: rig.dirty,
      time: animation.currentTime,
      playing: animation.isPlaying,
      selection: animation.selectedBoneId,
      ik: animation.selectedIKConstraintId,
      draft: animation.boneTransformDraft,
      poses: animation.poseLibrary.packagePoses(),
      libraryUndo: animation.poseLibrary.canUndo,
      libraryRedo: animation.poseLibrary.canRedo,
    };
    const notify = vi.fn();
    const release = animation.subscribe(notify);
    const targets = { resolve: () => ({ x: 1, y: 2, width: 200, height: 100 }), reveal: vi.fn(() => true) };
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
    assert.strictEqual(animation.workingAnimation, before.clip);
    assert.strictEqual(animation.animationIds, before.ids);
    assert.equal(animation.sessionRevision, before.session);
    assert.strictEqual(animation.previewAnimation, before.preview);
    assert.equal(JSON.stringify(animation.workingAnimation), before.json);
    assert.equal(animation.historyLength, before.history);
    assert.equal(rig.historyLength, before.rigHistory);
    assert.equal(animation.dirty, before.dirty);
    assert.equal(rig.dirty, before.rigDirty);
    assert.equal(animation.currentTime, before.time);
    assert.equal(animation.isPlaying, before.playing);
    assert.equal(animation.selectedBoneId, before.selection);
    assert.equal(animation.selectedIKConstraintId, before.ik);
    assert.deepEqual(animation.boneTransformDraft, before.draft);
    assert.strictEqual(animation.poseLibrary.packagePoses(), before.poses);
    assert.equal(animation.poseLibrary.canUndo, before.libraryUndo);
    assert.equal(animation.poseLibrary.canRedo, before.libraryRedo);
    assert.lengthOf(notify.mock.calls, 0);
    release();
  },
);

test.each([false, true])(
  'Environment Preview guide only reveals controls and preserves preview state; configured=%s',
  (configured) => {
    const { animation, launcher } = workspace();
    const guide = guides.find((entry) => entry.id === 'animation-environment-preview')!;
    assert.deepEqual(launcher.getAvailability(guide.id), {
      available: false,
      reason: 'Create or select an animation first.',
    });
    animation.createAnimation({ name: 'empty' });
    const environment = new EnvironmentPreviewController();
    const motion = new MotionPreviewController();
    motion.bind(animation);
    if (configured) {
      environment.update({ enabled: true, x: 310, y: 420, scale: 0.5 });
      environment.updateCamera({ mode: 'follow', x: 400, y: 450, zoom: 0.75 });
      motion.update({
        enabled: true,
        positionKeys: [
          { time: 0, offsetX: 0, offsetY: 0 },
          { time: 500, offsetX: 60, offsetY: -30 },
        ],
      });
    }
    animation.setCurrentTime(0.3);
    animation.setPreviewLoop(true);
    animation.setPlaybackSpeed(2);
    animation.play();
    const before = {
      environment: environment.getSnapshot(),
      motion: motion.getSnapshot(),
      clip: animation.workingAnimation,
      history: animation.historyLength,
      dirty: animation.dirty,
    };
    const events = vi.fn();
    animation.onAnimationEvent(events);
    launcher.refresh();
    assert.isTrue(launcher.getAvailability(guide.id).available);
    assert.lengthOf(guide.steps, 10);
    assert.isTrue(launcher.launch(guide.id).ok);
    const targets = { resolve: () => ({ x: 0, y: 0, width: 200, height: 40 }), reveal: vi.fn(() => true) };
    for (const step of guide.steps) {
      assert.equal(step.mode, 'explain');
      assert.equal(step.preparation, 'reveal-target');
      assert.isUndefined(step.prerequisites);
      assert.equal(launcher.controller.getSnapshot().currentStep?.id, step.id);
      assert.isTrue(launcher.controller.prepareCurrentStep(targets).ok);
      assert.deepEqual(targets.reveal.mock.lastCall, [step.targetId]);
      if (step !== guide.steps.at(-1)) assert.isTrue(launcher.controller.next().ok);
    }
    assert.isTrue(launcher.controller.finish().ok);
    assert.strictEqual(environment.getSnapshot(), before.environment);
    assert.strictEqual(motion.getSnapshot(), before.motion);
    assert.strictEqual(animation.workingAnimation, before.clip);
    assert.equal(animation.historyLength, before.history);
    assert.equal(animation.dirty, before.dirty);
    assert.equal(animation.currentTime, 0.3);
    assert.isTrue(animation.isPlaying);
    assert.isTrue(animation.previewLoop);
    assert.equal(animation.playbackSpeed, 2);
    assert.lengthOf(events.mock.calls, 0);
    const instructions = guide.steps.map((step) => step.description).join(' ');
    for (const phrase of [
      'PNG',
      'WebP',
      'image center',
      'middle drag',
      'project ZIP',
      'Local drafts',
      'preferences',
      'IK targets',
      'Fixed',
      'Follow Character',
      'Reset Camera',
      'continuous travel',
      'same time',
      'ordinary editor viewport',
      'animation events',
    ])
      assert.include(instructions, phrase);
    motion.dispose();
    environment.dispose();
  },
);

test.each([false, true])(
  'Preview Displacement guide needs only a selected clip and preserves session preferences; configured=%s',
  (configured) => {
    const { animation, launcher } = workspace();
    const guide = guides.find((entry) => entry.id === 'animation-preview-displacement')!;
    assert.deepEqual(launcher.getAvailability(guide.id), {
      available: false,
      reason: 'Create or select an animation first.',
    });
    animation.createAnimation({ name: 'empty' });
    const motion = new MotionPreviewController();
    motion.bind(animation);
    if (configured)
      motion.update({
        enabled: true,
        positionKeys: [
          { time: 0, offsetX: 0, offsetY: 0 },
          { time: 500, offsetX: 40, offsetY: -80 },
        ],
        interpolation: 'stepped',
        showTrajectory: false,
      });
    animation.setCurrentTime(0.3);
    launcher.refresh();
    const before = motion.getSnapshot();
    assert.isTrue(launcher.getAvailability(guide.id).available);
    assert.lengthOf(guide.steps, 7);
    assert.isTrue(launcher.launch(guide.id).ok);
    const targets = { resolve: () => ({ x: 0, y: 0, width: 200, height: 40 }), reveal: () => true };
    for (const [index, step] of guide.steps.entries()) {
      assert.equal(step.mode, 'explain');
      assert.equal(step.preparation, 'reveal-target');
      assert.equal(launcher.controller.getSnapshot().currentStep?.id, step.id);
      assert.isTrue(launcher.controller.prepareCurrentStep(targets).ok);
      if (index < guide.steps.length - 1) assert.isTrue(launcher.controller.next().ok);
    }
    assert.isTrue(launcher.controller.finish().ok);
    assert.strictEqual(motion.getSnapshot(), before);
    assert.equal(animation.currentTime, 0.3);
    motion.dispose();
  },
);
