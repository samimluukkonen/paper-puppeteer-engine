import { assert, test, vi } from 'vitest';
import { SceneCameraPreview } from '../src/devtools/scene-editor/SceneCameraPreview.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { panCamera, editorWorldViewport, zoomCameraAt } from '../src/devtools/shared/editorCamera.js';
import { Actor } from '../src/engine/Actor.js';
import {
  applyCinematicCamera,
  cameraForBounds,
  cinematicFrame,
  DEFAULT_CINEMATIC_CAMERA,
} from '../src/engine/cinematicCamera.js';
import { Puppet } from '../src/engine/Puppet.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { parallaxPosition } from '../src/engine/sceneLayers.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function camera() {
  return {
    x: 0,
    y: 0,
    width: 1000,
    height: 700,
    originX: 0.5,
    originY: 0.5,
    zoom: 1,
    scrollX: -500,
    scrollY: -350,
    setViewport(x: number, y: number, width: number, height: number) {
      Object.assign(this, { x, y, width, height });
    },
    setZoom(zoom: number) {
      this.zoom = zoom;
    },
    centerOn(x: number, y: number) {
      this.scrollX = x - this.width / 2;
      this.scrollY = y - this.height / 2;
    },
  };
}
test('legacy defaults are virtual and scene format 2 round trips authored camera without navigation state', async () => {
  const scene = createEmptyScene({ id: 'camera' });
  const original = serializeSceneDefinition(scene);
  const document = new SceneEditorDocument();
  assert.isTrue(document.importJson(original));
  assert.deepEqual(document.cinematicCamera, DEFAULT_CINEMATIC_CAMERA);
  assert.isUndefined(document.workingScene!.camera);
  document.selectCamera();
  document.setCameraPreview(true);
  document.setCameraOverlays(true);
  assert.equal(document.exportJson(), original);
  assert.isFalse(document.dirty);
  assert.isFalse(document.canUndo);
  assert.isTrue(document.updateCamera({ x: -210, y: 50, zoom: 2 }));
  const authored = document.workingScene!;
  assert.deepEqual(parseSceneJson(document.exportJson()).camera, authored.camera);
  const restored = await validateScenePackage(
    await buildScenePackage(authored, { baseUrl: 'https://example.test/scene.json' }),
  );
  assert.deepEqual(restored.definition.camera, authored.camera);
  document.undo();
  assert.isUndefined(document.workingScene!.camera);
  document.redo();
  assert.strictEqual(document.workingScene, authored);
});

test('camera validation rejects nonfinite centers and unbounded/nonpositive zoom without changing the document', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'camera' });
  const before = document.workingScene;
  for (const patch of [{ x: NaN }, { y: Infinity }, ...[0, -1, 0.09, 8.01, NaN, Infinity].map((zoom) => ({ zoom }))]) {
    assert.isFalse(document.updateCamera(patch));
    assert.strictEqual(document.workingScene, before);
    assert.throws(() => parseSceneDefinition({ ...before, camera: { ...DEFAULT_CINEMATIC_CAMERA, ...patch } }));
  }
  assert.isTrue(document.updateCamera({ zoom: 0.1 }));
  assert.isTrue(document.updateCamera({ zoom: 8 }));
});

test('frame uses center coordinates and Phaser projection preserves bounds at arbitrary viewport sizes', () => {
  const state = { x: 140, y: -80, zoom: 2 };
  assert.deepEqual(cinematicFrame(state), { x: -110, y: -255, width: 500, height: 350 });
  const target = camera();
  for (const viewport of [
    { x: 0, y: 0, width: 1000, height: 700 },
    { x: 20, y: 40, width: 1600, height: 800 },
    { x: 15, y: 5, width: 500, height: 900 },
  ]) {
    const fitted = applyCinematicCamera(target, state, viewport);
    assert.closeTo(fitted.width / fitted.height, 10 / 7, 1e-10);
    assert.isAtLeast(fitted.x, viewport.x);
    assert.isAtLeast(fitted.y, viewport.y);
    const world = editorWorldViewport(target)!;
    const frame = cinematicFrame(state);
    assert.closeTo(world.left, frame.x, 1e-9);
    assert.closeTo(world.top, frame.y, 1e-9);
    assert.closeTo(world.right - world.left, frame.width, 1e-9);
    assert.closeTo(world.bottom - world.top, frame.height, 1e-9);
  }
  assert.throws(() => applyCinematicCamera(target, state, { x: 0, y: 0, width: 0, height: 100 }));
});

