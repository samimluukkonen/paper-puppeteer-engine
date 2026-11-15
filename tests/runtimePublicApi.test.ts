import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import * as core from '../src/engine/core.js';
import * as legacy from '../src/engine/index.js';
import * as runtime from '../src/engine/runtime.js';
import * as serialization from '../src/engine/serialization.js';
import { runRuntimeExample } from '../src/examples/runtime.js';
import { loadSceneCharacter as legacyLoadSceneCharacter } from '../src/shared/loadSceneCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';
import { requestUrl } from './helpers/requestUrl.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Loader: {
      Events: { ADD: 'addfile', FILE_LOAD_ERROR: 'loaderror', FILE_COMPLETE: 'filecomplete', COMPLETE: 'complete' },
    },
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const files: Record<string, unknown> = {
  'character.json': {
    version: 1,
    id: 'integration',
    rig: 'rig.json',
    defaultSkin: 'default',
    skins: { default: 'skin.json', alternate: 'alternate.json' },
    animations: ['idle.json', 'walk.json'],
    textures: { art: 'art.png' },
  },
  'rig.json': {
    version: 1,
    root: 'root',
    bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 10 }, { id: 'end', parent: 'middle', y: 10 }],
    slots: [{ id: 'body', bone: 'root' }],
    attachments: [
      { id: 'normal', texture: 'art' },
      { id: 'alternate', texture: 'art', x: 5 },
    ],
    ik: [{ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
  },
  'skin.json': { version: 1, name: 'default', slots: { body: 'normal' } },
  'alternate.json': { version: 1, name: 'alternate', slots: { body: 'alternate' } },
  'idle.json': {
    version: 1,
    name: 'idle',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 1000, x: 10 },
      ],
    },
    events: [{ time: 250, name: 'marker', data: { value: 1 } }],
  },
  'walk.json': { version: 1, name: 'walk', duration: 1000, loop: false, tracks: { root: [{ time: 0, x: 20 }] } },
};

function fixture() {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const data = files[new URL(requestUrl(input)).pathname.split('/').at(-1)!];
    return data ? Response.json(data) : new Response(null, { status: 404 });
  });
  const scene = puppetScene();
  // Use Phaser's real context-aware emitter without importing its browser renderer.
  const SceneEvents = createRequire(import.meta.url)(
    '../node_modules/phaser/src/events/EventEmitter.js',
  ) as typeof Phaser.Events.EventEmitter;
  const events = new SceneEvents();
  const load = Object.assign(new EventEmitter(), { image: vi.fn(), start: vi.fn() });
  scene.events = events;
  scene.load = load as unknown as Phaser.Loader.LoaderPlugin;
  scene.sys = { isActive: () => true } as Phaser.Scenes.Systems;
  return { scene, events, load, fetcher };
}

test('root, runtime, core, serialization and previous scene-loader imports retain export identity', () => {
  assert.deepEqual(Object.keys(runtime).sort(), Object.keys(legacy).sort());
  for (const name of [
    'Actor',
    'Choreography',
    'ChoreographySequence',
    'ChoreographyConflictError',
    'Puppet',
    'Bone',
    'AnimationPlayer',
    'AnimationStateController',
    'TwoBoneIKConstraint',
    'loadSceneCharacter',
    'queueCharacterTextures',
  ] as const)
    assert.isFunction(Reflect.get(runtime, name));
  for (const [name, value] of Object.entries(core)) assert.strictEqual(Reflect.get(runtime, name), value);
  for (const [name, value] of Object.entries(serialization)) assert.strictEqual(Reflect.get(core, name), value);
  assert.equal(typeof runtime.CharacterLoader.load, 'function');
  assert.strictEqual(runtime.loadSceneCharacter, legacyLoadSceneCharacter);
  assert.strictEqual(runtime.Puppet, legacy.Puppet);
  assert.strictEqual(runtime.Actor, legacy.Actor);
  // PuppetRenderer is editor-facing and therefore public via the core barrel since the
  // barrel enforcement; genuinely internal modules stay unexposed.
  assert.isUndefined(Reflect.get(runtime, 'AnimationLayerEvaluator'));
  assert.isUndefined(Reflect.get(runtime, 'AnimationEditorState'));
});

