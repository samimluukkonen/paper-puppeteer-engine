import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test } from 'vitest';
import { SceneArtworkPanel } from '../src/devtools/scene-editor/SceneArtworkPanel.js';
import { SceneAudioInspector } from '../src/devtools/scene-editor/SceneAudioInspector.js';
import { SceneCameraPanel } from '../src/devtools/scene-editor/SceneCameraPanel.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneDialogueInspector } from '../src/devtools/scene-editor/SceneDialogueInspector.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { SceneLayersPanel } from '../src/devtools/scene-editor/SceneLayersPanel.js';
import { SceneTimeline } from '../src/devtools/scene-editor/SceneTimeline.js';
import { SceneTransitionPanel } from '../src/devtools/scene-editor/SceneTransitionPanel.js';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { guideRegistry } from '../src/devtools/shared/guides/registry.js';
import { sceneGuideHost } from '../src/devtools/shared/guides/sceneGuideHost.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

test('scene tours gate missing documents and selections, and explain tours preserve history and exported data', () => {
  const document = new SceneEditorDocument();
  const launcher = new GuideLauncher(sceneGuideHost(document));
  assert.lengthOf(guideRegistry.getGuidesForEditor('scene'), 30);
  assert.deepEqual(launcher.getAvailability('scene-creating'), { available: true });
  assert.isFalse(launcher.getAvailability('scene-adding-actor').available);
  assert.isFalse(launcher.getAvailability('scene-backgrounds-layers').available);
  assert.isFalse(launcher.getAvailability('scene-cinematic-camera').available);
  assert.isFalse(launcher.getAvailability('scene-camera-keyframes').available);
  assert.isFalse(launcher.getAvailability('scene-cuts-fades').available);
  assert.isFalse(launcher.getAvailability('scene-dialogue-authoring').available);
  assert.equal(launcher.getPrerequisiteGuide('scene-dialogue-authoring')?.id, 'scene-creating');
  assert.isFalse(launcher.getAvailability('scene-audio-timeline').available);
  assert.isFalse(launcher.getAvailability('scene-audio-synchronization').available);
  assert.equal(launcher.getPrerequisiteGuide('scene-audio-synchronization')?.id, 'scene-creating');
  assert.equal(launcher.getPrerequisiteGuide('scene-audio-timeline')?.id, 'scene-creating');
  assert.equal(launcher.getPrerequisiteGuide('scene-cuts-fades')?.id, 'scene-creating');
  assert.equal(launcher.getPrerequisiteGuide('scene-camera-keyframes')?.id, 'scene-creating');
  assert.equal(launcher.getPrerequisiteGuide('scene-cinematic-camera')?.id, 'scene-creating');
  assert.equal(launcher.getPrerequisiteGuide('scene-adding-actor')?.id, 'scene-creating');
  assert.isTrue(document.createScene({ id: 'tour' }));
  launcher.refresh();
  assert.isTrue(launcher.getAvailability('scene-adding-actor').available);
  assert.isTrue(launcher.getAvailability('scene-backgrounds-layers').available);
  assert.isTrue(launcher.getAvailability('scene-cinematic-camera').available);
  assert.isTrue(launcher.getAvailability('scene-camera-keyframes').available);
  assert.isTrue(launcher.getAvailability('scene-cuts-fades').available);
  assert.isTrue(launcher.getAvailability('scene-dialogue-authoring').available);
  assert.isTrue(launcher.getAvailability('scene-audio-timeline').available);
  assert.isTrue(launcher.getAvailability('scene-audio-synchronization').available);
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
    const html = renderToStaticMarkup(
      createElement(SceneCameraPanel, { document, playback: new SceneEditorPlayback() }),
    );
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

test('camera keyframe guide exposes unique anchors with or without keys and preserves authored and view state', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'camera-keys-tour' });
  const launcher = new GuideLauncher(sceneGuideHost(document));
  const guide = guideRegistry.getGuideById('scene-camera-keyframes')!;
  assert.equal(guide.title, 'Camera Timeline & Keyframes');
  assert.lengthOf(guide.steps, 9);
  const inspect = (populated: boolean) => {
    const html = renderToStaticMarkup(
      createElement(SceneCameraPanel, { document, playback: new SceneEditorPlayback() }),
    );
    for (const id of [
      GUIDE_TARGETS.sceneCameraKeyMode,
      GUIDE_TARGETS.sceneCameraKeyValues,
      GUIDE_TARGETS.sceneCameraKeyProperties,
      GUIDE_TARGETS.sceneCameraKeyCurves,
    ])
      assert.lengthOf([...html.matchAll(new RegExp(`data-guide-id="${id}"`, 'g'))], 1);
    assert.notInclude(html, '<details open');
    assert.include(html, populated ? 'Camera key interpolation' : 'No keys yet?');
    const before = document.workingScene;
    const json = document.exportJson();
    const state = () => [
      document.selectedCameraKey,
      document.cameraKeyEditing,
      document.cameraSelected,
      document.cameraPreviewing,
      document.cameraOverlays,
      document.selectedActorId,
      document.selectedActionId,
      document.selectedImageId,
      document.canUndo,
      document.canRedo,
      document.cinematicCamera,
    ];
    const selection = state();
    assert.isTrue(launcher.launch(guide.id).ok);
    for (const [index, step] of guide.steps.entries()) {
      assert.equal(step.preparation, 'reveal-target');
      assert.notEqual(step.mode, 'try-it');
      if (index) assert.isTrue(launcher.controller.next().ok);
    }
    launcher.controller.exit();
    assert.strictEqual(document.workingScene, before);
    assert.equal(document.exportJson(), json);
    assert.deepEqual(state(), selection);
  };
  inspect(false);
  assert.isUndefined(document.workingScene!.cameraTracks);
  document.setCameraKey(0, { x: 0, y: 0, zoom: 1 });
  document.setCameraKey(3000, { x: 120, y: -40, zoom: 2 });
  document.setCameraTimeProvider(() => 1500);
  document.setCameraPreview(true);
  document.setCameraOverlays(true);
  const id = document.workingScene!.cameraTracks!.x![0]!.id;
  document.selectCameraKey('x', id);
  document.updateCameraKey('x', id, {
    curve: { mode: 'bezier', control1: { x: 0.2, y: 0 }, control2: { x: 0.8, y: 1 } },
  });
  document.undo();
  launcher.refresh();
  inspect(true);
});

