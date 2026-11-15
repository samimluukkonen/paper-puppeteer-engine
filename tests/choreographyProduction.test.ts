import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { assert, beforeAll, expect, test, vi } from 'vitest';
import { buildCharacterPackage } from '../src/devtools/shared/package/characterPackage.js';
import { loadSceneCharacter } from '../src/engine/loadSceneCharacter.js';
import {
  Actor,
  CharacterLoader,
  type CharacterDefinition,
  Choreography,
  ChoreographySequence,
  Puppet,
} from '../src/engine/runtime.js';
import { createScriptedScene } from '../src/examples/choreography.js';
import { consumerCharacter, consumerImageFetcher } from './helpers/consumerCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
// Only texture loading is replaced. Metadata, Actors, Puppet, IK and choreography are real.
vi.mock('../src/engine/loadSceneCharacter.js', () => ({
  loadSceneCharacter: vi.fn(),
}));
const SceneEvents = createRequire(import.meta.url)(
  '../node_modules/phaser/src/events/EventEmitter.js',
) as typeof Phaser.Events.EventEmitter;
let definition: CharacterDefinition;
beforeAll(async () => {
  const files = await buildCharacterPackage(consumerCharacter(), consumerImageFetcher);
  definition = await CharacterLoader.load('https://consumer.test/character/character.json', async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const bytes = files.get(url.pathname.slice('/character/'.length));
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  });
});
function fixture() {
  const scene = puppetScene();
  const events = new SceneEvents();
  scene.events = events;
  return { scene, events };
}
async function flush() {
  for (let index = 0; index < 40; index++) await Promise.resolve();
}
async function drive<T>(promise: Promise<T>, update: (delta: number) => void): Promise<T> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let index = 0; index < 100 && !settled; index++) {
    update([13, 87, 150, 250][index % 4]!);
    await flush();
  }
  assert.isTrue(settled, 'all operations must settle within the bounded update budget');
  return promise;
}
function resources(puppet: Puppet) {
  return [
    [puppet, 'updateListeners'],
    [puppet, 'destroyListeners'],
    [puppet.posePipeline.player, 'lifecycleListeners'],
    [puppet.posePipeline.player, 'pendingWaitDisposers'],
  ].map(([owner, key]) => {
    const listeners: unknown = Reflect.get(owner as object, key as string);
    assert.instanceOf(listeners, Set);
    return listeners.size;
  });
}
async function sampleScene() {
  vi.mocked(loadSceneCharacter).mockResolvedValue(definition);
  const { scene, events } = fixture();
  const sample = await createScriptedScene(scene, { urls: ['first/character.json', 'second/character.json'] });
  assert.ok(sample);
  return { sample, scene, events };
}

test('actual reusable consumer scene loads two packages, synchronizes responses, returns idle and destroys resources', async () => {
  const { sample, scene, events } = await sampleScene();
  const [a, b] = sample.actors;
  assert.deepEqual(
    sample.actors.map((actor) => actor.position),
    [
      { x: 140, y: 380 },
      { x: 620, y: 380 },
    ],
  );
  assert.deepEqual(
    sample.actors.map((actor) => actor.currentAnimation),
    ['idle', 'idle'],
  );
  const starts: string[] = [];
  const animationEvents: string[] = [];
  for (const actor of sample.actors) {
    actor.puppet.onPlaybackLifecycle((event) => {
      if (event.type === 'started') starts.push(`${actor.id}:${event.clip}`);
    });
    actor.puppet.onAnimationEvent((event) => animationEvents.push(`${actor.id}:${event.name}`));
  }
  const pending = sample.run();
  assert.strictEqual(sample.run(), pending);
  events.emit('update', 0, 1000);
  await flush();
  assert.equal(a.position.x, 300);
  assert.equal(b.position.x, 500);
  assert.notInclude(starts, 'a:attack');
  // Paused scenes emit no updates; promise continuations cannot advance position or waits.
  await flush();
  assert.equal(b.position.x, 500);
  events.emit('update', 0, 334);
  await flush();
  assert.deepEqual([a.facingDirection, b.facingDirection], ['right', 'left']);
  assert.equal(starts.at(-1), 'a:attack');
  assert.equal(
    (
      await drive(pending, (delta) => {
        events.emit('update', 0, delta);
      })
    ).status,
    'completed',
  );
  assert.isBelow(starts.indexOf('a:attack'), starts.indexOf('b:recover'));
  assert.deepEqual(starts.slice(-2).sort(), ['a:idle', 'b:idle']);
  assert.include(animationEvents, 'a:attack-hit');
  assert.include(animationEvents, 'b:recovered');
  assert.equal(animationEvents.filter((name) => name === 'a:attack-hit').length, 1);
  for (const actor of sample.actors) {
    assert.isTrue(actor.isDisposed);
    assert.isTrue(actor.puppet.isDestroyed);
    assert.deepEqual(resources(actor.puppet), [0, 0, 0, 0]);
    assert.equal(actor.puppet.container.list.length, 0);
  }
  assert.equal(events.listenerCount('update'), 0);
  assert.equal(events.listenerCount('shutdown'), 0);
  assert.throws(() => sample.choreography.getActor('a'), /Missing/);
  assert.isTrue(scene.textures.exists('paper-head'), 'shared textures remain host-owned');
  sample.dispose();
});

