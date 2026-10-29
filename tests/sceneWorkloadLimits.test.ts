import { assert, expect, test, vi } from 'vitest';
import { SceneImageRegistry } from '../src/devtools/scene-editor/SceneImageRegistry.js';
import { AUDIO_MAX_FILE_BYTES } from '../src/engine/AudioAsset.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { resolveSceneDefinition } from '../src/engine/SceneAssets.js';
import { createEmptyScene, parseSceneDefinition, validateSceneDefinition } from '../src/engine/SceneDefinition.js';
import { createSceneTextureBudget } from '../src/engine/sceneTextureBudget.js';
import {
  assertSceneInstanceBudget,
  DEFAULT_SCENE_WORKLOAD_LIMITS as limits,
} from '../src/engine/sceneWorkloadLimits.js';

function character(count: number, slots = 0) {
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: [],
      textures: {},
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [
        { id: 'root' },
        ...Array.from({ length: count - 1 }, (_, index) => ({ id: `bone-${index}`, parent: 'root' })),
      ],
      slots: Array.from({ length: slots }, (_, index) => ({ id: `slot-${index}`, bone: 'root' })),
    },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
  });
}
function scene(count: number = limits.maxActors) {
  return {
    ...createEmptyScene({ id: 'opening' }),
    actors: Array.from({ length: count }, (_, index) => ({
      id: `actor-${index}`,
      character: { manifest: 'character.json' },
      position: { x: 0, y: 0 },
    })),
  };
}

test('rejects oversized raw scene collections before inspecting their malformed entries', () => {
  for (const [field, count] of [
    ['actors', limits.maxActors],
    ['actions', limits.maxActions],
  ] as const) {
    const issues = validateSceneDefinition({ ...scene(1), [field]: Array(count + 1).fill(null) });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.path, field);
    assert.match(issues[0]!.message, /limit/);
  }
  assert.equal(parseSceneDefinition(scene()).actors.length, limits.maxActors);
});

test('scene resolution accepts the editor image budget and rejects its next allocation', async () => {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(header.buffer).setUint32(16, 4096);
  new DataView(header.buffer).setUint32(20, 4096);
  const images = Array.from({ length: 9 }, (_, index) => ({
    id: `image-${index}`,
    image: `../images/image-${index}.png`,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    visible: true,
    order: index,
  }));
  const registry = new SceneImageRegistry();
  for (const image of images.slice(0, 8)) registry.register(image.image, header);
  const source = { ...createEmptyScene({ id: 'images' }), images: images.slice(0, 8) };
  const options = { baseUrl: 'https://example.test/scene.json', loadImage: () => Promise.resolve(header) };
  assert.equal((await resolveSceneDefinition(source, options)).images!.size, registry.entries.length);
  assert.throws(() => registry.register(images[8]!.image, header), /pixel total limit/);
  await expect(resolveSceneDefinition({ ...source, images }, options)).rejects.toThrow(/pixel total limit/);
});

function audioScene(count: number) {
  return {
    ...createEmptyScene({ id: 'audio' }),
    audioAssets: Array.from({ length: count }, (_, index) => ({
      id: `audio-${index}`,
      name: `Audio ${index}`,
      path: `audio/${index}.wav`,
      category: 'sfx' as const,
    })),
    audioTracks: [{ id: 'track', name: 'SFX', category: 'sfx' as const }],
    audioClips: Array.from({ length: count }, (_, index) => ({
      id: `clip-${index}`,
      assetId: `audio-${index}`,
      trackId: 'track',
      time: 0,
      duration: 1,
      sourceOffset: 0,
      volume: 1,
      loop: false,
    })),
  };
}
function wav(size: number) {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  return bytes;
}

test('host audio shares the total limit and stops acquiring assets when the budget is full', async () => {
  const bytes = wav(AUDIO_MAX_FILE_BYTES);
  const count = limits.maxTotalAudioBytes / bytes.byteLength;
  const loadAudio = vi.fn(() => Promise.resolve(bytes));
  const options = { baseUrl: 'https://example.test/scene.json', loadAudio };
  const resolved = await resolveSceneDefinition(audioScene(count), options);
  assert.equal(resolved.audio!.size, count);
  loadAudio.mockClear();
  await expect(resolveSceneDefinition(audioScene(count + 2), options)).rejects.toThrow(/audio.*total limit/);
  assert.equal(loadAudio.mock.calls.length, count);
});

test('host audio rejects a file larger than the remaining scene budget', async () => {
  const bytes = wav(AUDIO_MAX_FILE_BYTES - 1);
  const loadAudio = vi.fn(() => Promise.resolve(bytes));
  await expect(
    resolveSceneDefinition(audioScene(12), {
      baseUrl: 'https://example.test/scene.json',
      loadAudio,
    }),
  ).rejects.toThrow(/audio.*total limit/);
  assert.equal(loadAudio.mock.calls.length, 11);
});

test.each([undefined, '1'])('audio budget cancels streamed overflow with content-length %s', async (length) => {
  const bytes = wav(AUDIO_MAX_FILE_BYTES - 1);
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            // Leave overflow open: rejection must cancel it without waiting for EOF.
            if (fetcher.mock.calls.length <= 10) controller.close();
          },
          cancel,
        }),
        { headers: length ? { 'content-length': length } : {} },
      ),
    ),
  );
  await expect(
    resolveSceneDefinition(audioScene(12), {
      baseUrl: 'https://example.test/scene.json',
      fetcher,
    }),
  ).rejects.toThrow(/audio.*total limit/);
  assert.equal(fetcher.mock.calls.length, 11);
  assert.equal(cancel.mock.calls.length, 1);
});

test('counts every Actor instance even when all Actors share one definition', async () => {
  const source = scene();
  const allowed = character(limits.maxTotalBones / limits.maxActors);
  assert.doesNotThrow(() => assertSceneInstanceBudget(source, new Map([['character.json', allowed]])));
  const oversized = character(limits.maxTotalBones / limits.maxActors + 1);
  await expect(
    resolveSceneDefinition(source, {
      baseUrl: 'https://example.test/scene.json',
      loadCharacter: () => Promise.resolve(oversized),
    }),
  ).rejects.toThrow(/bone instance limit/);
  assert.throws(
    () => assertSceneInstanceBudget(source, new Map([['character.json', character(1, 129)]])),
    /slot instance limit/,
  );
});

test('scene texture budget counts aliases and characters together before image decoding', () => {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096);
  view.setUint32(20, 4096);
  const budget = createSceneTextureBudget();
  for (let index = 0; index < 8; index++) budget.checkImage(`character-${index}:paper`, header);
  assert.throws(() => budget.checkImage('character-9:alias', header), /total limit/);
  assert.throws(() => budget.checkImage('character-9:alias', header), /total limit/);
});
