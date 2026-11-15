import { assert, test, vi } from 'vitest';
import {
  AnimationPlayer,
  Joint,
  type AnimationPlayerOptions,
  type PlaybackLifecycleEvent,
  type PlaybackStatus,
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

function fixture(options?: AnimationPlayerOptions) {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joints = new Map([['root', new Joint('root', rig.getBone('root'))]]);
  const player = new AnimationPlayer(rig, joints, [], options);
  for (const [name, x] of [
    ['a', 0],
    ['b', 100],
    ['c', 200],
  ] as const) {
    player.addAnimation({
      name,
      duration: 100,
      loop: false,
      tracks: {
        root: [
          { time: 0, x },
          { time: 100, x: x + 100 },
        ],
      },
    });
  }
  const events: PlaybackLifecycleEvent[] = [];
  player.onPlaybackLifecycle((event) => events.push(event));
  return { rig, joints, player, events };
}

const types = (events: readonly PlaybackLifecycleEvent[]) => events.map((event) => event.type);
const terminals = (events: readonly PlaybackLifecycleEvent[]) =>
  events.filter((event) => ['completed', 'interrupted', 'stopped', 'disposed'].includes(event.type));

test.each([100, 101, 10_000])('start and exactly one completion at delta %s use the runtime clock', (delta) => {
  const { player, joints, events } = fixture();
  assert.isUndefined(player.getPlaybackStatus());
  const legacy: unknown[] = [];
  player.onAnimationComplete((event) => legacy.push(event));
  player.play('a');
  const started: PlaybackStatus = player.getPlaybackStatus()!;
  assert.deepEqual(started, {
    playbackId: 1,
    clip: 'a',
    layer: 'base',
    status: 'playing',
    elapsedTime: 0,
    duration: 100,
    loop: false,
  });
  player.update(0);
  player.update(25);
  assert.equal(player.getPlaybackStatus()!.elapsedTime, 25);
  player.update(delta - 25);
  assert.equal(joints.get('root')!.pose.x, 100);
  assert.deepEqual(player.getPlaybackStatus(), { ...started, status: 'completed', elapsedTime: 100 });
  player.update(1000);
  player.stop();
  player.pause();
  player.resume();
  player.dispose();
  assert.deepEqual(types(events), ['started', 'completed']);
  assert.deepEqual(legacy, [{ clip: 'a', layer: 'base' }]);
  assert.equal(events[0]!.playbackId, events[1]!.playbackId);
  assert.equal(started.elapsedTime, 0, 'status snapshots must not change with the clock');
});

test('playing the same animation twice identifies and interrupts only the first instance', () => {
  const { player, events } = fixture();
  player.play('a');
  player.update(40);
  player.play('a');
  assert.deepEqual(types(events), ['started', 'interrupted', 'started']);
  assert.equal(events[1]!.elapsedTime, 40);
  assert.equal(events[0]!.playbackId, events[1]!.playbackId);
  assert.notEqual(events[0]!.playbackId, events[2]!.playbackId);
  player.update(100);
  player.play('a', { restart: false });
  assert.equal(player.getPlaybackStatus()!.status, 'completed');
  assert.deepEqual(types(events), ['started', 'interrupted', 'started', 'completed']);
  assert.equal(events[3]!.playbackId, events[2]!.playbackId);
});

test('restart:false preserves active identity, clock, speed and notifications', () => {
  const { player, events } = fixture();
  player.play('a', { speed: 0.5 });
  player.update(40);
  const before = player.getPlaybackStatus();
  player.play('a', { restart: false, speed: 2, fadeDuration: 50 });
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.equal(player.currentAnimationSpeed, 0.5);
  assert.deepEqual(types(events), ['started']);
});

test('pause/resume and speed changes preserve identities and do not complete early', () => {
  const { player, events } = fixture();
  player.play('a', { speed: 0.5 });
  player.update(40);
  player.pause();
  player.pause();
  player.update(10_000);
  assert.equal(player.getPlaybackStatus()!.status, 'paused');
  assert.equal(player.elapsedTime, 20);
  player.resume();
  player.resume();
  player.setSpeed(0);
  player.update(10_000);
  assert.equal(player.getPlaybackStatus()!.status, 'playing');
  assert.equal(player.elapsedTime, 20);
  player.setSpeed(4);
  player.update(39);
  assert.equal(player.elapsedTime, 98);
  player.update(1);
  assert.deepEqual(types(events), ['started', 'paused', 'resumed', 'completed']);
  assert.equal(new Set(events.map((event) => event.playbackId)).size, 1);
});

test('starting while paused reports a paused start and zero clip speed holds completion', () => {
  const { player, events } = fixture();
  player.pause();
  player.play('a', { speed: 0 });
  assert.equal(events[0]!.status, 'paused');
  player.resume();
  player.update(10_000);
  assert.equal(player.elapsedTime, 0);
  player.stop();
  assert.deepEqual(types(events), ['started', 'resumed', 'stopped']);
});

test('indefinite loops preserve marker crossings without final completion', () => {
  const { player, events } = fixture();
  player.addAnimation({
    name: 'loop',
    duration: 100,
    loop: true,
    tracks: {},
    events: [
      { time: 0, name: 'zero' },
      { time: 100, name: 'end' },
    ],
  });
  const markers: string[] = [];
  player.onAnimationEvent((event) => markers.push(event.name));
  player.onAnimationComplete(() => assert.fail('A loop cannot complete'));
  player.play('loop');
  const id = player.getPlaybackStatus()!.playbackId;
  player.update(300);
  player.update(0);
  assert.deepEqual(markers, ['zero', 'zero', 'end', 'zero', 'end', 'zero', 'end']);
  assert.deepEqual(types(events), ['started']);
  assert.equal(player.getPlaybackStatus()!.playbackId, id);
  assert.equal(player.getPlaybackStatus()!.status, 'playing');
  assert.equal(player.elapsedTime, 0);
});

test('zero-duration authored and compiled clips retain validation and cannot disturb live playback', () => {
  const { rig, joints, player, events } = fixture();
  player.play('a');
  const before = player.getPlaybackStatus();
  for (const loop of [false, true]) {
    assert.throws(() => player.addAnimation({ name: 'zero', duration: 0, loop, tracks: {} }), /greater than zero/);
    assert.throws(
      () => new AnimationPlayer(rig, joints, [{ name: 'zero', duration: 0, loop, tracks: [], events: [] }]),
      /greater than zero/,
    );
  }
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.deepEqual(types(events), ['started']);
});

test('invalid playback requests do not interrupt, change identity or dispatch lifecycle', () => {
  const { player, events } = fixture();
  player.play('a');
  const before = player.getPlaybackStatus();
  for (const command of [
    () => player.play('unknown'),
    () => player.play('b', { speed: -1 }),
    () => player.play('b', { fadeDuration: NaN }),
    () => player.play('b', { layer: '' }),
    () => player.update(Infinity),
  ])
    assert.throws(command);
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.deepEqual(types(events), ['started']);
});

test('crossfade interrupts at replacement while the source keeps advancing visually', () => {
  const { player, joints, events } = fixture();
  player.play('a');
  player.update(25);
  player.play('b', { fadeDuration: 100 });
  assert.equal(joints.get('root')!.pose.x, 25);
  assert.deepEqual(types(events), ['started', 'interrupted', 'started']);
  player.update(25);
  assert.equal(joints.get('root')!.pose.x, 68.75);
  player.pause();
  player.update(1000);
  assert.equal(player.transition!.progress, 0.25);
  player.resume();
  const held = joints.get('root')!.pose.x;
  player.play('c', { fadeDuration: 100 });
  assert.equal(joints.get('root')!.pose.x, held, 'replacing an in-progress fade must not snap');
  player.update(100);
  assert.deepEqual(
    terminals(events).map((event) => [event.clip, event.type]),
    [
      ['a', 'interrupted'],
      ['b', 'interrupted'],
      ['c', 'completed'],
    ],
  );
  assert.isUndefined(player.transition);
  assert.equal(joints.get('root')!.pose.x, 300);
});

test('target completion during a longer fade stays final when the visual fade finishes', () => {
  const { player, events } = fixture();
  player.play('a');
  player.play('b', { fadeDuration: 200 });
  player.update(100);
  assert.equal(player.getPlaybackStatus()!.status, 'completed');
  assert.equal(player.transition!.progress, 0.5);
  player.update(100);
  player.stop();
  player.dispose();
  assert.deepEqual(
    terminals(events).map((event) => [event.clip, event.type]),
    [
      ['a', 'interrupted'],
      ['b', 'completed'],
    ],
  );
});

test('layers have independent identities and finish even when masked or weighted to zero', () => {
  const { player, events } = fixture();
  player.play('a');
  player.setLayerMask('upper', []);
  player.setLayerWeight('upper', 0);
  player.play('a', { layer: 'upper', speed: 2 });
  assert.notEqual(player.getPlaybackStatus()!.playbackId, player.getPlaybackStatus('upper')!.playbackId);
  player.update(50);
  assert.equal(player.getPlaybackStatus()!.status, 'playing');
  assert.equal(player.getPlaybackStatus('upper')!.status, 'completed');
  player.clearLayer('upper');
  assert.isUndefined(player.getPlaybackStatus('upper'));
  player.play('b', { layer: 'upper' });
  player.clearLayer('upper');
  player.clearAllLayers();
  player.clearAllLayers();
  assert.isUndefined(player.getPlaybackStatus());
  assert.deepEqual(
    terminals(events).map((event) => [event.clip, event.layer, event.type]),
    [
      ['a', 'upper', 'completed'],
      ['b', 'upper', 'stopped'],
      ['a', 'base', 'stopped'],
    ],
  );
});

test('restart assigns new identities to all selected layers and preserves pause and clip speeds', () => {
  const { player, events } = fixture();
  player.play('a', { speed: 2 });
  player.play('b', { layer: 'upper' });
  player.update(50);
  player.pause();
  const base = player.getPlaybackStatus()!;
  const upper = player.getPlaybackStatus('upper')!;
  player.restart();
  assert.notEqual(player.getPlaybackStatus()!.playbackId, base.playbackId);
  assert.notEqual(player.getPlaybackStatus('upper')!.playbackId, upper.playbackId);
  assert.equal(player.getPlaybackStatus()!.status, 'paused');
  assert.equal(player.getPlaybackStatus('upper')!.status, 'paused');
  assert.equal(player.currentAnimationSpeed, 2);
  assert.equal(player.elapsedTime, 0);
  player.resume();
  player.update(100);
  assert.deepEqual(
    terminals(events).map((event) => [event.clip, event.type]),
    [
      ['a', 'completed'],
      ['b', 'interrupted'],
      ['a', 'completed'],
      ['b', 'completed'],
    ],
  );
});

test('explicit stop is terminal once and resume cannot revive stopped playback', () => {
  const { player, events } = fixture();
  player.play('a');
  player.play('b', { layer: 'upper' });
  player.update(20);
  player.pause();
  player.stop();
  player.stop();
  player.resume();
  player.update(1000);
  assert.equal(player.getPlaybackStatus()!.status, 'stopped');
  assert.equal(player.elapsedTime, 20);
  player.dispose();
  assert.deepEqual(
    terminals(events).map((event) => [event.clip, event.type]),
    [
      ['a', 'stopped'],
      ['b', 'stopped'],
    ],
  );
});

test('disposal terminates every active layer once and releases listeners and playback state', () => {
  const { player, events } = fixture();
  player.play('a');
  player.play('b', { layer: 'upper', fadeDuration: 100 });
  player.pause();
  const remove = player.onPlaybackLifecycle(() => {});
  player.dispose();
  player.dispose();
  remove();
  player.update(1000);
  assert.isUndefined(player.getPlaybackStatus());
  assert.isUndefined(player.getPlaybackStatus('upper'));
  assert.throws(() => player.onPlaybackLifecycle(() => {}), /disposed/);
  assert.deepEqual(
    terminals(events).map((event) => [event.clip, event.type]),
    [
      ['a', 'disposed'],
      ['b', 'disposed'],
    ],
  );
});

test('lifecycle listeners use stable snapshots, removable subscriptions and independent payloads', () => {
  const { player } = fixture();
  const calls: string[] = [];
  const late = () => calls.push('late');
  let remove = () => {};
  const first = player.onPlaybackLifecycle((event) => {
    calls.push('first');
    remove();
    player.onPlaybackLifecycle(late);
    Reflect.set(event, 'clip', 'changed');
  });
  remove = player.onPlaybackLifecycle((event) => {
    calls.push(event.clip);
  });
  player.play('a');
  assert.deepEqual(calls, ['first', 'a']);
  first();
  player.update(100);
  assert.deepEqual(calls, ['first', 'a', 'late']);
  assert.equal(player.getPlaybackStatus()!.clip, 'a');
});

test('authored markers keep their order and observe final synchronized poses before completion', () => {
  const order: string[] = [];
  const syncLabels = ['sync-start', 'sync-end'];
  let syncCalls = 0;
  const { player, joints } = fixture({
    poseHooks: {
      synchronize: () => order.push(syncLabels[syncCalls++] ?? 'sync'),
    },
  });
  player.addAnimation({
    name: 'markers',
    duration: 100,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 100, x: 100 },
      ],
    },
    events: [
      { time: 100, name: 'end' },
      { time: 0, name: 'zero' },
      { time: 50, name: 'mid' },
    ],
  });
  player.onPlaybackLifecycle((event) => order.push(event.type));
  player.onAnimationEvent((event) => {
    order.push(event.name);
    assert.equal(joints.get('root')!.pose.x, event.time === 0 ? 0 : 100);
  });
  player.onAnimationComplete(() => order.push('legacy'));
  player.play('markers');
  player.update(1000);
  assert.deepEqual(order, ['sync-start', 'started', 'zero', 'sync-end', 'mid', 'end', 'completed', 'legacy']);
});

