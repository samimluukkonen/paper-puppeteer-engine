import { assert, test, vi } from 'vitest';
import {
  type AnimationClip,
  AnimationPlayer,
  type AnimationQueueRequest,
  Joint,
  type PlaybackLifecycleEvent,
  type QueueAnimationOptions,
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

const clips: AnimationClip[] = ['a', 'b', 'c', 'loop'].map((name, index) => ({
  name,
  duration: 100,
  loop: name === 'loop',
  tracks: {
    root: [
      { time: 0, x: index * 200 },
      { time: 100, x: index * 200 + 100 },
    ],
  },
  events: [
    { time: 0, name: `${name}-zero` },
    { time: 100, name: `${name}-end` },
  ],
}));

function fixture() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joints = new Map([['root', new Joint('root', rig.getBone('root'))]]);
  const player = new AnimationPlayer(rig, joints);
  for (const clip of clips) player.addAnimation(clip);
  const lifecycle: PlaybackLifecycleEvent[] = [];
  player.onPlaybackLifecycle((event) => lifecycle.push(event));
  return { player, joints, lifecycle };
}
const pending = (player: AnimationPlayer) => player.getQueue().map((request) => request.name);
const starts = (events: readonly PlaybackLifecycleEvent[]) =>
  events.filter((event) => event.type === 'started').map((event) => event.clip);

test('one idle request starts immediately and completes exactly once', () => {
  const { player, joints, lifecycle } = fixture();
  player.queue('a');
  assert.equal(player.currentAnimation, 'a');
  assert.equal(joints.get('root')!.pose.x, 0);
  assert.deepEqual(pending(player), []);
  player.update(100);
  player.update(1000);
  assert.deepEqual(
    lifecycle.map((event) => event.type),
    ['started', 'completed'],
  );
  assert.equal(player.getPlaybackStatus()!.status, 'completed');
});

test('multiple requests execute FIFO, including repeated names and queueing behind ordinary play', () => {
  const { player, lifecycle } = fixture();
  player.play('a');
  player.update(40);
  const active = player.getPlaybackStatus();
  player.queue('b');
  player.queue('c');
  player.queue('c');
  assert.deepEqual(player.getPlaybackStatus(), active);
  assert.deepEqual(pending(player), ['b', 'c', 'c']);
  for (const name of ['b', 'c', 'c']) {
    player.update(100);
    assert.equal(player.currentAnimation, name);
    assert.equal(player.elapsedTime, 0);
  }
  player.update(100);
  assert.deepEqual(starts(lifecycle), ['a', 'b', 'c', 'c']);
  assert.equal(new Set(lifecycle.filter((event) => event.type === 'started').map((event) => event.playbackId)).size, 4);
  assert.equal(lifecycle.filter((event) => event.type === 'completed').length, 4);
});

test.each(['completed', 'stopped'] as const)(
  'queueing after a held %s selection starts a fresh instance',
  (outcome) => {
    const { player, lifecycle } = fixture();
    player.play('a');
    if (outcome === 'completed') player.update(100);
    else player.stop();
    const previous = player.getPlaybackStatus()!.playbackId;
    player.queue('a');
    assert.notEqual(player.getPlaybackStatus()!.playbackId, previous);
    assert.deepEqual(starts(lifecycle), ['a', 'a']);
  },
);

test('queue options and inspection snapshots are immutable and owned', () => {
  const { player } = fixture();
  const options = { speed: 2, fadeDuration: 25 };
  player.queue('a');
  player.queue('b', options);
  const snapshot = player.getQueue();
  options.speed = 10;
  options.fadeDuration = 0;
  assert.isTrue(Object.isFrozen(snapshot));
  assert.isTrue(Object.isFrozen(snapshot[0]));
  assert.isTrue(Object.isFrozen(snapshot[0]!.options));
  assert.deepEqual(snapshot, [{ name: 'b', options: { speed: 2, fadeDuration: 25 } }]);
  player.queue('c');
  assert.equal(snapshot.length, 1);
  player.update(100);
  assert.equal(player.currentAnimationSpeed, 2);
  assert.equal(player.transition!.to, 'b');
  player.update(50);
  assert.equal(player.currentAnimation, 'c');
});