test('cuts and fades guide exposes real targets in empty and selected-effect states without authoring', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'transitions-tour', duration: 4000 });
  const launcher = new GuideLauncher(sceneGuideHost(document));
  const guide = guideRegistry.getGuideById('scene-cuts-fades')!;
  assert.equal(guide.title, 'Cinematic Cuts, Fades & Transitions');
  assert.lengthOf(guide.steps, 9);
  const registry = new SceneCharacterRegistry();
  const playback = new SceneEditorPlayback();
  const inspect = (populated: boolean) => {
    const html =
      renderToStaticMarkup(createElement(SceneTransitionPanel, { document })) +
      renderToStaticMarkup(
        createElement(SceneTimeline, { scene: document.workingScene!, document, registry, playback }),
      );
    for (const id of [
      GUIDE_TARGETS.sceneCameraCut,
      GUIDE_TARGETS.sceneAddTransition,
      GUIDE_TARGETS.sceneTransitions,
      GUIDE_TARGETS.sceneTransitionProperties,
      GUIDE_TARGETS.sceneTransitionTiming,
      GUIDE_TARGETS.sceneTransitionAppearance,
    ])
      assert.lengthOf([...html.matchAll(new RegExp(`data-guide-id="${id}"`, 'g'))], 1);
    assert.notInclude(html, '<details open');
    assert.include(html, populated ? 'Fade duration (seconds)' : 'No fades yet?');
    const before = document.workingScene;
    const json = document.exportJson();
    const state = () => [
      document.selectedTransition,
      document.selectedCameraKey,
      document.cameraSelected,
      document.cameraKeyEditing,
      document.cameraPreviewing,
      document.cameraOverlays,
      document.selectedActorId,
      document.selectedActionId,
      document.selectedImageId,
      document.canUndo,
      document.canRedo,
      document.cinematicCamera,
    ];
    const view = state();
    assert.isTrue(launcher.launch(guide.id).ok);
    for (const [index, step] of guide.steps.entries()) {
      assert.equal(step.preparation, 'reveal-target');
      assert.notEqual(step.mode, 'try-it');
      if (index) assert.isTrue(launcher.controller.next().ok);
    }
    launcher.controller.exit();
    assert.strictEqual(document.workingScene, before);
    assert.equal(document.exportJson(), json);
    assert.deepEqual(state(), view);
  };
  try {
    inspect(false);
    assert.isUndefined(document.workingScene!.transitions);
    assert.isUndefined(document.workingScene!.cameraTracks);
    document.setCameraCut(2000, { x: 120, y: 0, zoom: 2 });
    document.addTransition({ time: 3000, duration: 1000, type: 'fade-out', color: '#123456' });
    const id = document.selectedTransition!.id;
    document.setCameraTimeProvider(() => 1500);
    document.setCameraPreview(true);
    document.setCameraOverlays(true);
    document.selectTransition(id);
    document.updateTransition(id, { duration: 500 });
    document.undo();
    inspect(true);
  } finally {
    registry.dispose();
    playback.dispose();
  }
});