test('reentrant replacement keeps start and terminal notifications in playback order', () => {
  const { player, events } = fixture();
  player.onPlaybackLifecycle((event) => {
    if (event.clip === 'a' && event.type === 'interrupted') player.play('c');
  });
  player.play('a');
  player.play('b');
  player.update(100);
  assert.deepEqual(
    events.map((event) => [event.clip, event.type]),
    [
      ['a', 'started'],
      ['a', 'interrupted'],
      ['b', 'started'],
      ['b', 'interrupted'],
      ['c', 'started'],
      ['c', 'completed'],
    ],
  );
  assert.equal(new Set(terminals(events).map((event) => event.playbackId)).size, 3);
});

test('a same-clip start from an end marker cannot steal the old completion identity', () => {
  const { player, events } = fixture();
  player.addAnimation({
    name: 'marker',
    duration: 100,
    loop: false,
    tracks: {},
    events: [{ time: 100, name: 'end' }],
  });
  let restarted = false;
  player.onAnimationEvent(() => {
    if (!restarted) {
      restarted = true;
      player.play('marker');
    }
  });
  player.play('marker');
  player.update(100);
  assert.deepEqual(
    events.map((event) => [event.playbackId, event.type]),
    [
      [1, 'started'],
      [2, 'started'],
      [1, 'completed'],
    ],
  );
  assert.equal(player.getPlaybackStatus()!.status, 'playing');
  player.update(100);
  assert.deepEqual(
    terminals(events).map((event) => event.playbackId),
    [1, 2],
  );
});

