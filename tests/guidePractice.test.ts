import { assert, test } from 'vitest';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { workspaceGuideHost } from '../src/devtools/shared/guides/workspaceGuideHost.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';

function workspace() {
  const documents = createNewCharacter({ name: 'Practice', id: 'practice' });
  documents.animation.createAnimation({ name: 'practice' });
  documents.animation.setEditorMode('animation');
  let onion = false;
  const launcher = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'animation',
      getAnimation: () => documents.animation,
      getRig: () => documents.rig,
      getOnionEnabled: () => onion,
      navigate: () => true,
    }),
  );
  return {
    ...documents,
    launcher,
    setOnion: (value: boolean) => {
      onion = value;
      launcher.refresh();
    },
  };
}

test('practice completion follows authoritative selection, key presence and preview preferences; never advances', () => {
  const { animation, launcher, setOnion } = workspace();
  const controller = launcher.controller;
  launcher.launch('animation-first-keyframe');
  const before = animation.workingAnimation;
  assert.notInclude(controller.getSnapshot().context.capabilities, 'selected-bone');
  animation.selectBone('root');
  launcher.refresh();
  assert.include(controller.getSnapshot().context.capabilities, 'selected-bone');
  assert.equal(controller.getSnapshot().stepIndex, 0);
  assert.strictEqual(animation.workingAnimation, before);
  controller.next();
  controller.next();
  controller.next();
  const step = controller.getSnapshot().currentStep!;
  assert.equal(step.mode, 'try-it');
  if (step.mode !== 'try-it') throw new Error('Expected practice');
  assert.isTrue(step.practice.changesProject);
  assert.notInclude(controller.getSnapshot().context.capabilities, 'selected-x-key');
  const history = animation.historyLength;
  animation.setTemporaryBoneProperty('x', 42);
  animation.commitBoneProperty('x');
  launcher.refresh();
  assert.include(controller.getSnapshot().context.capabilities, 'selected-x-key');
  assert.equal(controller.getSnapshot().stepIndex, 3);
  assert.equal(animation.historyLength, history + 1);
  assert.isTrue(animation.dirty);
  animation.undo();
  launcher.refresh();
  assert.notInclude(controller.getSnapshot().context.capabilities, 'selected-x-key');
  animation.redo();
  launcher.refresh();
  assert.include(controller.getSnapshot().context.capabilities, 'selected-x-key');
  controller.restart();
  assert.equal(controller.getSnapshot().stepIndex, 0);
  controller.exit();
  launcher.launch('animation-onion-skinning');
  setOnion(true);
  assert.include(controller.getSnapshot().context.capabilities, 'onion-enabled');
  assert.equal(controller.getSnapshot().stepIndex, 0);
  setOnion(false);
  assert.notInclude(controller.getSnapshot().context.capabilities, 'onion-enabled');
});

test('restart preserves authored data, drafts, history and playback; prerequisites point to real guides', () => {
  const { animation, rig, launcher } = workspace();
  launcher.launch('animation-first-keyframe');
  animation.selectBone('root');
  animation.setTemporaryBoneProperty('x', 31);
  launcher.refresh();
  const before = {
    clip: animation.workingAnimation,
    rig: rig.workingCopy,
    history: animation.historyLength,
    draft: animation.boneTransformDraft,
    time: animation.currentTime,
    playing: animation.isPlaying,
  };
  launcher.controller.next();
  assert.isTrue(launcher.controller.restart().ok);
  assert.strictEqual(animation.workingAnimation, before.clip);
  assert.strictEqual(rig.workingCopy, before.rig);
  assert.equal(animation.historyLength, before.history);
  assert.strictEqual(animation.boneTransformDraft, before.draft);
  assert.equal(animation.currentTime, before.time);
  assert.equal(animation.isPlaying, before.playing);
  launcher.controller.exit();
  assert.isFalse(launcher.controller.restart().ok);
  assert.equal(launcher.getPrerequisiteGuide('animation-keyframe-editing')?.id, 'animation-first-keyframe');
  animation.cancelTransformEdit();
  assert.isTrue(animation.selectAnimation(null, { keepChanges: true }));
  launcher.refresh();
  assert.equal(launcher.getPrerequisiteGuide('animation-first-keyframe')?.id, 'animation-new');
});

test('practice loses completion with selection and cannot restart without a clip', () => {
  const { animation, launcher } = workspace();
  launcher.launch('animation-first-keyframe');
  animation.selectBone('root');
  launcher.refresh();
  animation.selectBone(null);
  launcher.refresh();
  assert.notInclude(launcher.controller.getSnapshot().context.capabilities, 'selected-bone');
  animation.selectAnimation(null, { keepChanges: true });
  launcher.refresh();
  assert.isFalse(launcher.controller.getSnapshot().availability.available);
  assert.isFalse(launcher.controller.restart().ok);
  assert.isTrue(launcher.controller.exit().ok);
  assert.isFalse(launcher.launch('animation-first-keyframe').ok);
});
