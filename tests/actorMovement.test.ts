import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { afterEach, assert, expect, test, vi } from 'vitest';
import { Actor, type ActorOptions } from '../src/engine/Actor.js';
import { Puppet } from '../src/engine/Puppet.js';
import type { ActorMoveOptions } from '../src/engine/runtime.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const fixtures: { actor: Actor; puppet: Puppet }[] = [];
afterEach(() => {
  for (const { actor, puppet } of fixtures.splice(0)) {
    actor.dispose();
    puppet.destroy();
  }
  vi.restoreAllMocks();
});

const locomotion = { walk: 'stride', idle: 'rest', fadeDuration: 40 };
function fixture(options: Partial<Omit<ActorOptions, 'puppet'>> = {}, autoUpdate = false) {
  const scene = puppetScene();
  const SceneEvents = createRequire(import.meta.url)(
    '../node_modules/phaser/src/events/EventEmitter.js',
  ) as typeof Phaser.Events.EventEmitter;
  const events = new SceneEvents();
  scene.events = events;
  const puppet = new Puppet(scene, {
    autoUpdate,
    rig: {
      root: 'root',
      bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 10 }, { id: 'end', parent: 'middle', y: 10 }],
    },
    animations: ['stride', 'rest', 'gesture'].map((name) => ({
      version: 1,
      name,
      duration: 1000,
      loop: name !== 'gesture',
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 10 },
        ],
      },
    })),
  });
  const actor = new Actor({ id: 'moving', puppet, ...options });
  fixtures.push({ actor, puppet });
  return { actor, puppet, scene, events };
}

test('straight-line movement uses the default speed and reaches the exact destination once', async () => {
  const { actor, puppet } = fixture();
  const onUpdate = vi.spyOn(puppet, 'onUpdate');
  const settle = vi.fn();
  const pending = actor.moveTo(240, 0).then((result) => {
    settle(result);
    return result;
  });
  puppet.update(500);
  assert.deepEqual(actor.position, { x: 60, y: 0 });
  puppet.update(1500);
  const result = await pending;
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.movement, {
    start: { x: 0, y: 0 },
    destination: { x: 240, y: 0 },
    position: { x: 240, y: 0 },
    speed: 120,
  });
  assert.isTrue(Object.isFrozen(result.movement));
  puppet.update(1000);
  actor.cancelMovement();
  actor.dispose();
  assert.equal(settle.mock.calls.length, 1);
  assert.equal(onUpdate.mock.calls.length, 1);
});

test('diagonal movement normalizes direction and travels at constant world speed', async () => {
  const { actor, puppet } = fixture();
  const pending = actor.moveTo(300, 400, { speed: 100 });
  for (let index = 1; index <= 4; index++) {
    puppet.update(1000);
    assert.closeTo(actor.position.x, index * 60, 1e-10);
    assert.closeTo(actor.position.y, index * 80, 1e-10);
  }
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(actor.position, { x: 300, y: 400 });
});

test('different frame partitions produce the same movement and completion', async () => {
  const a = fixture();
  const b = fixture();
  const first = a.actor.moveTo(-300, -400, { speed: 100 });
  const second = b.actor.moveTo(-300, -400, { speed: 100 });
  a.puppet.update(2500);
  for (let index = 0; index < 100; index++) b.puppet.update(25);
  assert.closeTo(a.actor.position.x, b.actor.position.x, 1e-10);
  assert.closeTo(a.actor.position.y, b.actor.position.y, 1e-10);
  a.puppet.update(3000);
  b.puppet.update(3000);
  assert.deepEqual(await first, await second);
});

test('large finite deltas clamp to destination without overshooting', async () => {
  const { actor, puppet } = fixture();
  const pending = actor.moveTo(-3, 4, { speed: Number.MAX_VALUE });
  puppet.update(Number.MAX_VALUE);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(actor.position, { x: -3, y: 4 });
});

test('zero distance completes immediately without changing playback', async () => {
  const { actor, puppet } = fixture({ locomotion });
  actor.play('gesture');
  const playback = puppet.getPlaybackStatus();
  assert.equal((await actor.walkTo(0, 0)).status, 'completed');
  assert.deepEqual(puppet.getPlaybackStatus(), playback);
  assert.equal((await actor.moveTo(0, 0)).status, 'completed');
});