test('looping requests and queueing behind an active loop fail without changing playback', () => {
  const { player, lifecycle } = fixture();
  player.queue('a');
  player.queue('b');
  assert.throws(() => player.queue('loop'), /indefinitely looping/);
  assert.throws(() => player.replaceQueue([{ name: 'c' }, { name: 'loop' }]), /indefinitely looping/);
  assert.deepEqual(pending(player), ['b']);
  assert.deepEqual(starts(lifecycle), ['a']);
  player.play('loop');
  player.pause();
  const before = player.getPlaybackStatus();
  assert.throws(() => player.queue('a'), /behind an indefinitely looping/);
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.deepEqual(pending(player), []);
  player.replaceQueue([{ name: 'b' }, { name: 'c' }]);
  assert.equal(player.currentAnimation, 'b');
  assert.equal(player.getPlaybackStatus()!.status, 'paused');
  player.stopQueue();
  player.play('loop');
  player.stopQueue();
  assert.doesNotThrow(() => player.queue('a'));
});

test.each([
  ['missing', {}],
  ['a', { speed: -1 }],
  ['a', { speed: NaN }],
  ['a', { speed: Infinity }],
  ['a', { speed: null }],
  ['a', { fadeDuration: -1 }],
  ['a', { fadeDuration: Infinity }],
  ['a', { fadeDuration: '10' }],
  ['a', { restart: false }],
  ['a', { layer: 'upper' }],
  ['a', null],
  ['a', []],
] as const)('invalid queue request %s %j preserves the active and pending requests', (name, options) => {
  const { player, lifecycle } = fixture();
  player.queue('a');
  player.queue('b');
  const before = player.getPlaybackStatus();
  const invalid = options as unknown as QueueAnimationOptions;
  assert.throws(() => player.queue(name, invalid));
  assert.throws(() => player.replaceQueue([{ name: 'c' }, { name, options: invalid }]));
  assert.deepEqual(player.getPlaybackStatus(), before);
  assert.deepEqual(pending(player), ['b']);
  assert.deepEqual(starts(lifecycle), ['a']);
});

test('invalid direct plays also preserve pending requests', () => {
  const { player } = fixture();
  player.queue('a');
  player.queue('b');
  assert.throws(() => player.play('missing'));
  assert.throws(() => player.play('c', { speed: -1 }));
  assert.deepEqual(pending(player), ['b']);
  player.update(100);
  assert.equal(player.currentAnimation, 'b');
});

test('clear discards pending requests while the active clip completes normally', () => {
  const { player, lifecycle } = fixture();
  player.queue('a');
  player.queue('b');
  player.clearQueue();
  player.update(100);
  assert.equal(player.getPlaybackStatus()!.status, 'completed');
  assert.deepEqual(starts(lifecycle), ['a']);
  assert.deepEqual(pending(player), []);
});

test.each(['stop', 'stopQueue', 'clearAllLayers', 'restart'] as const)(
  '%s cancels obsolete pending requests',
  (command) => {
    const { player, lifecycle } = fixture();
    player.queue('a');
    player.queue('b');
    player[command]();
    player.resume();
    player.update(1000);
    assert.deepEqual(pending(player), []);
    assert.notInclude(starts(lifecycle), 'b');
  },
);

test.each([true, false])('ordinary base play cancels pending requests with restart %s', (restart) => {
  const { player, lifecycle } = fixture();
  player.queue('a');
  player.queue('b');
  player.play('a', { restart });
  player.update(100);
  assert.deepEqual(pending(player), []);
  assert.notInclude(starts(lifecycle), 'b');
});

test('replaceQueue atomically interrupts the base and replaces pending requests', () => {
  const { player, lifecycle } = fixture();
  player.queue('a');
  player.queue('b');
  player.update(20);
  const replacement: AnimationQueueRequest[] = [{ name: 'c', options: { speed: 2 } }, { name: 'a' }];
  player.replaceQueue(replacement);
  replacement[1] = { name: 'missing' };
  assert.deepEqual(
    lifecycle.map((event) => `${event.clip}:${event.type}`),
    ['a:started', 'a:interrupted', 'c:started'],
  );
  assert.deepEqual(pending(player), ['a']);
  player.update(50);
  assert.equal(player.currentAnimation, 'a');
  player.replaceQueue([]);
  player.update(1000);
  assert.equal(player.getPlaybackStatus()!.status, 'stopped');
  assert.deepEqual(pending(player), []);
});

