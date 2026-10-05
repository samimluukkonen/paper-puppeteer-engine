import { EventEmitter } from 'node:events';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { Rig } from '../src/engine/Rig.js';
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

test('scene converts Phaser milliseconds to seconds and shutdown pauses and releases playback', () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockImplementation(() => new Promise(() => {}));
  const scene = new AnimationEditorScene(vi.fn(), vi.fn());
  scene.update(0, 1000); // Safe while character data is still loading.
  scene.create();
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [{ name: 'move', duration: 2000, loop: false, tracks: {} }]);
  state.selectAnimation('move');
  const dispose = vi.fn();
  const destroy = vi.fn();
  Object.assign(scene, { state, preview: { dispose }, puppet: { destroy } });
  state.play();
  scene.update(12345, 250);
  assert.equal(state.currentTime, 0.25);
  scene.update(99999, 125);
  assert.equal(state.currentTime, 0.375);
  state.beginScrub();
  scene.events.emit('shutdown');
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.isScrubbing);
  state.endScrub();
  assert.isFalse(state.isPlaying);
  assert.isUndefined(Reflect.get(scene, 'state'));
  assert.equal(dispose.mock.calls.length, 1);
  assert.equal(destroy.mock.calls.length, 1);
  scene.update(100000, 500);
  assert.equal(state.currentTime, 0.375);
  scene.create();
  scene.update(0, 500);
  assert.equal(state.currentTime, 0.375);
});
