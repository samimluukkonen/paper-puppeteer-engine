import { EventEmitter } from 'node:events';
import { afterEach, assert, test, vi } from 'vitest';
import { DemoScene } from '../src/demo/DemoScene.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      sys = { isActive: () => true };
      add = { text: vi.fn() };
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}));
vi.mock('../src/shared/loadSceneCharacter.js', () => ({ loadSceneCharacter: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

test('shutdown releases demo references and updates wait for the replacement puppet', () => {
  vi.mocked(loadSceneCharacter).mockImplementation(() => new Promise(() => {}));
  const scene = new DemoScene(vi.fn());
  scene.create();
  const update = vi.fn(() => {
    throw new Error('Destroyed puppet was updated');
  });
  scene.puppet = { animationPlayer: { update } } as unknown as Puppet;
  Object.assign(scene, { presentation: {}, authoring: { active: true }, controls: {} });
  scene.events.emit('shutdown');
  assert.isUndefined(scene.puppet);
  for (const key of ['presentation', 'authoring', 'controls']) assert.isUndefined(Reflect.get(scene, key));
  scene.create();
  assert.doesNotThrow(() => scene.update(0, 16));
  assert.equal(update.mock.calls.length, 0);
});

test('a character load failure after shutdown does not create scene objects', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(loadSceneCharacter).mockImplementation(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  const scene = new DemoScene(vi.fn());
  const text = vi.spyOn(scene.add, 'text');
  scene.create();
  scene.events.emit('shutdown');
  vi.spyOn(scene.sys, 'isActive').mockReturnValue(false);
  reject(new Error('Late failure'));
  await Promise.resolve();
  assert.equal(text.mock.calls.length, 0);
});
