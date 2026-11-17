import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { afterEach, assert, expect, test, vi } from 'vitest';
import { Actor, type ActorOptions } from '../src/engine/Actor.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { createOwnershipWatch } from '../src/engine/ownershipWatch.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetDebug } from '../src/engine/PuppetDebug.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

function definition() {
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'shared-character',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['idle.json', 'wave.json'],
      textures: { art: 'art.png' },
    },
    rig: {
      version: 1,
      root: 'root',
      bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 10 }, { id: 'end', parent: 'middle', y: 10 }],
      slots: [{ id: 'hand', bone: 'end' }],
      attachments: [{ id: 'prop', texture: 'art' }],
      ik: [{ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
    },
    skins: { 'skin.json': { version: 1, name: 'default', slots: { hand: 'prop' } } },
    animations: {
      'idle.json': { version: 1, name: 'idle', duration: 100, loop: true, tracks: {} },
      'wave.json': {
        version: 1,
        name: 'wave',
        duration: 100,
        loop: false,
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 100, x: 10 },
          ],
        },
      },
    },
  });
}

function fixture(options: Partial<Omit<ActorOptions, 'puppet'>> = {}) {
  const scene = puppetScene();
  const SceneEvents = createRequire(import.meta.url)(
    '../node_modules/phaser/src/events/EventEmitter.js',
  ) as typeof Phaser.Events.EventEmitter;
  const events = new SceneEvents();
  scene.events = events;
  const puppet = new Puppet(scene, { definition: definition(), x: 12, y: 34 });
  const actor = new Actor({ id: 'actor-a', puppet, ...options });
  return { actor, puppet, scene, events };
}

test('Actor construction leaves playback, scene updates and Puppet identity intact', () => {
  const { actor, puppet, events } = fixture();
  assert.equal(actor.id, 'actor-a');
  assert.strictEqual(actor.puppet, puppet);
  assert.equal(actor.puppetOwnership, 'borrowed');
  assert.isFalse(actor.isDisposed);
  assert.isUndefined(actor.currentAnimation);
  assert.equal(events.listenerCount('update'), 1);
  assert.equal(events.listenerCount('shutdown'), 1);
  actor.dispose();
  assert.isFalse(puppet.isDestroyed);
  puppet.destroy();
});

test('multiple Actors share one immutable character with independent transforms and playback identities', () => {
  const character = definition();
  const first = new Puppet(puppetScene(), { definition: character });
  const second = new Puppet(puppetScene(), { definition: character });
  const a = new Actor({ id: 'instance-a', puppet: first, puppetOwnership: 'owned' });
  const b = new Actor({ id: 'instance-b', puppet: second, puppetOwnership: 'owned' });
  assert.strictEqual(first.rig, second.rig);
  a.setPosition(5, 10).play('wave');
  b.setPosition(20, 30).play('idle');
  first.update(50);
  assert.equal(
    first.posePipeline.player.getPlaybackStatus()?.playbackId,
    second.posePipeline.player.getPlaybackStatus()?.playbackId,
  );
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, character.id);
  assert.deepEqual(a.position, { x: 5, y: 10 });
  assert.deepEqual(b.position, { x: 20, y: 30 });
  assert.equal(first.getBone('root').pose.x, 5);
  assert.equal(second.getBone('root').pose.x, 0);
  a.dispose();
  assert.isFalse(b.isDisposed);
  assert.isTrue(b.isPlaying);
  b.dispose();
});

test('position snapshots cannot mutate placement; direct Puppet changes remain authoritative', () => {
  const { actor, puppet, scene } = fixture();
  const snapshot = actor.position;
  assert.deepEqual(snapshot, { x: 12, y: 34 });
  assert.isTrue(Object.isFrozen(snapshot));
  assert.isFalse(Reflect.set(snapshot, 'x', 900));
  puppet.container.setPosition(-4, 8);
  assert.deepEqual(actor.position, { x: -4, y: 8 });
  assert.strictEqual(actor.setPosition(90, 100), actor);
  assert.equal(puppet.getBone('root').container.getWorldTransformMatrix().tx, 90);
  assert.deepEqual(snapshot, { x: 12, y: 34 });
  // Reparenting retains the same local-coordinate contract as Puppet's outer container.
  scene.add.container(200, 300).setScale(2).add(puppet.container);
  actor.setPosition(5, 10).setFacing('left');
  const matrix = puppet.container.getWorldTransformMatrix();
  assert.deepEqual(actor.position, { x: 5, y: 10 });
  assert.equal(matrix.tx, 210);
  assert.equal(matrix.ty, 320);
  puppet.destroy();
});