test.each(['cancel', 'dispose', 'shutdown'] as const)(
  'sample %s settles both active walks and cleans the registry',
  async (method) => {
    const { sample, events } = await sampleScene();
    const pending = sample.run();
    events.emit('update', 0, 100);
    if (method === 'cancel') sample.choreography.cancel();
    else if (method === 'dispose') sample.dispose();
    else events.emit('shutdown');
    assert.equal((await drive(pending, () => {})).status, method === 'cancel' ? 'cancelled' : 'disposed');
    assert.equal(events.listenerCount('update'), 0);
    assert.equal(events.listenerCount('shutdown'), 0);
    for (const actor of sample.actors) assert.deepEqual(resources(actor.puppet), [0, 0, 0, 0]);
  },
);

test('sample preflight, failed second load and shutdown while loading create no Puppet objects', async () => {
  const { scene } = fixture();
  const container = vi.spyOn(scene.add, 'container');
  vi.mocked(loadSceneCharacter).mockResolvedValueOnce(definition).mockResolvedValueOnce(undefined);
  assert.isUndefined(await createScriptedScene(scene, { urls: ['a', 'b'] }));
  vi.mocked(loadSceneCharacter).mockResolvedValue(definition);
  await expect(
    createScriptedScene(scene, {
      urls: ['a', 'b'],
      animations: {
        idle: 'idle',
        walk: 'walk',
        action: 'missing',
        response: 'recover',
      },
    }),
  ).rejects.toThrow(/missing/);
  vi.mocked(loadSceneCharacter).mockResolvedValueOnce(definition).mockRejectedValueOnce(new Error('load failed'));
  await expect(createScriptedScene(scene, { urls: ['a', 'b'] })).rejects.toThrow(/load failed/);
  assert.equal(container.mock.calls.length, 0);
  container.mockRestore();
});

test('queues, Actor state/action policy, crossfades and playAndWait share exact playback instances', async () => {
  const { scene } = fixture();
  const puppet = new Puppet(scene, { definition, autoUpdate: false });
  const actor = new Actor({
    id: 'integration',
    puppet,
    animationStates: {
      initialState: 'rest',
      defaultFadeDuration: 120,
      states: { rest: { animation: 'idle' }, motion: { animation: 'walk' }, action: { animation: 'attack' } },
    },
  });
  const baseline = resources(puppet);
  const seen: string[] = [];
  const release = puppet.onAnimationEvent((event) => seen.push(event.name));
  try {
    actor.setState('motion').playAction('action');
    puppet.update(400);
    assert.equal(actor.currentAnimation, 'walk');
    puppet.stopQueue().queue('attack').queue('recover', { fadeDuration: 120 });
    const queued = actor.waitForPlayback();
    const sequence = new ChoreographySequence(actor).playAnimation('baked', { fadeDuration: 120 });
    const interrupted = sequence.run();
    assert.equal((await queued).status, 'interrupted');
    assert.equal(puppet.getQueue().length, 0, 'imperative playback uses the existing queue replacement policy');
    puppet.queue('recover');
    sequence.cancel();
    assert.equal((await interrupted).status, 'cancelled');
    assert.equal(puppet.getQueue()[0]?.name, 'recover', 'cancellation preserves newly queued host work');
    const wait = actor.playAndWait('reach', { loop: false, fadeDuration: 120 });
    assert.equal((await drive(wait, (delta) => puppet.update(delta))).status, 'completed');
    const awaited = actor.playAndWait('attack', { loop: false, restart: true, fadeDuration: 120 });
    assert.equal((await drive(awaited, (delta) => puppet.update(delta))).status, 'completed');
    assert.equal(seen.filter((name) => name === 'attack-hit').length, 2);
    assert.deepEqual(resources(puppet), baseline);
  } finally {
    release();
    actor.dispose();
    puppet.destroy();
  }
});

