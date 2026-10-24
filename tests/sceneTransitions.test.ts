import { EventEmitter } from 'node:events';
import { assert, test, vi } from 'vitest';
import { importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { snapSceneTime } from '../src/devtools/scene-editor/timelineActions.js';
import { sceneDraftSource } from '../src/devtools/shared/autosave/editorDrafts.js';
import { Actor } from '../src/engine/Actor.js';
import { evaluateCameraAtTime } from '../src/engine/cameraAnimation.js';
import { cinematicFrame } from '../src/engine/cinematicCamera.js';
import { Puppet } from '../src/engine/Puppet.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { SceneLoader } from '../src/engine/SceneLoader.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { SceneTransitionOverlay } from '../src/engine/SceneTransitionOverlay.js';
import {
  CLEAR_SCENE_TRANSITION,
  evaluateTransitionAtTime,
  type SceneTransition,
} from '../src/engine/sceneTransitions.js';
import { puppetScene } from './helpers/puppetScene.js';
import { assetFixture, sceneFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Loader: {
      Events: { ADD: 'addfile', FILE_LOAD_ERROR: 'loaderror', FILE_COMPLETE: 'filecomplete', COMPLETE: 'complete' },
    },
  },
}));

const fade = (
  id: string,
  time: number,
  duration: number,
  type: SceneTransition['type'] = 'fade-in',
  color = '#000000',
): SceneTransition => ({ id, time, duration, type, color });
function scene() {
  return parseSceneDefinition({
    ...createEmptyScene({ id: 'fades', duration: 10000 }),
    transitions: [
      fade('in', 0, 1000),
      fade('out', 5000, 1000, 'fade-out', '#123456'),
      fade('return', 8000, 2000, 'fade-in', '#123456'),
    ],
  });
}
function document() {
  const doc = new SceneEditorDocument();
  doc.importJson(serializeSceneDefinition(scene()));
  return doc;
}
function factory() {
  const phaser = puppetScene();
  return (data: { id: string }) =>
    new Actor({
      id: data.id,
      puppetOwnership: 'owned',
      puppet: new Puppet(phaser, { rig: { root: 'root', bones: [{ id: 'root' }] }, autoUpdate: false }),
    });
}
function stage() {
  const phaser = puppetScene();
  const graphics = {
    setDepth: vi.fn<(depth: number) => unknown>(),
    clear: vi.fn(),
    fillStyle: vi.fn<(color: number, opacity: number) => unknown>(),
    fillRect: vi.fn<(x: number, y: number, width: number, height: number) => unknown>(),
    destroy: vi.fn(),
  };
  graphics.setDepth.mockReturnValue(graphics);
  Object.assign(phaser.add, { graphics: () => graphics });
  const events = new EventEmitter();
  Object.assign(phaser, {
    events,
    load: Object.assign(new EventEmitter(), { start: vi.fn() }),
    sys: { isActive: () => true },
  });
  return { phaser, graphics, events };
}

test('fade in/out, endpoints, holds, adjacent intervals and seek order are scene-clock samples', () => {
  const source = scene();
  for (const [time, opacity] of [
    [0, 1],
    [250, 0.75],
    [500, 0.5],
    [1000, 0],
    [4000, 0],
    [5000, 0],
    [5500, 0.5],
    [6000, 1],
    [7500, 1],
    [8000, 1],
    [9000, 0.5],
    [10000, 0],
    [5500, 0.5],
    [250, 0.75],
  ]) {
    assert.equal(evaluateTransitionAtTime(source, time!).opacity, opacity);
  }
  assert.equal(evaluateTransitionAtTime(source, 5500).color, '#123456');
  assert.equal(evaluateTransitionAtTime(source, -100).opacity, 1);
  assert.equal(evaluateTransitionAtTime(source, 20000).opacity, 0);
  assert.throws(() => evaluateTransitionAtTime(source, NaN), /finite/);
  assert.deepEqual(evaluateTransitionAtTime(createEmptyScene({ id: 'legacy' }), 1000), CLEAR_SCENE_TRANSITION);
  const adjacent = { ...source, transitions: [fade('b', 2000, 1000, 'fade-in'), fade('a', 1000, 1000, 'fade-out')] };
  assert.deepEqual(evaluateTransitionAtTime(adjacent, 999), CLEAR_SCENE_TRANSITION);
  assert.equal(evaluateTransitionAtTime(adjacent, 2000).opacity, 1);
  assert.equal(evaluateTransitionAtTime(adjacent, 2500).opacity, 0.5);
});