test.each([0, -1, NaN, Infinity, -Infinity, null, 'fast'])(
  'invalid speed %s preserves an existing request',
  async (speed) => {
    const { actor, puppet } = fixture();
    const pending = actor.moveTo(100, 0, { speed: 100 });
    await expect(actor.moveTo(200, 0, { speed: speed as number })).rejects.toThrow(/speed/);
    puppet.update(1000);
    assert.equal((await pending).status, 'completed');
    assert.equal(actor.position.x, 100);
  },
);

test.each([NaN, Infinity, -Infinity])('invalid coordinate %s rejects atomically', async (value) => {
  const { actor } = fixture();
  await expect(actor.moveTo(value, 0)).rejects.toThrow(/finite/);
  await expect(actor.moveTo(0, value)).rejects.toThrow(/finite/);
  assert.deepEqual(actor.position, { x: 0, y: 0 });
});

test('unrepresentable travel distance rejects without moving', async () => {
  const { actor } = fixture();
  actor.setPosition(-Number.MAX_VALUE, 0);
  await expect(actor.moveTo(Number.MAX_VALUE, 0)).rejects.toThrow(/finite/);
});

test.each([-1, NaN, Infinity])('invalid update delta %s preserves movement and animation clocks', async (delta) => {
  const { actor, puppet } = fixture();
  actor.play('gesture');
  const pending = actor.moveTo(100, 0, { speed: 100 });
  assert.throws(() => puppet.update(delta), /delta/);
  assert.equal(actor.position.x, 0);
  assert.equal(puppet.animationPlayer.elapsedTime, 0);
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
});

test('replacement settles interrupted and starts at the actual current position', async () => {
  const { actor, puppet } = fixture();
  const first = actor.moveTo(100, 0, { speed: 100 });
  puppet.update(250);
  const second = actor.moveTo(25, 100, { speed: 50 });
  const interrupted = await first;
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(interrupted.movement?.position, { x: 25, y: 0 });
  puppet.update(2000);
  assert.deepEqual((await second).movement?.start, { x: 25, y: 0 });
  assert.deepEqual(actor.position, { x: 25, y: 100 });
});

test.each(['abort', 'explicit'] as const)(
  '%s cancellation stops movement and removes request subscriptions',
  async (mode) => {
    const { actor, puppet } = fixture({ locomotion });
    const signal = new AbortController();
    const remove = vi.spyOn(signal.signal, 'removeEventListener');
    const unsubscribe = vi.fn();
    const subscribe = puppet.onUpdate.bind(puppet);
    vi.spyOn(puppet, 'onUpdate').mockImplementation((callback) => {
      const release = subscribe(callback);
      return () => {
        unsubscribe();
        release();
      };
    });
    const pending = actor.walkTo(100, 0, { speed: 100, signal: signal.signal });
    puppet.update(250);
    if (mode === 'abort') signal.abort();
    else actor.cancelMovement();
    assert.equal((await pending).status, 'cancelled');
    assert.equal(actor.currentAnimation, 'rest');
    assert.equal(unsubscribe.mock.calls.length, 1);
    assert.equal(remove.mock.calls.length, 1);
    puppet.update(1000);
    assert.equal(actor.position.x, 25);
  },
);

test('pre-aborted requests skip validation, playback and interruption', async () => {
  const { actor, puppet } = fixture();
  const pending = actor.moveTo(100, 0, { speed: 100 });
  const abort = new AbortController();
  abort.abort();
  assert.deepEqual(await actor.walkTo(NaN, Infinity, { signal: abort.signal }), { status: 'cancelled' });
  assert.deepEqual(await actor.moveTo(NaN, Infinity, { speed: -1, signal: abort.signal }), { status: 'cancelled' });
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
});

