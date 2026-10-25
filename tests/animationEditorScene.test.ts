import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import type { AnimationEditorGhostLayer } from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { createBoneSymmetryMapping, inferBoneSymmetryPairs } from '../src/devtools/shared/boneSymmetry.js';
import { localToWorld } from '../src/engine/affineMath.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { Puppet } from '../src/engine/Puppet.js';
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

test('ground reference stays in preview world through scaling, facing, clip switches and rig rebuilds', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/animation-editor/' },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const rig = scene.rigEditor!.state;
    const authored = JSON.stringify(scene.packageSnapshot());
    const pose = puppet.getBone(puppet.rig.root).getWorldPosition();
    scene.groundGuide.update({ enabled: true, y: 500, snapEnabled: true });
    assert.equal(JSON.stringify(scene.packageSnapshot()), authored);
    assert.deepEqual(puppet.getBone(puppet.rig.root).getWorldPosition(), pose);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
    assert.isFalse(rig.dirty);
    const originalContainerX = puppet.container.x;
    const rootBefore = state.workingAnimation!;
    state.setRootPosition({ x: 80, y: -20 });
    assert.equal(puppet.container.x, originalContainerX + 80);
    assert.equal(scene.groundGuide.getSnapshot().guide.y, 500);
    assert.strictEqual(state.workingAnimation!.tracks, rootBefore.tracks);
    assert.strictEqual(state.workingAnimation!.ikTracks, rootBefore.ikTracks);
    state.undo();
    assert.equal(puppet.container.x, originalContainerX);
    puppet.container.setScale(1.7);
    scene.setFacing('left');
    const otherClip = state.animationIds.find((id) => id !== state.selectedAnimationId);
    if (otherClip) state.selectAnimation(otherClip);
    assert.equal(scene.groundGuide.getSnapshot().guide.y, 500);
    scene.reloadRig(rig.recoveryDraft);
    assert.equal(scene.groundGuide.getSnapshot().guide.y, 500);
    assert.isTrue(scene.groundGuide.getSnapshot().guide.enabled);
    scene.groundGuide.resetY();
    assert.equal(scene.groundGuide.getSnapshot().guide.y, 435);
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
  }
  assert.isNull(scene.groundGuide.getSnapshot().workspaceId);
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 2));
  assert.equal(scene.groundGuide.getSnapshot().guide.y, 435);
  assert.isTrue(scene.groundGuide.getSnapshot().guide.enabled);
  scene.events.emit('shutdown');
});