test('authored callbacks retain synchronous nested start markers before remaining crossings', () => {
  const { player } = fixture();
  player.addAnimation({
    name: 'old',
    duration: 100,
    loop: false,
    tracks: {},
    events: [
      { time: 25, name: 'replace' },
      { time: 50, name: 'remaining' },
    ],
  });
  player.addAnimation({
    name: 'new',
    duration: 100,
    loop: false,
    tracks: {},
    events: [{ time: 0, name: 'new-zero' }],
  });
  const calls: string[] = [];
  player.onAnimationEvent((event) => {
    calls.push(event.name);
    if (event.name === 'replace') {
      player.play('new');
      calls.push('play-returned');
    }
  });
  player.onAnimationComplete(() => calls.push('old-complete'));
  player.play('old');
  player.update(100);
  assert.deepEqual(calls, ['replace', 'new-zero', 'play-returned', 'remaining', 'old-complete']);
});

test('unsubscribing during disposal affects subsequent layers and clears retained listener snapshots', () => {
  const { player } = fixture();
  player.play('a');
  player.play('b', { layer: 'upper' });
  const calls: string[] = [];
  let off = () => {};
  off = player.onPlaybackLifecycle((event) => {
    calls.push(event.layer);
    off();
  });
  player.dispose();
  assert.deepEqual(calls, ['base']);
  assert.doesNotThrow(off);
});

