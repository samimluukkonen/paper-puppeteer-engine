import { rejects } from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS, queueCharacterTextures } from '../src/engine/queueCharacterTextures.js';
import { loadSceneCharacter, type SceneCharacterLoadOptions } from '../src/shared/loadSceneCharacter.js';
import { requestUrl } from './helpers/requestUrl.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    Loader: {
      FILE_ERRORED: 16,
      FILE_COMPLETE: 17,
      FILE_PENDING_DESTROY: 20,
      Events: { ADD: 'addfile', FILE_LOAD_ERROR: 'loaderror', FILE_COMPLETE: 'filecomplete', COMPLETE: 'complete' },
    },
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function character(texture = 'part.png', extraTextures: Record<string, string> = {}) {
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'test',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: [],
      textures: { part: texture, ...extraTextures },
    },
    rig: { version: 1, root: 'root', bones: [{ id: 'root', sprite: { texture: 'part' } }] },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
  });
}
const definition = character();

function fixture() {
  const load = Object.assign(new EventEmitter(), { image: vi.fn(), start: vi.fn() });
  const events = new EventEmitter();
  const scene = { load, events, textures: { exists: () => false }, sys: { isActive: () => true } };
  const metadata = vi.spyOn(CharacterLoader, 'load').mockResolvedValue(definition);
  const start = (options?: SceneCharacterLoadOptions) =>
    loadSceneCharacter(scene as unknown as Phaser.Scene, 'https://example.test/character.json', options);
  const assertClean = () => {
    assert.equal(events.listenerCount('shutdown'), 0);
    assert.equal(load.listenerCount('complete'), 0);
    assert.equal(load.listenerCount('loaderror'), 0);
    assert.equal(load.listenerCount('filecomplete'), 0);
    assert.equal(load.listenerCount('addfile'), 0);
  };
  return { scene, load, events, metadata, start, assertClean };
}

/** Model Phaser's public file queues and failure path without using its browser renderer. */
function pendingArtwork(load: ReturnType<typeof fixture>['load'], phase: 'queued' | 'request' | 'decode' | 'image') {
  class Image {
    src = 'blob:pending-character-image';
    onload: (() => void) | null = vi.fn();
    onerror: (() => void) | null = vi.fn();
  }
  vi.stubGlobal('HTMLImageElement', Image);
  const xhr = { onload: vi.fn(), onerror: vi.fn(), onprogress: vi.fn(), ontimeout: vi.fn(), abort: vi.fn() };
  const image = phase === 'decode' || phase === 'image' ? new Image() : null;
  const file = {
    loader: load,
    key: 'part',
    type: 'image',
    state: 11,
    xhrLoader: phase === 'request' ? xhr : null,
    data: image,
    destroy: vi.fn(),
  };
  const list = new Set<typeof file>();
  const inflight = new Set<typeof file>();
  const queue = new Set<typeof file>();
  const nextFile = vi.fn((failed: typeof file, success: boolean) => {
    assert.isFalse(success);
    inflight.delete(failed);
    queue.delete(failed);
    load.emit('loaderror', failed);
    if (!list.size && !inflight.size && !queue.size) load.emit('complete');
  });
  const isLoading = vi.fn(() => true);
  Object.assign(load, { list, inflight, queue, nextFile, isLoading });
  load.image.mockImplementationOnce(() => {
    (phase === 'queued' ? list : phase === 'decode' ? queue : inflight).add(file);
    load.emit('addfile', file.key, file.type, load, file);
  });
  return { file, xhr, image, list, inflight, queue, nextFile, isLoading };
}

test('shutdown aborts artwork even after Phaser resets its queues, without restarting the loader', async () => {
  vi.useFakeTimers();
  const { load, events, start, assertClean } = fixture();
  const { file, xhr, inflight, nextFile, isLoading } = pendingArtwork(load, 'request');
  const pending = start();
  await vi.advanceTimersByTimeAsync(0);
  // Phaser's loader handles SHUTDOWN before the scene session's listener.
  inflight.clear();
  isLoading.mockReturnValue(false);
  events.emit('shutdown');
  assert.isUndefined(await pending);
  assert.equal(xhr.abort.mock.calls.length, 1);
  assert.equal(file.destroy.mock.calls.length, 1);
  assert.equal(nextFile.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 0);
  assertClean();
});

test.each([17, 20])('shutdown preserves already cached image data in file state %s', async (state) => {
  vi.useFakeTimers();
  const { load, events, start, assertClean } = fixture();
  const { file, image, queue, nextFile } = pendingArtwork(load, 'decode');
  const pending = start();
  await vi.advanceTimersByTimeAsync(0);
  file.state = state;
  queue.clear();
  events.emit('shutdown');
  assert.isUndefined(await pending);
  assert.equal(image!.src, 'blob:pending-character-image');
  assert.isFunction(image!.onload);
  assert.equal(file.destroy.mock.calls.length, 0);
  assert.equal(nextFile.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 0);
  assertClean();
});