test('fixed preview uses authored endpoints with offsets while scrubbing, scaling and mirroring', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  const arm = {
    name: 'arm',
    rootBone: 'root',
    middleBone: 'lower',
    endBone: 'hand',
    endOffset: { x: 0, y: 10 },
    bendDirection: 1 as const,
    enabled: false,
  };
  const character = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'offset-test',
      rig: 'rig.json',
      textures: {},
      skins: { basic: 'skin.json' },
      defaultSkin: 'basic',
      animations: ['motion.json'],
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [
        { id: 'root', rotation: 0.3 },
        { id: 'lower', parent: 'root', y: 20, rotation: 0.4 },
        { id: 'hand', parent: 'lower', y: 20, rotation: 0.2, scaleY: 1.2 },
        { id: 'other', parent: 'lower', y: 15 },
      ],
      ik: [arm],
    },
    skins: { 'skin.json': { version: 1, name: 'basic', slots: {} } },
    animations: {
      'motion.json': {
        version: 1,
        name: 'motion',
        duration: 1000,
        loop: false,
        tracks: {
          root: [
            { time: 0, rotation: 0.3 },
            { time: 1000, rotation: 0.5 },
          ],
        },
      },
    },
  });
  vi.mocked(loadSceneCharacter).mockResolvedValue(character);
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error, {
    ikChains: [{ ...arm, endBone: 'other', endOffset: { x: 0, y: 0 } }],
  });
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    puppet.container.setScale(1.7);
    const endpoint = () => localToWorld(arm.endOffset, puppet.getBone('hand').container.getWorldTransformMatrix());
    const before = endpoint();
    const local = puppet.container.getWorldTransformMatrix().applyInverse(before.x, before.y);
    scene.setIKPreview(true);
    assert.closeTo(puppet.getBone('root').pose.rotation, 0.3, 1e-8);
    assert.closeTo(puppet.getBone('lower').pose.rotation, 0.4, 1e-8);
    for (const facing of ['right', 'left'] as const) {
      scene.setFacing(facing);
      state.setCurrentTime(1);
      const expected = puppet.container.getWorldTransformMatrix().transformPoint(local.x, local.y);
      assert.closeTo(endpoint().x, expected.x, 1e-8);
      assert.closeTo(endpoint().y, expected.y, 1e-8);
    }
    scene.setIKPreview(false);
    assert.isFalse(puppet.getIK(arm.name).enabled);
    assert.closeTo(puppet.getBone('root').pose.rotation, 0.5, 1e-8);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
    // Preview toggles and unrelated rig defaults must not take specialized ownership.
    const provider = vi.fn(() => ({ x: 390, y: 440 }));
    puppet.getIK(arm.name).enabled = true;
    puppet.getIK(arm.name).setTargetProvider(provider);
    scene.setIKPreview(true);
    scene.setIKPreview(false);
    assert.strictEqual(puppet.getIK(arm.name).targetProvider, provider);
    assert.isTrue(puppet.getIK(arm.name).enabled);
    scene.rigEditor!.updateIKConstraint(arm.name, { target: { x: 5, y: 10 } });
    const rebuilt = Reflect.get(scene, 'puppet') as Puppet;
    assert.isTrue(puppet.isDestroyed);
    assert.strictEqual(rebuilt.getIK(arm.name).targetProvider, provider);
    assert.isTrue(rebuilt.getIK(arm.name).enabled);
    scene.setIKPreview(false);
    assert.strictEqual(rebuilt.getIK(arm.name).targetProvider, provider);
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
  }
});

