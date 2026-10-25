import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { Actor } from '../src/engine/Actor.js';
import { Choreography, ChoreographySequence, type ChoreographyStep, Puppet } from '../src/engine/runtime.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const fixtures: { actor: Actor; puppet: Puppet }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const { actor, puppet } of fixtures.splice(0)) {
    actor.dispose();
    puppet.destroy();
  }
});

function fixture(autoUpdate = false) {
  const scene = puppetScene();
  const SceneEvents = createRequire(import.meta.url)(
    '../node_modules/phaser/src/events/EventEmitter.js',
  ) as typeof Phaser.Events.EventEmitter;
  const events = new SceneEvents();
  scene.events = events;
  const puppet = new Puppet(scene, {
    autoUpdate,
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animations: ['walk', 'idle', 'draw', 'attack'].map((name) => ({
      name,
      duration: 100,
      loop: name === 'walk' || name === 'idle',
      tracks: {},
    })),
  });
  const actor = new Actor({ id: 'actor', puppet, locomotion: { walk: 'walk', idle: 'idle' } });
  fixtures.push({ actor, puppet });
  return { actor, puppet, scene, events };
}

/** Drain only promise continuations; the test controls every runtime update separately. */
async function flush(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

function resources(puppet: Puppet): number[] {
  return [
    [puppet, 'updateListeners'],
    [puppet.animationPlayer, 'lifecycleListeners'],
    [puppet.animationPlayer, 'pendingWaitDisposers'],
  ].map(([owner, key]) => {
    const value: unknown = Reflect.get(owner as object, key as string);
    assert.instanceOf(value, Set);
    return value.size;
  });
}

test('ordered move, play, look, face and cue steps wait for actual completion', async () => {
  const { actor, puppet } = fixture();
  const target = fixture().actor.setPosition(-100, 0);
  const seen: string[] = [];
  const move = vi.spyOn(actor, 'moveTo');
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started') seen.push(event.clip);
  });
  const sequence = new ChoreographySequence(actor)
    .moveTo(100, 0, { speed: 100 })
    .playAnimation('draw')
    .lookAt(target)
    .cue((current) => {
      assert.strictEqual(current, actor);
      seen.push(actor.facingDirection);
    })
    .playAnimation('attack')
    .setFacing('right');
  const pending = sequence.run();
  assert.equal(move.mock.calls.length, 1);
  assert.deepEqual(seen, []);
  puppet.update(500);
  await flush();
  assert.deepEqual(seen, []);
  puppet.update(500);
  await flush();
  assert.deepEqual(seen, ['draw']);
  puppet.update(99);
  await flush();
  assert.deepEqual(seen, ['draw']);
  puppet.update(1);
  await flush();
  assert.deepEqual(seen, ['draw', 'left', 'attack']);
  puppet.update(100);
  assert.deepEqual(await pending, { status: 'completed', completedSteps: 6 });
  assert.equal(actor.facingDirection, 'right');
});

test('walking delegates locomotion and restores idle before starting the next animation', async () => {
  const { actor, puppet } = fixture();
  const walk = vi.spyOn(actor, 'walkTo');
  const started: string[] = [];
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started') started.push(event.clip);
  });
  const baseline = resources(puppet);
  const pending = new ChoreographySequence(actor)
    .walkTo(-50, 0, { speed: 100, faceMovement: true })
    .playAnimation('draw')
    .run();
  assert.equal(walk.mock.calls.length, 1);
  assert.equal(actor.facingDirection, 'left');
  puppet.update(500);
  await flush();
  assert.deepEqual(started, ['walk', 'idle', 'draw']);
  puppet.update(100);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(resources(puppet), baseline);
});