test.each(['reach', 'baked'] as const)(
  'choreography preserves %s IK, skin/facing and world transforms against direct Puppet playback',
  async (clip) => {
    const { scene } = fixture();
    const parent = scene.add.container(80, -20).setScale(1.5, 0.7).setRotation(0.3);
    const puppet = new Puppet(scene, { definition, autoUpdate: false });
    const reference = new Puppet(scene, { definition, autoUpdate: false });
    parent.add(puppet.container);
    parent.add(reference.container);
    const actor = new Actor({ id: 'ik', puppet });
    try {
      actor.setPosition(10, 20).faceLeft().setSkin('alternate');
      reference.container.setPosition(10, 20);
      reference.setFacing('left').setSkin('alternate');
      const pending = new ChoreographySequence(actor).playAnimation(clip, { fadeDuration: 120 }).run();
      reference.play(clip, { loop: false, restart: true, fadeDuration: 120 });
      for (const delta of [13, 87, 150, 250, 500]) {
        puppet.update(delta);
        reference.update(delta);
        assert.equal(puppet.posePipeline.player.elapsedTime, reference.posePipeline.player.elapsedTime);
        for (const bone of definition.rig.bones) {
          assert.deepEqual(puppet.getBone(bone.id).pose, reference.getBone(bone.id).pose);
          const actual = puppet.getBone(bone.id).container.getWorldTransformMatrix();
          const expected = reference.getBone(bone.id).container.getWorldTransformMatrix();
          for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) assert.closeTo(actual[key], expected[key], 1e-8);
        }
        assert.equal(puppet.getAttachment('headVisual'), reference.getAttachment('headVisual'));
      }
      assert.equal((await pending).status, 'completed');
    } finally {
      actor.dispose();
      puppet.destroy();
      reference.destroy();
      parent.destroy();
    }
  },
);

test('twenty repeated group scenes with mixed exits release listeners, GameObjects and claims', async () => {
  const { scene, events } = fixture();
  for (let cycle = 0; cycle < 20; cycle++) {
    const actors = Array.from(
      { length: 4 },
      (_, index) =>
        new Actor({
          id: String(index),
          puppet: new Puppet(scene, { definition }),
          puppetOwnership: 'owned',
          locomotion: { walk: 'walk', idle: 'idle', fadeDuration: 120 },
        }),
    );
    const context = new Choreography(actors);
    try {
      const pending = context.run(
        context.parallel(
          actors.map((actor) =>
            context.actor(actor.id, [
              { kind: 'walk', x: 24, y: 18, options: { speed: 100 } },
              { kind: 'animation', name: 'attack', options: { fadeDuration: 120 } },
              { kind: 'wait', duration: 10 },
            ]),
          ),
        ),
      );
      events.emit('update', 0, 100);
      if (cycle % 4 === 0) context.cancel();
      else if (cycle % 4 === 1) actors[0]!.dispose();
      else if (cycle % 4 === 2) actors[0]!.play('recover'); // Walking keeps moving; host playback wins.
      const outcome = await drive(pending, (delta) => {
        events.emit('update', 0, delta);
      });
      assert.equal(outcome.status, cycle % 4 === 0 ? 'cancelled' : cycle % 4 === 1 ? 'disposed' : 'completed');
      for (const actor of actors.filter((candidate) => !candidate.isDisposed)) {
        assert.equal((await new ChoreographySequence(actor).wait(0).run()).status, 'completed');
        assert.deepEqual(resources(actor.puppet), [0, 1, 0, 0]);
      }
    } finally {
      context.dispose();
      for (const actor of actors) actor.dispose();
    }
    for (const actor of actors) {
      assert.deepEqual(resources(actor.puppet), [0, 0, 0, 0]);
      assert.equal(actor.puppet.container.list.length, 0);
    }
    assert.equal(events.listenerCount('update'), 0);
    assert.equal(events.listenerCount('shutdown'), 0);
  }
});