test('loaded authored IK reaches scrubbed targets and survives overlapping preview chains and fixed-preview toggles', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  const arm = { name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' };
  const character = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'ik-test',
      rig: 'rig.json',
      textures: {},
      skins: { basic: 'skin.json' },
      defaultSkin: 'basic',
      animations: ['reach.json'],
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [
        { id: 'root' },
        { id: 'upper', parent: 'root' },
        { id: 'lower', parent: 'upper', y: 60 },
        { id: 'hand', parent: 'lower', y: 50 },
      ],
      ik: [arm],
    },
    skins: { 'skin.json': { version: 1, name: 'basic', slots: {} } },
    animations: {
      'reach.json': {
        version: 1,
        name: 'reach',
        duration: 1000,
        loop: false,
        tracks: {},
        ikTracks: {
          arm: [
            { time: 0, x: 60, y: 60 },
            { time: 500, x: 30, y: 80 },
            { time: 1000, x: -40, y: 70 },
          ],
        },
      },
    },
  });
  vi.mocked(loadSceneCharacter).mockResolvedValue(character);
  const ready = vi.fn();
  const error = vi.fn();
  // A preview definition with the same name must not disable or replace the authored chain.
  const scene = new AnimationEditorScene(ready, error, { ikChains: [{ ...arm, mix: 0 }] });
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    const reaches = (x: number, y: number) => {
      const point = puppet.getBone('hand').getWorldPosition();
      const expected = puppet.container.getWorldTransformMatrix().transformPoint(x, y);
      assert.approximately(point.x, expected.x, 1e-8);
      assert.approximately(point.y, expected.y, 1e-8);
    };
    reaches(60, 60);
    state.setCurrentTime(0.5);
    reaches(30, 80);
    scene.setIKPreview(true);
    state.setCurrentTime(1);
    reaches(30, 80);
    scene.setIKPreview(false);
    reaches(-40, 70);
    assert.isTrue(puppet.getIK('arm').enabled);
    state.setCurrentTime(0);
    reaches(60, 60);
    scene.setFacing('left');
    reaches(60, 60);
    assert.isFalse(state.dirty);
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
  }
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
    assert.isTrue((Reflect.get(ghosts, 'settings') as { enabled: boolean }).enabled);
    assert.equal((Reflect.get(ghosts, 'instances') as Map<string, unknown>).size, 3);
    assert.equal(scene.getOnionSkinSettings().previousCount, 0);
    assert.equal(scene.getOnionSkinSettings().nextCount, 3);
  });
  scene.create();
  scene.setFacing('left');
  scene.setBonesVisible(false);
  scene.setIKPreview(true);
  scene.setOnionSkinning(true);
  scene.setOnionSkinSettings({ previousCount: 0, nextCount: 3, nextOpacity: 0.5, nextTint: 0x123456 });
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
  assert.isFalse((Reflect.get(ghosts, 'settings') as { enabled: boolean }).enabled);
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
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const destroy = vi.spyOn(puppet, 'destroy');
  const disposeGhosts = vi.fn();
  Object.assign(scene, {
    state,
    preview: { dispose },
    puppet,
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

test('late character load after shutdown cannot create ghosts or deliver a stale ready callback', async () => {
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
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  const create = vi.spyOn(fixture.add, 'container');
  try {
    Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
    scene.setOnionSkinSettings({ enabled: true, previousCount: 3, nextCount: 3 });
    scene.create();
    scene.events.emit('shutdown');
    finishLoad(demoCharacter);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(create.mock.calls.length, 0);
    assert.equal(ready.mock.calls.length, 0);
    assert.equal(error.mock.calls.length, 0);
    assert.isUndefined(Reflect.get(scene, 'ghosts'));
  } finally {
    create.mockRestore();
  }
});

test('ready failure destroys ghost artwork and subscriptions; a restarted scene gets a fresh pool', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const ready = vi.fn<() => void>(() => {
    throw new Error('ready failed');
  });
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  const input = new EventEmitter();
  const createContainer = vi.spyOn(fixture.add, 'container');
  const createImage = vi.spyOn(fixture.add, 'image');
  const characterBefore = JSON.stringify(demoCharacter);
  const rigBefore = JSON.stringify(demoCharacter.rig);
  try {
    Object.assign(scene, { add: fixture.add, textures: fixture.textures, input });
    scene.setBonesVisible(false);
    scene.setOnionSkinSettings({ enabled: true, previousCount: 3, nextCount: 3 });
    scene.create();
    await vi.waitFor(() => assert.equal(error.mock.calls.length, 1));
    assert.include(error.mock.calls[0]![0] as string, 'ready failed');
    assert.isUndefined(Reflect.get(scene, 'ghosts'));
    assert.equal(input.listenerCount('pointerdown'), 0);
    for (const result of [...createContainer.mock.results, ...createImage.mock.results])
      if (result.type === 'return') assert.isTrue(result.value.isDestroyed);
    scene.events.emit('shutdown');
    createContainer.mockClear();
    createImage.mockClear();
    ready.mockImplementation(() => {});
    scene.create();
    await vi.waitFor(() => assert.equal(ready.mock.calls.length, 2));
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    const ghosts = Reflect.get(scene, 'ghosts') as AnimationEditorGhostLayer;
    state.setCurrentTime(0.5);
    scene.events.emit('shutdown');
    assert.isTrue(Reflect.get(ghosts, 'disposed'));
    assert.equal(input.listenerCount('pointerdown'), 0);
    for (const result of [...createContainer.mock.results, ...createImage.mock.results])
      if (result.type === 'return') assert.isTrue(result.value.isDestroyed);
    createContainer.mockClear();
    state.setCurrentTime(0.2);
    scene.update(0, 16);
    assert.equal(createContainer.mock.calls.length, 0);
    assert.equal(JSON.stringify(demoCharacter), characterBefore);
    assert.equal(JSON.stringify(demoCharacter.rig), rigBefore);
  } finally {
    scene.events.emit('shutdown');
    createContainer.mockRestore();
    createImage.mockRestore();
  }
});

test('mirror overlay is lazy, independent of temporal ghosts, follows facing, and releases resources on shutdown', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const ready = vi.fn<(state: AnimationEditorState, characterId: string) => void>();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const state = ready.mock.calls[0]![0];
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const ghosts = Reflect.get(scene, 'ghosts') as AnimationEditorGhostLayer;
    assert.isUndefined(Reflect.get(scene, 'mirrorOverlay'));
    const source = state.workingAnimation;
    const pose = state.sampleGhostPose(state.currentTime)!;
    const activeRotation = puppet.getBone('leftUpperArm').pose.rotation;
    pose.get('leftUpperArm')!.rotation = activeRotation + 0.7;
    scene.setMirrorPreview(pose);
    const overlay = Reflect.get(
      scene,
      'mirrorOverlay',
    ) as import('../src/devtools/animation-editor/AnimationEditorGhostLayer.js').AnimationPoseOverlay;
    assert.isTrue(overlay.container.visible);
    assert.equal(overlay.container.depth, puppet.container.depth + 1);
    assert.closeTo(overlay.container.alpha, 0.35, 1e-9);
    assert.equal(puppet.getBone('leftUpperArm').pose.rotation, activeRotation);
    assert.strictEqual(state.workingAnimation, source);
    assert.equal(state.historyLength, 0);
    assert.isFalse(state.dirty);
    scene.setOnionSkinning(true);
    assert.isAbove((Reflect.get(ghosts, 'instances') as Map<string, unknown>).size, 0);
    scene.setFacing('left');
    assert.equal(overlay.container.scaleX, puppet.container.scaleX);
    scene.setMirrorPreview(null);
    assert.isFalse(overlay.container.visible);
    scene.setMirrorPreview(pose);
    assert.strictEqual(Reflect.get(scene, 'mirrorOverlay'), overlay);
    const destroy = vi.spyOn(overlay, 'destroy');
    scene.events.emit('shutdown');
    assert.equal(destroy.mock.calls.length, 1);
    assert.isUndefined(Reflect.get(scene, 'mirrorOverlay'));
    assert.isNull(Reflect.get(scene, 'mirrorPose'));
    assert.deepEqual(error.mock.calls, []);
  } finally {
    if (Reflect.get(scene, 'puppet')) scene.events.emit('shutdown');
  }
});