test('disposal listener failures aggregate after every active layer receives its outcome', () => {
  const { player, events } = fixture();
  player.play('a');
  player.play('b', { layer: 'upper' });
  const failure = new Error('dispose failed');
  player.onPlaybackLifecycle(() => {
    throw failure;
  });
  let thrown: unknown;
  try {
    player.dispose();
  } catch (error) {
    thrown = error;
  }
  assert.instanceOf(thrown, AggregateError);
  assert.deepEqual(thrown.errors, [failure, failure]);
  assert.deepEqual(
    terminals(events).map((event) => event.layer),
    ['base', 'upper'],
  );
  assert.isTrue(player.isDisposed);
  assert.doesNotThrow(() => player.dispose());
});

test('Puppet layer clearing synchronizes rendering before its stopped notification', () => {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animations: [{ name: 'overlay', duration: 100, loop: false, tracks: { root: [{ time: 0, x: 100 }] } }],
  });
  puppet.play('overlay', { layer: 'upper' });
  assert.equal(puppet.getBone('root').container.x, 100);
  const observed: string[] = [];
  puppet.onPlaybackLifecycle((event) => {
    observed.push(event.type);
    assert.equal(puppet.getBone('root').container.x, 0);
    assert.isUndefined(puppet.getPlaybackStatus('upper'));
  });
  puppet.clearLayer('upper');
  assert.deepEqual(observed, ['stopped']);
  puppet.destroy();
});