test('setPosition immediately synchronizes world-target IK and preserves playback clocks', () => {
  const { actor, puppet } = fixture();
  actor.play('wave');
  puppet.update(25);
  puppet.setIKTarget('chain', { x: 22, y: 44 });
  puppet.getIK('chain').enabled = true;
  const sync = vi.spyOn(puppet.posePipeline, 'syncPose');
  actor.setPosition(20, 40);
  assert.equal(sync.mock.calls.length, 1);
  assert.equal(puppet.posePipeline.player.elapsedTime, 25);
  const end = puppet.getBone('end').container.getWorldTransformMatrix();
  assert.closeTo(end.tx, 22, 1e-8);
  assert.closeTo(end.ty, 44, 1e-8);
  puppet.destroy();
});

test.each([NaN, Infinity, -Infinity])('invalid coordinates %s fail atomically', (invalid) => {
  const { actor, puppet } = fixture();
  assert.throws(() => actor.setPosition(invalid, 5), /finite/);
  assert.throws(() => actor.setPosition(5, invalid), /finite/);
  assert.deepEqual(actor.position, { x: 12, y: 34 });
  puppet.destroy();
});

test('animation delegation keeps Puppet options, events, pauses, stops and external control', async () => {
  const { actor, puppet, events } = fixture();
  const complete = vi.fn();
  puppet.onAnimationComplete(complete);
  const options = { loop: false, speed: 2, layer: 'gesture' };
  const play = vi.spyOn(puppet, 'play');
  assert.strictEqual(actor.play('wave', options), actor);
  assert.strictEqual(play.mock.calls[0]?.[1], options);
  const waiting = actor.waitForPlayback({ layer: 'gesture' });
  actor.pauseAnimation();
  events.emit('update', 0, 50);
  assert.equal(puppet.posePipeline.player.getPlaybackStatus('gesture')?.elapsedTime, 0);
  actor.resumeAnimation();
  events.emit('update', 0, 50);
  assert.equal((await waiting).status, 'completed');
  assert.equal(complete.mock.calls.length, 1);
  puppet.play('idle');
  assert.equal(actor.currentAnimation, 'idle');
  assert.isTrue(actor.isPlaying);
  actor.stop();
  assert.isFalse(actor.isPlaying);
  puppet.destroy();
});

test('Actor states reuse action returns, fades and imperative playback precedence', () => {
  const { actor, puppet } = fixture({
    animationStates: {
      initialState: 'rest',
      states: { rest: { animation: 'idle' }, greeting: { animation: 'wave' } },
      defaultFadeDuration: 20,
    },
  });
  assert.equal(actor.currentState, 'rest');
  assert.equal(actor.currentAnimation, 'idle');
  actor.playAction('greeting');
  assert.equal(puppet.posePipeline.player.transition?.to, 'wave');
  puppet.update(100);
  assert.equal(actor.currentAnimation, 'idle');
  actor.playAction('greeting');
  actor.play('wave');
  puppet.update(100);
  assert.equal(actor.currentAnimation, 'wave');
  actor.setState('rest');
  assert.equal(actor.currentAnimation, 'idle');
  actor.playAction('greeting');
  actor.dispose();
  puppet.update(100);
  assert.equal(puppet.currentAnimation, 'wave', 'Disposed Actor policy must not return to idle.');
  puppet.destroy();
});

test('appearance changes use existing skins, slot selection and facing', () => {
  const { actor, puppet } = fixture();
  actor.play('wave');
  puppet.update(25);
  actor.clearAttachment('hand');
  assert.isUndefined(puppet.getAttachment('hand'));
  actor.setAttachment('hand', 'prop').setSkin('default').applySkin('default').setFacing('left');
  assert.equal(puppet.getAttachment('hand'), 'prop');
  assert.equal(puppet.facingDirection, 'left');
  assert.equal(puppet.posePipeline.player.elapsedTime, 25);
  assert.throws(() => actor.setAttachment('hand', 'missing'), /Unknown attachment/);
  assert.throws(() => actor.setSkin('missing'), /Unknown skin/);
  puppet.destroy();
});

