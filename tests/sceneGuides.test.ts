import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test } from 'vitest';
import { SceneArtworkPanel } from '../src/devtools/scene-editor/SceneArtworkPanel.js';
import { SceneCameraPanel } from '../src/devtools/scene-editor/SceneCameraPanel.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneLayersPanel } from '../src/devtools/scene-editor/SceneLayersPanel.js';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { guideRegistry } from '../src/devtools/shared/guides/registry.js';
import { sceneGuideHost } from '../src/devtools/shared/guides/sceneGuideHost.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

test('scene tours gate missing documents and selections, and explain tours preserve history and exported data', () => {
  const document = new SceneEditorDocument();
  const launcher = new GuideLauncher(sceneGuideHost(document));
  assert.lengthOf(guideRegistry.getGuidesForEditor('scene'), 12);
  assert.deepEqual(launcher.getAvailability('scene-creating'), { available: true });
  assert.isFalse(launcher.getAvailability('scene-adding-actor').available);
  assert.isFalse(launcher.getAvailability('scene-backgrounds-layers').available);
  assert.isFalse(launcher.getAvailability('scene-cinematic-camera').available);
  assert.equal(launcher.getPrerequisiteGuide('scene-cinematic-camera')?.id, 'scene-creating');
  assert.equal(launcher.getPrerequisiteGuide('scene-adding-actor')?.id, 'scene-creating');
  assert.isTrue(document.createScene({ id: 'tour' }));
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('scene-adding-actor').available);
  assert.isTrue(launcher.getAvailability('scene-backgrounds-layers').available);
  assert.isTrue(launcher.getAvailability('scene-cinematic-camera').available);
  assert.isTrue(launcher.getAvailability('scene-ground-reference').available);
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
  const ground = document.groundGuide.getSnapshot();
  for (const guide of guideRegistry.getGuidesForEditor('scene')) {
    assert.isTrue(launcher.launch(guide.id).ok);
    for (let i = 1; i < guide.steps.length; i++) assert.isTrue(launcher.controller.next().ok);
    launcher.controller.exit();
    assert.isTrue(guide.steps.every((step) => step.mode !== 'try-it'));
  }
  assert.strictEqual(document.workingScene, original);
  assert.equal(document.exportJson(), json);
  assert.deepEqual([document.canUndo, document.canRedo], history);
  assert.strictEqual(document.groundGuide.getSnapshot(), ground);
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

test('background tour has unique real anchors before import and with selected, locked artwork', async () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'background-tour' });
  const markup = () =>
    renderToStaticMarkup(createElement(SceneArtworkPanel, { document })) +
    renderToStaticMarkup(createElement(SceneLayersPanel, { document }));
  const anchors = () => {
    const html = markup();
    for (const id of [
      GUIDE_TARGETS.sceneAddBackground,
      GUIDE_TARGETS.sceneProjectImage,
      GUIDE_TARGETS.sceneImageTransform,
      GUIDE_TARGETS.sceneLayers,
      GUIDE_TARGETS.sceneLayerOrder,
      GUIDE_TARGETS.sceneLayerParallax,
    ])
      assert.lengthOf([...html.matchAll(new RegExp(`data-guide-id="${id}"`, 'g'))], 1);
    assert.notInclude(html, '<details open');
  };
  anchors();
  assert.include(markup(), 'Add or select an image');
  const reference = await document.images.add(
    new Uint8Array(artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>),
    'forest.png',
  );
  document.addImage(reference);
  document.addLayer();
  document.setLayerLocked('background', true);
  anchors();
  assert.include(markup(), '<fieldset disabled');
  const launcher = new GuideLauncher(sceneGuideHost(document));
  const guide = guideRegistry.getGuideById('scene-backgrounds-layers')!;
  assert.lengthOf(guide.steps, 8);
  const source = document.workingScene;
  const json = document.exportJson();
  const selection = document.selectedImageId;
  const history = [document.canUndo, document.canRedo];
  assert.isTrue(launcher.launch(guide.id).ok);
  for (const [index, step] of guide.steps.entries()) {
    assert.equal(step.preparation, 'reveal-target');
    assert.notEqual(step.mode, 'try-it');
    if (index) assert.isTrue(launcher.controller.next().ok);
  }
  launcher.controller.exit();
  assert.strictEqual(document.workingScene, source);
  assert.equal(document.exportJson(), json);
  assert.equal(document.selectedImageId, selection);
  assert.isTrue(document.isLayerLocked('background'));
  assert.deepEqual([document.canUndo, document.canRedo], history);
});

test('camera tour uses unique collapsed inspector controls and preserves empty and authored preview states', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'camera-tour' });
  const launcher = new GuideLauncher(sceneGuideHost(document));
  const guide = guideRegistry.getGuideById('scene-cinematic-camera')!;
  assert.lengthOf(guide.steps, 8);
  const inspect = () => {
    const html = renderToStaticMarkup(createElement(SceneCameraPanel, { document }));
    for (const id of [
      GUIDE_TARGETS.sceneCameraSelect,
      GUIDE_TARGETS.sceneCameraCenter,
      GUIDE_TARGETS.sceneCameraZoom,
      GUIDE_TARGETS.sceneCameraFrameActor,
    ])
      assert.lengthOf([...html.matchAll(new RegExp(`data-guide-id="${id}"`, 'g'))], 1);
    assert.notInclude(html, '<details open');
    const source = document.workingScene;
    const json = document.exportJson();
    const state = [
      document.selectedActorId,
      document.selectedImageId,
      document.selectedActionId,
      document.cameraSelected,
      document.cameraPreviewing,
      document.cameraOverlays,
      document.canUndo,
      document.canRedo,
    ];
    assert.isTrue(launcher.launch(guide.id).ok);
    for (const [index, step] of guide.steps.entries()) {
      assert.equal(step.preparation, 'reveal-target');
      assert.notEqual(step.mode, 'try-it');
      if (index) assert.isTrue(launcher.controller.next().ok);
    }
    launcher.controller.exit();
    assert.strictEqual(document.workingScene, source);
    assert.equal(document.exportJson(), json);
    assert.deepEqual(
      [
        document.selectedActorId,
        document.selectedImageId,
        document.selectedActionId,
        document.cameraSelected,
        document.cameraPreviewing,
        document.cameraOverlays,
        document.canUndo,
        document.canRedo,
      ],
      state,
    );
  };
  inspect();
  assert.isUndefined(document.workingScene!.camera);
  document.addActor('hero.json');
  document.updateCamera({ x: 120, y: -40, zoom: 1.5 });
  document.selectCamera();
  document.setCameraPreview(true);
  document.setCameraOverlays(true);
  document.updateCamera({ x: 150 });
  document.undo();
  launcher.refresh();
  inspect();
});
