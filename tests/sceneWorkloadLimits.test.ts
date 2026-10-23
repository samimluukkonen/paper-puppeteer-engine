import { assert, expect, test } from 'vitest';
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