test('invalid fade parameters, IDs, bounds and overlapping intervals are rejected; adjacency and cuts coexist', () => {
  const base = createEmptyScene({ id: 'validation', duration: 10000 });
  for (const patch of [
    { time: -1 },
    { time: NaN },
    { time: Infinity },
    { duration: 0 },
    { duration: -1 },
    { duration: Infinity },
    { time: 10000 },
    { time: 9500 },
    { type: 'blur' },
    { color: 'black' },
    { color: '#fff' },
    { color: '#000000ff' },
    { color: '#zzzzzz' },
    { id: '' },
    { id: '   ' },
    { time: 1000, duration: Number.MIN_VALUE },
  ])
    assert.throws(() => parseSceneDefinition({ ...base, transitions: [{ ...fade('a', 0, 1000), ...patch }] }));
  for (const transitions of [
    [fade('a', 0, 1000), fade('a', 2000, 1000)],
    [fade('a', 0, 1000), fade('b', 999, 1000, 'fade-out')],
    [fade('a', 0, 1000), fade('b', 0, 500)],
    [fade('a', 0, 9000), fade('b', 2000, 1000), fade('c', 4000, 1000)],
  ])
    assert.throws(() => parseSceneDefinition({ ...base, transitions }));
  assert.doesNotThrow(() =>
    parseSceneDefinition({ ...base, transitions: [fade('b', 1000, 1000), fade('a', 0, 1000)] }),
  );
  assert.isUndefined(parseSceneDefinition(base).transitions);
});

