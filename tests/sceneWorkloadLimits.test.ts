import { assert, expect, test, vi } from 'vitest';
import { SceneImageRegistry } from '../src/devtools/scene-editor/SceneImageRegistry.js';
import { AUDIO_MAX_FILE_BYTES } from '../src/engine/AudioAsset.js';
import { CharacterDefinition, type CharacterData } from '../src/engine/CharacterDefinition.js';
import { CharacterLoader, type CharacterLoadOptions } from '../src/engine/CharacterLoader.js';
import { countJsonBytes } from '../src/engine/jsonInput.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { resolveSceneDefinition } from '../src/engine/SceneAssets.js';
import { createEmptyScene, parseSceneDefinition, validateSceneDefinition } from '../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../src/engine/ScenePackage.js';
import { createSceneTextureBudget } from '../src/engine/sceneTextureBudget.js';
import {
  assertSceneInstanceBudget,
  DEFAULT_SCENE_WORKLOAD_LIMITS as limits,
  SceneMetadataBudget,
} from '../src/engine/sceneWorkloadLimits.js';
import type { MeshAttachmentDefinition, RigDefinition } from '../src/engine/types.js';
import { requestUrl } from './helpers/requestUrl.js';
import { assetFixture, sceneFixture } from './helpers/scenePackageFixtures.js';

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

function workloadCharacter(rig: RigDefinition & { name?: string }, animations: Record<string, unknown> = {}) {
  const data: CharacterData = {
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: Object.keys(animations),
      textures: { paper: 'paper.png' },
    },
    rig: { version: 1, ...rig },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    animations,
  };
  return CharacterDefinition.fromData(data);
}

function meshCharacter(count: number, influences = 0, slots = 1, grid = 1) {
  const rig: RigDefinition = {
    root: 'root',
    bones: [{ id: 'root' }, ...Array.from({ length: 3 }, (_, index) => ({ id: `b${index}`, parent: 'root' }))],
    slots: Array.from({ length: slots }, (_, index) => ({ id: `s${index}`, bone: 'root' })),
  };
  const base = createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 10, height: 10 }, rig);
  const vertices = Array.from({ length: (grid + 1) ** 2 }, (_, index) => ({
    id: `v${index}`,
    x: index % (grid + 1),
    y: Math.floor(index / (grid + 1)),
    u: (index % (grid + 1)) / grid,
    v: Math.floor(index / (grid + 1)) / grid,
    ...(influences
      ? { influences: rig.bones.slice(0, influences).map((bone) => ({ boneId: bone.id, weight: 1 / influences })) }
      : {}),
  }));
  const triangles: number[] = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = y * (grid + 1) + x;
      triangles.push(a, a + 1, a + grid + 2, a, a + grid + 2, a + grid + 1);
    }
  }
  const attachments: MeshAttachmentDefinition[] = Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `mesh-${index}`,
    vertices,
    triangles,
  }));
  return workloadCharacter({
    ...rig,
    attachments,
    skins: [
      { version: 1, name: 'alternative', slots: Object.fromEntries(rig.slots!.map((slot) => [slot.id, 'mesh-0'])) },
    ],
  });
}

test.each([
  ['mesh vertex', 64, 0, 1],
  ['mesh triangle', 8, 0, 4],
  ['mesh influence', 32, 4, 1],
] as const)(
  'bounds %s work across shared instances and initially hidden skin alternatives',
  async (label, count, weights, grid) => {
    const allowed = meshCharacter(count, weights, 1, grid);
    const oversized = meshCharacter(count + 1, weights, 1, grid);
    assert.doesNotThrow(() => assertSceneInstanceBudget(scene(), new Map([['character.json', allowed]])));
    // Every package is valid individually; only the instance-weighted scene is too expensive.
    assert.doesNotThrow(() => assertSceneInstanceBudget(scene(1), new Map([['character.json', oversized]])));
    const loadImage = vi.fn();
    await expect(
      resolveSceneDefinition(scene(), {
        baseUrl: 'https://example.test/scene.json',
        loadCharacter: async () => oversized,
        loadImage,
      }),
    ).rejects.toThrow(new RegExp(`${label} instance limit`));
    assert.equal(loadImage.mock.calls.length, 0);
  },
);

test('charges one mesh mounted in several slots, including legacy rigid influences', () => {
  assert.doesNotThrow(() => assertSceneInstanceBudget(scene(), new Map([['character.json', meshCharacter(1, 0, 64)]])));
  assert.throws(
    () => assertSceneInstanceBudget(scene(), new Map([['character.json', meshCharacter(1, 0, 65)]])),
    /mesh vertex instance limit/,
  );
});