test('listener failures finish lifecycle, authored and legacy delivery before being rethrown', () => {
  const { player, events } = fixture();
  const failure = new Error('lifecycle failed');
  player.addAnimation({
    name: 'marker',
    duration: 100,
    loop: false,
    tracks: {},
    events: [{ time: 0, name: 'zero' }],
  });
  player.onPlaybackLifecycle(() => {
    throw failure;
  });
  const marker = vi.fn();
  const complete = vi.fn();
  player.onAnimationEvent(marker);
  player.onAnimationComplete(complete);
  assert.throws(() => player.play('marker'), 'lifecycle failed');
  assert.equal(marker.mock.calls.length, 1);
  assert.throws(() => player.update(100), 'lifecycle failed');
  assert.equal(complete.mock.calls.length, 1);
  assert.deepEqual(types(events), ['started', 'completed']);
  assert.doesNotThrow(() => player.update(100));
});

test('disposal from a started callback cancels stale markers and delivers the disposed outcome', () => {
  const { player, events } = fixture();
  player.addAnimation({
    name: 'marker',
    duration: 100,
    loop: false,
    tracks: {},
    events: [{ time: 0, name: 'zero' }],
  });
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'started') player.dispose();
  });
  player.onAnimationEvent(() => assert.fail('Stale authored event'));
  player.onAnimationComplete(() => assert.fail('Stale completion'));
  player.play('marker');
  player.update(100);
  assert.deepEqual(types(events), ['started', 'disposed']);
});

test('Puppet exposes synchronized lifecycle and completes destruction despite listener failures', () => {
  const scene = puppetScene();
  const puppet = new Puppet(scene, {
    autoUpdate: false,
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animations: [
      {
        name: 'a',
        duration: 100,
        loop: false,
        tracks: {
          root: [
            { time: 0, x: 10 },
            { time: 100, x: 110 },
          ],
        },
      },
    ],
  });
  const events: PlaybackLifecycleEvent[] = [];
  const root = puppet.getBone('root').container;
  const off = puppet.onPlaybackLifecycle((event) => {
    events.push(event);
    if (event.type === 'started') assert.equal(root.x, 10);
    if (event.type === 'completed') assert.equal(root.x, 110);
    if (event.type === 'disposed') {
      assert.isTrue(puppet.isDestroyed);
      throw new Error('disposed callback failed');
    }
  });
  assert.strictEqual(puppet.play('a'), puppet);
  assert.deepEqual(puppet.getPlaybackStatus(), puppet.posePipeline.player.getPlaybackStatus());
  puppet.update(100);
  puppet.restart();
  assert.throws(() => puppet.destroy(), 'disposed callback failed');
  assert.isTrue(puppet.container.isDestroyed);
  assert.isTrue(root.isDestroyed);
  assert.isTrue(puppet.posePipeline.player.isDisposed);
  assert.throws(() => puppet.getBone('root'), /Unknown bone/);
  assert.isUndefined(puppet.getPlaybackStatus());
  assert.doesNotThrow(off);
  assert.doesNotThrow(() => puppet.destroy());
  puppet.update(1000);
  assert.deepEqual(types(events), ['started', 'completed', 'started', 'disposed']);
});
