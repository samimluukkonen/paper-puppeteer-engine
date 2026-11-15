import { assert, test, vi } from 'vitest';
import {
  type AnimationActionOptions,
  type AnimationClip,
  AnimationPlayer,
  AnimationStateController,
  type AnimationStateControllerOptions,
  Joint,
  type PlaybackLifecycleEvent,
  Rig,
  type SetAnimationStateOptions,
} from '../src/engine/core.js';
import { Puppet } from '../src/engine/runtime.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const clips: AnimationClip[] = ['idle', 'walk', 'run', 'attack', 'recover'].map((name, index) => ({
  name,
  duration: 1000,
  loop: name === 'run',
  tracks: {
    root: [
      { time: 0, x: index * 100 },
      { time: 1000, x: index * 100 + 100 },
    ],
  },
  events: [
    { time: 0, name: 'zero' },
    { time: 1000, name: 'end' },
  ],
}));

function config(): AnimationStateControllerOptions {
  return {
    initialState: 'idle',
    states: {
      idle: { animation: 'idle', loop: true },
      walking: { animation: 'walk', loop: true },
      running: { animation: 'run' },
      attack: { animation: 'attack' },
    },
    transitions: { idle: { walking: 200 }, walking: { running: 150 }, running: { idle: 200 }, attack: { idle: 100 } },
  };
}

function fixture() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joints = new Map([['root', new Joint('root', rig.getBone('root'))]]);
  const player = new AnimationPlayer(rig, joints);
  for (const clip of clips) player.addAnimation(clip);
  const lifecycle: PlaybackLifecycleEvent[] = [];
  player.onPlaybackLifecycle((event) => lifecycle.push(event));
  return { player, joints, lifecycle };
}

const starts = (events: readonly PlaybackLifecycleEvent[]) => events.filter((event) => event.type === 'started');

test('initial state selects a registered clip; state identity is visible in start callbacks', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  assert.equal(controller.currentState, 'idle');
  assert.isUndefined(controller.currentAction);
  assert.isTrue(controller.isActive);
  assert.equal(player.currentAnimation, 'idle');
  assert.isTrue(player.getPlaybackStatus()!.loop);
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'walk') assert.equal(controller.currentState, 'walking');
  });
  assert.strictEqual(controller.setState('walking'), controller);
  assert.equal(controller.currentState, 'walking');
  assert.equal(player.currentAnimation, 'walk');
  controller.dispose();
});

test('repeated requests keep the playback ID, clock, queue and fade; restart is explicit', () => {
  const { player, lifecycle } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.setState('walking');
  player.update(50);
  const status = player.getPlaybackStatus();
  const transition = player.transition;
  for (let i = 0; i < 10; i++) controller.setState('walking');
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.deepEqual(player.transition, transition);
  assert.equal(starts(lifecycle).length, 2);
  controller.setState('walking', { restart: true });
  assert.notEqual(player.getPlaybackStatus()!.playbackId, status!.playbackId);
  assert.equal(player.elapsedTime, 0);
});

test('pair transitions use existing millisecond crossfades and preserve the blended pose', () => {
  const { player, joints } = fixture();
  const controller = new AnimationStateController(player, config());
  player.update(100);
  controller.setState('walking');
  assert.equal(joints.get('root')!.pose.x, 10);
  assert.deepEqual(player.transition, { from: 'idle', to: 'walk', progress: 0 });
  player.update(100);
  assert.equal(player.transition!.progress, 0.5);
  assert.equal(joints.get('root')!.pose.x, 65);
  controller.setState('running');
  assert.equal(player.transition!.from, 'previous pose');
  assert.equal(joints.get('root')!.pose.x, 65);
  player.update(75);
  assert.equal(player.transition!.progress, 0.5);
  player.update(75);
  controller.setState('idle');
  player.update(100);
  assert.equal(player.transition!.progress, 0.5);
});