test('timed waits use only Puppet deltas, ignore animation pause/speed and release subscriptions', async () => {
  const { actor, puppet } = fixture();
  const cue = vi.fn(() => undefined);
  const baseline = resources(puppet);
  const pending = new ChoreographySequence(actor).wait(100).cue(cue).run();
  puppet.pauseAnimation().setAnimationSpeed(0);
  puppet.update(0);
  puppet.update(40);
  await flush();
  assert.equal(cue.mock.calls.length, 0);
  puppet.update(60);
  assert.equal((await pending).status, 'completed');
  assert.equal(cue.mock.calls.length, 1);
  assert.deepEqual(resources(puppet), baseline);
});

test('scene pause stops the scene update clock; resume carries no wall-clock time into waits', async () => {
  const { actor, puppet, events } = fixture(true);
  const cue = vi.fn(() => undefined);
  const pending = new ChoreographySequence(actor).wait(100).cue(cue).run();
  // Match Phaser Systems.step: paused scenes do not emit UPDATE.
  let paused = false;
  const sceneStep = (delta: number): void => {
    if (!paused) events.emit('update', 0, delta);
  };
  sceneStep(40);
  paused = true;
  sceneStep(10000);
  await flush();
  assert.equal(cue.mock.calls.length, 0);
  assert.equal(events.listenerCount('update'), 1);
  paused = false;
  sceneStep(59);
  await flush();
  assert.equal(cue.mock.calls.length, 0);
  sceneStep(1);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test('zero-duration waits, zero-distance moves, cues and an empty sequence complete without updates', async () => {
  const { actor, puppet } = fixture();
  const cue = vi.fn(() => undefined);
  assert.deepEqual(await new ChoreographySequence(actor).run(), { status: 'completed', completedSteps: 0 });
  const result = await new ChoreographySequence(actor).wait(0).moveTo(0, 0).walkTo(0, 0).cue(cue).run();
  assert.equal(result.status, 'completed');
  assert.equal(result.completedSteps, 4);
  assert.equal(cue.mock.calls.length, 1);
  assert.isUndefined(puppet.currentAnimation);
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test('animation steps play looping clips once without changing registered metadata', async () => {
  const { actor, puppet } = fixture();
  const pending = new ChoreographySequence(actor).playAnimation('walk').run();
  assert.isFalse(puppet.getPlaybackStatus()?.loop);
  puppet.update(100);
  assert.equal((await pending).status, 'completed');
  puppet.play('walk');
  assert.isTrue(puppet.getPlaybackStatus()?.loop);
});

test.each(['replace', 'stop'] as const)(
  'playback %s prevents future steps and retains the playback result',
  async (mode) => {
    const { actor, puppet } = fixture();
    const cue = vi.fn(() => undefined);
    const sequence = new ChoreographySequence(actor).playAnimation('draw').cue(cue);
    const pending = sequence.run();
    if (mode === 'replace') puppet.play('attack');
    else puppet.stop();
    const result = await pending;
    assert.equal(result.status, 'interrupted');
    assert.equal(result.stepIndex, 0);
    assert.equal(result.completedSteps, 0);
    if (result.status !== 'failed')
      assert.equal(result.stepResult?.status, mode === 'replace' ? 'interrupted' : 'stopped');
    sequence.cancel();
    assert.equal(cue.mock.calls.length, 0);
    assert.equal(puppet.currentAnimation, mode === 'replace' ? 'attack' : 'draw');
    assert.deepEqual(resources(puppet), [0, 0, 0]);
  },
);

test.each(['move', 'walk'] as const)('cancellation during %s stops only the owned request', async (kind) => {
  const { actor, puppet } = fixture();
  const cue = vi.fn(() => undefined);
  const sequence = new ChoreographySequence(actor, [{ kind, x: 100, y: 0, options: { speed: 100 } }]).cue(cue);
  const pending = sequence.run();
  puppet.update(250);
  sequence.cancel();
  sequence.cancel();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  puppet.update(1000);
  assert.equal(actor.position.x, 25);
  assert.equal(cue.mock.calls.length, 0);
  if (kind === 'walk') assert.equal(puppet.currentAnimation, 'idle');
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test('movement replacement wins even when the sequence is cancelled before promise continuations', async () => {
  const { actor, puppet } = fixture();
  const sequence = new ChoreographySequence(actor).moveTo(100, 0);
  const pending = sequence.run();
  const replacement = actor.moveTo(200, 0, { speed: 100 });
  sequence.cancel();
  assert.equal((await pending).status, 'cancelled');
  puppet.update(2000);
  assert.equal((await replacement).status, 'completed');
  assert.equal(actor.position.x, 200);
});

test('movement interruption prevents later steps', async () => {
  const { actor } = fixture();
  const cue = vi.fn(() => undefined);
  const pending = new ChoreographySequence(actor).moveTo(100, 0).cue(cue).run();
  const replacement = actor.moveTo(0, 0);
  assert.equal((await pending).status, 'interrupted');
  assert.equal((await replacement).status, 'completed');
  assert.equal(cue.mock.calls.length, 0);
});

test('cancelling animation freezes its instance while an unrelated layer continues', async () => {
  const { actor, puppet } = fixture();
  puppet.play('attack', { layer: 'overlay' });
  const other = puppet.waitForPlayback({ layer: 'overlay' });
  const sequence = new ChoreographySequence(actor).playAnimation('draw');
  const pending = sequence.run();
  const ownPlayback = puppet.getPlaybackStatus()?.playbackId;
  puppet.update(25);
  sequence.cancel();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(puppet.getPlaybackStatus()?.playbackId, ownPlayback);
  assert.equal(puppet.getPlaybackStatus()?.status, 'stopped');
  puppet.update(75);
  assert.equal((await other).status, 'completed');
  assert.equal(puppet.getPlaybackStatus()?.elapsedTime, 25);
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test('cancellation preserves a replacement with the same clip and host queue requests', async () => {
  const { actor, puppet } = fixture();
  const sequence = new ChoreographySequence(actor).playAnimation('draw');
  const pending = sequence.run();
  puppet.play('draw');
  const replacement = puppet.getPlaybackStatus()?.playbackId;
  puppet.queue('attack');
  sequence.cancel();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(puppet.getPlaybackStatus()?.playbackId, replacement);
  assert.isTrue(puppet.isPlaying);
  assert.equal(puppet.getQueue().length, 1);
  puppet.update(100);
  assert.equal(puppet.currentAnimation, 'attack');
});

test('cancelling a wait releases it without touching externally owned playback or movement', async () => {
  const { actor, puppet } = fixture();
  puppet.play('idle');
  const movement = actor.moveTo(100, 0, { speed: 100 });
  const sequence = new ChoreographySequence(actor).wait(1000);
  const pending = sequence.run();
  sequence.cancel();
  assert.equal((await pending).status, 'cancelled');
  puppet.update(1000);
  assert.equal((await movement).status, 'completed');
  assert.equal(puppet.currentAnimation, 'idle');
  assert.isTrue(puppet.isPlaying);
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test.each(['move', 'animation', 'wait'] as const)(
  'Actor disposal during %s settles without updates and removes all sequence subscriptions',
  async (kind) => {
    const { actor, puppet } = fixture();
    const cue = vi.fn(() => undefined);
    const steps: ChoreographyStep[] = [
      kind === 'move'
        ? { kind, x: 100, y: 0 }
        : kind === 'animation'
          ? { kind, name: 'draw' }
          : { kind, duration: 100 },
    ];
    const remove = vi.spyOn(actor.disposalSignal, 'removeEventListener');
    const pending = new ChoreographySequence(actor, steps).cue(cue).run();
    actor.dispose();
    assert.equal((await pending).status, 'disposed');
    assert.equal(cue.mock.calls.length, 0);
    assert.isFalse(puppet.isDestroyed);
    assert.deepEqual(resources(puppet), [0, 0, 0]);
    assert.equal(remove.mock.calls.length, 1);
  },
);

test.each(['destroy', 'shutdown', 'sequence'] as const)('%s settles timed waits as disposed', async (mode) => {
  const { actor, puppet, events } = fixture(true);
  const sequence = new ChoreographySequence(actor).wait(1000);
  const pending = sequence.run();
  if (mode === 'destroy') puppet.destroy();
  if (mode === 'shutdown') events.emit('shutdown');
  if (mode === 'sequence') sequence.dispose();
  assert.equal((await pending).status, 'disposed');
  sequence.dispose();
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test.each([
  { kind: 'animation', name: 'missing' },
  { kind: 'animation', name: 'draw', options: { speed: -1 } },
  { kind: 'animation', name: 'draw', options: { layer: 'overlay' } },
  { kind: 'move', x: NaN, y: 0 },
  { kind: 'move', x: 10, y: Infinity },
  { kind: 'move', x: 10, y: 0, options: { speed: 0 } },
  { kind: 'move', x: 10, y: 0, options: { speed: null } },
  { kind: 'move', x: 10, y: 0, options: { signal: new AbortController().signal } },
  { kind: 'animation', name: 'draw', options: null },
  { kind: 'walk', x: 10, y: 0, options: { locomotion: { walk: 'missing', idle: 'idle' } } },
  { kind: 'walk', x: 10, y: 0, options: { faceMovement: 'yes' } },
  { kind: 'wait', duration: -1 },
  { kind: 'wait', duration: NaN },
  { kind: 'wait', duration: Infinity },
  { kind: 'lookAt', target: { x: NaN, y: 0 } },
  { kind: 'lookAt', target: null },
  { kind: 'face', facing: 'up' },
  { kind: 'cue', callback: 'not a function' },
  { kind: 'unsupported' },
  null,
])('invalid instruction preflights before earlier valid actions: %j', async (invalid) => {
  const { actor, puppet } = fixture();
  const cue = vi.fn(() => undefined);
  const sequence = new ChoreographySequence(actor).cue(cue).add(invalid as unknown as ChoreographyStep);
  const result = await sequence.run();
  assert.equal(result.status, 'failed');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.completedSteps, 0);
  assert.equal(cue.mock.calls.length, 0);
  assert.isUndefined(puppet.currentAnimation);
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test('missing Actor and missing walk mapping fail without executing', async () => {
  const { puppet } = fixture();
  const actor = new Actor({ id: 'unmapped', puppet });
  assert.equal((await new ChoreographySequence(undefined as unknown as Actor).run()).status, 'failed');
  assert.equal((await new ChoreographySequence(actor).walkTo(10, 0).run()).status, 'failed');
  actor.dispose();
});

test('disposed source/target preflights and a target disposed during a preceding wait aborts later steps', async () => {
  const { actor, puppet } = fixture();
  const target = fixture().actor;
  const sequence = new ChoreographySequence(actor).wait(100).lookAt(target);
  const pending = sequence.run();
  target.dispose();
  puppet.update(100);
  const result = await pending;
  assert.equal(result.status, 'disposed');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.completedSteps, 1);
  assert.equal((await new ChoreographySequence(actor).lookAt(target).run()).status, 'disposed');
  actor.dispose();
  assert.equal((await new ChoreographySequence(actor).run()).status, 'disposed');
});

test('cue failure stops subsequent steps and preserves the error', async () => {
  const { actor, puppet } = fixture();
  const failure = new Error('cue failed');
  const result = await new ChoreographySequence(actor)
    .wait(0)
    .cue(() => {
      throw failure;
    })
    .playAnimation('draw')
    .run();
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.strictEqual(result.error, failure);
  assert.equal(result.completedSteps, 1);
  assert.equal(result.stepIndex, 1);
  assert.isUndefined(puppet.currentAnimation);
});

test('untyped async cues fail and their rejected promises are observed', async () => {
  const { actor } = fixture();
  const callback = (() => Promise.reject(new Error('async cue'))) as unknown as (actor: Actor) => undefined;
  const result = await new ChoreographySequence(actor).cue(callback).run();
  assert.equal(result.status, 'failed');
  await flush();
});

test('commands own snapshots but sample live Actor target positions when reached', async () => {
  const { actor, puppet } = fixture();
  const target = fixture().actor.setPosition(100, 0);
  const options = { speed: 100 };
  const point = { x: -100, y: 0 };
  const steps: ChoreographyStep[] = [
    { kind: 'move', x: 10, y: 0, options },
    { kind: 'lookAt', target: point },
  ];
  const sequence = new ChoreographySequence(actor, steps).lookAt(target);
  options.speed = 1;
  point.x = 100;
  steps.length = 0;
  const seen: string[] = [];
  vi.spyOn(actor, 'lookAt').mockImplementation((position) => {
    const x = position instanceof Actor ? position.worldPosition.x : position.x;
    seen.push(String(x));
    return actor;
  });
  const pending = sequence.run();
  target.setPosition(-200, 0);
  puppet.update(100);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(seen, ['-100', '-200']);
});

test('run is idempotent, reentrant and single-run; mutation after start rejects', async () => {
  const { actor } = fixture();
  let reentrant: ReturnType<ChoreographySequence['run']> | undefined;
  const sequence = new ChoreographySequence(actor).cue(() => {
    reentrant = sequence.run();
  });
  const pending = sequence.run();
  assert.strictEqual(sequence.run(), pending);
  assert.strictEqual(reentrant, pending);
  assert.throws(() => sequence.wait(1), /single-run/);
  const result = await pending;
  assert.strictEqual(await sequence.run(), result);
  assert.isTrue(Object.isFrozen(result));
});

test.each(['cancel', 'dispose'] as const)('%s before run prevents any action', async (method) => {
  const { actor, puppet } = fixture();
  const sequence = new ChoreographySequence(actor).playAnimation('draw');
  sequence[method]();
  const pending = sequence.run();
  assert.strictEqual(sequence.run(), pending);
  assert.equal((await pending).status, method === 'cancel' ? 'cancelled' : 'disposed');
  assert.isUndefined(puppet.currentAnimation);
});

test.each(['cancel', 'dispose'] as const)('a synchronous cue can %s and prevent the next action', async (method) => {
  const { actor, puppet } = fixture();
  const sequence: ChoreographySequence = new ChoreographySequence(actor)
    .cue(() => {
      sequence[method]();
    })
    .playAnimation('draw');
  assert.equal((await sequence.run()).status, method === 'cancel' ? 'cancelled' : 'disposed');
  assert.isUndefined(puppet.currentAnimation);
});

test('cancellation during animation start settles once and stops the exact instance', async () => {
  const { actor, puppet } = fixture();
  const sequence = new ChoreographySequence(actor).playAnimation('draw').playAnimation('attack');
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started') sequence.cancel();
  });
  const settled = vi.fn();
  const pending = sequence.run().then((result) => {
    settled(result);
    return result;
  });
  assert.equal((await pending).status, 'cancelled');
  assert.equal(puppet.getPlaybackStatus()?.status, 'stopped');
  puppet.update(1000);
  sequence.dispose();
  sequence.cancel();
  assert.equal(settled.mock.calls.length, 1);
  assert.equal(puppet.currentAnimation, 'draw');
});

test.each([false, true])(
  'animation start failures respect terminal outcomes and replacement ownership (%s)',
  async (replace) => {
    const { actor, puppet } = fixture();
    const failure = new Error('start failed');
    const release = puppet.onPlaybackLifecycle((event) => {
      if (event.type !== 'started' || event.clip !== 'draw') return;
      if (replace) puppet.play('attack');
      throw failure;
    });
    const result = await new ChoreographySequence(actor).playAnimation('draw').run();
    assert.equal(result.status, replace ? 'interrupted' : 'failed');
    if (result.status === 'failed') assert.strictEqual(result.error, failure);
    assert.equal(puppet.currentAnimation, replace ? 'attack' : 'draw');
    assert.equal(puppet.getPlaybackStatus()?.status, replace ? 'playing' : 'stopped');
    release();
    assert.deepEqual(resources(puppet), [0, 0, 0]);
  },
);

test('runtime movement validation failure stops later actions and retains existing requests', async () => {
  const { actor, puppet, scene } = fixture();
  scene.add.container(0, 0).setScale(0).add(puppet.container);
  const result = await new ChoreographySequence(actor).moveTo(10, 0).playAnimation('draw').run();
  assert.equal(result.status, 'failed');
  assert.isUndefined(puppet.currentAnimation);
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test.each(['preparePose', 'syncPose'] as const)(
  'cancellation from %s during animation startup cleans up',
  async (method) => {
    const { actor, puppet } = fixture();
    const sequence = new ChoreographySequence(actor).playAnimation('draw').playAnimation('attack');
    vi.spyOn(puppet, method).mockImplementationOnce(() => sequence.cancel());
    const result = await sequence.run();
    assert.equal(result.status, 'cancelled');
    assert.equal(puppet.getPlaybackStatus()?.status, 'stopped');
    assert.deepEqual(resources(puppet), [0, 0, 0]);
  },
);

test('owned animation cancellation preserves pending queue requests on its own channel', async () => {
  const { actor, puppet } = fixture();
  const sequence = new ChoreographySequence(actor).playAnimation('draw');
  const pending = sequence.run();
  puppet.queue('attack');
  sequence.cancel();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(puppet.getPlaybackStatus()?.status, 'stopped');
  assert.equal(puppet.getQueue()[0]?.name, 'attack');
});

test.each(['complete', 'cancel', 'dispose'] as const)(
  'sequence %s releases captured cue and target references',
  async (mode) => {
    const { actor } = fixture();
    const sequence = new ChoreographySequence(actor).cue(() => {}).lookAt({ x: 10, y: 0 });
    if (mode === 'cancel') sequence.cancel();
    if (mode === 'dispose') sequence.dispose();
    const result = await sequence.run();
    assert.isTrue(Object.isFrozen(result));
    assert.equal(result.status, mode === 'complete' ? 'completed' : mode === 'cancel' ? 'cancelled' : 'disposed');
    const steps: unknown = Reflect.get(sequence, 'steps');
    assert.deepEqual(steps, []);
  },
);

test('choreography root-motion steps hand off to movement and cancellation retains partial travel', async () => {
  const { actor, puppet } = fixture();
  puppet.addAnimation({
    name: 'step',
    duration: 100,
    loop: false,
    tracks: {},
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0 },
        { time: 100, x: 80 },
      ],
    },
  });
  const sequence = new ChoreographySequence(actor)
    .playAnimation('step', { rootMotion: 'apply' })
    .moveTo(100, 0, { speed: 100 });
  const pending = sequence.run();
  puppet.update(100);
  await flush();
  assert.deepEqual(actor.position, { x: 80, y: 0 });
  puppet.update(200);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(actor.position, { x: 100, y: 0 });
  const cancelled = new ChoreographySequence(actor).playAnimation('step', { rootMotion: 'apply' });
  const outcome = cancelled.run();
  puppet.update(50);
  cancelled.cancel();
  assert.equal((await outcome).status, 'cancelled');
  puppet.update(100);
  assert.deepEqual(actor.position, { x: 140, y: 0 });
});

test('parallel choreography rejects root motion and movement for the same Actor before either starts', async () => {
  const { actor, puppet } = fixture();
  puppet.addAnimation({
    name: 'step',
    duration: 100,
    loop: false,
    tracks: {},
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0 },
        { time: 100, x: 80 },
      ],
    },
  });
  const choreography = new Choreography([actor]);
  const result = await choreography.run(
    choreography.parallel([
      choreography.actor(actor.id, [{ kind: 'animation', name: 'step', options: { rootMotion: 'apply' } }]),
      choreography.actor(actor.id, [{ kind: 'move', x: 100, y: 0 }]),
    ]),
  );
  assert.equal(result.status, 'failed');
  assert.equal(actor.currentAnimation, undefined);
  assert.deepEqual(actor.position, { x: 0, y: 0 });
  choreography.dispose();
});