test.each(['completed', 'interrupted', 'stopped', 'disposed'] as const)(
  'async delegation preserves the %s outcome and playback identity',
  async (outcome) => {
    const { actor, puppet } = fixture();
    const waiting = actor.playAndWait('wave');
    const status = puppet.getPlaybackStatus();
    const alsoWaiting = puppet.waitForPlayback();
    if (outcome === 'completed') puppet.update(100);
    if (outcome === 'interrupted') actor.play('idle');
    if (outcome === 'stopped') actor.stop();
    if (outcome === 'disposed') puppet.destroy();
    const result = await waiting;
    assert.equal(result.status, outcome);
    assert.equal(result.playback?.playbackId, status?.playbackId);
    assert.deepEqual(result, await alsoWaiting);
    puppet.destroy();
  },
);

test('aborting an Actor wait leaves playback running and pre-aborted requests skip validation/start', async () => {
  const { actor, puppet } = fixture();
  const abort = new AbortController();
  const waiting = actor.playAndWait('wave', { signal: abort.signal });
  abort.abort();
  assert.equal((await waiting).status, 'cancelled');
  assert.isTrue(actor.isPlaying);
  assert.deepEqual(await actor.playAndWait('missing', { signal: abort.signal }), { status: 'cancelled' });
  assert.equal(actor.currentAnimation, 'wave');
  await expect(actor.playAndWait('idle')).rejects.toThrow(/loop/);
  await expect(actor.playAndWait('missing')).rejects.toThrow(/Unknown animation/);
  puppet.destroy();
});

test('borrowed disposal cancels only Actor waits, removes listeners and leaves other wrappers active', async () => {
  const { actor, puppet } = fixture();
  const other = new Actor({ id: 'other', puppet });
  const ownWait = actor.playAndWait('wave');
  const ownSecondWait = actor.waitForPlayback();
  const otherWait = other.waitForPlayback();
  const hostWait = puppet.waitForPlayback();
  const disposePlayer = vi.spyOn(puppet.posePipeline.player, 'dispose');
  actor.dispose();
  actor.dispose();
  assert.equal((await ownWait).status, 'cancelled');
  assert.equal((await ownSecondWait).status, 'cancelled');
  assert.equal(disposePlayer.mock.calls.length, 0);
  assert.isFalse(puppet.isDestroyed);
  puppet.update(100);
  assert.equal((await otherWait).status, 'completed');
  assert.equal((await hostWait).status, 'completed');
  puppet.destroy();
  assert.isTrue(other.isDisposed);
});

test('owned disposal destroys once and preserves disposed results for pending waits', async () => {
  const { actor, puppet, events } = fixture({ puppetOwnership: 'owned' });
  const destroy = vi.spyOn(puppet.posePipeline.player, 'dispose');
  const waiting = actor.playAndWait('wave');
  actor.dispose();
  actor.dispose();
  assert.equal((await waiting).status, 'disposed');
  assert.equal(destroy.mock.calls.length, 1);
  assert.isTrue(puppet.isDestroyed);
  assert.equal(events.listenerCount('update'), 0);
  assert.equal(events.listenerCount('shutdown'), 0);
});

test.each(['idle', 'playing', 'completed', 'stopped'] as const)(
  'scene shutdown disposes borrowed and owning Actors with %s playback',
  (state) => {
    const { actor, puppet, events } = fixture({ puppetOwnership: 'owned' });
    const borrower = new Actor({ id: 'borrower', puppet });
    if (state !== 'idle') actor.play('wave');
    if (state === 'completed') puppet.update(100);
    if (state === 'stopped') actor.stop();
    events.emit('shutdown');
    assert.isTrue(actor.isDisposed);
    assert.isTrue(borrower.isDisposed);
    actor.dispose();
    assert.equal(events.listenerCount('update'), 0);
  },
);

test('ownership rejects a second owner and failed construction releases its claim without destroying the Puppet', () => {
  const { actor, puppet } = fixture();
  assert.throws(
    () =>
      new Actor({
        id: 'invalid',
        puppet,
        puppetOwnership: 'owned',
        animationStates: { initialState: 'bad', states: {} },
      }),
    /Unknown animation state/,
  );
  assert.isFalse(puppet.isDestroyed);
  const owner = new Actor({ id: 'owner', puppet, puppetOwnership: 'owned' });
  assert.throws(() => new Actor({ id: 'other-owner', puppet, puppetOwnership: 'owned' }), /already has an owning/);
  owner.dispose();
  assert.isTrue(actor.isDisposed);
});