test('transition precedence is pair, destination option, default; controller owns its configuration', () => {
  const { player } = fixture();
  const options = { speed: 2, fadeDuration: 100 };
  const pairs = { walking: 200 };
  const states = { idle: { animation: 'idle', loop: true }, walking: { animation: 'walk', loop: true, options } };
  const controller = new AnimationStateController(player, {
    initialState: 'idle',
    states,
    defaultFadeDuration: 50,
    transitions: { idle: pairs },
  });
  options.speed = 0;
  options.fadeDuration = 999;
  pairs.walking = 999;
  states.walking.animation = 'missing';
  controller.setState('walking');
  assert.equal(player.currentAnimationSpeed, 2);
  player.update(100);
  assert.equal(player.transition!.progress, 0.5);
  controller.setState('walking', { restart: true });
  player.update(50);
  assert.equal(player.transition!.progress, 0.5);
  controller.setState('idle');
  player.update(25);
  assert.equal(player.transition!.progress, 0.5);
});

test('unknown and malformed state requests preserve active playback, persistent state and pending requests', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  player.queue('recover');
  const status = player.getPlaybackStatus();
  assert.throws(() => controller.setState('missing'), /Unknown animation state/);
  assert.throws(() => controller.setState('toString'), /Unknown animation state/);
  assert.throws(() => controller.setState('   '), /nonempty/);
  for (const options of [null, [], { restart: 'yes' }, { fadeDuration: 10 }])
    assert.throws(() => controller.setState('walking', options as unknown as SetAnimationStateOptions));
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.equal(controller.currentState, 'idle');
  assert.equal(controller.currentAction, 'attack');
  assert.equal(player.getQueue()[0]!.name, 'recover');
});

const invalidConfigs: unknown[] = [
  null,
  {},
  { initialState: 'idle', states: null },
  { initialState: 'idle', states: [] },
  { initialState: 'missing', states: config().states },
  { initialState: 'idle', states: { idle: { animation: 'missing' } } },
  { initialState: 'idle', states: { idle: { animation: '' } } },
  { initialState: 'idle', states: { '': { animation: 'idle' } } },
  { initialState: 'idle', states: { idle: null } },
  { initialState: 'idle', states: { idle: { animation: 'idle', loop: null } } },
  { initialState: 'idle', states: { idle: { animation: 'idle', loop: 'yes' } } },
  { initialState: 'idle', states: { idle: { animation: 'idle', options: null } } },
  { initialState: 'idle', states: { idle: { animation: 'idle', options: { layer: 'upper' } } } },
  ...[-1, NaN, Infinity, null, '100'].flatMap((value) => [
    { ...config(), defaultFadeDuration: value },
    { ...config(), transitions: { idle: { walking: value } } },
    { ...config(), states: { idle: { animation: 'idle', options: { speed: value } } } },
    { ...config(), states: { idle: { animation: 'idle', options: { fadeDuration: value } } } },
  ]),
  { ...config(), transitions: { idle: { missing: 10 } } },
  { ...config(), transitions: { missing: { idle: 10 } } },
  { ...config(), transitions: { idle: { walking: undefined } } },
  { ...config(), transitions: { idle: null } },
  { ...config(), transitions: null },
];

test.each(invalidConfigs)('invalid controller configuration %# rejects before disturbing playback', (options) => {
  const { player, lifecycle } = fixture();
  player.queue('attack');
  player.queue('recover');
  player.update(40);
  const status = player.getPlaybackStatus();
  const subscribe = vi.spyOn(player, 'onPlaybackLifecycle');
  assert.throws(() => new AnimationStateController(player, options as AnimationStateControllerOptions));
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.equal(player.getQueue()[0]!.name, 'recover');
  assert.equal(starts(lifecycle).length, 1);
  assert.equal(subscribe.mock.calls.length, 0);
});

test('action naturally completes once, then returns with the configured crossfade after legacy callbacks', () => {
  const { player, lifecycle } = fixture();
  const controller = new AnimationStateController(player, config());
  const completed = vi.fn(() => {
    assert.equal(player.currentAnimation, 'attack');
    assert.equal(controller.currentAction, 'attack');
  });
  player.onAnimationComplete(completed);
  assert.strictEqual(controller.playAction('attack'), controller);
  assert.equal(controller.currentState, 'idle');
  assert.equal(controller.currentAction, 'attack');
  controller.setState('idle');
  assert.equal(player.currentAnimation, 'attack');
  player.update(999);
  assert.equal(player.currentAnimation, 'attack');
  player.update(1);
  assert.equal(completed.mock.calls.length, 1);
  assert.equal(player.currentAnimation, 'idle');
  assert.isUndefined(controller.currentAction);
  assert.isTrue(controller.isActive);
  player.update(50);
  assert.equal(player.transition!.progress, 0.5);
  player.update(1000);
  assert.deepEqual(
    starts(lifecycle).map((event) => event.clip),
    ['idle', 'attack', 'idle'],
  );
});