test('bake overlay follows facing and frees artwork on hide and scene shutdown without changing the puppet', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const ready = vi.fn<(state: AnimationEditorState, characterId: string) => void>();
  const scene = new AnimationEditorScene(ready, vi.fn());
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const state = ready.mock.calls[0]![0];
    const original = state.workingAnimation;
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const rotation = puppet.getBone('leftUpperArm').pose.rotation;
    const pose = state.sampleGhostPose(0)!;
    pose.get('leftUpperArm')!.rotation = rotation + 0.7;
    scene.setBakePreview(pose);
    const overlay = Reflect.get(
      scene,
      'bakeOverlay',
    ) as import('../src/devtools/animation-editor/AnimationEditorGhostLayer.js').AnimationPoseOverlay;
    assert.isTrue(overlay.container.visible);
    assert.equal(overlay.container.depth, puppet.container.depth + 1);
    assert.closeTo(overlay.container.alpha, 0.55, 1e-9);
    scene.setFacing('left');
    assert.equal(overlay.container.scaleX, puppet.container.scaleX);
    assert.equal(puppet.getBone('leftUpperArm').pose.rotation, rotation);
    assert.strictEqual(state.workingAnimation, original);
    const destroy = vi.spyOn(overlay, 'destroy');
    scene.setBakePreview(null);
    assert.equal(destroy.mock.calls.length, 1);
    assert.isUndefined(Reflect.get(scene, 'bakeOverlay'));
    assert.isNull(Reflect.get(scene, 'bakeSample'));
    scene.setBakePreview(pose);
    const next = Reflect.get(scene, 'bakeOverlay') as typeof overlay;
    assert.notStrictEqual(next, overlay);
    const nextDestroy = vi.spyOn(next, 'destroy');
    scene.events.emit('shutdown');
    assert.equal(nextDestroy.mock.calls.length, 1);
    assert.isUndefined(Reflect.get(scene, 'bakeOverlay'));
  } finally {
    if (Reflect.get(scene, 'puppet')) scene.events.emit('shutdown');
  }
});