test.each(['destroy', 'shutdown'] as const)(
  'public loading, playback, transitions, skins, events and %s cleanup',
  async (cleanup) => {
    const { scene, events, load, fetcher } = fixture();
    const definition = await runtime.CharacterLoader.load('https://example.test/character.json', fetcher);
    assert.equal(fetcher.mock.calls.length, 6);
    scene.textures.exists = () => false;
    const releaseReservation = runtime.queueCharacterTextures(scene, definition);
    assert.deepEqual(load.image.mock.calls[0]?.slice(0, 2), ['art', 'https://example.test/art.png']);
    scene.textures.exists = () => true;
    load.emit('complete');
    releaseReservation();
    assert.equal(load.listenerCount('complete'), 0);
    const puppet = new runtime.Puppet(scene, { definition });
    const player = puppet.posePipeline.player;
    const constraint = puppet.getIK('chain');
    const provider = vi.fn(() => undefined);
    constraint.setTargetProvider(provider);
    const delivered: runtime.FiredAnimationEvent[] = [];
    const unsubscribe = puppet.onAnimationEvent((event) => delivered.push(event));
    const completion = vi.fn();
    const stopCompletions = puppet.onAnimationComplete(completion);
    puppet.play('idle');
    events.emit('update', 0, 250);
    assert.equal(puppet.getBone('root').pose.x, 2.5);
    assert.equal(delivered[0]?.name, 'marker');
    assert.equal(player.elapsedTime, 250);
    puppet.play('idle', { restart: false });
    assert.equal(player.elapsedTime, 250);
    puppet.play('walk', { fadeDuration: 100 });
    assert.deepEqual(player.transition, { from: 'idle', to: 'walk', progress: 0 });
    puppet.update(50);
    assert.equal(puppet.getBone('root').pose.x, 11.5);
    puppet.setSkin('alternate').setAttachment('body', 'normal').clearAttachment('body').setSkin('default');
    assert.equal(player.elapsedTime, 50);
    puppet.update(950);
    assert.equal(completion.mock.calls.length, 1);
    assert.equal(player.transition, undefined);
    unsubscribe();
    stopCompletions();
    if (cleanup === 'shutdown') events.emit('shutdown');
    else puppet.destroy();
    puppet.destroy();
    assert.isTrue(puppet.isDestroyed);
    assert.isTrue(puppet.container.isDestroyed);
    assert.isTrue(player.isDisposed);
    assert.isTrue(constraint.isDisposed);
    assert.isUndefined(constraint.target);
    assert.equal(constraint.targetOwnership, 'animation');
    assert.equal(events.listenerCount('update'), 0);
    assert.equal(events.listenerCount('shutdown'), 0);
    const calls = provider.mock.calls.length;
    constraint.apply({ worldToParent: (_id, target) => target });
    events.emit('update', 1000, 1000);
    puppet.update(1000);
    assert.equal(provider.mock.calls.length, calls);
    assert.equal(delivered.length, 1);
    assert.throws(() => player.play('idle'), /disposed/);
    assert.throws(() => constraint.setTargetProvider(provider), /disposed/);
    assert.throws(
      () => puppet.addIK({ name: 'new', rootBone: 'root', middleBone: 'middle', endBone: 'end' }),
      /destroyed/,
    );
    assert.isTrue(scene.textures.exists('art'), 'Textures remain owned by the host texture manager.');
  },
);

test('the minimal example runs through the public scene loader and releases its puppet', async () => {
  const { scene, events, fetcher } = fixture();
  vi.stubGlobal('fetch', fetcher);
  const destroy = vi.spyOn(runtime.Puppet.prototype, 'destroy');
  await runRuntimeExample(scene, 'https://example.test/character.json');
  assert.equal(fetcher.mock.calls.length, 6);
  assert.equal(destroy.mock.calls.length, 1);
  assert.equal(events.listenerCount('update'), 0);
  assert.equal(events.listenerCount('shutdown'), 0);
});

test('rig exports are detached and transition/playback queries cannot change player state', async () => {
  const { scene, fetcher } = fixture();
  const definition = await runtime.CharacterLoader.load('https://example.test/character.json', fetcher);
  const puppet = new runtime.Puppet(scene, { definition, autoUpdate: false });
  const rig = puppet.exportRig();
  rig.bones[0]!.x = 99;
  assert.equal(puppet.rig.getBone('root').x, undefined);
  puppet.play('idle').play('walk', { fadeDuration: 100 });
  puppet.posePipeline.player.transition!.progress = 1;
  puppet.posePipeline.player.playbackMode.mode = 'stepped';
  assert.equal(puppet.posePipeline.player.transition?.progress, 0);
  assert.deepEqual(puppet.posePipeline.player.playbackMode, { mode: 'smooth' });
  puppet.destroy();
});

test('standalone IK owns immutable resolved targets and disposal prevents callback revival', () => {
  const rig = new core.Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 10 }, { id: 'end', parent: 'middle', y: 10 }],
  });
  const joints = new Map(rig.bones.map((bone) => [bone.id, new core.Joint(bone.id, bone)]));
  const constraint = new core.TwoBoneIKConstraint(
    { name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' },
    rig,
    joints,
  );
  const target = { x: 10, y: 10 };
  const provider = vi.fn(() => target);
  constraint.setTargetProvider(provider);
  const context: core.IKTransformContext = { worldToParent: (_id, point) => point };
  constraint.apply(context);
  const snapshot = constraint.resolvedTarget;
  assert.ok(snapshot);
  assert.notStrictEqual(snapshot, target);
  assert.isTrue(Object.isFrozen(snapshot));
  assert.isFalse(Reflect.set(snapshot, 'x', 100));
  target.x = 5;
  constraint.apply(context);
  assert.equal(snapshot.x, 10);
  assert.equal(constraint.resolvedTarget?.x, 5);
  constraint.dispose();
  constraint.dispose();
  constraint.enabled = true; // The existing mutable flag cannot reactivate a disposed solver.
  constraint.apply(context);
  assert.equal(provider.mock.calls.length, 2);
  assert.isTrue(constraint.isDisposed);
  assert.isUndefined(constraint.resolvedTarget);
  assert.equal(constraint.status, 'inactive');
  assert.throws(() => constraint.setTargetProvider(provider), /disposed/);
  assert.throws(() => constraint.setTarget(target), /disposed/);
  assert.throws(() => constraint.setEndOffset(target), /disposed/);
  assert.throws(() => {
    constraint.mix = 0.5;
  }, /disposed/);
  assert.throws(() => {
    constraint.priority = 1;
  }, /disposed/);
  assert.throws(() => {
    constraint.bendDirection = -1;
  }, /disposed/);
});
