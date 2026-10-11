import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import type { AnimationEditorGhostLayer } from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { createBoneSymmetryMapping, inferBoneSymmetryPairs } from '../src/devtools/shared/boneSymmetry.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
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