test('actions override authored/state looping, speed and fade, and can choose their return state', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.playAction('running', { returnTo: 'walking', speed: 2, fadeDuration: 100 });
  assert.equal(controller.currentState, 'walking');
  assert.isFalse(player.getPlaybackStatus()!.loop);
  player.update(50);
  assert.equal(player.transition!.progress, 0.5);
  player.update(450);
  assert.equal(player.currentAnimation, 'walk');
  assert.isTrue(player.getPlaybackStatus()!.loop);
  controller.setState('running');
  assert.isTrue(player.getPlaybackStatus()!.loop);
});

test.each([
  null,
  [],
  { returnTo: 'missing' },
  { returnTo: null },
  { speed: -1 },
  { speed: NaN },
  { fadeDuration: -1 },
  { fadeDuration: Infinity },
  { loop: true },
  { layer: 'upper' },
])('invalid action options %j preserve the current action and return destination', (options) => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  const status = player.getPlaybackStatus();
  assert.throws(() => controller.playAction('running', options as unknown as AnimationActionOptions));
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.equal(controller.currentState, 'idle');
  player.update(1000);
  assert.equal(player.currentAnimation, 'idle');
});

test.each(['state', 'restart', 'action', 'manual', 'stop'] as const)(
  'an action interrupted by %s cannot return later',
  (kind) => {
    const { player, lifecycle } = fixture();
    const controller = new AnimationStateController(player, config());
    controller.playAction('attack');
    player.update(200);
    if (kind === 'state') controller.setState('walking');
    if (kind === 'restart') controller.setState('idle', { restart: true });
    if (kind === 'action') controller.playAction('running', { returnTo: 'walking' });
    if (kind === 'manual') player.play('recover');
    if (kind === 'stop') player.stopQueue();
    player.update(10000);
    assert.equal(
      lifecycle.filter((event) => event.clip === 'attack' && event.type === 'interrupted').length,
      kind === 'stop' ? 0 : 1,
    );
    assert.equal(starts(lifecycle).filter((event) => event.clip === 'idle').length, kind === 'restart' ? 2 : 1);
    if (kind === 'action') assert.equal(player.currentAnimation, 'walk');
  },
);

test('direct base play relinquishes ownership until an explicit state request, including the same remembered state', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  player.play('attack');
  assert.isFalse(controller.isActive);
  player.update(1000);
  assert.equal(player.currentAnimation, 'attack');
  assert.equal(controller.currentState, 'idle');
  controller.setState('idle');
  assert.isTrue(controller.isActive);
  assert.equal(player.currentAnimation, 'idle');
  player.play('idle'); // Even the same clip is imperative when it creates a new instance.
  assert.isFalse(controller.isActive);
  controller.setState('walking');
  const status = player.getPlaybackStatus();
  assert.throws(() => player.play('missing'));
  assert.throws(() => player.play('walk', { loop: 'yes' as unknown as boolean }));
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.isTrue(controller.isActive);
  player.play('walk', { restart: false }); // Existing no-op identity keeps ownership.
  assert.isTrue(controller.isActive);
});

test('pending queue takes precedence over action return and is never resumed by the controller', () => {
  const { player, lifecycle } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  player.queue('recover');
  player.update(1000);
  assert.equal(player.currentAnimation, 'recover');
  assert.isFalse(controller.isActive);
  assert.isUndefined(controller.currentAction);
  player.update(1000);
  assert.deepEqual(
    starts(lifecycle).map((event) => event.clip),
    ['idle', 'attack', 'recover'],
  );
  controller.setState('idle');
  assert.equal(player.currentAnimation, 'idle');
});

