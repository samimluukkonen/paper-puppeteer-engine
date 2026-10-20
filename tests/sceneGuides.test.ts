import { assert, test } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { guideRegistry } from '../src/devtools/shared/guides/registry.js';
import { sceneGuideHost } from '../src/devtools/shared/guides/sceneGuideHost.js';

test('scene tours gate missing documents and selections, and explain tours preserve history and exported data', () => {
  const document = new SceneEditorDocument();
  const launcher = new GuideLauncher(sceneGuideHost(document));
  assert.lengthOf(guideRegistry.getGuidesForEditor('scene'), 8);
  assert.deepEqual(launcher.getAvailability('scene-creating'), { available: true });
  assert.isFalse(launcher.getAvailability('scene-adding-actor').available);
  assert.equal(launcher.getPrerequisiteGuide('scene-adding-actor')?.id, 'scene-creating');
  assert.isTrue(document.createScene({ id: 'tour' }));
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('scene-adding-actor').available);
  assert.isFalse(launcher.getAvailability('scene-positioning').available);
  document.addActor('../characters/demo/character.json');
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('scene-positioning').available);
  assert.isFalse(launcher.getAvailability('scene-timing').available);
  document.addAction({ actorId: document.selectedActorId!, type: 'wait', time: 0, duration: 1000 });
  launcher.refresh();
  const original = document.workingScene;
  const json = document.exportJson();
  const history = [document.canUndo, document.canRedo];
  for (const guide of guideRegistry.getGuidesForEditor('scene')) {
    assert.isTrue(launcher.launch(guide.id).ok);
    for (let i = 1; i < guide.steps.length; i++) assert.isTrue(launcher.controller.next().ok);
    launcher.controller.exit();
    assert.isTrue(guide.steps.every((step) => step.mode !== 'try-it'));
  }
  assert.strictEqual(document.workingScene, original);
  assert.equal(document.exportJson(), json);
  assert.deepEqual([document.canUndo, document.canRedo], history);
  assert.isFalse(launcher.getAvailability('rig-new-character').available);
  assert.isFalse(launcher.launch('rig-new-character').ok);
});

test('selection disappearing during a scene tour reports prerequisites without selecting or editing data', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'tour' });
  document.addActor('../characters/demo/character.json');
  const launcher = new GuideLauncher(sceneGuideHost(document));
  launcher.launch('scene-positioning');
  const source = document.workingScene;
  document.selectActor(null);
  launcher.refresh();
  const snapshot = launcher.controller.getSnapshot();
  assert.equal(snapshot.status, 'active');
  if (snapshot.status === 'active') assert.isFalse(snapshot.availability.available);
  assert.isFalse(launcher.controller.next().ok);
  assert.strictEqual(document.workingScene, source);
  assert.isNull(document.selectedActorId);
});