test.each([
  'scene-audio-timeline',
  'scene-audio-synchronization',
  'scene-importing-audio',
  'scene-audio-timeline-basics',
  'scene-audio-scene-timing',
] as const)(
  '%s resolves unique real controls with empty and selected clips while preserving history and view state',
  (guideId) => {
    const document = new SceneEditorDocument();
    document.createScene({ id: 'audio-tour', duration: 4000 });
    const launcher = new GuideLauncher(sceneGuideHost(document));
    const guide = guideRegistry.getGuideById(guideId)!;
    assert.deepEqual(
      guide.prerequisites?.map(({ capability }) => capability),
      ['tool:scene'],
    );
    const registry = new SceneCharacterRegistry();
    const playback = new SceneEditorPlayback();
    const inspect = (populated: boolean) => {
      playback.sync(document.workingScene, true, () => {
        throw new Error('The audio guide fixture has no Actors.');
      });
      if (populated) {
        playback.seek(1000);
        playback.setSpeed(0.5);
        playback.setAudioMuted(true);
      }
      const html =
        renderToStaticMarkup(createElement(SceneAudioInspector, { document })) +
        renderToStaticMarkup(
          createElement(SceneTimeline, { scene: document.workingScene!, document, registry, playback }),
        );
      for (const id of [
        GUIDE_TARGETS.sceneAudioAsset,
        GUIDE_TARGETS.sceneAudioAddTrack,
        GUIDE_TARGETS.sceneAudioAddClip,
        GUIDE_TARGETS.sceneAudioTracks,
        GUIDE_TARGETS.sceneAudioProperties,
        GUIDE_TARGETS.sceneAudioTiming,
        GUIDE_TARGETS.sceneAudioPlayback,
        GUIDE_TARGETS.sceneAudioFades,
        GUIDE_TARGETS.sceneAudioActions,
        GUIDE_TARGETS.scenePlayback,
        GUIDE_TARGETS.sceneTime,
        GUIDE_TARGETS.sceneAudioStatus,
        GUIDE_TARGETS.sceneAudioMute,
        GUIDE_TARGETS.scenePlaybackSpeed,
        GUIDE_TARGETS.sceneRestart,
        GUIDE_TARGETS.sceneStop,
      ])
        assert.lengthOf([...html.matchAll(new RegExp(`data-guide-id="${id}"`, 'g'))], 1);
      assert.notInclude(html, '<details open');
      assert.include(html, populated ? 'Source offset (seconds)' : 'No clips yet?');
      const before = document.workingScene;
      const json = document.exportJson();
      const state = () => [
        document.selectedAudioClip,
        document.selectedActorId,
        document.selectedActionId,
        document.selectedImageId,
        document.selectedCameraKey,
        document.cameraSelected,
        document.cameraPreviewing,
        document.cameraOverlays,
        document.canUndo,
        document.canRedo,
        document.cinematicCamera,
        playback.time,
        playback.status,
        playback.speed,
        playback.audioMuted,
        playback.audioStatus,
        playback.audioError,
      ];
      const view = state();
      assert.isTrue(launcher.launch(guide.id).ok);
      assert.isTrue(launcher.controller.next().ok);
      assert.isTrue(launcher.controller.previous().ok);
      assert.isTrue(launcher.controller.restart().ok);
      for (const [index, step] of guide.steps.entries()) {
        assert.equal(step.preparation, 'reveal-target');
        assert.notEqual(step.mode, 'try-it');
        if (index) assert.isTrue(launcher.controller.next().ok);
      }
      assert.isTrue(launcher.controller.finish().ok);
      assert.strictEqual(document.workingScene, before);
      assert.equal(document.exportJson(), json);
      assert.deepEqual(state(), view);
    };
    try {
      inspect(false);
      document.replaceScene({
        ...document.workingScene,
        audioAssets: [{ id: 'tone', name: 'Tone', category: 'voice', path: 'audio/tone.wav', durationSeconds: 2 }],
        audioTracks: [{ id: 'voice', name: 'Voice', category: 'voice' }],
        audioClips: [
          {
            id: 'voice-clip',
            assetId: 'tone',
            trackId: 'voice',
            time: 500,
            duration: 3000,
            sourceOffset: 100,
            volume: 0.4,
            loop: true,
            fadeIn: 200,
            fadeOut: 300,
          },
        ],
      });
      document.setCameraTimeProvider(() => 1000);
      document.setCameraPreview(true);
      document.setCameraOverlays(true);
      document.selectAudioClip('voice-clip');
      document.updateAudioClip('voice-clip', { volume: 0.6 });
      document.undo();
      launcher.refresh();
      inspect(true);
      assert.isTrue(document.canRedo);
    } finally {
      registry.dispose();
      playback.dispose();
    }
  },
);