test('a partial image queue failure removes owned files before releasing their texture keys', async () => {
  const { load, start, assertClean } = fixture();
  const { file, list, nextFile, isLoading } = pendingArtwork(load, 'queued');
  isLoading.mockReturnValue(false);
  load.image.mockReset().mockImplementationOnce(() => {
    list.add(file);
    load.emit('addfile', file.key, file.type, load, file);
    throw new Error('Image queue failed');
  });
  await rejects(start(), /Image queue failed/);
  assert.equal(list.size, 0);
  assert.equal(file.destroy.mock.calls.length, 1);
  assert.equal(nextFile.mock.calls.length, 0);
  assertClean();
});

test('the default artwork deadline rejects stalled loading and releases reservations for a replacement', async () => {
  vi.useFakeTimers();
  const { load, metadata, start, assertClean } = fixture();
  const pending = start();
  const rejection = rejects(pending, { name: 'TimeoutError', message: /Character artwork loading timed out/ });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(load.start.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS - 1);
  assert.equal(load.listenerCount('complete'), 2);
  await vi.advanceTimersByTimeAsync(1);
  await rejection;
  assertClean();
  assert.equal(vi.getTimerCount(), 0);
  metadata.mockResolvedValueOnce(character('replacement.png'));
  const replacement = start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(load.start.mock.calls.length, 2);
  load.emit('complete');
  assert.equal((await replacement)?.textureUrl('part'), 'replacement.png');
  assertClean();
  assert.equal(vi.getTimerCount(), 0);
});

