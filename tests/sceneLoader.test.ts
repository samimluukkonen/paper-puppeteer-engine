import { rejects } from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, assert, test, vi } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { Actor } from '../src/engine/Actor.js';
import { encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { resolveSceneDefinition } from '../src/engine/SceneAssets.js';
import { parseSceneJson, serializeSceneDefinition } from '../src/engine/SceneDefinition.js';
import { SceneLoader, type LoadedScene } from '../src/engine/SceneLoader.js';
import { buildScenePackage } from '../src/engine/ScenePackage.js';
import type { SceneCue, SceneRunner } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';
import { requestUrl } from './helpers/requestUrl.js';
import { artworkFixture, assetFixture, sceneFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Loader: {
      Events: { ADD: 'addfile', FILE_LOAD_ERROR: 'loaderror', FILE_COMPLETE: 'filecomplete', COMPLETE: 'complete' },
    },
  },
}));
const sessions: LoadedScene[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

class SceneEvents {
  private listeners: { event: string; callback: (...args: unknown[]) => void; context: unknown; once: boolean }[] = [];
  on(event: string, callback: (...args: unknown[]) => void, context?: unknown) {
    this.listeners.push({ event, callback, context, once: false });
    return this;
  }
  once(event: string, callback: (...args: unknown[]) => void, context?: unknown) {
    this.listeners.push({ event, callback, context, once: true });
    return this;
  }
  off(event: string, callback: (...args: unknown[]) => void, context?: unknown) {
    this.listeners = this.listeners.filter(
      (entry) => entry.event !== event || entry.callback !== callback || entry.context !== context,
    );
    return this;
  }
  emit(event: string) {
    for (const entry of this.listeners.filter((entry) => entry.event === event)) {
      if (entry.once) this.off(event, entry.callback, entry.context);
      entry.callback.call(entry.context);
    }
  }
  listenerCount(event: string) {
    return this.listeners.filter((entry) => entry.event === event).length;
  }
}
function stage() {
  const events = new SceneEvents();
  const scene = puppetScene();
  Object.assign(scene, {
    events,
    load: Object.assign(new EventEmitter(), { start: vi.fn() }),
    sys: { isActive: () => true },
  });
  return { scene, events };
}
function snapshot(runner: SceneRunner) {
  return [...runner.actors].map(([id, actor]) => ({
    id,
    position: actor.position,
    facing: actor.facingDirection,
    animation: actor.currentAnimation,
    pose: { ...actor.puppet.getBone('root').pose },
    depth: actor.puppet.container.depth,
  }));
}

test('exported/imported JSON and ZIP runtime playback match the editor runner at every sampled time', async () => {
  const source = sceneFixture();
  const assets = assetFixture();
  const resolved = await resolveSceneDefinition(source, assets);
  const character = [...resolved.characters.values()][0]!;
  const document = new SceneEditorDocument();
  document.importJson(serializeSceneDefinition(source));
  const original = document.workingScene;
  const json = document.exportJson();
  const playback = new SceneEditorPlayback();
  const editorScene = stage().scene;
  playback.sync(document.workingScene, true, (data, depth) => {
    const puppet = new Puppet(editorScene, { definition: character, autoUpdate: false, depth });
    return new Actor({ id: data.id, puppet, puppetOwnership: 'owned' });
  });
  const onCue = vi.fn<(cue: SceneCue) => void>();
  const direct = await SceneLoader.fromDefinition(stage().scene, parseSceneJson(json), { ...assets, onCue });
  const packaged = await SceneLoader.loadPackage(
    stage().scene,
    encodePackageZip(await buildScenePackage(source, assets)),
    { onCue },
  );
  sessions.push(direct, packaged);
  for (const runtime of sessions) runtime.runner.play();
  playback.play();
  for (const delta of [100, 150, 250, 250, 250, 1000]) {
    playback.update(delta);
    direct.runner.update(delta);
    packaged.runner.update(delta);
    assert.deepEqual(snapshot(packaged.runner), snapshot(direct.runner));
    assert.deepEqual(
      [...playback.actors!.values()].map((actor) => ({
        id: actor.id,
        position: actor.position,
        facing: actor.facingDirection,
        animation: actor.currentAnimation,
        pose: { ...actor.puppet.getBone('root').pose },
        depth: actor.puppet.container.depth,
      })),
      snapshot(direct.runner),
    );
  }
  assert.equal(onCue.mock.calls.length, 2);
  const cues = onCue.mock.calls.length;
  for (const time of [250, 1500, 0, 1000]) {
    direct.runner.seek(time);
    packaged.runner.seek(time);
    assert.deepEqual(snapshot(packaged.runner), snapshot(direct.runner));
  }
  assert.equal(onCue.mock.calls.length, cues);
  assert.strictEqual(document.workingScene, original);
  assert.equal(document.exportJson(), json);
  assert.isFalse(document.canUndo);
  playback.dispose();
});

test('hosted scene JSON loads relative character references through the public adapter', async () => {
  const assets = assetFixture();
  const fetcher: typeof fetch = (input, init) =>
    requestUrl(input).endsWith('/scene.json')
      ? Promise.resolve(Response.json(sceneFixture()))
      : assets.fetcher(input, init);
  const { scene, events } = stage();
  const loaded = await SceneLoader.load(scene, assets.baseUrl, { fetcher });
  sessions.push(loaded);
  const actor = loaded.runner.actors.get('hero')!;
  loaded.runner.play();
  loaded.runner.update(600);
  assert.equal(loaded.runner.time, 600);
  assert.closeTo(loaded.runner.actors.get('hero')!.position.x, 100, 1e-8);
  events.emit('shutdown');
  assert.isTrue(actor.isDisposed);
  assert.equal(loaded.runner.status, 'disposed');
  assert.equal(events.listenerCount('shutdown'), 0);
});

test('invalid dependencies construct no Actors and leave no shutdown listeners', async () => {
  const assets = assetFixture();
  delete assets.documents['animations/wave.json'];
  const { scene, events } = stage();
  const add = vi.spyOn(scene.add, 'container');
  await rejects(SceneLoader.fromDefinition(scene, sceneFixture(), assets), /could not load/);
  assert.equal(add.mock.calls.length, 0);
  assert.equal(events.listenerCount('shutdown'), 0);
});

test('shutdown while metadata is pending aborts loading and installs no Actors', async () => {
  const { scene, events } = stage();
  const add = vi.spyOn(scene.add, 'container');
  let reached: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const fetcher: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      reached!();
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    });
  const loading = SceneLoader.fromDefinition(scene, sceneFixture(), { ...assetFixture(), fetcher });
  const failed = rejects(loading, /disposed/);
  await started;
  events.emit('shutdown');
  await failed;
  assert.equal(add.mock.calls.length, 0);
  assert.equal(events.listenerCount('shutdown'), 0);
});

