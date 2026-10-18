import { assert, test } from 'vitest';
import { createEmptyScene, parseSceneDefinition, validateSceneDefinition } from '../src/engine/core.js';
import type { SceneDefinition } from '../src/engine/data.js';
import { UnsupportedFormatVersionError } from '../src/engine/externalData.js';
import { generateJsonSchemas } from '../src/engine/jsonSchemas.js';
import { parseSceneJson, SceneValidationError, serializeSceneDefinition } from '../src/engine/serialization.js';

function fixture(): SceneDefinition {
  return {
    ...createEmptyScene({ id: 'opening', name: 'Opening', duration: 2000 }),
    actors: [
      {
        id: 'hero',
        character: { manifest: '../characters/hero/character.json' },
        position: { x: -10, y: 40 },
        facing: 'right',
        animation: 'idle',
        skin: 'default',
      },
      { id: 'friend', character: { manifest: '../characters/hero/character.json' }, position: { x: 120, y: 40 } },
    ],
    actions: [
      {
        id: 'walk',
        type: 'animation',
        actorId: 'hero',
        time: 0,
        animation: 'walk',
        duration: 1000,
        loop: false,
        speed: 1,
      },
      { id: 'face', type: 'face', actorId: 'friend', time: 2000, target: { type: 'direction', facing: 'left' } },
    ],
  };
}

test('empty scenes need no character, rig, JSON or renderer and get independent arrays', () => {
  const scene = createEmptyScene({ id: 'empty' });
  assert.deepEqual(scene, {
    version: 2,
    id: 'empty',
    name: 'Untitled Scene',
    duration: 10000,
    actors: [],
    actions: [],
  });
  assert.deepEqual(validateSceneDefinition(scene), []);
  const other = createEmptyScene({ id: 'other' });
  assert.notStrictEqual(scene.actors, other.actors);
  assert.notStrictEqual(scene.actions, other.actions);
});

test('scene actor identity is scene-local, distinct from its character reference, and survives a round trip', () => {
  const scene = fixture();
  const parsed = parseSceneJson(serializeSceneDefinition(scene));
  assert.deepEqual(parsed, scene);
  assert.deepEqual(
    parsed.actors.map(({ id }) => id),
    ['hero', 'friend'],
  );
  assert.notStrictEqual(parsed.actors[0], scene.actors[0]);
  assert.deepEqual(
    validateSceneDefinition(scene, {
      characters: new Map([
        ['../characters/hero/character.json', { animations: ['idle', 'walk'], skins: ['default'] }],
      ]),
    }),
    [],
  );
});

test.each([
  { id: '' },
  { id: '  ' },
  { id: '__proto__' },
  { name: '' },
  { duration: 0 },
  { duration: -1 },
  { duration: NaN },
  { duration: Infinity },
  { actors: [{ id: 'bad', character: { manifest: 'hero.json' }, position: { x: Infinity, y: 0 } }] },
  { actors: [{ id: 'bad', character: { manifest: 'hero.json' }, position: { x: 0 } }] },
  { actors: [{ ...fixture().actors[0], facing: 'up' }] },
  { actors: [fixture().actors[0], fixture().actors[0]] },
  { actions: [{ type: 'unsupported', time: 0, actorId: 'hero' }] },
  { actions: [{ type: 'face', time: -1, actorId: 'hero', facing: 'left' }] },
  { actions: [{ type: 'face', time: Infinity, actorId: 'hero', facing: 'left' }] },
  { actions: [{ type: 'face', time: 2001, actorId: 'hero', facing: 'left' }] },
  { actions: [{ type: 'face', time: 0, actorId: 'missing', facing: 'left' }] },
  { actions: [{ type: 'animation', time: 0, actorId: 'hero', animation: '' }] },
  { selection: 'hero' },
  { zoom: 2 },
  { history: [] },
])('rejects invalid fields and editor state: %j', (patch) => {
  const input = { ...fixture(), ...patch };
  assert.isAbove(validateSceneDefinition(input).length, 0);
  assert.throws(() => parseSceneDefinition(input), SceneValidationError);
});

test.each([
  '',
  'blob:https://example.com/hero.json',
  'data:application/json,{}.json',
  'file:///hero.json',
  'javascript:hero.json',
  '//example.com/hero.json',
  'hero.json?temporary=1',
  'hero.json#fragment',
  'hero.png',
])('rejects invalid or temporary character reference %s', (manifest) => {
  const input = fixture();
  input.actors[0]!.character.manifest = manifest;
  assert.ok(validateSceneDefinition(input).some(({ path }) => path === 'actors[0].character.manifest'));
});

test('optional catalog checks character existence, starting animation/skin, and scheduled animation references', () => {
  const scene = fixture();
  const unknown = validateSceneDefinition(scene, { characters: new Map() });
  assert.equal(unknown.filter(({ path }) => path?.endsWith('.character.manifest')).length, 2);
  const issues = validateSceneDefinition(scene, {
    characters: new Map([['../characters/hero/character.json', { animations: [], skins: [] }]]),
  });
  assert.deepEqual(
    issues.map(({ path }) => path),
    ['actors[0].animation', 'actors[0].skin', 'actions[0].animation'],
  );
  scene.actors[0]!.character.manifest = 'https://assets.example.com/hero/character.json';
  assert.deepEqual(validateSceneDefinition(scene), []);
});

test('version errors use the existing version contract, while JSON parsing remains bounded', () => {
  assert.ok(validateSceneDefinition({ ...fixture(), version: 3 }).some(({ path }) => path === 'version'));
  assert.throws(() => parseSceneDefinition({ ...fixture(), version: 3 }), UnsupportedFormatVersionError);
  assert.throws(() => parseSceneDefinition({ ...fixture(), version: 1 }), UnsupportedFormatVersionError);
  assert.throws(() => parseSceneDefinition({ ...fixture(), version: undefined }), SceneValidationError);
  assert.throws(() => parseSceneJson('{'), SyntaxError);
  assert.throws(() => parseSceneJson(' '.repeat(10 * 1024 * 1024 + 1)), /size limit/);
});

test('rejects functions, promises, class instances, accessors and cycles before schema reads', () => {
  const getter = { ...fixture() };
  Object.defineProperty(getter, 'name', {
    enumerable: true,
    get: () => {
      throw new Error('Must not execute');
    },
  });
  const cycle: Record<string, unknown> = { ...fixture() };
  cycle.self = cycle;
  for (const input of [
    getter,
    cycle,
    { ...fixture(), runtime: () => {} },
    { ...fixture(), runtime: Promise.resolve() },
    { ...fixture(), runtime: new Date() },
  ]) {
    assert.isAbove(validateSceneDefinition(input).length, 0);
    assert.throws(() => serializeSceneDefinition(input), SceneValidationError);
  }
});

test('canonical serialization preserves array order and authored precision while ignoring object key order', () => {
  const scene = fixture();
  scene.actors[0]!.position.x = 0.123456789;
  const reordered = Object.fromEntries(Object.entries(scene).reverse());
  assert.equal(serializeSceneDefinition(scene), serializeSceneDefinition(reordered));
  assert.deepEqual(parseSceneJson(serializeSceneDefinition(scene)), scene);
  assert.ok(serializeSceneDefinition(scene).endsWith('\n'));
  assert.property(generateJsonSchemas(), 'scene.schema.json');
});