test('queued fades begin at natural completion and reuse the final pose as their source', () => {
  const { player, joints, lifecycle } = fixture();
  player.queue('a');
  player.queue('b', { fadeDuration: 100 });
  player.update(99);
  assert.isUndefined(player.transition);
  assert.equal(player.currentAnimation, 'a');
  player.update(1);
  assert.deepEqual(player.transition, { from: 'a', to: 'b', progress: 0 });
  assert.equal(joints.get('root')!.pose.x, 100);
  player.update(50);
  assert.equal(joints.get('root')!.pose.x, 175);
  assert.equal(player.transition!.progress, 0.5);
  player.update(50);
  assert.isUndefined(player.transition);
  assert.equal(joints.get('root')!.pose.x, 300);
  assert.deepEqual(
    lifecycle.map((event) => event.type),
    ['started', 'completed', 'started', 'completed'],
  );
});

test('a queued replacement during an unfinished fade retains the blended pose', () => {
  const { player, joints } = fixture();
  player.queue('a');
  player.queue('b', { fadeDuration: 200 });
  player.queue('c', { fadeDuration: 100 });
  player.update(100);
  player.update(100);
  assert.equal(player.currentAnimation, 'c');
  assert.equal(player.transition!.from, 'previous pose');
  assert.equal(joints.get('root')!.pose.x, 200);
  player.update(50);
  assert.equal(joints.get('root')!.pose.x, 325);
});

test('authored endpoint, lifecycle completion and legacy completion precede the next start', () => {
  const { player } = fixture();
  const calls: string[] = [];
  player.onPlaybackLifecycle((event) => calls.push(`${event.clip}-${event.type}`));
  player.onAnimationEvent((event) => calls.push(event.name));
  player.onAnimationComplete((event) => calls.push(`${event.clip}-legacy`));
  player.queue('a');
  player.queue('b');
  player.update(100);
  assert.deepEqual(calls, ['a-started', 'a-zero', 'a-end', 'a-completed', 'a-legacy', 'b-started', 'b-zero']);
});

test.each(['marker', 'lifecycle', 'legacy'] as const)(
  'a %s callback can replace playback without reviving the old queue',
  (kind) => {
    const { player, lifecycle } = fixture();
    const replace = () => player.play('c');
    if (kind === 'marker')
      player.onAnimationEvent((event) => {
        if (event.name === 'a-end') replace();
      });
    if (kind === 'lifecycle')
      player.onPlaybackLifecycle((event) => {
        if (event.clip === 'a' && event.type === 'completed') replace();
      });
    if (kind === 'legacy')
      player.onAnimationComplete((event) => {
        if (event.clip === 'a') replace();
      });
    player.queue('a');
    player.queue('b');
    player.update(100);
    player.update(100);
    assert.deepEqual(starts(lifecycle), ['a', 'c']);
    assert.deepEqual(pending(player), []);
  },
);

test('queueing from endpoint callbacks waits for the boundary and cannot start twice', () => {
  const { player, lifecycle } = fixture();
  const calls: string[] = [];
  player.onAnimationEvent((event) => {
    if (event.name === 'a-end') {
      player.queue('c');
      calls.push(player.currentAnimation!);
    }
  });
  player.onPlaybackLifecycle((event) => {
    if (event.clip === 'a' && event.type === 'completed') {
      player.queue('b');
      calls.push(player.currentAnimation!);
    }
  });
  player.queue('a');
  player.queue('b');
  player.update(100);
  assert.deepEqual(calls, ['a', 'a']);
  assert.deepEqual(starts(lifecycle), ['a', 'b']);
  assert.deepEqual(pending(player), ['c', 'b']);
  player.update(0);
  assert.deepEqual(starts(lifecycle), ['a', 'b']);
});