test.each(['borrowed', 'owned', 'destroy', 'shutdown'] as const)(
  '%s disposal settles pending movement',
  async (mode) => {
    const { actor, puppet, events } = fixture(
      { locomotion, puppetOwnership: mode === 'owned' ? 'owned' : 'borrowed' },
      true,
    );
    const pending = actor.walkTo(100, 0, { speed: 100 });
    events.emit('update', 0, 250);
    if (mode === 'destroy') puppet.destroy();
    else if (mode === 'shutdown') events.emit('shutdown');
    else actor.dispose();
    actor.dispose();
    assert.equal((await pending).status, 'disposed');
    assert.isTrue(actor.isDisposed);
    if (mode === 'borrowed') {
      assert.isFalse(puppet.isDestroyed);
      assert.equal(puppet.currentAnimation, 'rest');
      puppet.update(1000);
      assert.equal(puppet.container.x, 25);
    } else assert.isTrue(puppet.isDestroyed);
    await expect(actor.moveTo(1, 2)).rejects.toThrow(/disposed/);
    await expect(actor.walkTo(1, 2)).rejects.toThrow(/disposed/);
    assert.throws(() => actor.cancelMovement(), /disposed/);
  },
);

test('walkTo uses explicit names, looping locomotion and existing crossfades', async () => {
  const { actor, puppet } = fixture({ locomotion });
  actor.play('rest');
  const pending = actor.walkTo(100, 0, { speed: 100 });
  const playbackId = puppet.getPlaybackStatus()?.playbackId;
  assert.equal(actor.currentAnimation, 'stride');
  assert.deepEqual(puppet.animationPlayer.transition, { from: 'rest', to: 'stride', progress: 0 });
  puppet.update(20);
  assert.closeTo(puppet.animationPlayer.transition?.progress ?? -1, 0.5, 1e-10);
  puppet.update(480);
  assert.equal(puppet.getPlaybackStatus()?.playbackId, playbackId, 'No per-update locomotion restart.');
  puppet.update(500);
  assert.equal((await pending).status, 'completed');
  assert.equal(actor.currentAnimation, 'rest');
  assert.deepEqual(puppet.animationPlayer.transition, { from: 'stride', to: 'rest', progress: 0 });
});

test('walkTo requires a valid mapping and allows per-request overrides', async () => {
  const { actor, puppet } = fixture();
  await expect(actor.walkTo(100, 0)).rejects.toThrow(/mapping/);
  await expect(actor.walkTo(100, 0, { locomotion: { walk: 'missing', idle: 'rest' } })).rejects.toThrow(/Unknown/);
  await expect(actor.walkTo(100, 0, { locomotion: { walk: 'stride', idle: 'missing' } })).rejects.toThrow(/Unknown/);
  await expect(actor.walkTo(100, 0, { locomotion: { ...locomotion, fadeDuration: -1 } })).rejects.toThrow(/negative/);
  const pending = actor.walkTo(120, 0, { locomotion });
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  assert.equal(actor.currentAnimation, 'rest');
});

test.each(['play', 'stop', 'state', 'action'] as const)(
  'external %s owns playback while movement continues',
  async (mode) => {
    const { actor, puppet } = fixture({
      locomotion,
      animationStates: {
        initialState: 'resting',
        states: { resting: { animation: 'rest' }, greeting: { animation: 'gesture' } },
      },
    });
    const pending = actor.walkTo(100, 0, { speed: 100 });
    puppet.update(250);
    if (mode === 'play') puppet.play('gesture');
    if (mode === 'stop') puppet.stop();
    if (mode === 'state') actor.setState('greeting');
    if (mode === 'action') actor.playAction('greeting');
    const playback = puppet.getPlaybackStatus();
    puppet.update(750);
    assert.equal((await pending).status, 'completed');
    assert.equal(puppet.getPlaybackStatus()?.playbackId, playback?.playbackId);
    assert.equal(puppet.getPlaybackStatus()?.clip, playback?.clip);
  },
);

test('a newer request for the same walk clip retains ownership on arrival', async () => {
  const { actor, puppet } = fixture({ locomotion });
  const pending = actor.walkTo(100, 0, { speed: 100 });
  puppet.play('stride', { restart: true });
  const id = puppet.getPlaybackStatus()?.playbackId;
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  assert.equal(actor.currentAnimation, 'stride');
  assert.equal(puppet.getPlaybackStatus()?.playbackId, id);
});

test('walk replacement starts once without an intermediate idle; plain movement restores idle', async () => {
  const { actor, puppet } = fixture({ locomotion });
  const started: string[] = [];
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started') started.push(event.clip);
  });
  const first = actor.walkTo(100, 0);
  const second = actor.walkTo(200, 0);
  assert.equal((await first).status, 'interrupted');
  assert.deepEqual(started, ['stride', 'stride']);
  const third = actor.moveTo(300, 0);
  assert.equal((await second).status, 'interrupted');
  assert.equal(actor.currentAnimation, 'rest');
  puppet.update(3000);
  assert.equal((await third).status, 'completed');
});