test.each(['marker', 'lifecycle', 'legacy'] as const)(
  '%s completion callbacks can enqueue or override before an action returns',
  (kind) => {
    for (const command of ['queue', 'play'] as const) {
      const { player, lifecycle } = fixture();
      const controller = new AnimationStateController(player, config());
      const takeOver = () => player[command]('recover');
      if (kind === 'marker')
        player.onAnimationEvent((event) => {
          if (event.clip === 'attack' && event.name === 'end') takeOver();
        });
      if (kind === 'lifecycle')
        player.onPlaybackLifecycle((event) => {
          if (event.clip === 'attack' && event.type === 'completed') takeOver();
        });
      if (kind === 'legacy')
        player.onAnimationComplete((event) => {
          if (event.clip === 'attack') takeOver();
        });
      controller.playAction('attack');
      player.update(1000);
      player.update(1000);
      assert.deepEqual(
        starts(lifecycle).map((event) => event.clip),
        ['idle', 'attack', 'recover'],
      );
      assert.isFalse(controller.isActive);
    }
  },
);

test('state/action requests use base play cancellation; idempotent requests preserve pending queue', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  player.queue('recover');
  controller.setState('idle');
  assert.equal(player.getQueue().length, 1);
  controller.setState('walking');
  assert.equal(player.getQueue().length, 0);
  controller.playAction('attack');
  player.queue('recover');
  player.replaceQueue([{ name: 'recover' }, { name: 'attack' }]);
  assert.isFalse(controller.isActive);
  controller.playAction('attack');
  assert.equal(player.getQueue().length, 0);
});

test.each(['marker', 'lifecycle', 'legacy'] as const)(
  '%s callback stops cancel return even after the action committed completion',
  (kind) => {
    for (const command of ['stop', 'stopQueue'] as const) {
      const { player, lifecycle } = fixture();
      const controller = new AnimationStateController(player, config());
      const stop = () => player[command]();
      if (kind === 'marker')
        player.onAnimationEvent((event) => {
          if (event.clip === 'attack' && event.name === 'end') stop();
        });
      if (kind === 'lifecycle')
        player.onPlaybackLifecycle((event) => {
          if (event.clip === 'attack' && event.type === 'completed') stop();
        });
      if (kind === 'legacy')
        player.onAnimationComplete((event) => {
          if (event.clip === 'attack') stop();
        });
      controller.playAction('attack');
      player.update(1000);
      assert.equal(player.getPlaybackStatus()!.status, 'completed');
      assert.isTrue(player.isPlaybackStopped());
      assert.isFalse(controller.isActive);
      assert.isUndefined(controller.currentAction);
      assert.deepEqual(
        starts(lifecycle).map((event) => event.clip),
        ['idle', 'attack'],
      );
      controller.setState('idle');
      assert.equal(player.currentAnimation, 'idle');
      assert.isFalse(player.isPlaybackStopped());
    }
  },
);

test('a cleared queue allows natural return; a stopped action never returns', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  player.queue('recover');
  player.clearQueue();
  player.update(1000);
  assert.equal(player.currentAnimation, 'idle');
  controller.playAction('attack');
  player.stopQueue();
  player.update(1000);
  assert.equal(player.getPlaybackStatus()!.status, 'stopped');
  assert.isFalse(controller.isActive);
});

test('pause, zero speed, stepped sampling and large deltas use the single existing player clock', () => {
  const { player, lifecycle } = fixture();
  const controller = new AnimationStateController(player, config());
  player.pause();
  controller.playAction('attack', { speed: 2 });
  player.setPlaybackMode({ mode: 'stepped', fps: 1 });
  player.update(1000);
  assert.equal(controller.currentAction, 'attack');
  player.resume();
  player.setSpeed(0);
  player.update(1000);
  assert.equal(player.elapsedTime, 0);
  player.setSpeed(1);
  player.update(10000);
  assert.equal(player.currentAnimation, 'idle');
  assert.equal(player.elapsedTime, 0);
  assert.equal(starts(lifecycle).length, 3);
});

