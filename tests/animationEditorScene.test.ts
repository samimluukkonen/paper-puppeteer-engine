import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import type { AnimationEditorGhostLayer } from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
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
    const ghosts = Reflect.get(scene, 'ghosts') as AnimationEditorGhostLayer;
    assert.isTrue(Reflect.get(ghosts, 'enabled'));
    assert.equal((Reflect.get(ghosts, 'instances') as Map<string, unknown>).size, 1);
  });
  scene.create();
  scene.setFacing('left');
  scene.setBonesVisible(false);
  scene.setIKPreview(true);
  scene.setOnionSkinning(true);
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
  const ghosts = Reflect.get(scene, 'ghosts') as AnimationEditorGhostLayer;
  scene.setOnionSkinning(false);
  assert.isFalse(Reflect.get(ghosts, 'enabled'));
  scene.events.emit('shutdown');
  assert.isUndefined(Reflect.get(scene, 'ghosts'));
  assert.isTrue(Reflect.get(ghosts, 'disposed'));
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
  const disposeGhosts = vi.fn();
  Object.assign(scene, {
    state,
    preview: { dispose },
    puppet: { destroy },
    ghosts: { updateFrame: (update: () => void) => update(), dispose: disposeGhosts },
  });
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
  assert.equal(disposeGhosts.mock.calls.length, 1);
  assert.isUndefined(Reflect.get(scene, 'ghosts'));
  assert.equal(destroy.mock.calls.length, 1);
  scene.update(100000, 500);
  assert.equal(state.currentTime, 0.375);
  scene.create();
  scene.update(0, 500);
  assert.equal(state.currentTime, 0.375);
});

test('scene owns options before loading and retains its IK chains after caller mutations', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const ready = vi.fn();
  const error = vi.fn();
  const chains = [
    {
      name: 'arm',
      rootBone: 'rightUpperArm',
      middleBone: 'rightForearm',
      endBone: 'rightHand',
      endOffset: { x: 1, y: 2 },
    },
  ];
  const options = { characterUrl: '../original/character.json', ikChains: chains };
  const scene = new AnimationEditorScene(ready, error, options);
  options.characterUrl = '../replacement/character.json';
  chains[0]!.endOffset.x = 99;
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    assert.deepEqual(error.mock.calls, []);
    assert.equal(vi.mocked(loadSceneCharacter).mock.calls[0]![1], 'https://example.test/original/character.json');
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    assert.deepEqual(puppet.getIK('arm').endOffset, { x: 1, y: 2 });
    chains[0]!.name = 'changed-by-caller';
    chains.push({ ...chains[0]!, name: 'added-by-caller' });
    scene.setIKPreview(true);
    assert.isTrue(puppet.getIK('arm').enabled);
    scene.setIKPreview(false);
    assert.isFalse(puppet.getIK('arm').enabled);
  } finally {
    scene.events.emit('shutdown');
  }
});