function ikCharacter(bones: number, constraints: number) {
  return workloadCharacter({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'middle', parent: 'root', x: 1 },
      { id: 'end', parent: 'middle', x: 1 },
      ...Array.from({ length: bones - 3 }, (_, index) => ({ id: `b${index}`, parent: 'root' })),
    ],
    ik: Array.from({ length: constraints }, (_, index) => ({
      name: `ik${index}`,
      rootBone: 'root',
      middleBone: 'middle',
      endBone: 'end',
    })),
  });
}

test.each([
  ['IK constraint', limits.maxActors, 3, limits.maxTotalIKConstraints / limits.maxActors],
  ['IK bone operation', 32, 1024, 32],
] as const)('bounds %s work independently of the bone and slot limits', (label, actors, bones, constraints) => {
  const source = scene(actors);
  assert.doesNotThrow(() =>
    assertSceneInstanceBudget(source, new Map([['character.json', ikCharacter(bones, constraints)]])),
  );
  assert.throws(
    () => assertSceneInstanceBudget(source, new Map([['character.json', ikCharacter(bones, constraints + 1)]])),
    new RegExp(`${label} instance limit`),
  );
});

function distinctScene(count: number) {
  const source = scene(count);
  source.actors.forEach((actor, index) => {
    actor.character.manifest = `character-${index}.json`;
  });
  return source;
}

test.each(['keyframe', 'event'] as const)(
  'cached packages share cumulative %s budgets, while repeated instances share metadata',
  async (kind) => {
    const count = (kind === 'keyframe' ? limits.maxTotalKeyframes : limits.maxTotalEvents) / 5;
    const clip = {
      version: 1,
      name: 'idle',
      duration: count,
      loop: false,
      tracks: kind === 'keyframe' ? { root: Array.from({ length: count }, (_, time) => ({ time, x: time })) } : {},
      ...(kind === 'event' ? { events: Array.from({ length: count }, (_, time) => ({ time, name: 'tick' })) } : {}),
    };
    const definition = workloadCharacter({ root: 'root', bones: [{ id: 'root' }] }, { 'idle.json': clip });
    const source = distinctScene(7);
    assert.doesNotThrow(() => assertSceneInstanceBudget(scene(), new Map([['character.json', definition]])));
    assert.doesNotThrow(() =>
      assertSceneInstanceBudget(
        distinctScene(5),
        new Map(source.actors.map((actor) => [actor.character.manifest, definition])),
      ),
    );
    const loadCharacter = vi.fn(async () => definition);
    await expect(
      resolveSceneDefinition(source, { baseUrl: 'https://example.test/scene.json', loadCharacter }),
    ).rejects.toThrow(new RegExp(`${kind}.*limit`));
    assert.equal(loadCharacter.mock.calls.length, 6);
  },
);

test('cached character JSON is bounded across packages without allocating serialized copies', async () => {
  const definition = workloadCharacter({ root: 'root', name: 'é'.repeat(1024 * 1024), bones: [{ id: 'root' }] });
  const bytes = [definition.manifest, definition.rigFile, ...definition.standaloneSkins].reduce(
    (sum, doc) => sum + countJsonBytes(doc, limits.maxTotalJsonBytes),
    0,
  );
  const allowed = Math.floor(limits.maxTotalJsonBytes / bytes);
  assert.doesNotThrow(() => assertSceneInstanceBudget(scene(), new Map([['character.json', definition]])));
  const loadCharacter = vi.fn(async () => definition);
  assert.equal(
    (
      await resolveSceneDefinition(distinctScene(allowed), {
        baseUrl: 'https://example.test/scene.json',
        loadCharacter,
      })
    ).characters.size,
    allowed,
  );
  loadCharacter.mockClear();
  await expect(
    resolveSceneDefinition(distinctScene(allowed + 2), { baseUrl: 'https://example.test/scene.json', loadCharacter }),
  ).rejects.toThrow(/character JSON.*total limit/);
  assert.equal(loadCharacter.mock.calls.length, allowed + 1);
});

test('raw animation budgets include bone, IK, deformation and root-motion rows before inspecting entries', () => {
  const budget = new SceneMetadataBudget();
  const rows = Array(limits.maxTotalKeyframes / 4).fill(null);
  Object.defineProperty(rows, '0', { get: () => assert.fail('Do not inspect raw rows') });
  budget.checkAnimation({
    tracks: { root: rows },
    ikTracks: { arm: rows },
    deformationTracks: { mesh: rows },
    rootMotion: { translationKeys: rows },
  });
  assert.throws(() => budget.checkAnimation({ tracks: { root: [null] } }), /keyframe.*limit/);
});

