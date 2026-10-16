import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { assert, expect, test, vi } from 'vitest';
import { buildCharacterPackage, loadPackageDefinition } from '../src/devtools/shared/package/characterPackage.js';
import {
  type AnimationClip,
  AnimationStateController,
  type PlaybackLifecycleEvent,
  Puppet,
} from '../src/engine/runtime.js';
import { consumerCharacter, consumerImageFetcher } from './helpers/consumerCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const clips: AnimationClip[] = ['idle', 'walk', 'run', 'attack', 'recover'].map((name, index) => ({
  name,
  duration: 100,
  loop: index < 3,
  tracks: { root: [{ time: 0, x: index * 100 }] },
  events: [
    { time: 0, name: 'start' },
    { time: 50, name: 'middle' },
    { time: 100, name: 'end' },
  ],
}));
function fixture(scene = puppetScene()) {
  const puppet = new Puppet(scene, {
    autoUpdate: false,
    rig: { root: 'root', bones: [{ id: 'root' }, { id: 'upper', parent: 'root' }] },
    animations: [
      ...clips,
      {
        name: 'overlay',
        duration: 1000,
        loop: true,
        tracks: { upper: [{ time: 0, x: 10 }], root: [{ time: 0, y: 999 }] },
      },
    ],
  });
  puppet.setLayerMask('upper', ['upper']).setLayerWeight('upper', 0.5).play('overlay', { layer: 'upper' });
  return puppet;
}
function states(puppet: Puppet) {
  return new AnimationStateController(puppet, {
    initialState: 'idle',
    defaultFadeDuration: 100,
    states: Object.fromEntries(clips.map((clip) => [clip.name, { animation: clip.name }])),
  });
}
function resources(puppet: Puppet): number[] {
  return ['lifecycleListeners', 'settledCompletionListeners', 'pendingWaitDisposers'].map(
    (key) => (Reflect.get(puppet.animationPlayer, key) as Set<unknown>).size,
  );
}

test.each([
  ['idle', 'walk', 50],
  ['walk', 'run', 150],
  ['attack', 'idle', 150],
] as const)(
  '%s → %s fades preserve masked overlays and terminate outgoing ownership immediately',
  async (from, to, x) => {
    const puppet = fixture();
    const lifecycle: PlaybackLifecycleEvent[] = [];
    const authored: string[] = [];
    puppet.onPlaybackLifecycle((event) => lifecycle.push(event));
    puppet.onAnimationEvent((event) => authored.push(`${event.clip}:${event.name}`));
    try {
      puppet.play(from);
      const overlay = puppet.getPlaybackStatus('upper')!;
      const outgoing = from === 'attack' ? puppet.waitForPlayback() : undefined;
      const outgoingId = puppet.getPlaybackStatus()!.playbackId;
      puppet.play(to, { fadeDuration: 100 });
      if (outgoing) assert.equal((await outgoing).status, 'interrupted');
      puppet.update(50);
      assert.equal(puppet.getBone('root').pose.x, x);
      assert.equal(puppet.getBone('root').pose.y, 0);
      assert.equal(puppet.getBone('upper').pose.x, 5);
      assert.equal(puppet.getPlaybackStatus('upper')!.playbackId, overlay.playbackId);
      assert.equal(puppet.getPlaybackStatus('upper')!.elapsedTime, 50);
      assert.equal(
        lifecycle.filter((event) => event.playbackId === outgoingId && event.type === 'interrupted').length,
        1,
      );
      assert.notInclude(authored, `${from}:middle`);
      assert.include(authored, `${to}:middle`);
      puppet.update(50);
      assert.isUndefined(puppet.animationPlayer.transition);
    } finally {
      puppet.destroy();
    }
  },
);

test('FIFO and action-return fades use the held endpoint while wait results retain their exact ownership', async () => {
  const puppet = fixture();
  const controller = states(puppet);
  try {
    controller.playAction('attack');
    const action = puppet.waitForPlayback();
    puppet.queue('recover', { fadeDuration: 100 });
    puppet.update(100);
    const result = await action;
    assert.equal(result.status, 'completed');
    assert.equal(result.playback!.clip, 'attack');
    assert.equal(puppet.currentAnimation, 'recover');
    assert.isFalse(controller.isActive);
    puppet.update(50);
    assert.equal(puppet.getBone('root').pose.x, 350);
    assert.equal(puppet.getBone('upper').pose.x, 5);
    controller.setState('idle');
    controller.playAction('attack');
    const returned = puppet.waitForPlayback();
    puppet.update(100);
    assert.equal((await returned).status, 'completed');
    assert.equal(puppet.currentAnimation, 'idle');
    assert.isTrue(controller.isActive);
    puppet.update(50);
    assert.equal(puppet.getBone('root').pose.x, 150);
    assert.equal(puppet.getBone('upper').pose.x, 5);
  } finally {
    controller.dispose();
    puppet.destroy();
  }
});