test('clear and replace from completion callbacks invalidate scheduled advancement', () => {
  const { player, lifecycle } = fixture();
  player.onPlaybackLifecycle((event) => {
    if (event.clip === 'a' && event.type === 'completed') {
      player.clearQueue();
      player.queue('c');
    }
  });
  player.queue('a');
  player.queue('b');
  player.update(100);
  assert.deepEqual(starts(lifecycle), ['a', 'c']);
  assert.deepEqual(pending(player), []);
});

test('listener errors are reported after delivery and queue advancement', () => {
  const { player, lifecycle } = fixture();
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'completed') throw new Error('listener failed');
  });
  player.queue('a');
  player.queue('b');
  assert.throws(() => player.update(100), /listener failed/);
  assert.deepEqual(starts(lifecycle), ['a', 'b']);
  assert.equal(player.getPlaybackStatus()!.status, 'playing');
});

test.each([100, 10000])('delta %s starts only one successor at time zero without carrying overshoot', (delta) => {
  const { player, lifecycle } = fixture();
  player.queue('a');
  player.queue('b');
  player.queue('c');
  player.update(delta);
  assert.equal(player.elapsedTime, 0);
  assert.equal(player.currentAnimation, 'b');
  assert.deepEqual(pending(player), ['c']);
  player.update(0);
  assert.deepEqual(starts(lifecycle), ['a', 'b']);
});

test('pause, zero speeds and stepped presentation retain the existing clock semantics', () => {
  const { player } = fixture();
  player.pause();
  player.queue('a', { speed: 0 });
  player.queue('b', { speed: 2 });
  assert.equal(player.getPlaybackStatus()!.status, 'paused');
  player.update(1000);
  player.resume();
  player.update(1000);
  assert.equal(player.elapsedTime, 0);
  player.replaceQueue([{ name: 'a', options: { speed: 2 } }, { name: 'b' }]);
  player.setPlaybackMode({ mode: 'stepped', fps: 1 });
  player.setSpeed(0);
  player.update(1000);
  assert.equal(player.elapsedTime, 0);
  player.setSpeed(2);
  player.update(24);
  assert.equal(player.elapsedTime, 96);
  player.update(1);
  assert.equal(player.currentAnimation, 'b');
  assert.equal(player.elapsedTime, 0);
});

test('overlay playback, masks, weights and clearing are independent of the base queue', () => {
  const { player } = fixture();
  player.queue('a');
  player.queue('b');
  player.setLayerMask('upper', ['root']);
  player.setLayerWeight('upper', 0.5);
  player.play('loop', { layer: 'upper' });
  const overlayId = player.getPlaybackStatus('upper')!.playbackId;
  player.update(100);
  assert.equal(player.currentAnimation, 'b');
  assert.equal(player.getPlaybackStatus('upper')!.playbackId, overlayId);
  player.queue('c');
  player.stopQueue();
  player.update(25);
  assert.equal(player.elapsedTime, 0);
  assert.equal(player.getPlaybackStatus('upper')!.elapsedTime, 25);
  assert.equal(player.getLayerWeight('upper'), 0.5);
  player.queue('a');
  player.queue('c');
  player.clearLayer('upper');
  assert.deepEqual(pending(player), ['c']);
  player.update(100);
  assert.equal(player.currentAnimation, 'c');
});

test.each(['marker', 'lifecycle', 'legacy'] as const)(
  'disposal from %s cancels pending starts and notifications',
  (kind) => {
    const { player, lifecycle } = fixture();
    if (kind === 'marker')
      player.onAnimationEvent((event) => {
        if (event.name === 'a-end') player.dispose();
      });
    if (kind === 'lifecycle')
      player.onPlaybackLifecycle((event) => {
        if (event.type === 'completed') player.dispose();
      });
    if (kind === 'legacy') player.onAnimationComplete(() => player.dispose());
    player.queue('a');
    player.queue('b');
    player.update(100);
    assert.deepEqual(starts(lifecycle), ['a']);
    assert.deepEqual(pending(player), []);
    assert.isFalse(player.update(100));
    assert.throws(() => player.queue('c'), /disposed/);
    assert.throws(() => player.replaceQueue([{ name: 'c' }]), /disposed/);
    assert.throws(() => player.clearQueue(), /disposed/);
    assert.throws(() => player.stopQueue(), /disposed/);
  },
);

