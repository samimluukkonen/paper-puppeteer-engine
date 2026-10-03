import { rejects } from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    Loader: { Events: { FILE_LOAD_ERROR: 'loaderror', COMPLETE: 'complete' } },
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const definition = CharacterDefinition.fromData({
  manifest: {
    version: 1,
    id: 'test',
    rig: 'rig.json',
    defaultSkin: 'default',
    skins: { default: 'skin.json' },
    animations: [],
    textures: { part: 'part.png' },
  },
  rig: { version: 1, root: 'root', bones: [{ id: 'root', sprite: { texture: 'part' } }] },
  skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
});

function fixture() {
  const load = Object.assign(new EventEmitter(), { image: vi.fn(), start: vi.fn() });
  const events = new EventEmitter();
  const scene = { load, events, textures: { exists: () => false }, sys: { isActive: () => true } };
  const metadata = vi.spyOn(CharacterLoader, 'load').mockResolvedValue(definition);
  const start = () => loadSceneCharacter(scene as unknown as Phaser.Scene, 'https://example.test/character.json');
  const assertClean = () => {
    assert.equal(events.listenerCount('shutdown'), 0);
    assert.equal(load.listenerCount('complete'), 0);
    assert.equal(load.listenerCount('loaderror'), 0);
  };
  return { scene, load, events, metadata, start, assertClean };
}

test('character loading waits for artwork and cleans up after success', async () => {
  const { load, start, assertClean } = fixture();
  const pending = start();
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  assert.deepEqual(load.image.mock.calls, [['part', 'part.png']]);
  load.emit('complete');
  assert.strictEqual(await pending, definition);
  assertClean();
});

test('an image failure rejects the character after loading completes', async () => {
  const { load, start, assertClean } = fixture();
  const pending = start();
  const rejection = rejects(pending, /Could not load character images: "part" \(part\.png\)/);
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  load.emit('loaderror', { key: 'part', type: 'image' });
  load.emit('complete');
  await rejection;
  assertClean();
});

test.each([
  { key: 'unrelated', type: 'image' },
  { key: 'part', type: 'audio' },
])('unrelated $type failures do not reject character loading', async (file) => {
  const { load, start, assertClean } = fixture();
  const pending = start();
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  load.emit('loaderror', file);
  load.emit('complete');
  assert.strictEqual(await pending, definition);
  assertClean();
});

test('preloaded character keys do not claim failures from new image requests', async () => {
  const { scene, load, start, assertClean } = fixture();
  scene.textures.exists = () => true;
  const pending = start();
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  load.emit('loaderror', { key: 'part', type: 'image' });
  load.emit('complete');
  assert.strictEqual(await pending, definition);
  assert.equal(load.image.mock.calls.length, 0);
  assertClean();
});

test('shutdown aborts metadata and prevents a late result from affecting a restarted scene', async () => {
  const { load, events, metadata, start, assertClean } = fixture();
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  let release!: (value: CharacterDefinition) => void;
  metadata.mockImplementationOnce(async (url, fetch) => {
    await fetch!(url);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const oldSession = start();
  await vi.waitFor(() => assert.isFunction(release));
  const signal = fetcher.mock.lastCall![1].signal as AbortSignal;
  assert.isFalse(signal.aborted);
  events.emit('shutdown');
  assert.isUndefined(await oldSession);
  assert.isTrue(signal.aborted);
  assertClean();
  const newSession = start();
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  release(definition);
  await Promise.resolve();
  load.emit('complete');
  assert.strictEqual(await newSession, definition);
  assert.equal(load.start.mock.calls.length, 1);
  assert.equal(load.image.mock.calls.length, 1);
  assertClean();
});

test('shutdown while images load settles promptly and removes loader listeners', async () => {
  const { load, events, start, assertClean } = fixture();
  const pending = start();
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  events.emit('shutdown');
  assert.isUndefined(await pending);
  assertClean();
  load.emit('loaderror');
  load.emit('complete');
});

test.each(['metadata', 'image queue', 'loader start'])(
  'a failure during %s releases scene listeners',
  async (stage) => {
    const { load, metadata, start, assertClean } = fixture();
    const error = new Error('load failed');
    if (stage === 'metadata') metadata.mockRejectedValueOnce(error);
    else
      (stage === 'image queue' ? load.image : load.start).mockImplementationOnce(() => {
        throw error;
      });
    await rejects(start(), /load failed/);
    assertClean();
  },
);

test('an inactive scene does not queue artwork after metadata resolves', async () => {
  const { scene, metadata, load, start, assertClean } = fixture();
  scene.sys.isActive = () => false;
  assert.isUndefined(await start());
  assert.equal(metadata.mock.calls.length, 1);
  assert.equal(load.start.mock.calls.length, 0);
  assertClean();
});

test('loading from create waits for Phaser to mark the scene active', async () => {
  const { scene, load, start, assertClean } = fixture();
  scene.sys.isActive = () => false;
  const pending = start();
  scene.sys.isActive = () => true;
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  load.emit('complete');
  assert.strictEqual(await pending, definition);
  assertClean();
});