test('mirror commits refresh active/previous/next authored poses while arm and leg IK remain procedural', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const ready = vi.fn<(state: AnimationEditorState) => void>();
  const error = vi.fn();
  const chains = [
    { name: 'arm', rootBone: 'rightUpperArm', middleBone: 'rightForearm', endBone: 'rightHand' },
    { name: 'leg', rootBone: 'rightThigh', middleBone: 'rightLowerLeg', endBone: 'rightFoot' },
  ];
  const scene = new AnimationEditorScene(ready, error, { ikChains: chains });
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.setBonesVisible(false);
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const state = ready.mock.calls[0]![0];
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const ghosts = Reflect.get(scene, 'ghosts') as AnimationEditorGhostLayer;
    const originalRig = JSON.stringify(puppet.rig);
    const bones = ['leftUpperArm', 'leftForearm', 'leftThigh', 'leftLowerLeg'];
    state.replaceWorkingAnimation({
      ...state.workingAnimation!,
      duration: 1000,
      loop: false,
      playback: { mode: 'smooth' },
      tracks: Object.fromEntries(
        bones.map((id) => [
          id,
          [
            { time: 0, rotation: 0.1 },
            { time: 1000, rotation: 0.9 },
          ],
        ]),
      ),
      events: [{ time: 500, name: 'unchanged', data: { nested: [1, 2] } }],
    });
    const mapping = createBoneSymmetryMapping(puppet.rig, {
      automaticCandidates: inferBoneSymmetryPairs(puppet.rig).pairs,
    });
    assert.isTrue(mapping.success);
    state.setSymmetryMapping(mapping.mapping);
    state.setCurrentTime(0.5);
    scene.setOnionSkinning(true);
    scene.setIKPreview(true);
    const constraints = chains.map((chain) => puppet.getIK(chain.name));
    const targets = constraints.map((constraint) => Reflect.get(constraint, 'provider') as unknown);
    const original = state.workingAnimation;
    const events = vi.fn();
    state.onAnimationEvent(events);
    const instances = Reflect.get(ghosts, 'instances') as Map<
      string,
      import('../src/devtools/animation-editor/AnimationEditorGhostLayer.js').AnimationPoseOverlay
    >;
    const before = [...instances.values()].map(
      (ghost) =>
        (Reflect.get(ghost, 'bones') as Map<string, import('../src/engine/Bone.js').Bone>).get('rightUpperArm')!.pose
          .rotation,
    );
    state.selectKeyframes(
      bones.flatMap((boneId) => [0, 1].map((time) => ({ boneId, property: 'rotation' as const, time }))),
    );
    assert.isTrue(state.mirrorSelectedKeyframes('left-to-right'));
    const committed = state.workingAnimation;
    assert.strictEqual(committed!.events, original!.events);
    const checkGhosts = () => {
      const samples = state.sampleGhostPoses();
      for (const [index, sample] of samples.entries()) {
        const ghost = instances.get(`${sample.direction}-1`)!;
        const ghostBones = Reflect.get(ghost, 'bones') as Map<string, import('../src/engine/Bone.js').Bone>;
        assert.isTrue(ghost.container.visible);
        assert.closeTo(
          ghostBones.get('rightUpperArm')!.pose.rotation,
          sample.pose.get('rightUpperArm')!.rotation!,
          1e-9,
        );
        assert.notEqual(ghostBones.get('rightUpperArm')!.pose.rotation, before[index]);
      }
    };
    checkGhosts();
    for (const chain of chains) {
      const authored = state.getEvaluatedBonePropertyValue(chain.rootBone, 'rotation')!;
      assert.notEqual(
        puppet.getBone(chain.rootBone).pose.rotation,
        authored,
        'fixed-target IK changes only the rendered pose',
      );
    }
    assert.deepEqual(
      constraints.map((constraint) => Reflect.get(constraint, 'provider') as unknown),
      targets,
    );
    assert.isTrue(constraints.every((constraint) => constraint.enabled));
    for (let index = 0; index < 4; ++index) {
      scene.setMirrorPreview(state.sampleGhostPose(0.5)!);
      scene.setFacing(index % 2 ? 'right' : 'left');
      scene.setOnionSkinning(false);
      scene.setMirrorPreview(null);
      scene.setOnionSkinning(true);
      checkGhosts();
      assert.strictEqual(state.workingAnimation, committed);
      assert.equal(events.mock.calls.length, 0);
    }
    scene.setIKPreview(false);
    for (const chain of chains)
      assert.closeTo(
        puppet.getBone(chain.rootBone).pose.rotation,
        state.getEvaluatedBonePropertyValue(chain.rootBone, 'rotation')!,
        1e-9,
      );
    state.undo();
    assert.strictEqual(state.workingAnimation, original);
    state.redo();
    assert.strictEqual(state.workingAnimation, committed);
    checkGhosts();
    assert.equal(JSON.stringify(puppet.rig), originalRig);
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
  }
});

