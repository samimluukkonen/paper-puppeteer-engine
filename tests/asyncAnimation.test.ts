import { rejects } from 'node:assert/strict';
import { assert, test, vi } from 'vitest';
import {
  type AnimationClip,
  AnimationPlayer,
  AnimationStateController,
  Joint,
  type PlaybackWaitResult,
  Rig,
} from '../src/engine/core.js';
import { Puppet } from '../src/engine/runtime.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const clips: AnimationClip[] = ['a', 'b', 'loop'].map((name) => ({
  name,
  duration: 100,
  loop: name === 'loop',
  tracks: {
    root: [
      { time: 0, x: 10 },
      { time: 100, x: 110 },
    ],
  },
  events: [
    { time: 0, name: 'zero' },
    { time: 100, name: 'end' },
  ],
}));

function fixture() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joints = new Map([['root', new Joint('root', rig.getBone('root'))]]);
  const player = new AnimationPlayer(rig, joints);
  for (const clip of clips) player.addAnimation(clip);
  return { player, joints };
}

function resources(player: AnimationPlayer) {
  return ['lifecycleListeners', 'settledCompletionListeners', 'pendingWaitDisposers'].map(
    (key) => (Reflect.get(player, key) as Set<unknown>).size,
  );
}

test.each([100, 101, 10_000])('natural completion at delta %s returns the exact terminal instance', async (delta) => {
  const { player, joints } = fixture();
  const result = player.playAndWait('a');
  const initial = player.getPlaybackStatus()!;
  let settled = 0;
  void result.then(() => settled++);
  player.update(25);
  await Promise.resolve();
  assert.equal(settled, 0);
  player.update(delta - 25);
  assert.deepEqual(await result, {
    status: 'completed',
    playback: { ...initial, elapsedTime: 100, status: 'completed' },
  });
  assert.equal(joints.get('root')!.pose.x, 110);
  player.update(100);
  player.stop();
  player.dispose();
  await Promise.resolve();
  assert.equal(settled, 1);
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test.each(['b', 'a'])('replacement with %s interrupts only the old playback identity', async (replacement) => {
  const { player } = fixture();
  const first = player.playAndWait('a');
  const oldId = player.getPlaybackStatus()!.playbackId;
  player.update(20);
  const second = player.playAndWait(replacement, { fadeDuration: 200 });
  const secondId = player.getPlaybackStatus()!.playbackId;
  const interrupted = await first;
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.playback!.playbackId, oldId);
  assert.equal(interrupted.playback!.elapsedTime, 20);
  assert.notEqual(secondId, oldId);
  player.update(100);
  const completed = await second;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.playback!.playbackId, secondId);
  assert.equal(player.transition!.progress, 0.5, 'completion follows the clip, not the visual fade');
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('restart assigns a new instance and interrupts a pending wait', async () => {
  const { player } = fixture();
  const pending = player.playAndWait('a');
  player.restart();
  assert.equal((await pending).status, 'interrupted');
  const restarted = player.waitForPlayback();
  player.update(100);
  assert.equal((await restarted).status, 'completed');
});

test.each(['stop', 'stopQueue', 'clearAllLayers'] as const)(
  '%s preserves the stopped lifecycle outcome',
  async (command) => {
    const { player } = fixture();
    const pending = player.playAndWait('a');
    player[command]();
    assert.equal((await pending).status, 'stopped');
    assert.deepEqual(resources(player), [0, 0, 0]);
  },
);

test('AbortSignal cancels only its wait and removes lifecycle and abort listeners', async () => {
  const { player } = fixture();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = player.playAndWait('a', { signal: controller.signal });
  player.queue('b');
  player.play('b', { layer: 'upper' });
  player.update(20);
  const status = player.getPlaybackStatus()!;
  const queue = player.getQueue();
  controller.abort();
  assert.deepEqual(await pending, { status: 'cancelled', playback: status });
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.deepEqual(player.getQueue(), queue);
  assert.equal(player.getPlaybackStatus('upper')!.status, 'playing');
  assert.equal(remove.mock.calls.length, 1);
  assert.deepEqual(resources(player), [0, 0, 0]);
  player.update(80);
  assert.equal(player.currentAnimation, 'b');
});

test('abort before start skips playback, validation and subscriptions', async () => {
  const { player } = fixture();
  player.play('a');
  player.queue('b');
  const initial = player.getPlaybackStatus();
  const controller = new AbortController();
  controller.abort();
  const subscribe = vi.spyOn(player, 'onPlaybackLifecycle');
  assert.deepEqual(await player.playAndWait('unknown', { signal: controller.signal }), { status: 'cancelled' });
  assert.deepEqual(await player.waitForPlayback({ signal: controller.signal }), { status: 'cancelled' });
  assert.deepEqual(player.getPlaybackStatus(), initial);
  assert.equal(player.getQueue().length, 1);
  assert.equal(subscribe.mock.calls.length, 0);
});

test('abort from a time-zero callback releases the wait without affecting committed playback', async () => {
  const { player } = fixture();
  const controller = new AbortController();
  player.onAnimationEvent(() => controller.abort());
  const result = await player.playAndWait('a', { signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.playback!.playbackId, player.getPlaybackStatus()!.playbackId);
  assert.equal(player.isPlaying, true);
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test.each(['complete', 'interrupt', 'dispose'] as const)(
  'abort after %s cannot relabel a terminal result',
  async (outcome) => {
    const { player } = fixture();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = player.playAndWait('a', { signal: controller.signal });
    if (outcome === 'complete') player.update(100);
    else if (outcome === 'interrupt') player.play('b');
    else player.dispose();
    controller.abort();
    const expected = { complete: 'completed', interrupt: 'interrupted', dispose: 'disposed' }[outcome];
    assert.equal((await pending).status, expected);
    assert.equal(remove.mock.calls.length, 1);
    assert.deepEqual(resources(player), [0, 0, 0]);
  },
);

test('multiple waits can share an instance while independent layers finish separately', async () => {
  const { player } = fixture();
  const first = player.playAndWait('a');
  player.update(20);
  const joined = player.playAndWait('a', { restart: false, speed: 10, loop: true });
  const controller = new AbortController();
  const cancelled = player.waitForPlayback({ signal: controller.signal });
  const current = player.waitForPlayback();
  const upper = player.playAndWait('b', { layer: 'upper', speed: 2 });
  controller.abort();
  assert.equal((await cancelled).status, 'cancelled');
  player.update(50);
  assert.equal((await upper).status, 'completed');
  assert.equal(player.getPlaybackStatus()!.status, 'playing');
  player.update(30);
  const completed = await Promise.all([first, joined, current]);
  assert.isTrue(completed.every((result) => result.status === 'completed'));
  assert.equal(new Set(completed.map((result) => result.playback!.playbackId)).size, 1);
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('clearLayer stops only waits on that layer', async () => {
  const { player } = fixture();
  const base = player.playAndWait('a');
  const upper = player.playAndWait('b', { layer: 'upper' });
  player.clearLayer('upper');
  assert.equal((await upper).status, 'stopped');
  player.update(100);
  assert.equal((await base).status, 'completed');
});

test('disposal settles all current waits and detaches signal listeners', async () => {
  const { player } = fixture();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const base = player.playAndWait('a', { signal: controller.signal });
  const current = player.waitForPlayback();
  const upper = player.playAndWait('b', { layer: 'upper' });
  player.dispose();
  player.dispose();
  const results = await Promise.all([base, current, upper]);
  assert.isTrue(results.every((result) => result.status === 'disposed'));
  assert.isTrue(results.every((result) => result.playback!.status === 'disposed'));
  assert.equal(remove.mock.calls.length, 1);
  assert.deepEqual(resources(player), [0, 0, 0]);
  await rejects(player.playAndWait('a'), /disposed/);
  await rejects(player.waitForPlayback(), /disposed/);
});

test('unknown and invalid requests reject without disturbing playback or leaving listeners', async () => {
  const { player } = fixture();
  const pending = player.playAndWait('a');
  player.queue('b');
  const before = player.getPlaybackStatus();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  for (const request of [
    player.playAndWait('unknown', { signal: controller.signal }),
    player.playAndWait('b', { speed: -1 }),
    player.playAndWait('b', { fadeDuration: NaN }),
    player.playAndWait('b', { layer: '' }),
    player.waitForPlayback({ layer: 'missing' }),
  ])
    await rejects(request);
  assert.equal(remove.mock.calls.length, 1);
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.equal(player.getQueue().length, 1);
  assert.deepEqual(resources(player), [1, 0, 1]);
  player.update(100);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('infinite loops reject before mutation; loop:false awaits one pass', async () => {
  const { player } = fixture();
  player.play('a');
  player.queue('b');
  const before = player.getPlaybackStatus();
  await rejects(player.playAndWait('loop'), /loop: false/);
  await rejects(player.playAndWait('b', { loop: true }), /indefinitely looping/);
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.equal(player.getQueue().length, 1);
  const once = player.playAndWait('loop', { loop: false });
  player.update(100);
  assert.equal((await once).status, 'completed');
  player.play('loop');
  const looping = player.getPlaybackStatus();
  await rejects(player.waitForPlayback(), /indefinitely looping/);
  await rejects(player.playAndWait('loop', { restart: false, loop: false }), /indefinitely looping/);
  assert.deepEqual(player.getPlaybackStatus(), looping);
  player.stop();
  assert.equal((await player.waitForPlayback()).status, 'stopped');
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('waitForPlayback requires a selected instance and can read held terminal outcomes', async () => {
  const { player } = fixture();
  await rejects(player.waitForPlayback(), /No animation playback/);
  const first = player.playAndWait('a');
  player.update(100);
  assert.deepEqual(await player.waitForPlayback(), await first);
  assert.deepEqual(await player.playAndWait('a', { restart: false }), await first);
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('zero-duration clips retain existing registration validation without starting a wait', async () => {
  const { player } = fixture();
  assert.throws(() => player.addAnimation({ name: 'zero', duration: 0, loop: false, tracks: {} }), /greater than zero/);
  await rejects(player.playAndWait('zero'), /Unknown animation/);
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('pause and zero speed hold waits until controlled updates reach completion', async () => {
  const { player } = fixture();
  player.pause();
  const pending = player.playAndWait('a', { speed: 0.5 });
  let result: PlaybackWaitResult | undefined;
  void pending.then((value) => {
    result = value;
  });
  player.update(1000);
  await Promise.resolve();
  assert.isUndefined(result);
  player.resume();
  player.setSpeed(0);
  player.update(1000);
  assert.equal(player.elapsedTime, 0);
  player.setSpeed(2);
  player.update(100);
  assert.equal((await pending).status, 'completed');
});

test('an end-marker replay cannot steal the completed instance or settle its successor', async () => {
  const { player } = fixture();
  let second: Promise<PlaybackWaitResult> | undefined;
  player.onAnimationEvent((event) => {
    if (event.name === 'end' && !second) second = player.playAndWait('a');
  });
  const first = player.playAndWait('a');
  const firstId = player.getPlaybackStatus()!.playbackId;
  player.update(100);
  assert.equal((await first).playback!.playbackId, firstId);
  const secondId = player.getPlaybackStatus()!.playbackId;
  assert.notEqual(firstId, secondId);
  assert.deepEqual(resources(player), [1, 0, 1]);
  player.update(100);
  assert.equal((await second!).playback!.playbackId, secondId);
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('awaits created in lifecycle callbacks bind before deferred notifications drain', async () => {
  const { player } = fixture();
  let nested: Promise<PlaybackWaitResult> | undefined;
  player.onPlaybackLifecycle((event) => {
    if (event.clip === 'a' && event.type === 'interrupted') nested = player.playAndWait('a');
  });
  const first = player.playAndWait('a');
  const middle = player.playAndWait('b');
  assert.equal((await first).status, 'interrupted');
  assert.equal((await middle).status, 'interrupted');
  player.update(100);
  assert.equal((await nested!).status, 'completed');
});

test.each(['started', 'zero', 'end', 'completed'] as const)(
  'disposal during %s cannot strand or relabel a wait',
  async (phase) => {
    const { player } = fixture();
    player.onPlaybackLifecycle((event) => {
      if (event.type === phase) player.dispose();
    });
    player.onAnimationEvent((event) => {
      if (event.name === phase) player.dispose();
    });
    const pending = player.playAndWait('a');
    if (!player.isDisposed) player.update(100);
    assert.equal((await pending).status, phase === 'end' || phase === 'completed' ? 'completed' : 'disposed');
    assert.deepEqual(resources(player), [0, 0, 0]);
  },
);

test('disposal from an interruption callback preserves both instance outcomes', async () => {
  const { player } = fixture();
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'interrupted') player.dispose();
  });
  const first = player.playAndWait('a');
  const second = player.playAndWait('b');
  assert.equal((await first).status, 'interrupted');
  assert.equal((await second).status, 'disposed');
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('listener failures reject start requests and clean up while preserving committed playback', async () => {
  const { player } = fixture();
  const controller = new AbortController();
  const release = player.onPlaybackLifecycle(() => {
    throw new Error('listener failed');
  });
  await rejects(player.playAndWait('a', { signal: controller.signal }), /listener failed/);
  assert.equal(player.isPlaying, true);
  assert.deepEqual(resources(player), [1, 0, 0]);
  release();
  player.update(100);
  assert.equal((await player.waitForPlayback()).status, 'completed');
});

test('queue advancement stays authoritative and completed waits retain the preceding identity', async () => {
  const { player } = fixture();
  const first = player.playAndWait('a');
  const firstId = player.getPlaybackStatus()!.playbackId;
  player.queue('b');
  player.update(100);
  assert.equal((await first).playback!.playbackId, firstId);
  assert.equal(player.currentAnimation, 'b');
  const second = player.waitForPlayback();
  player.clearQueue();
  player.update(100);
  assert.equal((await second).status, 'completed');
  const replaced = player.playAndWait('a');
  player.replaceQueue([{ name: 'b' }]);
  assert.equal((await replaced).status, 'interrupted');
});

test('state actions can be awaited with one existing controller subscription and no stale return', async () => {
  const { player } = fixture();
  const states = new AnimationStateController(player, {
    initialState: 'idle',
    states: { idle: { animation: 'loop' }, action: { animation: 'a' }, other: { animation: 'b', loop: true } },
  });
  states.playAction('action');
  const completed = player.waitForPlayback();
  player.update(100);
  assert.equal((await completed).status, 'completed');
  assert.equal(player.currentAnimation, 'loop');
  assert.deepEqual(resources(player), [1, 1, 0]);
  states.playAction('action');
  const interrupted = player.waitForPlayback();
  states.setState('other');
  assert.equal((await interrupted).status, 'interrupted');
  assert.equal(states.currentState, 'other');
  assert.equal(player.currentAnimation, 'b');
  const direct = player.playAndWait('a');
  player.update(100);
  assert.equal((await direct).status, 'completed');
  assert.equal(player.currentAnimation, 'a', 'a direct play must not revive an outdated controller state');
  assert.isFalse(states.isActive);
  states.dispose();
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('a queued successor retains priority over an awaited state action return', async () => {
  const { player } = fixture();
  const states = new AnimationStateController(player, {
    initialState: 'idle',
    states: { idle: { animation: 'loop' }, action: { animation: 'a' } },
  });
  states.playAction('action');
  const pending = player.waitForPlayback();
  player.queue('b');
  player.update(100);
  assert.equal((await pending).status, 'completed');
  assert.equal(player.currentAnimation, 'b');
  assert.isFalse(states.isActive);
  states.dispose();
});

test('repeated cancellation/completion cycles release listeners without accumulating stale waits', async () => {
  const { player } = fixture();
  for (let index = 0; index < 30; index++) {
    const controller = new AbortController();
    const pending = player.playAndWait('a', { signal: controller.signal });
    if (index % 2 === 0) controller.abort();
    player.update(100);
    assert.equal((await pending).status, index % 2 === 0 ? 'cancelled' : 'completed');
    assert.deepEqual(resources(player), [0, 0, 0]);
  }
});

test('Puppet awaits synchronize rendering, and destruction settles pending waits safely', async () => {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animations: clips,
  });
  const first = puppet.playAndWait('a');
  assert.equal(puppet.getBone('root').container.x, 10);
  puppet.update(100);
  assert.equal((await first).status, 'completed');
  assert.equal(puppet.getBone('root').container.x, 110);
  assert.deepEqual(await puppet.waitForPlayback(), await first);
  const disposed = puppet.playAndWait('b');
  const root = puppet.getBone('root').container;
  puppet.destroy();
  assert.equal((await disposed).status, 'disposed');
  assert.isTrue(root.isDestroyed);
  assert.isTrue(puppet.container.isDestroyed);
  assert.deepEqual(resources(puppet.animationPlayer), [0, 0, 0]);
  await rejects(puppet.playAndWait('a'), /disposed/);
});

test('an abort from an end marker preserves the already committed completion', async () => {
  const { player } = fixture();
  const controller = new AbortController();
  player.onAnimationEvent((event) => {
    if (event.name === 'end') controller.abort();
  });
  const pending = player.playAndWait('a', { signal: controller.signal });
  player.update(100);
  assert.equal((await pending).status, 'completed');
  assert.deepEqual(resources(player), [0, 0, 0]);
});

test('a preflight start-event budget failure rejects and releases the wait without interruption', async () => {
  const { player } = fixture();
  player.addAnimation({
    name: 'over-budget',
    duration: 100,
    loop: false,
    tracks: {},
    events: Array.from({ length: 10_001 }, () => ({ name: 'zero', time: 0 })),
  });
  const pending = player.playAndWait('a');
  const before = player.getPlaybackStatus();
  await rejects(player.playAndWait('over-budget'), /event/i);
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.deepEqual(resources(player), [1, 0, 1]);
  player.update(100);
  assert.equal((await pending).status, 'completed');
});

test('sequential async application code starts each clip only after successful completion', async () => {
  const { player } = fixture();
  const started: string[] = [];
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'started') started.push(event.clip);
  });
  const sequence = (async () => {
    for (const name of ['a', 'b', 'a']) {
      const result = await player.playAndWait(name);
      if (result.status !== 'completed') return result;
    }
    return undefined;
  })();
  assert.deepEqual(started, ['a']);
  for (let index = 0; index < 3; index++) {
    player.update(100);
    await Promise.resolve();
    assert.equal(started.length, Math.min(index + 2, 3));
  }
  assert.isUndefined(await sequence);
  assert.deepEqual(started, ['a', 'b', 'a']);
  assert.deepEqual(resources(player), [1, 0, 0]);
});

test('Puppet destruction still settles waits when a disposal listener throws', async () => {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animations: clips,
  });
  puppet.onPlaybackLifecycle((event) => {
    if (event.type === 'disposed') throw new Error('dispose listener failed');
  });
  const pending = puppet.playAndWait('a');
  assert.throws(() => puppet.destroy(), /dispose listener failed/);
  assert.equal((await pending).status, 'disposed');
  assert.isTrue(puppet.container.isDestroyed);
  assert.deepEqual(resources(puppet.animationPlayer), [0, 0, 0]);
});