test('nonlooping persistent states hold completion and remain idempotent', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, { ...config(), initialState: 'attack' });
  player.update(1000);
  const status = player.getPlaybackStatus();
  controller.setState('attack');
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.isTrue(controller.isActive);
});

test('nested lifecycle state requests keep the latest intent despite deferred start notifications', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'attack') {
      controller.setState('walking');
      controller.setState('running');
    }
  });
  controller.playAction('attack');
  assert.equal(controller.currentState, 'running');
  assert.isTrue(controller.isActive);
  player.update(10000);
  assert.equal(player.currentAnimation, 'run');
});

test('manual same-clip replacement from an earlier start listener cannot be adopted as controller playback', () => {
  const { player } = fixture();
  let replaced = false;
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'attack' && !replaced) {
      replaced = true;
      player.play('attack');
    }
  });
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  assert.isFalse(controller.isActive);
  player.update(1000);
  assert.equal(player.currentAnimation, 'attack');
});

test('listener errors after successful starts retain committed state and completion still returns', () => {
  const { player } = fixture();
  const controller = new AnimationStateController(player, config());
  const unsubscribe = player.onPlaybackLifecycle((event) => {
    if (event.type === 'started') throw new Error('start failed listener');
  });
  assert.throws(() => controller.setState('walking'), /start failed listener/);
  assert.equal(controller.currentState, 'walking');
  assert.isTrue(controller.isActive);
  unsubscribe();
  controller.playAction('attack');
  player.onAnimationComplete(() => {
    throw new Error('completion failed listener');
  });
  assert.throws(() => player.update(1000), /completion failed listener/);
  assert.equal(player.currentAnimation, 'walk');
  assert.isTrue(controller.isActive);
});

test('preflight event-budget failure rolls back controller intent and releases failed constructor subscriptions', () => {
  const { player } = fixture();
  player.addAnimation({
    ...clips[3]!,
    name: 'too-many',
    events: Array.from({ length: 10001 }, () => ({ time: 0, name: 'zero' })),
  });
  const configuration = { ...config(), states: { ...config().states, invalid: { animation: 'too-many' } } };
  const controller = new AnimationStateController(player, configuration);
  const status = player.getPlaybackStatus();
  assert.throws(() => controller.setState('invalid'), /exceeds/);
  assert.equal(controller.currentState, 'idle');
  assert.isTrue(controller.isActive);
  assert.deepEqual(player.getPlaybackStatus(), status);
  const released = vi.fn();
  const subscribe = player.onPlaybackLifecycle.bind(player);
  vi.spyOn(player, 'onPlaybackLifecycle').mockImplementation((listener, options) => {
    const unsubscribe = subscribe(listener, options);
    return () => {
      released();
      unsubscribe();
    };
  });
  assert.throws(() => new AnimationStateController(player, { ...configuration, initialState: 'invalid' }), /exceeds/);
  assert.equal(released.mock.calls.length, 1);
});

test.each(['dispose', 'host-dispose', 'completion-dispose'] as const)('%s prevents late action returns', (kind) => {
  const { player, lifecycle } = fixture();
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  if (kind === 'dispose') controller.dispose();
  if (kind === 'host-dispose') player.dispose();
  if (kind === 'completion-dispose') player.onAnimationComplete(() => controller.dispose());
  player.update(1000);
  controller.dispose();
  controller.dispose();
  assert.isTrue(controller.isDisposed);
  assert.isFalse(controller.isActive);
  assert.isUndefined(controller.currentAction);
  assert.throws(() => controller.setState('idle'), /disposed/);
  assert.throws(() => controller.playAction('attack'), /disposed/);
  assert.deepEqual(
    starts(lifecycle).map((event) => event.clip),
    ['idle', 'attack'],
  );
});

test('dispose unsubscribes once, preserves pending host queue, and does not stop playback', () => {
  const { player } = fixture();
  const unsubscribe = vi.fn();
  const subscribe = player.onPlaybackLifecycle.bind(player);
  vi.spyOn(player, 'onPlaybackLifecycle').mockImplementation((listener, options) => {
    const release = subscribe(listener, options);
    return () => {
      unsubscribe();
      release();
    };
  });
  const controller = new AnimationStateController(player, config());
  controller.playAction('attack');
  player.queue('recover');
  const status = player.getPlaybackStatus();
  controller.dispose();
  controller.dispose();
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.equal(player.getQueue().length, 1);
  assert.equal(unsubscribe.mock.calls.length, 1);
  player.update(1000);
  assert.equal(player.currentAnimation, 'recover');
});