test.each([0, 0.2, 1, 1.2])(
  'parallax %s and Actors use the same audience projection through resize and zoom',
  (factor) => {
    const state = { x: 120, y: -60, zoom: 1.8 };
    const authored = Object.freeze({ x: 75, y: 40 });
    const display = parallaxPosition(authored, factor, state);
    for (const size of [
      { width: 1000, height: 700 },
      { width: 1200, height: 600 },
    ]) {
      const target = camera();
      applyCinematicCamera(target, state, { x: 0, y: 0, ...size });
      const world = editorWorldViewport(target)!;
      const pixelX = (display.x - world.left) * target.zoom;
      const pixelY = (display.y - world.top) * target.zoom;
      assert.closeTo(pixelX, target.width / 2 + (authored.x - factor * state.x) * target.zoom, 1e-9);
      assert.closeTo(pixelY, target.height / 2 + (authored.y - factor * state.y) * target.zoom, 1e-9);
    }
    assert.deepEqual(authored, { x: 75, y: 40 });
  },
);

test('editor pan and zoom remain independent, preview resizes then restores exact navigation and authored state', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'camera' });
  document.updateCamera({ x: 250, y: 80, zoom: 1.5 });
  const authored = document.workingScene;
  const target = camera();
  panCamera(target, 120, -60);
  zoomCameraAt(target, 200, 150, -300);
  const navigation = { ...target };
  const preview = new SceneCameraPreview(target);
  preview.sync(true, document.cinematicCamera, { x: 0, y: 0, width: 1000, height: 700 });
  assert.equal(target.zoom, 1.5);
  preview.sync(true, document.cinematicCamera, { x: 0, y: 0, width: 800, height: 800 });
  assert.closeTo(target.zoom, 1.2, 1e-9);
  preview.sync(false, document.cinematicCamera, { x: 0, y: 0, width: 800, height: 800 });
  assert.deepEqual(target, navigation);
  assert.strictEqual(document.workingScene, authored);
  preview.sync(false, document.cinematicCamera, { x: 0, y: 0, width: 1000, height: 700 });
  assert.deepEqual(target, navigation);
});

test('Actor framing fits rendered bounds, falls back to origin and preserves Actor transforms and actions', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'camera' });
  document.addActor('hero.json', { x: 75, y: 120 });
  const before = document.workingScene!;
  const id = document.selectedActorId!;
  document.selectCamera();
  assert.isTrue(document.frameActor(id));
  assert.deepEqual(document.cinematicCamera, { x: 75, y: 120, zoom: 1 });
  const bounds = { x: -40, y: -200, width: 240, height: 300 };
  document.setActorBoundsProvider(() => bounds);
  document.frameActor(id);
  assert.deepEqual(document.cinematicCamera, cameraForBounds(bounds));
  const frame = cinematicFrame(document.cinematicCamera);
  assert.isBelow(frame.x, bounds.x);
  assert.isAbove(frame.y + frame.height, bounds.y + bounds.height);
  assert.deepEqual(document.workingScene!.actors, before.actors);
  assert.deepEqual(document.workingScene!.actions, before.actions);
  assert.equal(cameraForBounds({ x: 0, y: 0, width: 1, height: 1 }).zoom, 8);
});

test('camera drag is one undo entry and cancellation, selection, preview and scene switches roll it back', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'camera' });
  document.addActor('hero.json');
  const before = document.workingScene;
  document.beginCameraDrag();
  for (let x = 1; x <= 20; x++) document.moveCameraDrag({ x, y: x });
  document.endCameraDrag();
  const after = document.workingScene;
  document.undo();
  assert.strictEqual(document.workingScene, before);
  document.redo();
  assert.strictEqual(document.workingScene, after);
  for (const cancel of [
    () => document.cancelCameraDrag(),
    () => document.selectActor('actor-1'),
    () => document.setCameraPreview(true),
  ]) {
    document.setCameraPreview(false);
    document.beginCameraDrag();
    document.moveCameraDrag({ x: 100, y: 200 });
    cancel();
    assert.strictEqual(document.workingScene, after);
    assert.isFalse(document.hasOpenOperation);
  }
  document.setCameraPreview(false);
  document.beginCameraDrag();
  document.moveCameraDrag({ x: 300, y: 400 });
  document.createScene({ id: 'other' });
  document.selectScene('camera');
  assert.strictEqual(document.workingScene, after);
});

test('camera edits and preview toggles preserve isolated runtime Actors and choreography time', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'camera' });
  document.addActor('hero.json');
  const playback = new SceneEditorPlayback();
  const scene = puppetScene();
  const factory = (data: { id: string }) =>
    new Actor({
      id: data.id,
      puppetOwnership: 'owned',
      puppet: new Puppet(scene, {
        rig: { root: 'root', bones: [{ id: 'root' }] },
        autoUpdate: false,
      }),
    });
  playback.sync(document.workingScene, true, factory);
  playback.seek(1200);
  const actor = playback.actors!.get('actor-1');
  document.updateCamera({ x: 100, zoom: 2 });
  document.setCameraPreview(true);
  playback.sync(document.workingScene, true, factory);
  assert.strictEqual(playback.actors!.get('actor-1'), actor);
  assert.equal(playback.time, 1200);
  playback.dispose();
});