test('zero-distance replacement releases the previous walking animation', async () => {
  const { actor, puppet } = fixture({ locomotion });
  const first = actor.walkTo(100, 0, { speed: 100 });
  puppet.update(250);
  assert.equal((await actor.walkTo(25, 0)).status, 'completed');
  assert.equal((await first).status, 'interrupted');
  assert.equal(actor.currentAnimation, 'rest');
});

test('external Puppet position changes remain authoritative during movement', async () => {
  const { actor, puppet } = fixture();
  const pending = actor.moveTo(100, 0, { speed: 100 });
  puppet.update(250);
  puppet.container.setPosition(70, 40);
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 85, y: 20 });
  actor.setPosition(100, 0);
  puppet.update(0);
  assert.equal((await pending).status, 'completed');
});

test('parent transforms preserve destination convention and world speed; facing and Puppet scale do not affect it', async () => {
  const { actor, puppet, scene } = fixture();
  scene.add
    .container(200, 300)
    .setScale(2, 3)
    .setRotation(Math.PI / 2)
    .add(puppet.container);
  puppet.container.setScale(4);
  actor.setFacing('left');
  const pending = actor.moveTo(30, 40, { speed: 100 });
  const before = puppet.container.getWorldTransformMatrix();
  puppet.update(500);
  const after = puppet.container.getWorldTransformMatrix();
  assert.closeTo(Math.hypot(after.tx - before.tx, after.ty - before.ty), 50, 1e-10);
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(actor.position, { x: 30, y: 40 });
});

test('movement synchronizes world IK and bone positions without mixing bone animation into placement', async () => {
  const { actor, puppet } = fixture();
  const ik = puppet.addIK({ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' });
  puppet.setIKTarget('chain', { x: 12, y: 14 });
  ik.enabled = true;
  actor.play('gesture');
  const pending = actor.moveTo(10, 0, { speed: 20 });
  puppet.update(500);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(actor.position, { x: 10, y: 0 });
  assert.equal(puppet.animationPlayer.elapsedTime, 500);
  assert.closeTo(puppet.getBone('root').pose.x, 5, 1e-10);
  const end = puppet.getBone('end').container.getWorldTransformMatrix();
  assert.closeTo(end.tx, 12, 1e-8);
  assert.closeTo(end.ty, 14, 1e-8);
});

test('scene-driven movement needs no additional scene subscription and pauses independently of animation', async () => {
  const { actor, puppet, events } = fixture({ locomotion }, true);
  const pending = actor.walkTo(100, 0, { speed: 100 });
  assert.equal(events.listenerCount('update'), 1);
  actor.pauseAnimation();
  events.emit('update', 0, 500);
  assert.equal(actor.position.x, 50);
  assert.equal(puppet.animationPlayer.elapsedTime, 0);
  events.emit('update', 0, 500);
  assert.equal((await pending).status, 'completed');
});

test('abort during locomotion start settles once and restores idle', async () => {
  const { actor, puppet } = fixture({ locomotion });
  const abort = new AbortController();
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'stride') abort.abort();
  });
  const pending = actor.walkTo(100, 0, { signal: abort.signal });
  assert.equal((await pending).status, 'cancelled');
  assert.equal(actor.currentAnimation, 'rest');
  puppet.update(1000);
  assert.equal(actor.position.x, 0);
});

test.each(['replace', 'dispose'] as const)('locomotion start callbacks can %s movement', async (mode) => {
  const { actor, puppet } = fixture({ locomotion });
  let next: ReturnType<Actor['moveTo']> | undefined;
  puppet.onPlaybackLifecycle((event) => {
    if (event.type !== 'started' || event.clip !== 'stride') return;
    if (mode === 'replace') next = actor.moveTo(200, 0, { speed: 100 });
    else actor.dispose();
  });
  const first = await actor.walkTo(100, 0);
  assert.equal(first.status, mode === 'replace' ? 'interrupted' : 'disposed');
  assert.equal(puppet.currentAnimation, 'rest');
  puppet.update(2000);
  if (mode === 'replace') assert.equal((await next)?.status, 'completed');
  else assert.equal(puppet.container.x, 0);
});

