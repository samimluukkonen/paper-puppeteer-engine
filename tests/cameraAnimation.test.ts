import { assert, test, vi } from 'vitest';
import { importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { snapSceneTime } from '../src/devtools/scene-editor/timelineActions.js';
import { sceneDraftSource } from '../src/devtools/shared/autosave/editorDrafts.js';
import { Actor } from '../src/engine/Actor.js';
import { sampleProperty } from '../src/engine/AnimationClip.js';
import { evaluateCameraAtTime, type CameraKeyframe, type CameraTracks } from '../src/engine/cameraAnimation.js';
import { DEFAULT_CINEMATIC_CAMERA } from '../src/engine/cinematicCamera.js';
import { Puppet } from '../src/engine/Puppet.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const row = (id: string, time: number, value: number): CameraKeyframe => ({ id, time, value });
const ease = { mode: 'bezier' as const, control1: { x: 0.2, y: 0.1 }, control2: { x: 0.8, y: 0.6 } };
function scene(cameraTracks?: CameraTracks) {
  return parseSceneDefinition({
    ...createEmptyScene({ id: 'camera', duration: 10000 }),
    camera: { x: -10, y: 25, zoom: 1.5 },
    ...(cameraTracks ? { cameraTracks } : {}),
  });
}
function document() {
  const document = new SceneEditorDocument();
  document.importJson(serializeSceneDefinition(scene()));
  return document;
}
function factory() {
  const phaser = puppetScene();
  return (data: { id: string }) =>
    new Actor({
      id: data.id,
      puppetOwnership: 'owned',
      puppet: new Puppet(phaser, {
        rig: { root: 'root', bones: [{ id: 'root' }] },
        autoUpdate: false,
      }),
    });
}

test('sparse channels use static/legacy fallback, hold endpoints and sample position/zoom on the scene clock', () => {
  const legacy = createEmptyScene({ id: 'legacy' });
  assert.deepEqual(evaluateCameraAtTime(legacy, 500), DEFAULT_CINEMATIC_CAMERA);
  assert.isUndefined(legacy.camera);
  assert.isUndefined(legacy.cameraTracks);
  assert.deepEqual(evaluateCameraAtTime(scene(), 2000), { x: -10, y: 25, zoom: 1.5 });
  const source = scene({ x: [row('a', 1000, 0), row('b', 3000, 100)], zoom: [row('a', 0, 1), row('b', 10000, 3)] });
  assert.deepEqual(evaluateCameraAtTime(source, 2000), { x: 50, y: 25, zoom: 1.4 });
  assert.deepEqual(evaluateCameraAtTime(source, -500), { x: 0, y: 25, zoom: 1 });
  assert.deepEqual(evaluateCameraAtTime(source, 20000), { x: 100, y: 25, zoom: 3 });
  assert.deepEqual(evaluateCameraAtTime(scene({ x: [], zoom: [] }), 2000), source.camera);
  assert.throws(() => evaluateCameraAtTime(source, NaN), /finite/);
});

test('stepped and bounded Bézier camera curves exactly reuse character property sampling, including zoom limits', () => {
  const source = scene({
    x: [{ ...row('a', 0, 0), curve: { mode: 'stepped' } }, row('b', 1000, 100)],
    y: [{ ...row('a', 0, -100), curve: ease }, row('b', 1000, 200)],
    zoom: [{ ...row('a', 0, 0.1), curve: ease }, row('b', 1000, 8)],
  });
  for (let time = 0; time <= 1000; time += 5) {
    const state = evaluateCameraAtTime(source, time);
    assert.equal(state.x, time < 1000 ? 0 : 100);
    assert.equal(state.y, sampleProperty(source.cameraTracks!.y!, time));
    assert.equal(state.zoom, sampleProperty(source.cameraTracks!.zoom!, time));
    assert.isAtLeast(state.zoom, 0.1);
    assert.isAtMost(state.zoom, 8);
  }
});

test('camera validation rejects duplicate/outside/nonfinite keys, invalid zoom and nonmonotonic or unbounded curves', () => {
  const cases = [
    { x: [row('a', 20, 0), row('b', 20, 1)] },
    { x: [row('a', 20, 0), row('a', 30, 1)] },
    { x: [row('a', 30, 0), row('b', 20, 1)] },
    { x: [row('a', -1, 0)] },
    { x: [row('a', 10001, 0)] },
    { x: [row('a', Infinity, 0)] },
    { x: [row('a', 0, NaN)] },
    { zoom: [row('a', 0, 0.09)] },
    { zoom: [row('a', 0, 8.01)] },
    { x: [{ ...row('a', 0, 0), curve: { ...ease, control1: { x: 0.9, y: 0 } } }] },
    { x: [{ ...row('a', 0, 0), curve: { ...ease, control2: { x: 1, y: 1.1 } } }] },
  ];
  for (const cameraTracks of cases) assert.throws(() => scene(cameraTracks));
});

test('explicit capture and key edit mode create sparse keys, preserve initial data and support grouped Undo/Redo', () => {
  const doc = document();
  const before = doc.workingScene;
  doc.setCameraTimeProvider(() => 3000);
  doc.setCameraKeyEditing(true);
  doc.selectCamera();
  assert.strictEqual(doc.workingScene, before);
  assert.isFalse(doc.canUndo);
  doc.updateCamera({ x: 100 });
  assert.deepEqual(doc.workingScene!.cameraTracks!.x, [row('camera-key-1', 3000, 100)]);
  assert.isUndefined(doc.workingScene!.cameraTracks!.y);
  assert.deepEqual(doc.workingScene!.camera, before!.camera);
  doc.setCameraKey();
  assert.lengthOf(doc.workingScene!.cameraTracks!.x!, 1);
  assert.equal(doc.workingScene!.cameraTracks!.y![0]!.value, 25);
  assert.equal(doc.workingScene!.cameraTracks!.zoom![0]!.value, 1.5);
  const captured = doc.workingScene;
  doc.beginCameraDrag();
  doc.moveCameraDrag({ x: 110, y: 40 });
  doc.setCameraTimeProvider(() => 5000); // Drag keeps its original authoring time.
  doc.moveCameraDrag({ x: 120, y: 50 });
  doc.endCameraDrag();
  assert.lengthOf(doc.workingScene!.cameraTracks!.x!, 1);
  assert.equal(doc.workingScene!.cameraTracks!.x![0]!.time, 3000);
  const moved = doc.workingScene;
  doc.undo();
  assert.strictEqual(doc.workingScene, captured);
  doc.redo();
  assert.strictEqual(doc.workingScene, moved);
  doc.setCameraKeyEditing(false);
  assert.isFalse(doc.beginCameraDrag());
});

test('selected key value/time/curves, duplication and deletion preserve curves and reject collisions atomically', () => {
  const doc = document();
  doc.setCameraKey(0, { x: 0 });
  const id = doc.workingScene!.cameraTracks!.x![0]!.id;
  doc.selectCameraKey('x', id);
  doc.updateCameraKey('x', id, { curve: ease });
  doc.setCameraKey(0, { x: 10 });
  assert.deepEqual(doc.selectedCameraKey!.key.curve, ease);
  doc.duplicateCameraKey('x', id, 3000);
  const copy = doc.selectedCameraKey!.key.id;
  assert.notEqual(id, copy);
  assert.deepEqual(doc.selectedCameraKey!.key.curve, ease);
  const before = doc.workingScene;
  assert.isFalse(doc.updateCameraKey('x', copy, { time: 0 }));
  assert.strictEqual(doc.workingScene, before);
  assert.isFalse(doc.duplicateCameraKey('x', id, 3000));
  assert.strictEqual(doc.workingScene, before);
  doc.updateCameraKey('x', copy, { time: 5000, value: 80 });
  assert.equal(doc.selectedCameraKey!.key.time, 5000);
  doc.removeCameraKey('x', copy);
  assert.isNull(doc.selectedCameraKey);
  doc.undo();
  assert.equal(doc.selectedCameraKey!.key.time, 5000);
  doc.redo();
  assert.isNull(doc.selectedCameraKey);
  doc.updateProperties({ duration: 500 });
  doc.setCameraKey(0, { zoom: 0 });
  assert.isUndefined(doc.workingScene!.cameraTracks!.zoom);
});

test('timeline key drag shares snapping, has one history entry and cancels on selection, scene switch or Undo', () => {
  const doc = document();
  doc.setCameraKey(1000, { x: 10 });
  doc.setCameraKey(2345, { y: 20 });
  const key = doc.workingScene!.cameraTracks!.x![0]!;
  const original = doc.workingScene;
  const excluded = { property: 'x' as const, id: key.id };
  assert.closeTo(snapSceneTime(original!, null, 2348, 1000, 7000, true, 0, 10000, excluded), 2345, 1e-8);
  assert.equal(snapSceneTime(original!, null, 2348, 1000, 7000, false, 0, 10000, excluded), 2348);
  doc.beginCameraKeyDrag('x', key.id);
  doc.changeCameraKeyDrag(2000);
  doc.changeCameraKeyDrag(3000);
  doc.endCameraDrag();
  const moved = doc.workingScene;
  doc.undo();
  assert.strictEqual(doc.workingScene, original);
  doc.redo();
  assert.strictEqual(doc.workingScene, moved);
  for (const cancel of [() => doc.cancelCameraDrag(), () => doc.selectActor(null), () => doc.selectCamera(false)]) {
    doc.beginCameraKeyDrag('x', key.id);
    doc.changeCameraKeyDrag(4000);
    cancel();
    assert.strictEqual(doc.workingScene, moved);
    assert.isFalse(doc.hasOpenOperation);
    assert.isFalse(doc.changeCameraKeyDrag(6000));
  }
  doc.beginCameraKeyDrag('x', key.id);
  doc.changeCameraKeyDrag(5000);
  doc.createScene({ id: 'other' });
  doc.selectScene('camera');
  assert.strictEqual(doc.workingScene, moved);
  doc.beginCameraKeyDrag('x', key.id);
  doc.changeCameraKeyDrag(5000);
  doc.undo();
  assert.strictEqual(doc.workingScene, original);
});

test('direct and backward/forward seeks, speed, pause/restart and Actor motion use one deterministic clock', () => {
  const source = scene({ x: [row('a', 0, 0), row('b', 10000, 100)], zoom: [row('a', 0, 1), row('b', 10000, 3)] });
  source.actors = [{ id: 'hero', character: { manifest: 'hero.json' }, position: { x: 0, y: 0 } }];
  source.actions = [
    { id: 'move', actorId: 'hero', type: 'move', time: 0, duration: 10000, destination: { x: 100, y: 0 } },
  ];
  const camera = { width: 1000, height: 700, setViewport: vi.fn(), setZoom: vi.fn(), centerOn: vi.fn() };
  const runner = new SceneRunner(source, { createActor: factory(), camera: { target: camera } });
  runner.play();
  runner.update(5000);
  const expected = runner.cinematicCamera;
  const position = runner.actors.get('hero')!.position;
  for (const time of [9000, 5000, 2000, 5000, 0, 5000]) {
    runner.seek(time);
    assert.deepEqual(runner.cinematicCamera, evaluateCameraAtTime(source, time));
    assert.closeTo(runner.actors.get('hero')!.position.x, runner.cinematicCamera.x, 1e-7);
    if (time === 5000) {
      assert.deepEqual(runner.cinematicCamera, expected);
      assert.deepEqual(runner.actors.get('hero')!.position, position);
    }
  }
  runner.update(3000);
  assert.equal(runner.time, 5000);
  runner.speed = 2;
  runner.play();
  runner.update(500);
  assert.equal(runner.time, 6000);
  assert.equal(runner.cinematicCamera.x, 60);
  assert.deepEqual(camera.centerOn.mock.calls.at(-1), [60, 25]);
  assert.deepEqual(camera.setZoom.mock.calls.at(-1), [2.2]);
  runner.restart();
  assert.equal(runner.time, 0);
  assert.equal(runner.cinematicCamera.x, 0);
  runner.update(5000);
  assert.equal(runner.status, 'completed');
  runner.stop();
  assert.equal(runner.time, 0);
  runner.dispose();
});

test('camera edits preserve paused/running Actor instances and editor time, including undo', () => {
  const doc = document();
  doc.addActor('hero.json');
  const playback = new SceneEditorPlayback();
  const createActor = factory();
  const sync = () => playback.sync(doc.workingScene, true, createActor);
  sync();
  const release = doc.subscribe(sync);
  doc.setCameraTimeProvider(() => playback.time);
  playback.seek(5000);
  const actor = playback.actors!.get('actor-1');
  doc.setCameraKey();
  doc.setCameraKeyEditing(true);
  doc.updateCamera({ x: 100, zoom: 2 });
  assert.equal(playback.time, 5000);
  assert.strictEqual(playback.actors!.get('actor-1'), actor);
  doc.undo();
  assert.equal(playback.time, 5000);
  assert.strictEqual(playback.actors!.get('actor-1'), actor);
  playback.play();
  doc.updateCamera({ y: 50 });
  assert.equal(playback.status, 'playing');
  assert.strictEqual(playback.actors!.get('actor-1'), actor);
  assert.equal(doc.cinematicCamera.y, 50);
  release();
  playback.dispose();
});

test('JSON, portable packages and project recovery preserve camera curves without navigation state', async () => {
  const source = scene({
    x: [{ ...row('a', 0, 10), curve: ease }, row('b', 3000, 100)],
    zoom: [row('a', 0, 1), row('b', 5000, 2)],
  });
  const json = serializeSceneDefinition(source);
  const restored = parseSceneJson(json);
  assert.deepEqual(restored, source);
  const portable = await validateScenePackage(
    await buildScenePackage(source, { baseUrl: 'https://example.test/scene.json' }),
  );
  assert.deepEqual(portable.definition.cameraTracks, source.cameraTracks);
  const doc = document();
  doc.replaceScene(source);
  doc.setCameraKeyEditing(true);
  doc.setCameraPreview(true);
  assert.equal(doc.exportJson(), json);
  const registry = new SceneCharacterRegistry();
  const recovered = await importProjectPackage(await sceneDraftSource(doc, registry, 'camera-draft')!.build());
  assert.deepEqual(recovered.scenes.workingScene!.cameraTracks, source.cameraTracks);
  assert.isFalse(recovered.scenes.cameraKeyEditing);
  for (const time of [0, 1234.5, 3000, 5000, 10000])
    assert.deepEqual(evaluateCameraAtTime(portable.definition, time), evaluateCameraAtTime(source, time));
  registry.dispose();
});
