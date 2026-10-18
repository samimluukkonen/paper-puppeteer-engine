import { assert, test, vi } from 'vitest';
import { AnimationPlayer, Joint, Rig, type PlaybackLifecycleEvent } from '../src/engine/core.js';
import { Puppet } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const player = new AnimationPlayer(rig, new Map([['root', new Joint('root', rig.getBone('root'))]]));
  for (const name of ['a', 'b'])
    player.addAnimation({ name, duration: 100, loop: false, tracks: {}, events: [{ time: 100, name: 'end' }] });
  return player;
}

test('a failing IK provider still settles completed waits and advances queued playback', async () => {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: {
      root: 'root',
      bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 20 }, { id: 'end', parent: 'middle', y: 20 }],
    },
    ik: [{ name: 'arm', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
    animations: ['a', 'b'].map((name) => ({ name, duration: 100, loop: false, tracks: {} })),
  });
  try {
    const waiting = puppet.playAndWait('a');
    puppet.queue('b');
    const providerFailure = new Error('provider failed');
    let calls = 0;
    puppet.getIK('arm').setTargetProvider(() => {
      if (++calls === 1) throw providerFailure;
      return undefined;
    });
    assert.throws(() => puppet.update(100), /provider failed/);
    assert.equal((await waiting).status, 'completed');
    assert.equal(puppet.currentAnimation, 'b');
    assert.equal(puppet.getQueue().length, 0);
    const successor = puppet.waitForPlayback();
    puppet.update(100);
    assert.equal((await successor).status, 'completed');
  } finally {
    puppet.destroy();
  }
});

test.each(['replace', 'restart', 'clear'] as const)(
  '%s settles the outgoing wait despite a synchronization failure',
  async (operation) => {
    const player = fixture();
    const layer = operation === 'clear' ? 'overlay' : 'base';
    const waiting = player.playAndWait('a', { layer });
    const failure = new Error('synchronization failed');
    const synchronize = (): void => {
      throw failure;
    };
    try {
      assert.throws(() => {
        if (operation === 'replace') player.play('b', {}, undefined, synchronize);
        else if (operation === 'restart') player.restart(undefined, synchronize);
        else player.clearLayer(layer, undefined, synchronize);
      }, /synchronization failed/);
      assert.equal((await waiting).status, operation === 'clear' ? 'stopped' : 'interrupted');
      if (operation !== 'clear') {
        const successor = player.waitForPlayback();
        player.update(100);
        assert.equal((await successor).status, 'completed');
      }
    } finally {
      player.dispose();
    }
  },
);

test('completion delivers markers and lifecycle once and retains synchronization and listener errors', async () => {
  const player = fixture();
  const poseFailure = new Error('pose failed');
  const listenerFailure = new Error('listener failed');
  const lifecycle: PlaybackLifecycleEvent[] = [];
  const markers: string[] = [];
  player.onPlaybackLifecycle((event) => lifecycle.push(event));
  player.onAnimationEvent((event) => {
    markers.push(event.name);
    throw listenerFailure;
  });
  const waiting = player.playAndWait('a');
  try {
    try {
      player.update(100, undefined, () => {
        throw poseFailure;
      });
      assert.fail('Both failures must be reported.');
    } catch (error) {
      assert.instanceOf(error, AggregateError);
      assert.deepEqual(error.errors, [poseFailure, listenerFailure]);
    }
    assert.equal((await waiting).status, 'completed');
    player.update(100);
    assert.deepEqual(markers, ['end']);
    assert.deepEqual(
      lifecycle.map((event) => event.type),
      ['started', 'completed'],
    );
    assert.equal((Reflect.get(player, 'pendingWaitDisposers') as Set<unknown>).size, 0);
  } finally {
    player.dispose();
  }
});