test.each([false, true])(
  'failed walk start releases subscriptions and respects newer ownership (%s)',
  async (replace) => {
    const { actor, puppet } = fixture({ locomotion });
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const release = puppet.onPlaybackLifecycle((event) => {
      if (event.type !== 'started' || event.clip !== 'stride') return;
      if (replace) puppet.play('gesture');
      throw new Error('walk start callback');
    });
    await expect(actor.walkTo(100, 0, { signal: abort.signal })).rejects.toThrow(/walk start callback/);
    assert.equal(actor.currentAnimation, replace ? 'gesture' : 'rest');
    assert.equal(remove.mock.calls.length, 1);
    release();
    puppet.update(1000);
    assert.equal(actor.position.x, 0);
  },
);

test('collapsed parent directions reject and later collapse cancels an active request', async () => {
  const { actor, puppet, scene } = fixture();
  const parent = scene.add.container(0, 0).add(puppet.container).setScale(0);
  await expect(actor.moveTo(100, 0)).rejects.toThrow(/collapsed/);
  parent.setScale(1);
  const pending = actor.moveTo(100, 0);
  parent.setScale(0);
  assert.throws(() => puppet.update(500), /collapsed/);
  assert.equal((await pending).status, 'cancelled');
});

test('idle callbacks may start a new movement without changing the completed snapshot', async () => {
  const { actor, puppet } = fixture({ locomotion });
  let next: ReturnType<Actor['moveTo']> | undefined;
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'rest') {
      actor.setPosition(200, 0);
      next = actor.moveTo(300, 0, { speed: 100 });
    }
  });
  const first = actor.walkTo(100, 0, { speed: 100 });
  puppet.update(1000);
  assert.deepEqual((await first).movement?.position, { x: 100, y: 0 });
  assert.equal(actor.position.x, 200);
  puppet.update(1000);
  assert.equal((await next)?.status, 'completed');
});

test('an idle listener failure still settles the movement and releases subscriptions', async () => {
  const { actor, puppet } = fixture({ locomotion });
  const failure = new Error('idle listener');
  const release = puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'rest') throw failure;
  });
  const pending = actor.walkTo(100, 0, { speed: 100 });
  assert.throws(() => puppet.update(1000), /idle listener/);
  assert.equal((await pending).status, 'completed');
  release();
  puppet.update(1000);
  assert.equal(actor.position.x, 100);
});

test('public movement options remain structurally usable', async () => {
  const { actor, puppet } = fixture();
  const options: ActorMoveOptions = { speed: 50 };
  const pending = actor.moveTo(50, 0, options);
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
});

test.each([undefined, false, true])(
  'walk auto-facing is opt-in (%s) and does not restart facing each frame',
  async (faceMovement) => {
    const { actor, puppet } = fixture({ locomotion });
    const facing = vi.spyOn(puppet, 'setFacing');
    const pending = actor.walkTo(-100, 0, { speed: 100, ...(faceMovement === undefined ? {} : { faceMovement }) });
    assert.equal(actor.facingDirection, faceMovement ? 'left' : 'right');
    puppet.update(250);
    puppet.update(250);
    puppet.update(500);
    assert.equal((await pending).status, 'completed');
    assert.equal(actor.facingDirection, faceMovement ? 'left' : 'right');
    assert.equal(facing.mock.calls.length, faceMovement ? 1 : 0);
  },
);

test('vertical, zero-distance and negligible horizontal walking preserve facing', async () => {
  const { actor, puppet } = fixture({ locomotion });
  actor.faceLeft();
  const facing = vi.spyOn(puppet, 'setFacing');
  assert.equal((await actor.walkTo(0, 0, { faceMovement: true })).status, 'completed');
  const vertical = actor.walkTo(0, 100, { speed: 100, faceMovement: true });
  puppet.update(1000);
  assert.equal((await vertical).status, 'completed');
  const nearVertical = actor.walkTo(1e-10, 200, { speed: 100, faceMovement: true });
  puppet.update(1000);
  assert.equal((await nearVertical).status, 'completed');
  assert.equal(actor.facingDirection, 'left');
  assert.equal(facing.mock.calls.length, 0);
});