test.each(['scene-dialogue-authoring', 'scene-creating-dialogue'])(
  '%s preserves authored and preview state with empty and selected lines',
  (guideId) => {
    const document = new SceneEditorDocument();
    document.createScene({ id: 'dialogue-tour', duration: 6000 });
    const launcher = new GuideLauncher(sceneGuideHost(document));
    const guide = guideRegistry.getGuideById(guideId)!;
    assert.deepEqual(
      guide.prerequisites?.map(({ capability }) => capability),
      ['tool:scene'],
    );
    const registry = new SceneCharacterRegistry();
    const playback = new SceneEditorPlayback();
    const inspect = (selected: boolean) => {
      playback.sync(document.workingScene, true, () => {
        throw new Error('Dialogue guide fixture has no Actors.');
      });
      playback.seek(1500);
      playback.setSpeed(0.5);
      playback.setAudioMuted(true);
      const html =
        renderToStaticMarkup(createElement(SceneDialogueInspector, { document })) +
        renderToStaticMarkup(
          createElement(SceneTimeline, { scene: document.workingScene!, document, registry, playback }),
        );
      for (const id of [
        GUIDE_TARGETS.sceneDialogueAdd,
        GUIDE_TARGETS.sceneDialogueTrack,
        GUIDE_TARGETS.sceneDialogueProperties,
        GUIDE_TARGETS.sceneDialogueText,
        GUIDE_TARGETS.sceneDialogueSpeaker,
        GUIDE_TARGETS.sceneDialogueTiming,
        GUIDE_TARGETS.sceneDialogueVoice,
        GUIDE_TARGETS.sceneDialogueActions,
      ])
        assert.lengthOf([...html.matchAll(new RegExp(`data-guide-id="${id}"`, 'g'))], 1);
      assert.notInclude(html, '<details open');
      assert.include(html, selected ? 'Dialogue text' : 'No lines yet?');
      const before = document.workingScene;
      const json = document.exportJson();
      const view = () => [
        document.selectedDialogueLine,
        document.selectedActorId,
        document.selectedAudioClip,
        document.selectedCameraKey,
        document.cameraSelected,
        document.cameraKeyEditing,
        document.cameraPreviewing,
        document.cameraOverlays,
        document.canUndo,
        document.canRedo,
        playback.time,
        playback.status,
        playback.speed,
        playback.audioMuted,
        playback.audioStatus,
      ];
      const original = view();
      assert.isTrue(launcher.launch(guide.id).ok);
      assert.isTrue(launcher.controller.next().ok);
      assert.isTrue(launcher.controller.previous().ok);
      assert.isTrue(launcher.controller.restart().ok);
      for (const [index, step] of guide.steps.entries()) {
        assert.equal(step.preparation, 'reveal-target');
        assert.notEqual(step.mode, 'try-it');
        if (index) assert.isTrue(launcher.controller.next().ok);
      }
      assert.isTrue(launcher.controller.finish().ok);
      assert.isTrue(launcher.launch(guide.id).ok);
      launcher.controller.exit();
      assert.strictEqual(document.workingScene, before);
      assert.equal(document.exportJson(), json);
      assert.deepEqual(view(), original);
    };
    try {
      inspect(false);
      document.addDialogueLine({
        time: 500,
        duration: 1000,
        text: '森は静かだった。\n  Hello 👋',
        speakerName: 'Narrator',
      });
      const id = document.selectedDialogueLine!.id;
      document.setCameraPreview(true);
      document.setCameraOverlays(true);
      document.selectDialogueLine(id);
      document.updateDialogueLine(id, { text: 'Temporary edit' });
      document.undo();
      inspect(true);
      assert.isTrue(document.canRedo);
      document.selectDialogueLine(null);
      inspect(false);
    } finally {
      playback.dispose();
      registry.dispose();
    }
  },
);