test('Puppet queue starts and successors synchronize rendering before notifications and clean up on destroy', () => {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animations: clips,
  });
  const root = puppet.getBone('root').container;
  const observed: string[] = [];
  puppet.onPlaybackLifecycle((event) => {
    if (event.layer !== 'base') return;
    observed.push(`${event.clip}:${event.type}`);
    if (event.type === 'started') assert.equal(root.x, event.clip === 'a' ? 0 : 200);
    if (event.type === 'completed' && event.clip === 'a') assert.equal(root.x, 100);
  });
  assert.strictEqual(puppet.queue('a').queue('b'), puppet);
  assert.equal(puppet.getQueue()[0]!.name, 'b');
  puppet.update(100);
  assert.equal(root.x, 200);
  assert.strictEqual(puppet.clearQueue(), puppet);
  assert.strictEqual(puppet.stopQueue(), puppet);
  assert.strictEqual(puppet.replaceQueue([{ name: 'a' }, { name: 'b' }]), puppet);
  puppet.destroy();
  assert.deepEqual(puppet.getQueue(), []);
  assert.isTrue(root.isDestroyed);
  assert.throws(() => puppet.queue('a'), /disposed/);
  assert.deepEqual(observed, ['a:started', 'a:completed', 'b:started', 'b:stopped', 'a:started', 'a:disposed']);
});

const sparseRequests: AnimationQueueRequest[] = [];
sparseRequests.length = 2;
test.each([null, {}, [null], [{}], [{ name: 'b', extra: true }], sparseRequests])(
  'malformed replacement %j rejects before changing the queue',
  (requests) => {
    const { player } = fixture();
    player.queue('a');
    player.queue('c');
    const before = player.getPlaybackStatus();
    assert.throws(() => player.replaceQueue(requests as unknown as readonly AnimationQueueRequest[]));
    assert.deepEqual(player.getPlaybackStatus(), before);
    assert.deepEqual(pending(player), ['c']);
  },
);

test('replacement crossfade starts immediately and preserves the input options snapshot', () => {
  const { player, joints } = fixture();
  player.queue('a');
  player.queue('c');
  player.update(40);
  const options = { fadeDuration: 100, speed: 2 };
  player.replaceQueue([
    { name: 'b', options },
    { name: 'a', options },
  ]);
  options.fadeDuration = 0;
  options.speed = 0;
  assert.equal(joints.get('root')!.pose.x, 40);
  assert.deepEqual(player.transition, { from: 'a', to: 'b', progress: 0 });
  player.update(50);
  assert.equal(player.currentAnimation, 'a');
  assert.equal(player.currentAnimationSpeed, 2);
  assert.equal(player.transition!.progress, 0);
  assert.isAbove(joints.get('root')!.pose.x, 40);
});

test.each(['clearQueue', 'stopQueue', 'stop', 'restart', 'clearAllLayers'] as const)(
  '%s from completion prevents the already scheduled successor',
  (command) => {
    const { player, lifecycle } = fixture();
    player.onPlaybackLifecycle((event) => {
      if (event.type === 'completed' && event.clip === 'a') player[command]();
    });
    player.queue('a');
    player.queue('b');
    player.update(100);
    assert.deepEqual(pending(player), []);
    assert.notInclude(starts(lifecycle), 'b');
  },
);

test('nested updates from lifecycle listeners still start each queued instance once', () => {
  const { player, lifecycle } = fixture();
  player.onPlaybackLifecycle((event) => {
    if (event.type === 'started' && event.clip === 'b') player.update(100);
  });
  player.queue('a');
  player.queue('b');
  player.queue('c');
  player.update(100);
  assert.deepEqual(starts(lifecycle), ['a', 'b', 'c']);
  assert.deepEqual(
    lifecycle.filter((event) => event.type === 'completed').map((event) => event.clip),
    ['a', 'b'],
  );
  assert.equal(player.currentAnimation, 'c');
  assert.equal(player.elapsedTime, 0);
});