test('Set Camera Cut anchors old shots and jumps all channels at the exact boundary in one undo entry', () => {
  const doc = document();
  doc.updateCamera({ x: -100, y: 50, zoom: 0.5 });
  const before = doc.workingScene;
  assert.isTrue(doc.setCameraCut(3000, { x: 200, y: -50, zoom: 2 }));
  const cut = doc.workingScene!;
  for (const time of [0, 1500, 2999.999])
    assert.deepEqual(evaluateCameraAtTime(cut, time), { x: -100, y: 50, zoom: 0.5 });
  for (const time of [3000, 3000.001, 7000])
    assert.deepEqual(evaluateCameraAtTime(cut, time), { x: 200, y: -50, zoom: 2 });
  doc.undo();
  assert.strictEqual(doc.workingScene, before);
  doc.redo();
  assert.strictEqual(doc.workingScene, cut);
  assert.isFalse(doc.setCameraCut(11000));
  assert.strictEqual(doc.workingScene, cut);
  doc.setCameraCut(6000, { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(evaluateCameraAtTime(doc.workingScene!, 5999), { x: 200, y: -50, zoom: 2 });
  assert.deepEqual(evaluateCameraAtTime(doc.workingScene!, 6000), { x: 0, y: 0, zoom: 1 });
  doc.setCameraCut(0, { x: 10, y: 20, zoom: 1 });
  assert.deepEqual(evaluateCameraAtTime(doc.workingScene!, 0), { x: 10, y: 20, zoom: 1 });
});

test('fade authoring selects stable IDs, edits duration/time/color, rejects conflicts atomically and supports Undo/Redo', () => {
  const doc = document();
  const before = doc.workingScene;
  doc.addTransition(fade('ignored', 2000, 500, 'fade-out'));
  const id = doc.selectedTransition!.id;
  assert.equal(id, 'transition-1');
  const added = doc.workingScene;
  doc.updateTransition(id, { time: 2500, duration: 750, color: '#abcdef', type: 'fade-in' });
  const edited = doc.workingScene;
  assert.equal(doc.selectedTransition!.time, 2500);
  assert.isFalse(doc.updateTransition(id, { time: 500 }));
  assert.strictEqual(doc.workingScene, edited);
  assert.isFalse(doc.updateProperties({ duration: 9000 }));
  assert.strictEqual(doc.workingScene, edited);
  doc.undo();
  assert.strictEqual(doc.workingScene, added);
  doc.undo();
  assert.strictEqual(doc.workingScene, before);
  doc.redo();
  doc.redo();
  assert.strictEqual(doc.workingScene, edited);
  doc.removeTransition(id);
  assert.isNull(doc.selectedTransition);
  doc.undo();
  assert.equal(doc.selectedTransition!.id, id);
  doc.selectCamera();
  assert.isNull(doc.selectedTransition);
  doc.selectTransition(id);
  doc.selectActor(null);
  assert.isNull(doc.selectedTransition);
  assert.closeTo(snapSceneTime(doc.workingScene!, null, 3252, 1000, 0, true), 3250, 1e-8);
});

test('runtime fades and cuts share Actor time, pause/resume, seek without cues, completion and cleanup', () => {
  const source = scene();
  source.actors = [{ id: 'hero', character: { manifest: 'hero.json' }, position: { x: 0, y: 0 } }];
  source.actions = [
    { id: 'move', actorId: 'hero', type: 'move', time: 0, duration: 10000, destination: { x: 100, y: 0 } },
    { id: 'cue', actorId: 'hero', type: 'cue', time: 500, name: 'external' },
  ];
  source.cameraTracks = {
    x: [
      { id: 'wide', time: 0, value: 0, curve: { mode: 'stepped' } },
      { id: 'close', time: 3000, value: 100 },
    ],
  };
  const onCue = vi.fn();
  const overlay = { setTransition: vi.fn() };
  const runner = new SceneRunner(source, { createActor: factory(), onCue, transitionOverlay: overlay });
  runner.play();
  runner.update(500);
  assert.equal(runner.transition.opacity, 0.5);
  assert.equal(onCue.mock.calls.length, 1);
  runner.pause();
  runner.update(500);
  assert.equal(runner.transition.opacity, 0.5);
  runner.play();
  runner.update(250);
  assert.equal(runner.transition.opacity, 0.25);
  for (const time of [9000, 5500, 2999.99, 3000, 3000.01, 250, 750]) {
    runner.seek(time);
    assert.deepEqual(overlay.setTransition.mock.calls.at(-1), [evaluateTransitionAtTime(source, time)]);
    assert.equal(runner.cinematicCamera.x, time < 3000 ? 0 : 100);
    assert.closeTo(runner.actors.get('hero')!.position.x, time / 100, 1e-7);
  }
  assert.equal(onCue.mock.calls.length, 1);
  runner.seek(5500);
  runner.cancel();
  assert.deepEqual(overlay.setTransition.mock.calls.at(-1), [CLEAR_SCENE_TRANSITION]);
  runner.restart();
  assert.equal(runner.transition.opacity, 1);
  runner.stop();
  assert.equal(runner.time, 0);
  runner.seek(10000);
  assert.equal(runner.status, 'completed');
  assert.equal(runner.transition.opacity, 0);
  runner.seek(6500);
  assert.equal(runner.transition.opacity, 1);
  runner.dispose();
  runner.dispose();
  assert.deepEqual(overlay.setTransition.mock.calls.at(-1), [CLEAR_SCENE_TRANSITION]);
});

test('fade edits and history retain editor clock, playback status and Actor instances', () => {
  const doc = document();
  doc.addActor('hero.json');
  const playback = new SceneEditorPlayback();
  const createActor = factory();
  const sync = () => playback.sync(doc.workingScene, true, createActor);
  sync();
  const release = doc.subscribe(sync);
  playback.seek(5500);
  playback.play();
  const actor = playback.actors!.get('actor-1');
  doc.updateTransition('out', { color: '#ffffff', duration: 2000 });
  assert.equal(playback.time, 5500);
  assert.equal(playback.status, 'playing');
  assert.strictEqual(playback.actors!.get('actor-1'), actor);
  doc.undo();
  doc.redo();
  assert.equal(playback.time, 5500);
  assert.strictEqual(playback.actors!.get('actor-1'), actor);
  release();
  playback.dispose();
});

test('JSON, standalone ZIP and project recovery preserve fades and cuts with identical sampling', async () => {
  const doc = document();
  doc.setCameraCut(3000, { x: 100, y: 20, zoom: 2 });
  const source = doc.workingScene!;
  assert.deepEqual(parseSceneJson(doc.exportJson()), source);
  const portable = await validateScenePackage(
    await buildScenePackage(source, { baseUrl: 'https://example.test/scene.json' }),
  );
  assert.deepEqual(portable.definition, source);
  const registry = new SceneCharacterRegistry();
  try {
    const recovered = await importProjectPackage(await sceneDraftSource(doc, registry, 'fades-draft')!.build());
    assert.deepEqual(recovered.scenes.workingScene, source);
    assert.isNull(recovered.scenes.selectedTransition);
    for (const time of [0, 500, 2999.999, 3000, 5500, 7000, 9000, 10000]) {
      assert.deepEqual(evaluateTransitionAtTime(portable.definition, time), evaluateTransitionAtTime(source, time));
      assert.deepEqual(evaluateCameraAtTime(portable.definition, time), evaluateCameraAtTime(source, time));
    }
  } finally {
    registry.dispose();
  }
});

test('overlay covers the camera frame above all scene bands, clears samples and releases its shutdown handler', () => {
  const { phaser, graphics, events } = stage();
  const overlay = new SceneTransitionOverlay(phaser);
  assert.deepEqual(graphics.setDepth.mock.calls, [[8000]]);
  const camera = { x: 100, y: 50, zoom: 2 };
  overlay.setCamera(camera);
  overlay.setTransition({ color: '#123456', opacity: 0.5 });
  const frame = cinematicFrame(camera);
  assert.deepEqual(graphics.fillStyle.mock.calls.at(-1), [0x123456, 0.5]);
  assert.deepEqual(graphics.fillRect.mock.calls.at(-1), [frame.x, frame.y, frame.width, frame.height]);
  const count = graphics.fillRect.mock.calls.length;
  overlay.setTransition(CLEAR_SCENE_TRANSITION);
  assert.equal(graphics.fillRect.mock.calls.length, count);
  events.emit('shutdown');
  assert.equal(events.listenerCount('shutdown'), 0);
  overlay.dispose();
  overlay.setTransition({ color: '#ffffff', opacity: 1 });
  assert.equal(graphics.destroy.mock.calls.length, 1);
  assert.equal(graphics.fillRect.mock.calls.length, count);
});

test('standalone SceneLoader renders imported fades on the same clock and disposes the overlay', async () => {
  const source = { ...sceneFixture(), transitions: [fade('in', 0, 1000), fade('out', 1000, 1000, 'fade-out')] };
  const files = await buildScenePackage(source, assetFixture());
  const { phaser, graphics } = stage();
  const loaded = await SceneLoader.loadPackage(phaser, files);
  const camera = { width: 1000, height: 700, setViewport: vi.fn(), setZoom: vi.fn(), centerOn: vi.fn() };
  loaded.applyCamera(camera);
  loaded.runner.play();
  loaded.runner.update(500);
  assert.deepEqual(graphics.fillStyle.mock.calls.at(-1), [0, 0.5]);
  for (const time of [1500, 250, 2000, 500]) {
    loaded.runner.seek(time);
    assert.equal(loaded.runner.transition.opacity, evaluateTransitionAtTime(source, time).opacity);
  }
  loaded.dispose();
  loaded.dispose();
  assert.equal(graphics.destroy.mock.calls.length, 1);
  assert.equal(loaded.runner.status, 'disposed');
});