test('auto-facing follows actual travel after external placement, but zero delta and pre-abort preserve facing', async () => {
  const { actor, puppet } = fixture({ locomotion });
  const pending = actor.walkTo(100, 0, { speed: 100, faceMovement: true });
  actor.setPosition(150, 0);
  puppet.update(0);
  assert.equal(actor.facingDirection, 'right');
  const abort = new AbortController();
  abort.abort();
  assert.deepEqual(await actor.walkTo(-100, 0, { faceMovement: true, signal: abort.signal }), { status: 'cancelled' });
  assert.equal(actor.facingDirection, 'right');
  puppet.update(250);
  assert.equal(actor.facingDirection, 'left');
  actor.cancelMovement();
  assert.equal((await pending).status, 'cancelled');
  puppet.update(1000);
  assert.equal(actor.facingDirection, 'left');
});

test('auto-facing uses world travel under a rotated parent and leaves movement speed unchanged', async () => {
  const { actor, puppet, scene } = fixture({ locomotion });
  scene.add
    .container(300, 200)
    .setScale(2, 3)
    .setRotation(Math.PI / 3)
    .add(puppet.container);
  // Local x is positive, but the diagonal destination is to the left in world coordinates.
  const pending = actor.walkTo(10, 40, { speed: 100, faceMovement: true });
  assert.equal(actor.facingDirection, 'left');
  const start = actor.worldPosition;
  puppet.update(500);
  const end = actor.worldPosition;
  assert.closeTo(Math.hypot(end.x - start.x, end.y - start.y), 50, 1e-8);
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(actor.position, { x: 10, y: 40 });
});

test('walk-facing synchronizes fixed world IK and is visible to locomotion start callbacks', async () => {
  const { actor, puppet } = fixture({ locomotion });
  const ik = puppet.addIK({ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' });
  puppet.setIKTarget('chain', { x: 0, y: 12 });
  ik.enabled = true;
  const observed: string[] = [];
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started') observed.push(actor.facingDirection);
  });
  const pending = actor.walkTo(-5, 0, { speed: 5, faceMovement: true });
  assert.deepEqual(observed, ['left']);
  puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  const end = puppet.getBone('end').container.getWorldTransformMatrix();
  assert.closeTo(end.tx, 0, 1e-8);
  assert.closeTo(end.ty, 12, 1e-8);
});

test.each(['cancel', 'dispose'] as const)(
  'IK callbacks can %s during initial walk-facing without starting locomotion',
  async (mode) => {
    const { actor, puppet } = fixture({ locomotion });
    const ik = puppet.addIK({ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' });
    ik.setTargetProvider(() => {
      if (mode === 'cancel') actor.cancelMovement();
      else actor.dispose();
      return { x: 0, y: 12 };
    });
    ik.enabled = true;
    const pending = actor.walkTo(-100, 0, { faceMovement: true });
    assert.equal((await pending).status, mode === 'cancel' ? 'cancelled' : 'disposed');
    assert.isUndefined(puppet.currentAnimation);
    puppet.update(1000);
    assert.deepEqual(puppet.container.x, 0);
  },
);

test('Puppet update listeners use stable snapshots, complete delivery after errors and release on destruction', () => {
  const { puppet } = fixture();
  const seen: string[] = [];
  let removeSecond = (): void => {};
  puppet.onUpdate(() => {
    seen.push('first');
    removeSecond();
    throw new Error('update callback');
  });
  removeSecond = puppet.onUpdate(() => {
    seen.push('second');
  });
  assert.throws(() => puppet.update(10), /update callback/);
  assert.deepEqual(seen, ['first', 'second']);
  assert.throws(() => puppet.update(10), /update callback/);
  assert.deepEqual(seen, ['first', 'second', 'first']);
  puppet.destroy();
  puppet.update(10);
  assert.throws(() => puppet.onUpdate(() => {}), /destroyed/);
  assert.equal(seen.length, 3);
});

test('Puppet destruction stops the current update listener snapshot', () => {
  const { puppet } = fixture();
  const later = vi.fn();
  puppet.onUpdate(() => puppet.destroy());
  puppet.onUpdate(later);
  puppet.update(10);
  assert.equal(later.mock.calls.length, 0);
});