test('shared scene rebinds newly authored IK for animation keying, safe deletion and rig undo', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  const character = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'new-ik',
      rig: 'rig.json',
      textures: {},
      skins: { basic: 'skin.json' },
      defaultSkin: 'basic',
      animations: ['motion.json'],
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 40 }, { id: 'tip', parent: 'middle', y: 30 }],
    },
    skins: { 'skin.json': { version: 1, name: 'basic', slots: {} } },
    animations: { 'motion.json': { version: 1, name: 'motion', duration: 1000, loop: false, tracks: {} } },
  });
  vi.mocked(loadSceneCharacter).mockResolvedValue(character);
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const editor = scene.rigEditor!;
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    const original = Reflect.get(scene, 'puppet') as Puppet;
    editor.createIKConstraint({ name: 'tendrilIK', rootBone: 'root', middleBone: 'middle', endBone: 'tip' });
    let current = Reflect.get(scene, 'puppet') as Puppet;
    assert.notStrictEqual(current, original);
    assert.isTrue(original.isDestroyed);
    assert.isTrue(current.getIK('tendrilIK').enabled);
    assert.equal(state.rig!.ik![0]!.name, 'tendrilIK');
    assert.isTrue(state.setIKPropertyKeyframe('tendrilIK', 'x', 20, 0));
    assert.isTrue(state.setIKPropertyKeyframe('tendrilIK', 'y', 55, 0));
    const actual = localToWorld({ x: 0, y: 0 }, current.getBone('tip').container.getWorldTransformMatrix());
    const expected = localToWorld({ x: 20, y: 55 }, current.container.getWorldTransformMatrix());
    assert.approximately(actual.x, expected.x, 1e-8);
    assert.approximately(actual.y, expected.y, 1e-8);
    assert.throws(() => editor.removeIKConstraint('tendrilIK'), /animation "motion" IK track/);
    state.removeIKPropertyKeyframe('tendrilIK', 'x', 0);
    state.removeIKPropertyKeyframe('tendrilIK', 'y', 0);
    editor.removeIKConstraint('tendrilIK');
    current = Reflect.get(scene, 'puppet') as Puppet;
    assert.throws(() => current.getIK('tendrilIK'), /Unknown IK/);
    assert.isEmpty(state.rig!.ik);
    editor.undo();
    current = Reflect.get(scene, 'puppet') as Puppet;
    assert.equal(current.getIK('tendrilIK').name, 'tendrilIK');
    assert.isEmpty(editor.actionError);
    assert.isUndefined(character.rig.ik);
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
  }
});