test('external cancellation cleans up an already loaded session', async () => {
  const { scene, events } = stage();
  const controller = new AbortController();
  const loaded = await SceneLoader.fromDefinition(scene, sceneFixture(), {
    ...assetFixture(),
    signal: controller.signal,
  });
  sessions.push(loaded);
  const actors = [...loaded.runner.actors.values()];
  controller.abort();
  assert.equal(loaded.runner.status, 'disposed');
  assert.isTrue(actors.every((actor) => actor.isDisposed));
  assert.equal(events.listenerCount('shutdown'), 0);
});

test('ZIP runtime artwork uses isolated keys, shares image aliases, and releases URLs/textures on dispose', async () => {
  const files = await buildScenePackage(sceneFixture(), artworkFixture());
  const zip = encodePackageZip(files);
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const { scene } = stage();
  const remove = vi.fn<(key: string) => void>();
  Object.assign(scene.textures, { remove });
  const first = await SceneLoader.loadPackage(scene, zip);
  const second = await SceneLoader.loadPackage(scene, zip);
  sessions.push(first, second);
  const firstTexture = first.runner.actors.get('hero')!.puppet.rig.getBone('root').sprite!.texture;
  const secondTexture = second.runner.actors.get('hero')!.puppet.rig.getBone('root').sprite!.texture;
  assert.notEqual(firstTexture, secondTexture);
  assert.equal(createUrl.mock.calls.length, 2); // One URL per image path, shared by both texture aliases.
  first.dispose();
  second.dispose();
  assert.equal(revoke.mock.calls.length, 2);
  assert.equal(remove.mock.calls.length, 4);
  first.dispose();
  assert.equal(revoke.mock.calls.length, 2);
});

test('failed scene HTTP responses cancel their bodies and release the loading session', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const { scene, events } = stage();
  const fetcher: typeof fetch = () => Promise.resolve(new Response(body, { status: 404 }));
  await rejects(SceneLoader.load(scene, 'https://assets.test/scene.json', { fetcher }), /404/);
  assert.equal(cancel.mock.calls.length, 1);
  assert.equal(events.listenerCount('shutdown'), 0);
});