test.each([undefined, '1'])(
  'shared JSON bytes cancel streamed overflow before parsing (content-length %s)',
  async (length) => {
    const budget = new SceneMetadataBudget();
    budget.countBytes(limits.maxTotalJsonBytes - 1);
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('not JSON'));
            },
            cancel,
          }),
          { headers: length ? { 'content-length': length } : {} },
        ),
    );
    await expect(
      CharacterLoader.load('https://example.test/character.json', fetcher, { metadataBudget: budget }),
    ).rejects.toThrow(/Scene character JSON.*total limit/);
    assert.equal(cancel.mock.calls.length, 1);
    assert.equal(fetcher.mock.calls.length, 1);
  },
);

test.each(['default', 'custom', 'archive'] as const)(
  'scene resolution forwards the streaming budget through the %s loader',
  async (mode) => {
    const assets = assetFixture();
    const check = vi.spyOn(SceneMetadataBudget.prototype, 'checkAnimation');
    try {
      if (mode === 'archive') {
        const encoder = new TextEncoder();
        const files = new Map(
          Object.entries(assets.documents).map(([path, value]) => [
            `characters/hero/${path}`,
            encoder.encode(JSON.stringify(value)),
          ]),
        );
        files.set('scene.json', encoder.encode(JSON.stringify(sceneFixture())));
        await validateScenePackage(files);
      } else {
        await resolveSceneDefinition(sceneFixture(), {
          ...assets,
          ...(mode === 'custom'
            ? {
                loadCharacter: (url: string, _reference: string, options: CharacterLoadOptions) =>
                  CharacterLoader.load(url, assets.fetcher, options),
              }
            : {}),
        });
      }
      assert.equal(check.mock.calls.length, 1);
    } finally {
      check.mockRestore();
    }
  },
);

test.each(['keyframe', 'event'] as const)(
  'streamed packages reject cumulative %s overflow before character assembly',
  async (kind) => {
    const fixture = assetFixture();
    const count = (kind === 'keyframe' ? limits.maxTotalKeyframes : limits.maxTotalEvents) / 5;
    fixture.documents['animations/wave.json'] = {
      version: 1,
      name: 'wave',
      duration: count,
      loop: false,
      tracks: kind === 'keyframe' ? { root: Array.from({ length: count }, (_, time) => ({ time, x: time })) } : {},
      ...(kind === 'event' ? { events: Array.from({ length: count }, (_, time) => ({ time, name: 'tick' })) } : {}),
    };
    const bodies = new Map(Object.entries(fixture.documents).map(([path, value]) => [path, JSON.stringify(value)]));
    const source = distinctScene(7);
    source.actors.forEach((actor, index) => {
      actor.character.manifest = `characters/character-${index}/character.json`;
    });
    let manifests = 0;
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(requestUrl(input)).pathname.replace(/^\/characters\/character-\d+\//, '');
      if (path === 'character.json') manifests++;
      return new Response(bodies.get(path) ?? null);
    };
    const assemble = vi.spyOn(CharacterDefinition, 'fromData');
    try {
      await expect(
        resolveSceneDefinition(source, { baseUrl: 'https://example.test/scene.json', fetcher }),
      ).rejects.toThrow(new RegExp(`${kind}.*limit`));
      assert.equal(manifests, 6);
      assert.equal(assemble.mock.calls.length, 5);
    } finally {
      assemble.mockRestore();
    }
  },
);

test('cached metadata reserves bytes and animation work before later streamed resources arrive', () => {
  const definition = workloadCharacter(
    { root: 'root', bones: [{ id: 'root' }] },
    {
      'idle.json': { version: 1, name: 'idle', duration: 1, loop: false, tracks: { root: [{ time: 0, x: 0 }] } },
    },
  );
  const budget = new SceneMetadataBudget();
  budget.completeCharacter(definition);
  assert.throws(() => budget.countBytes(limits.maxTotalJsonBytes), /character JSON.*total limit/);
  const animations = new SceneMetadataBudget();
  animations.completeCharacter(definition);
  animations.checkAnimation({ tracks: { root: Array(limits.maxTotalKeyframes - 1).fill(null) } });
  assert.throws(() => animations.checkAnimation({ tracks: { root: [null] } }), /keyframe.*limit/);
});