test.each(['queued', 'request', 'decode', 'image'] as const)(
  'a custom artwork deadline cancels the character %s file while unrelated loading continues',
  async (phase) => {
    vi.useFakeTimers();
    const { load, start, assertClean } = fixture();
    const { file, xhr, image, list, inflight, queue, nextFile } = pendingArtwork(load, phase);
    const unrelated = { ...file, key: 'unrelated', xhrLoader: { ...xhr, abort: vi.fn() } };
    inflight.add(unrelated);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pending = start({ artworkTimeoutMs: 5000 });
    const rejection = rejects(pending, { name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(load.image.mock.calls, [['part', 'part.png', { responseType: 'blob', timeout: 5000 }]]);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    assertClean();
    assert.equal(vi.getTimerCount(), 0);
    assert.isFalse(list.has(file) || inflight.has(file) || queue.has(file));
    assert.isTrue(inflight.has(unrelated));
    assert.equal(unrelated.xhrLoader.abort.mock.calls.length, 0);
    assert.deepEqual(nextFile.mock.calls, [[file, false]]);
    if (phase === 'request') {
      assert.equal(xhr.abort.mock.calls.length, 1);
      assert.isNull(xhr.onload);
      assert.isNull(xhr.onerror);
      assert.isNull(xhr.onprogress);
      assert.isNull(xhr.ontimeout);
    }
    if (image) {
      assert.isNull(image.onload);
      assert.isNull(image.onerror);
      assert.equal(image.src, '');
      assert.deepEqual(revoke.mock.calls, [['blob:pending-character-image']]);
    }
    load.emit('complete');
    assertClean();
  },
);

test.each(['complete', 'shutdown', 'error'] as const)(
  '%s clears the artwork deadline without late effects',
  async (finish) => {
    vi.useFakeTimers();
    const { load, events, start, assertClean } = fixture();
    const pending = start({ artworkTimeoutMs: 5000 });
    const result = finish === 'error' ? rejects(pending, /Could not load character images/) : pending;
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(vi.getTimerCount(), 1);
    if (finish === 'shutdown') events.emit('shutdown');
    else {
      if (finish === 'error') load.emit('loaderror', { key: 'part', type: 'image' });
      load.emit('complete');
    }
    await result;
    assertClean();
    assert.equal(vi.getTimerCount(), 0);
    await vi.advanceTimersByTimeAsync(10_000);
    assertClean();
  },
);

test.each([0, -1, NaN, Infinity, 1.5, 2_147_483_648])(
  'invalid artwork timeout %s rejects before loading',
  async (artworkTimeoutMs) => {
    const { metadata, start, assertClean } = fixture();
    await rejects(start({ artworkTimeoutMs }));
    assert.equal(metadata.mock.calls.length, 0);
    assertClean();
  },
);

test('character loading waits for artwork and cleans up after success', async () => {
  const { load, start, assertClean } = fixture();
  const pending = start();
  await vi.waitFor(() => assert.equal(load.start.mock.calls.length, 1));
  assert.deepEqual(load.image.mock.calls, [
    ['part', 'part.png', { responseType: 'blob', timeout: DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS }],
  ]);
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
  assert.strictEqual(await pending, definition);
  assert.equal(load.start.mock.calls.length, 0);
  load.emit('loaderror', { key: 'part', type: 'image' });
  load.emit('complete');
  assert.equal(load.image.mock.calls.length, 0);
  assertClean();
});

test.each(['part.png', 'replacement.png'])('cached character images validate the requested URL %s', async (texture) => {
  const { scene, load, metadata, start, assertClean } = fixture();
  let loaded = false;
  scene.textures.exists = () => loaded;
  queueCharacterTextures(scene as unknown as Phaser.Scene, definition);
  loaded = true;
  load.emit('complete');
  assertClean();
  const replacement = character(texture);
  metadata.mockResolvedValueOnce(replacement);
  if (texture === 'part.png') assert.strictEqual(await start(), replacement);
  else await rejects(start(), /Texture key "part".*already assigned.*part\.png.*replacement\.png/);
  // Only the initial load queues artwork; reuse and rejection leave no listeners or new batch.
  assert.equal(load.image.mock.calls.length, 1);
  assert.equal(load.start.mock.calls.length, 0);
  assertClean();
});

test.each(['loaded', 'failed'] as const)(
  'character artwork that %s settles without waiting for unrelated scene downloads',
  async (result) => {
    vi.useFakeTimers();
    const { load, start, assertClean } = fixture();
    const pending = start({ artworkTimeoutMs: 5000 });
    const outcome = result === 'failed' ? rejects(pending, /Could not load character images/) : pending;
    await vi.advanceTimersByTimeAsync(0);
    if (result === 'loaded') load.emit('filecomplete', 'part', 'image');
    else load.emit('loaderror', { key: 'part', type: 'image' });
    await vi.advanceTimersByTimeAsync(0);
    const character = await outcome;
    if (result === 'loaded') assert.strictEqual(character, definition);
    assertClean();
    assert.equal(vi.getTimerCount(), 0);
    await vi.advanceTimersByTimeAsync(10_000);
    // An unrelated file can complete the global batch after the character session has already settled.
    load.emit('complete');
    assertClean();
  },
);

test('file completion waits for every character image and ignores unrelated keys and file types', async () => {
  vi.useFakeTimers();
  const { load, metadata, start, assertClean } = fixture();
  const multiple = character('part.png', { extra: 'extra.png' });
  metadata.mockResolvedValueOnce(multiple);
  let settled = false;
  const pending = start().then((result) => {
    settled = true;
    return result;
  });
  await vi.advanceTimersByTimeAsync(0);
  load.emit('filecomplete', 'unrelated', 'image');
  load.emit('filecomplete', 'part', 'audio');
  load.emit('filecomplete', 'part', 'image');
  await vi.advanceTimersByTimeAsync(0);
  assert.isFalse(settled);
  load.emit('filecomplete', 'extra', 'image');
  await vi.advanceTimersByTimeAsync(0);
  assert.strictEqual(await pending, multiple);
  assertClean();
  assert.equal(vi.getTimerCount(), 0);
});

test('shutdown aborts metadata and prevents a late result from affecting a restarted scene', async () => {
  const { load, events, metadata, start, assertClean } = fixture();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  let release!: (value: CharacterDefinition) => void;
  metadata.mockImplementationOnce(async (url, fetch, options) => {
    await fetch!(url, { signal: options!.signal! });
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const oldSession = start();
  await vi.waitFor(() => assert.isFunction(release));
  const signal = fetcher.mock.lastCall![1]!.signal!;
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

test('a metadata failure aborts sibling requests and preserves the original error', async () => {
  const { metadata, start, load, events, assertClean } = fixture();
  metadata.mockRestore();
  const aborted = vi.fn();
  let siblingSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith('character.json'))
      return Response.json({
        version: 1,
        id: 'test',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: { default: 'skin.json' },
        animations: [],
        textures: {},
      });
    if (url.endsWith('rig.json')) return new Response(null, { status: 404 });
    siblingSignal = init!.signal!;
    return new Promise<Response>((_resolve, reject) => {
      siblingSignal!.addEventListener(
        'abort',
        () => {
          aborted();
          reject(siblingSignal!.reason);
        },
        { once: true },
      );
    });
  });

  await rejects(start(), /Could not load character JSON "https:\/\/example.test\/rig.json" \(404\)/);
  assert.isTrue(siblingSignal?.aborted);
  assert.equal(aborted.mock.calls.length, 1);
  assert.equal(load.start.mock.calls.length, 0);
  assertClean();
  events.emit('shutdown');
  assert.equal(aborted.mock.calls.length, 1);
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