test('explicit guide alignment uses fresh puppet transforms, authors one XY history action and rejects unavailable owners', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  const character = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'ground-ik',
      rig: 'rig.json',
      textures: {},
      skins: { basic: 'skin.json' },
      defaultSkin: 'basic',
      animations: ['walk.json'],
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [
        { id: 'root', y: 10 },
        { id: 'upper', parent: 'root' },
        { id: 'lower', parent: 'upper', y: 50 },
        { id: 'foot', parent: 'lower', y: 50 },
      ],
      ik: [{ name: 'leg', rootBone: 'upper', middleBone: 'lower', endBone: 'foot', endOffset: { x: 0, y: 7 } }],
    },
    skins: { 'skin.json': { version: 1, name: 'basic', slots: {} } },
    animations: {
      'walk.json': {
        version: 1,
        name: 'walk',
        duration: 1000,
        loop: true,
        tracks: {
          root: [
            { time: 0, y: 10 },
            { time: 1000, y: 25 },
          ],
        },
        ikTracks: { leg: [{ time: 0, x: 30, y: 80 }] },
        events: [{ time: 500, name: 'step' }],
      },
    },
  });
  vi.mocked(loadSceneCharacter).mockResolvedValue(character);
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const original = state.workingAnimation!;
    assert.isFalse(scene.alignSelectedIKTargetToGround());
    scene.groundGuide.update({ enabled: true, y: 570 });
    assert.isFalse(scene.alignSelectedIKTargetToGround());
    state.selectIKConstraint('leg');
    state.setCurrentTime(0.5);
    for (const facing of ['left', 'right'] as const) {
      scene.setFacing(facing);
      puppet.container.setPosition(310, 420).setScale(1.5).setRotation(0.2);
      const matrix = puppet.container.getWorldTransformMatrix();
      const before = localToWorld(state.selectedIKTargetValues!, matrix);
      assert.isTrue(scene.alignSelectedIKTargetToGround());
      const after = localToWorld(state.selectedIKTargetValues!, matrix);
      assert.closeTo(after.x, before.x, 1e-8);
      assert.closeTo(after.y, 570, 1e-8);
      assert.strictEqual(state.workingAnimation!.tracks, original.tracks);
      assert.strictEqual(state.workingAnimation!.events, original.events);
      assert.equal(state.historyLength, 1);
      state.undo();
      assert.strictEqual(state.workingAnimation, original);
    }
    puppet.getIK('leg').setTarget({ x: 200, y: 500 });
    assert.isFalse(scene.alignSelectedIKTargetToGround());
    assert.strictEqual(state.workingAnimation, original);
    puppet.getIK('leg').target = undefined;
    puppet.container.setScale(0);
    assert.isFalse(scene.alignSelectedIKTargetToGround());
    scene.groundGuide.update({ enabled: false });
    assert.isFalse(scene.alignSelectedIKTargetToGround());
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
  }
});

test('ground is available before any animation exists and persists through creating and switching empty clips', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  const character = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'empty-ground',
      rig: 'rig.json',
      textures: {},
      skins: { basic: 'skin.json' },
      defaultSkin: 'basic',
      animations: [],
    },
    rig: { version: 1, root: 'root', bones: [{ id: 'root' }] },
    skins: { 'skin.json': { version: 1, name: 'basic', slots: {} } },
    animations: {},
  });
  vi.mocked(loadSceneCharacter).mockResolvedValue(character);
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error);
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    const overlay: unknown = Reflect.get(scene, 'groundOverlay');
    assert.isNull(state.workingAnimation);
    assert.isNotNull(scene.groundGuide.getSnapshot().workspaceId);
    scene.groundGuide.update({ enabled: true, y: 520 });
    assert.isTrue(state.createAnimation({ name: 'first' }));
    const first = state.workingAnimation;
    assert.isTrue(state.createAnimation({ name: 'second' }));
    state.selectAnimation('first', { keepChanges: true });
    assert.strictEqual(state.workingAnimation, first);
    assert.isEmpty(state.workingAnimation!.tracks);
    assert.equal(state.historyLength, 0);
    assert.equal(scene.groundGuide.getSnapshot().guide.y, 520);
    assert.strictEqual(Reflect.get(scene, 'groundOverlay'), overlay);
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
  }
});