test('pause and speed zero hold clocks; fades use elapsed milliseconds and stopQueue freezes only base', async () => {
  const puppet = fixture();
  try {
    puppet.play('idle');
    const result = puppet.playAndWait('attack', { fadeDuration: 200, speed: 2 });
    puppet.pauseAnimation();
    puppet.update(1000);
    assert.equal(puppet.getPlaybackStatus()!.elapsedTime, 0);
    puppet.resumeAnimation().setAnimationSpeed(0);
    puppet.update(50);
    assert.equal(puppet.getPlaybackStatus()!.elapsedTime, 0);
    assert.equal(puppet.animationPlayer.transition!.progress, 0.25);
    puppet.setAnimationSpeed(1);
    puppet.update(25);
    assert.equal(puppet.getPlaybackStatus()!.elapsedTime, 50);
    const overlayTime = puppet.getPlaybackStatus('upper')!.elapsedTime;
    const fade = puppet.animationPlayer.transition!.progress;
    puppet.stopQueue();
    assert.equal((await result).status, 'stopped');
    puppet.update(100);
    assert.equal(puppet.animationPlayer.transition!.progress, fade);
    assert.equal(puppet.getPlaybackStatus('upper')!.elapsedTime, overlayTime + 100);
    assert.equal(puppet.getBone('upper').pose.x, 5);
  } finally {
    puppet.destroy();
  }
});

test.each(['marker', 'immediate', 'legacy'] as const)(
  '%s replacement wins over queue and automatic action return',
  async (phase) => {
    const puppet = fixture();
    const controller = states(puppet);
    const replace = () => {
      puppet.play('run', { fadeDuration: 50 });
    };
    if (phase === 'marker')
      puppet.onAnimationEvent((event) => {
        if (event.clip === 'attack' && event.name === 'end') replace();
      });
    if (phase === 'immediate')
      puppet.onPlaybackLifecycle((event) => {
        if (event.clip === 'attack' && event.type === 'completed') replace();
      });
    if (phase === 'legacy')
      puppet.onAnimationComplete((event) => {
        if (event.clip === 'attack') replace();
      });
    try {
      controller.playAction('attack');
      const operation = puppet.waitForPlayback();
      puppet.queue('recover');
      puppet.update(1000);
      assert.equal((await operation).status, 'completed');
      assert.equal(puppet.currentAnimation, 'run');
      assert.equal(puppet.getQueue().length, 0);
      assert.isFalse(controller.isActive);
      puppet.update(1000);
      assert.equal(puppet.currentAnimation, 'run');
    } finally {
      controller.dispose();
      puppet.destroy();
    }
  },
);

test.each([{ restart: 'yes' }, { layer: 7 }, { layer: '  ' }])(
  'malformed play options %j fail before queue, pose or identity mutation',
  async (options) => {
    const puppet = fixture();
    try {
      puppet.queue('attack').queue('recover');
      const before = puppet.getPlaybackStatus();
      const pose = { ...puppet.getBone('root').pose };
      assert.throws(() => puppet.play('idle', options as never), /must be/);
      await expect(puppet.playAndWait('attack', options as never)).rejects.toThrow(/must be/);
      assert.deepEqual(puppet.getPlaybackStatus(), before);
      assert.deepEqual(puppet.getBone('root').pose, pose);
      assert.equal(puppet.getQueue()[0]!.name, 'recover');
    } finally {
      puppet.destroy();
    }
  },
);

test('100 controller/action/queue/wait cycles release subscriptions, abort handlers and disposed host references', async () => {
  const puppet = fixture();
  try {
    for (let cycle = 0; cycle < 100; cycle++) {
      const controller = states(puppet);
      controller.playAction('attack');
      const signal = new AbortController();
      const remove = vi.spyOn(signal.signal, 'removeEventListener');
      const cancelled = puppet.waitForPlayback({ signal: signal.signal });
      const completed = puppet.waitForPlayback();
      signal.abort();
      assert.equal((await cancelled).status, 'cancelled');
      assert.equal(remove.mock.calls.length, 1);
      puppet.queue('recover').clearQueue().queue('recover');
      puppet.update(100);
      assert.equal((await completed).status, 'completed');
      assert.equal(puppet.currentAnimation, 'recover');
      controller.dispose();
      controller.dispose();
      assert.isUndefined(Reflect.get(controller, 'host'));
      assert.deepEqual(resources(puppet), [0, 0, 0]);
      const stopped = puppet.waitForPlayback();
      puppet.replaceQueue([]);
      assert.equal((await stopped).status, 'stopped');
      assert.equal(puppet.getQueue().length, 0);
    }
  } finally {
    puppet.destroy();
  }
  assert.deepEqual(resources(puppet), [0, 0, 0]);
});

