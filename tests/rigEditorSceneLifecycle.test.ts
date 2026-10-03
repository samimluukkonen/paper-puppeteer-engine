import { EventEmitter } from 'node:events';
import { afterEach, assert, test, vi } from 'vitest';
import { RigEditorScene } from '../src/devtools/rig-editor/RigEditorScene.js';
import type { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      sys = { isActive: () => true };
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}));
vi.mock('../src/shared/loadSceneCharacter.js', () => ({ loadSceneCharacter: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function fixture(characterUrl?: string) {
  vi.stubGlobal('window', { location: { href: 'https://example.test/rig-editor/' } });
  vi.mocked(loadSceneCharacter).mockImplementation(() => new Promise(() => {}));
  const error = vi.fn();
  const scene = new RigEditorScene(vi.fn(), error, characterUrl === undefined ? {} : { characterUrl });
  return { scene, error };
}

test.each([
  ['../characters/custom/character.json', 'https://example.test/characters/custom/character.json'],
  ['https://assets.example.test/hero.json', 'https://assets.example.test/hero.json'],
])('loads a configured character URL %s', (path, expected) => {
  const { scene } = fixture(path);
  scene.create();
  assert.deepEqual(vi.mocked(loadSceneCharacter).mock.calls, [[scene, expected]]);
});

test('shutdown releases editor state, filename, and character even while metadata loads', () => {
  const { scene } = fixture();
  scene.create();
  const disable = vi.fn();
  const destroy = vi.fn(() => assert.equal(disable.mock.calls.length, 1));
  Object.assign(scene, {
    editor: { disable },
    puppet: { destroy },
    loadedFilename: 'imported.json',
    definition: { id: 'old-character', rigPath: 'original.json' },
  });
  scene.events.emit('shutdown');
  assert.isUndefined(scene.editor);
  assert.isUndefined(Reflect.get(scene, 'puppet'));
  assert.isUndefined(Reflect.get(scene, 'definition'));
  assert.isUndefined(Reflect.get(scene, 'loadedFilename'));
  assert.equal(scene.rigFilename, 'rig.json');
  assert.equal(scene.characterId, 'unknown');
  assert.equal(destroy.mock.calls.length, 1);
});

test.each(['result', 'error'] as const)('a late load %s cannot affect a restarted scene', async (outcome) => {
  const { scene, error } = fixture();
  let resolve!: (definition: CharacterDefinition) => void;
  let reject!: (error: Error) => void;
  vi.mocked(loadSceneCharacter).mockImplementationOnce(
    () =>
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  scene.create();
  scene.events.emit('shutdown');
  scene.create();
  if (outcome === 'error') reject(new Error('Late failure'));
  else resolve({ id: 'old-character' } as CharacterDefinition);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(error.mock.calls.length, 0);
  assert.equal(scene.characterId, 'unknown');
  assert.isUndefined(scene.editor);
});

test('current load errors still reach the active editor panel', async () => {
  const { scene, error } = fixture();
  vi.mocked(loadSceneCharacter).mockRejectedValueOnce(new Error('Current failure'));
  scene.create();
  await Promise.resolve();
  assert.deepEqual(error.mock.calls, [['Error: Current failure']]);
});