test('environment preview preserves the authoritative Puppet, poses, IK, skins, facing, playback and every clip document', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const environment = new EnvironmentPreviewController();
  const ready = vi.fn();
  const error = vi.fn();
  const scene = new AnimationEditorScene(ready, error, {
    environment,
    ikChains: [{ name: 'arm', rootBone: 'rightUpperArm', middleBone: 'rightForearm', endBone: 'rightHand' }],
  });
  const fixture = puppetScene();
  Object.assign(scene, {
    add: fixture.add,
    textures: fixture.textures,
    input: new EventEmitter(),
    cameras: {
      main: {
        width: 800,
        height: 600,
        scrollX: 0,
        scrollY: 0,
        zoom: 1,
        setZoom(zoom: number) {
          this.zoom = zoom;
        },
        centerOn(x: number, y: number) {
          this.scrollX = x - this.width / 2;
          this.scrollY = y - this.height / 2;
        },
      },
    },
  });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  try {
    const puppet = Reflect.get(scene, 'puppet') as Puppet;
    const state = Reflect.get(scene, 'state') as AnimationEditorState;
    const original = JSON.stringify(scene.packageSnapshot());
    puppet.setSkin('alternate');
    scene.setFacing('left');
    scene.setIKPreview(true);
    for (const clip of state.animationIds) {
      state.selectAnimation(clip);
      state.setCurrentTime(0.3);
      state.play();
      const snapshot = () =>
        JSON.stringify(
          puppet.rig.bones.map((bone) => ({
            pose: puppet.getBone(bone.id).pose,
            world: puppet.getBone(bone.id).getWorldPosition(),
            texture: puppet.getBone(bone.id).sprite?.texture.key,
          })),
        );
      const pose = snapshot();
      const time = state.currentTime;
      for (const enabled of [true, false, true]) {
        environment.update({ enabled, x: -30, y: 500, scale: 2 });
        assert.strictEqual(Reflect.get(scene, 'puppet'), puppet);
        assert.equal(snapshot(), pose);
        assert.equal(puppet.facingDirection, 'left');
        assert.isTrue(puppet.getIK('arm').enabled);
        assert.isTrue(state.isPlaying);
        assert.equal(state.currentTime, time);
        assert.isFalse(state.dirty);
        assert.equal(state.historyLength, 0);
        assert.equal(JSON.stringify(scene.packageSnapshot()), original);
      }
      state.pause();
    }
    assert.deepEqual(error.mock.calls, []);
  } finally {
    scene.events.emit('shutdown');
    assert.isUndefined(Reflect.get(scene, 'environmentLayer'));
    assert.isUndefined(Reflect.get(scene, 'environmentCamera'));
    environment.dispose();
  }
});

test('shutdown during ready does not install an environment camera or retain preview subscriptions', async () => {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const environment = new EnvironmentPreviewController();
  const error = vi.fn();
  const ready = vi.fn(() => {
    scene.events.emit('shutdown');
  });
  const scene = new AnimationEditorScene(ready, error, { environment });
  const fixture = puppetScene();
  Object.assign(scene, { add: fixture.add, textures: fixture.textures, input: new EventEmitter() });
  scene.create();
  await vi.waitFor(() => assert.equal(ready.mock.calls.length, 1));
  assert.isUndefined(Reflect.get(scene, 'environmentCamera'));
  assert.isUndefined(Reflect.get(scene, 'puppet'));
  assert.isUndefined(Reflect.get(scene, 'state'));
  environment.update({ enabled: true });
  assert.deepEqual(error.mock.calls, []);
  environment.dispose();
});