test('steady controller updates evaluate and synchronize once without creating render objects', () => {
  const scene = puppetScene();
  const puppet = fixture(scene);
  const controller = states(puppet);
  const evaluate = vi.spyOn(puppet.animationPlayer, 'applyCurrentPose');
  const sync = vi.spyOn(puppet, 'syncPose');
  const images = vi.spyOn(scene.add, 'image');
  const containers = vi.spyOn(scene.add, 'container');
  try {
    for (let frame = 0; frame < 120; frame++) puppet.update(16);
    assert.equal(evaluate.mock.calls.length, 120);
    assert.equal(sync.mock.calls.length, 120);
    assert.equal(images.mock.calls.length, 0);
    assert.equal(containers.mock.calls.length, 0);
  } finally {
    controller.dispose();
    puppet.destroy();
  }
});

test('exported IK/baked clips retain solver configuration across states, queues and asynchronous selection', async () => {
  const definition = await loadPackageDefinition(
    await buildCharacterPackage(consumerCharacter(), consumerImageFetcher),
  );
  const puppet = new Puppet(puppetScene(), { definition, autoUpdate: false });
  const reference = new Puppet(puppetScene(), { definition, autoUpdate: false });
  const controller = new AnimationStateController(puppet, {
    initialState: 'idle',
    defaultFadeDuration: 100,
    states: {
      idle: { animation: 'idle' },
      reach: { animation: 'reach', loop: false },
      baked: { animation: 'baked', loop: false },
    },
  });
  const constraint = puppet.getIK('rightArmIK');
  constraint.setTarget(20, 30);
  const target = constraint.target;
  reference.getIK('rightArmIK').setTarget(20, 30);
  const verify = () => {
    for (const bone of definition.rig.bones)
      assert.deepEqual(puppet.getBone(bone.id).pose, reference.getBone(bone.id).pose);
    assert.strictEqual(puppet.getIK('rightArmIK'), constraint);
    assert.deepEqual(constraint.target, target);
  };
  try {
    reference.play('idle', { fadeDuration: 100 });
    for (const name of ['reach', 'baked'] as const) {
      controller.setState(name);
      reference.play(name, { fadeDuration: 100, loop: false });
      for (const delta of [50, 50, 400, 500]) {
        puppet.update(delta);
        reference.update(delta);
        verify();
      }
    }
    puppet.queue('attack').queue('recover', { fadeDuration: 100 });
    reference.play('attack');
    const operation = puppet.waitForPlayback();
    puppet.update(400);
    reference.update(400);
    assert.equal((await operation).status, 'completed');
    reference.play('recover', { fadeDuration: 100 });
    puppet.update(50);
    reference.update(50);
    verify();
    const asyncResult = puppet.playAndWait('reach', { loop: false, fadeDuration: 100 });
    reference.play('reach', { loop: false, fadeDuration: 100 });
    puppet.update(1000);
    reference.update(1000);
    verify();
    assert.equal((await asyncResult).status, 'completed');
  } finally {
    controller.dispose();
    puppet.destroy();
    reference.destroy();
  }
});

test('twenty character reloads and scene shutdowns settle all waits and remove all scene listeners', async () => {
  const files = await buildCharacterPackage(consumerCharacter(), consumerImageFetcher);
  const SceneEvents = createRequire(import.meta.url)(
    '../node_modules/phaser/src/events/EventEmitter.js',
  ) as typeof Phaser.Events.EventEmitter;
  const scene = puppetScene();
  const events = new SceneEvents();
  scene.events = events;
  for (let cycle = 0; cycle < 20; cycle++) {
    const definition = await loadPackageDefinition(files);
    const puppet = new Puppet(scene, { definition });
    const controller = new AnimationStateController(puppet, {
      initialState: 'idle',
      states: { idle: { animation: 'idle' }, attack: { animation: 'attack' } },
    });
    controller.playAction('attack');
    const base = puppet.waitForPlayback();
    const overlay = puppet.playAndWait('recover', { layer: 'upper' });
    puppet.queue('recover');
    events.emit('update', 0, 50);
    events.emit('shutdown');
    assert.equal((await base).status, 'disposed');
    assert.equal((await overlay).status, 'disposed');
    assert.isTrue(controller.isDisposed);
    assert.deepEqual(resources(puppet), [0, 0, 0]);
    assert.equal(events.listenerCount('update'), 0);
    assert.equal(events.listenerCount('shutdown'), 0);
    assert.equal(puppet.getQueue().length, 0);
  }
});
