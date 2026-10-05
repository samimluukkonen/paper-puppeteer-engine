import { EventEmitter } from 'node:events';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';
import { demoCharacter } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      sys = { isActive: () => true };
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Math: {
      Vector2: class {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
      },
    },
  },
}));
vi.mock('../src/shared/loadSceneCharacter.js', () => ({ loadSceneCharacter: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

test('preview preferences chosen while loading apply before the ready callback', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  let finishLoad!: (definition: typeof demoCharacter) => void;
  vi.mocked(loadSceneCharacter).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishLoad = resolve;
      }),
  );
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error, {
    ikChains: [{ name: 'arm', rootBone: 'rightUpperArm', middleBone: 'rightForearm', endBone: 'rightHand' }],
  });
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  ready.mockImplementation((state: AnimationEditorState) => {
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    assert.equal(puppet.facingDirection, 'left');
    assert.isFalse(puppet.isDebug);
    assert.isTrue(puppet.getIK('arm').enabled);
    assert.equal(puppet.getIK('arm').status, 'solved');
    assert.isFalse(state.dirty);
  });
  scene.create();
  scene.setFacing('left');
  scene.setBonesVisible(false);
  scene.setIKPreview(true);
  finishLoad(demoCharacter);
  await vi.waitFor(() => {
    assert.deepEqual(error.mock.calls, []);
    assert.equal(ready.mock.calls.length, 1);
  });
  assert.equal(error.mock.calls.length, 0);
  const puppet = Reflect.get(scene, 'puppet') as Puppet;
  scene.setFacing('right');
  scene.setBonesVisible(true);
  scene.setIKPreview(false);
  assert.equal(puppet.facingDirection, 'right');
  assert.isTrue(puppet.isDebug);
  assert.isFalse(puppet.getIK('arm').enabled);
  (Reflect.get(scene, 'preview') as { dispose(): void }).dispose();
  puppet.destroy();
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