test('Puppet state/action transitions synchronize rendering and retain overlays, masks, IK, skin, and facing', () => {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: {
      root: 'root',
      bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 10 }, { id: 'end', parent: 'middle', y: 10 }],
      slots: [{ id: 'body', bone: 'root' }],
      attachments: [{ id: 'art', texture: 'art' }],
      skins: [{ version: 1, name: 'alternate', slots: { body: 'art' } }],
      ik: [{ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
    },
    animations: [
      ...clips,
      {
        name: 'overlay',
        duration: 1000,
        loop: true,
        tracks: { middle: [{ time: 0, x: 4 }], root: [{ time: 0, y: 400 }] },
      },
    ],
  });
  const controller = new AnimationStateController(puppet, config());
  puppet.setLayerMask('upper', ['middle']).setLayerWeight('upper', 0.5).play('overlay', { layer: 'upper' });
  const overlayId = puppet.getPlaybackStatus('upper')!.playbackId;
  puppet.setSkin('alternate').setFacing('left');
  const constraint = puppet.getIK('chain');
  constraint.setTarget({ x: 10, y: 10 });
  const target = constraint.target;
  const verify = () => {
    assert.equal(puppet.getPlaybackStatus('upper')!.playbackId, overlayId);
    assert.equal(puppet.posePipeline.player.getLayerWeight('upper'), 0.5);
    assert.equal(puppet.getBone('middle').pose.x, 2);
    assert.equal(puppet.getBone('root').pose.y, 0);
    assert.strictEqual(puppet.getIK('chain'), constraint);
    assert.deepEqual(constraint.target, target);
    assert.equal(puppet.facingDirection, 'left');
    assert.equal(puppet.getAttachment('body'), 'art');
  };
  controller.setState('walking');
  puppet.update(100);
  verify();
  assert.equal(puppet.getPlaybackStatus('upper')!.elapsedTime, 100);
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'attack') assert.equal(puppet.getBone('root').container.x, 300);
  });
  controller.playAction('attack');
  verify();
  puppet.update(1000);
  verify();
  puppet.destroy();
  assert.isTrue(controller.isDisposed);
});

test('loop overrides are instance-local, survive restart, and leave registered/shared clips unchanged', () => {
  const { player } = fixture();
  player.play('idle', { loop: true });
  player.update(1500);
  assert.equal(player.elapsedTime, 500);
  player.restart();
  assert.isTrue(player.getPlaybackStatus()!.loop);
  player.play('run', { loop: false });
  player.queue('recover');
  player.update(1000);
  assert.equal(player.currentAnimation, 'recover');
  player.play('run');
  assert.isTrue(player.getPlaybackStatus()!.loop);
  player.play('idle');
  assert.isFalse(player.getPlaybackStatus()!.loop);
  assert.throws(() => player.queue('run'), /indefinitely looping/);
  assert.isTrue(player.hasAnimation('idle'));
  assert.isFalse(player.hasAnimation('missing'));
});

test('settled lifecycle completion follows legacy callbacks and queue advancement and can unsubscribe', () => {
  const { player } = fixture();
  const calls: string[] = [];
  const unsubscribe = player.onPlaybackLifecycle(
    (event) => {
      if (event.type === 'completed') calls.push(`settled:${event.clip}:${player.currentAnimation}`);
    },
    { completionPhase: 'settled' },
  );
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'completed') calls.push('immediate');
  });
  player.onAnimationComplete(() => calls.push('legacy'));
  player.queue('attack');
  player.queue('recover');
  player.update(1000);
  assert.deepEqual(calls, ['immediate', 'legacy', 'settled:attack:recover']);
  unsubscribe();
  player.update(1000);
  assert.deepEqual(calls.slice(3), ['immediate', 'legacy']);
});