test('invalid IDs, ownership, missing state configuration and dead Puppets reject', () => {
  const { actor, puppet } = fixture();
  for (const id of ['', '   ', 5]) assert.throws(() => new Actor({ id, puppet } as ActorOptions), /nonempty string/);
  assert.throws(
    () => new Actor({ id: 'bad', puppet, puppetOwnership: 'other' } as unknown as ActorOptions),
    /ownership/,
  );
  assert.throws(() => actor.setState('rest'), /no animationStates/);
  assert.throws(() => actor.playAction('rest'), /no animationStates/);
  assert.throws(() => actor.play('missing'), /Unknown animation/);
  puppet.destroy();
  assert.throws(() => new Actor({ id: 'dead', puppet }), /live Puppet/);
});

test('all Actor operations reject after disposal, while identity remains readable', async () => {
  const { actor, puppet } = fixture();
  actor.dispose();
  for (const operation of [
    () => actor.position,
    () => actor.currentAnimation,
    () => actor.currentState,
    () => actor.isPlaying,
    () => actor.setPosition(1, 2),
    () => actor.play('wave'),
    () => actor.stop(),
    () => actor.pauseAnimation(),
    () => actor.resumeAnimation(),
    () => actor.setState('rest'),
    () => actor.playAction('rest'),
    () => actor.setFacing('right'),
    () => actor.setSkin('default'),
    () => actor.applySkin('default'),
    () => actor.setAttachment('hand', 'prop'),
    () => actor.clearAttachment('hand'),
  ])
    assert.throws(operation, /disposed/);
  await expect(actor.playAndWait('wave')).rejects.toThrow(/disposed/);
  await expect(actor.waitForPlayback()).rejects.toThrow(/disposed/);
  assert.equal(actor.id, 'actor-a');
  puppet.destroy();
});

test('Puppet destroy listeners finish after cleanup, unsubscribe, and survive listener failures', () => {
  const { actor, puppet } = fixture();
  const ignored = vi.fn();
  puppet.onDestroy(ignored)();
  const failure = new Error('Host destruction callback failed');
  puppet.onDestroy(() => {
    assert.isTrue(puppet.container.isDestroyed);
    throw failure;
  });
  const observer = vi.fn();
  puppet.onDestroy(observer);
  assert.throws(() => puppet.destroy(), failure.message);
  assert.isTrue(actor.isDisposed);
  assert.equal(ignored.mock.calls.length, 0);
  assert.equal(observer.mock.calls.length, 1);
  puppet.destroy();
  assert.equal(observer.mock.calls.length, 1);
  assert.throws(() => puppet.onDestroy(ignored), /destroyed/);
});

test('cleanup failures still dispose Actors, settle waits and prohibit a second destruction', async () => {
  const { actor, puppet } = fixture({ puppetOwnership: 'owned' });
  vi.spyOn(PuppetDebug.prototype, 'update').mockImplementation(() => {});
  puppet.setDebug(true);
  const failure = new Error('Overlay cleanup failed');
  vi.spyOn(PuppetDebug.prototype, 'destroy').mockImplementation(() => {
    throw failure;
  });
  const waiting = actor.playAndWait('wave');
  assert.throws(() => actor.dispose(), failure.message);
  assert.equal((await waiting).status, 'disposed');
  assert.isTrue(actor.isDisposed);
  assert.isTrue(puppet.container.isDestroyed);
  assert.doesNotThrow(() => actor.dispose());
});

test('ownership commands report only to the currently attached watch', async () => {
  const { actor } = fixture();
  const first = createOwnershipWatch();
  const second = createOwnershipWatch();
  const releaseFirst = actor.attachOwnershipWatch(first);
  actor.play('wave');
  assert.isAbove(first.revision, 0);
  const firstSeen = first.revision;

  const releaseSecond = actor.attachOwnershipWatch(second);
  actor.stop();
  void actor.moveTo(50, 0);
  assert.equal(first.revision, firstSeen);
  const secondSeen = second.revision;
  assert.isAbove(secondSeen, 0);

  // A stale release must not detach the newer owner.
  releaseFirst();
  actor.cancelMovement();
  assert.isAbove(second.revision, secondSeen);

  releaseSecond();
  const released = second.revision;
  actor.play('wave');
  actor.dispose();
  await Promise.resolve();
  assert.equal(second.revision, released);
  assert.equal(first.revision, firstSeen);
});

test('clock advances and natural completions do not invalidate ownership', () => {
  const { actor, puppet } = fixture();
  const watch = createOwnershipWatch();
  actor.play('wave');
  actor.attachOwnershipWatch(watch);
  puppet.update(50);
  puppet.update(200);
  assert.equal(puppet.getPlaybackStatus()?.status, 'completed');
  assert.equal(watch.revision, 0);
});
