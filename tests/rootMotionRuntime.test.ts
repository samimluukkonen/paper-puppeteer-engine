import { afterEach, assert, expect, test, vi } from 'vitest';
import { Actor } from '../src/engine/Actor.js';
import {
  type AnimationClip,
  AnimationPlayer,
  compileClip,
  evaluateRootMotionAtTime,
  evaluateRootMotionAtElapsedTime,
  getRootMotionDelta,
  Joint,
  Rig,
} from '../src/engine/core.js';
import { Puppet, type PuppetOptions } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'middle', parent: 'root', x: 10 }, { id: 'end', parent: 'middle', x: 10 }],
  ik: [{ name: 'arm', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
});
function clip(name = 'walk', endX = 40, loop = true): AnimationClip {
  return {
    name,
    duration: 1000,
    loop,
    tracks: {
      root: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 1 },
      ],
    },
    rootMotion: {
      translationKeys: [
        { time: 0, x: 10, y: 5 },
        { time: 500, y: -15 },
        { time: 1000, x: 10 + endX, y: 5 },
      ],
    },
  };
}
const live: Actor[] = [];
afterEach(() => {
  for (const actor of live.splice(0)) {
    actor.dispose();
    actor.puppet.destroy();
  }
});
function fixture(options: Partial<Omit<PuppetOptions, 'definition' | 'rig'>> = {}) {
  const scene = puppetScene();
  const puppet = new Puppet(scene, {
    rig,
    x: 100,
    y: 200,
    autoUpdate: false,
    animations: [
      clip(),
      clip('back', -80, false),
      clip('finite', 40, false),
      { name: 'legacy', duration: 1000, loop: true, tracks: {} },
    ],
    ...options,
  });
  const actor = new Actor({ id: 'hero', puppet });
  live.push(actor);
  return { scene, puppet, actor, player: puppet.animationPlayer };
}
function close(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  assert.closeTo(actual.x, expected.x, 1e-8);
  assert.closeTo(actual.y, expected.y, 1e-8);
}

test('absolute local and elapsed APIs distinguish clamping from continuous cycles and reverse deltas', () => {
  const animation = compileClip(clip(), rig);
  assert.deepEqual(evaluateRootMotionAtTime(animation, 3500), { x: 40, y: 0 });
  assert.deepEqual(evaluateRootMotionAtElapsedTime(animation, 3500), { x: 140, y: -20 });
  assert.deepEqual(evaluateRootMotionAtElapsedTime(animation, 3000), { x: 120, y: 0 });
  assert.deepEqual(evaluateRootMotionAtElapsedTime(animation, 3500, { loop: false }), { x: 40, y: 0 });
  assert.deepEqual(getRootMotionDelta(animation, 900, 3100), { x: 88, y: 0 });
  assert.deepEqual(getRootMotionDelta(animation, 3100, 900), { x: -88, y: 0 });
  close(getRootMotionDelta(animation, 999.9999, 1000.0001), { x: 0.000008, y: 0 });
  const before = structuredClone(animation.rootMotion);
  for (const time of [5000, 10, 9000, 0, -10, 5000]) evaluateRootMotionAtElapsedTime(animation, time);
  assert.deepEqual(animation.rootMotion, before);
});

test.each([undefined, { translationKeys: [] }])(
  'no root motion yields zero at arbitrary elapsed times (%j)',
  (rootMotion) => {
    const animation = { duration: 1000, loop: true, ...(rootMotion ? { rootMotion } : {}) };
    for (const t of [-1, 0, 100, 5000]) {
      assert.deepEqual(evaluateRootMotionAtElapsedTime(animation, t), { x: 0, y: 0 });
      assert.deepEqual(getRootMotionDelta(animation, 900, t), { x: 0, y: 0 });
    }
  },
);

test.each([0.1, 1000 / 3, 33.3])(
  'fractional duration %s retains exact cycle boundaries without duplicated travel',
  (duration) => {
    const animation = {
      duration,
      loop: true,
      rootMotion: {
        translationKeys: [
          { time: 0, x: 10 },
          { time: duration, x: 50 },
        ],
      },
    };
    for (const cycles of [1, 3, 10, 1000]) {
      assert.deepEqual(evaluateRootMotionAtElapsedTime(animation, duration * cycles), { x: 40 * cycles, y: 0 });
      const before = evaluateRootMotionAtElapsedTime(animation, duration * cycles - duration / 10000);
      const after = evaluateRootMotionAtElapsedTime(animation, duration * cycles + duration / 10000);
      assert.closeTo(after.x - before.x, 0.008, 1e-8);
    }
  },
);

test('authored reset motion remains a reset with zero net travel', () => {
  const animation = {
    duration: 1000,
    loop: true,
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0 },
        { time: 900, x: 40, curves: { x: { mode: 'stepped' as const } } },
        { time: 1000, x: 0 },
      ],
    },
  };
  assert.deepEqual(evaluateRootMotionAtElapsedTime(animation, 3999), { x: 40, y: 0 });
  assert.deepEqual(evaluateRootMotionAtElapsedTime(animation, 4000), { x: 0, y: 0 });
});

test('elapsed evaluation rejects invalid clocks, modes, cycle bounds and overflowing travel', () => {
  for (const time of [NaN, Infinity, -Infinity, Number.MAX_VALUE])
    assert.throws(() => evaluateRootMotionAtElapsedTime(clip(), time));
  assert.throws(() => evaluateRootMotionAtElapsedTime({ ...clip(), duration: 0 }, 1));
  assert.throws(() => evaluateRootMotionAtElapsedTime(clip(), 1, { playback: { mode: 'stepped', fps: 0 } }));
  assert.throws(() => getRootMotionDelta(clip(), NaN, 0));
  assert.throws(() => evaluateRootMotionAtElapsedTime(clip('extreme', Number.MAX_VALUE), 2000), /finite/);
});

test('irregular playback and a large step agree with an absolute seek, without double application', () => {
  const { actor, puppet, player } = fixture();
  actor.play('walk', { rootMotion: 'apply' });
  const sync = vi.spyOn(puppet, 'syncPose');
  let elapsed = 0;
  for (const delta of [17, 103, 380, 400, 2200, 400, 5000, 0]) {
    elapsed += delta;
    puppet.update(delta);
    const displacement = evaluateRootMotionAtElapsedTime(clip(), elapsed);
    close(actor.position, { x: 100 + displacement.x, y: 200 + displacement.y });
    assert.equal(player.unwrappedElapsedTime, elapsed);
    close(player.sampleRootMotion(elapsed), displacement);
  }
  assert.equal(sync.mock.calls.length, 8);
  const other = fixture();
  other.actor.play('walk', { rootMotion: 'apply' });
  other.puppet.update(elapsed);
  close(actor.position, other.actor.position);
  assert.equal(player.elapsedTime, elapsed % 1000);
});

test('pause/resume, speed, stop and restart preserve travel and start new instances at the current origin', () => {
  const { actor, puppet, player } = fixture();
  actor.play('walk', { rootMotion: 'apply', speed: 2 });
  player.setSpeed(0.5);
  puppet.update(250);
  const atPause = actor.position;
  actor.pauseAnimation();
  puppet.update(5000);
  assert.deepEqual(actor.position, atPause);
  actor.resumeAnimation();
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 120, y: 180 });
  actor.stop();
  puppet.update(5000);
  assert.deepEqual(actor.position, { x: 120, y: 180 });
  puppet.restart();
  assert.deepEqual(actor.position, { x: 120, y: 180 });
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 130, y: 170 });
  actor.play('walk', { restart: false, rootMotion: 'ignore' });
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 140, y: 160 });
});

test('completion applies its endpoint before callbacks, and repeated updates keep the held position', async () => {
  const { actor, puppet, player } = fixture();
  const positions: unknown[] = [];
  puppet.onAnimationComplete(() => positions.push(actor.position));
  const wait = actor.playAndWait('finite', { rootMotion: 'apply' });
  puppet.update(5000);
  assert.equal((await wait).status, 'completed');
  assert.deepEqual(positions, [{ x: 140, y: 200 }]);
  assert.isFalse(player.isApplyingRootMotion);
  puppet.update(1000);
  assert.deepEqual(actor.position, { x: 140, y: 200 });
  actor.setPosition(1, 2);
  puppet.update(1000);
  assert.deepEqual(actor.position, { x: 1, y: 2 });
});

test('abort with owned playback stops once and releases movement ownership without snap-back', async () => {
  const { actor, puppet } = fixture();
  const controller = new AbortController();
  const wait = actor.playAndWait('finite', { rootMotion: 'apply', signal: controller.signal, stopOnAbort: true });
  puppet.update(400);
  const position = actor.position;
  controller.abort();
  assert.equal((await wait).status, 'cancelled');
  puppet.update(400);
  assert.deepEqual(actor.position, position);
  const movement = actor.moveTo(position.x + 10, position.y, { speed: 10 });
  puppet.update(1000);
  assert.equal((await movement).status, 'completed');
});

test('wait-only cancellation leaves root motion playback running', async () => {
  const { actor, puppet } = fixture();
  const controller = new AbortController();
  const wait = actor.playAndWait('finite', { rootMotion: 'apply', signal: controller.signal });
  puppet.update(250);
  controller.abort();
  assert.equal((await wait).status, 'cancelled');
  puppet.update(750);
  assert.deepEqual(actor.position, { x: 140, y: 200 });
});

test('crossfade applies only incoming motion; interruption retains the outgoing travel', async () => {
  const { actor, puppet } = fixture();
  const wait = actor.playAndWait('finite', { rootMotion: 'apply' });
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 110, y: 190 });
  actor.play('back', { rootMotion: 'apply', fadeDuration: 500 });
  assert.equal((await wait).status, 'interrupted');
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 90, y: 180 });
  actor.play('walk', { fadeDuration: 500 });
  const held = actor.position;
  puppet.update(2000);
  assert.deepEqual(actor.position, held);
});

test('queue requests opt in separately and begin from the completed endpoint', () => {
  const { actor, puppet, player } = fixture();
  actor.play('finite', { rootMotion: 'apply' });
  puppet.queue('back', { rootMotion: 'apply', fadeDuration: 500 });
  puppet.queue('finite');
  puppet.update(1500); // Existing queue policy starts next at zero and discards overshoot.
  assert.equal(player.unwrappedElapsedTime, 0);
  assert.equal(actor.currentAnimation, 'back');
  assert.deepEqual(actor.position, { x: 140, y: 200 });
  puppet.update(1000);
  assert.deepEqual(actor.position, { x: 60, y: 200 });
  puppet.update(1000);
  assert.deepEqual(actor.position, { x: 60, y: 200 });
});

test.each(['left', 'right'] as const)(
  'starting %s facing, nonuniform scale, rotation and ancestors transform travel once',
  (facing) => {
    const { actor, puppet, scene } = fixture({ facing, scale: 2 });
    const parent = scene.add.container(20, 30).setScale(3, 4).setRotation(0.2);
    parent.add(puppet.container);
    puppet.container.setRotation(Math.PI / 2);
    puppet.container.scaleY = 3;
    const start = puppet.container.getWorldTransformMatrix();
    const expected = start.transformPoint(20, -20);
    actor.play('walk', { rootMotion: 'apply' });
    puppet.update(500);
    close(actor.worldPosition, expected);
    const expectedParent = { x: 160, y: 200 + (facing === 'left' ? -40 : 40) };
    close(actor.position, expectedParent);
    // Starting transform stays fixed for this playback even when facing/scale changes later.
    actor.setFacing(facing === 'left' ? 'right' : 'left');
    puppet.container.setScale(10);
    puppet.update(500);
    close(actor.position, { x: 100, y: 200 + (facing === 'left' ? -80 : 80) });
  },
);

test('root translation preserves skeletal channels and puppet-local IK, and fixed world IK observes the new origin', () => {
  const animation = { ...clip('finite', 40, false), ikTracks: { arm: [{ time: 0, x: 15, y: 5, mix: 1 }] } };
  const moving = fixture({ animations: [animation] });
  const stationary = fixture({ animations: [animation] });
  moving.actor.play('finite', { rootMotion: 'apply' });
  stationary.actor.play('finite');
  moving.puppet.update(250);
  stationary.puppet.update(250);
  for (const bone of rig.bones)
    assert.deepEqual(moving.puppet.getBone(bone.id).pose, stationary.puppet.getBone(bone.id).pose);
  const target = { x: 125, y: 195 };
  moving.puppet.getIK('arm').setTarget(target);
  moving.puppet.update(250);
  const endpoint = moving.puppet.getBone('end').container.getWorldTransformMatrix();
  close({ x: endpoint.tx, y: endpoint.ty }, target);
  assert.deepEqual(moving.puppet.getIK('arm').resolvedTarget, target);
});

test('pure seek and skeletal sample never move the Actor or mutate runtime clocks', () => {
  const { actor, puppet, player } = fixture();
  actor.play('walk', { rootMotion: 'apply' });
  puppet.update(250);
  const before = actor.position;
  const status = player.getPlaybackStatus();
  for (const time of [3500, 0, 9900, 250, 1000]) {
    close(player.sampleRootMotion(time), evaluateRootMotionAtElapsedTime(clip(), time));
    puppet.sampleAnimation(time);
    assert.deepEqual(actor.position, before);
    assert.deepEqual(player.getPlaybackStatus(), status);
    assert.equal(player.unwrappedElapsedTime, 250);
  }
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 120, y: 180 });
});

test('stepped root sampling follows playback settings and clip overrides, retaining final net travel', () => {
  const { actor, puppet, player } = fixture();
  player.setPlaybackMode({ mode: 'stepped', fps: 2 });
  actor.play('finite', { rootMotion: 'apply' });
  puppet.update(499);
  assert.deepEqual(actor.position, { x: 100, y: 200 });
  puppet.update(1);
  assert.deepEqual(actor.position, { x: 120, y: 180 });
  puppet.update(500);
  assert.deepEqual(actor.position, { x: 140, y: 200 });
  puppet.addAnimation({ ...clip('override'), playback: { mode: 'stepped', fps: 4 } });
  actor.play('override', { rootMotion: 'apply' });
  puppet.update(1250);
  assert.deepEqual(actor.position, { x: 190, y: 190 });
});

test('translation conflicts reject before changing playback, queues or active movement', async () => {
  const { actor, puppet, player } = fixture();
  actor.play('legacy');
  const movement = actor.moveTo(300, 200, { speed: 100 });
  const status = player.getPlaybackStatus();
  assert.throws(() => actor.play('walk', { rootMotion: 'apply' }), /conflict/);
  assert.deepEqual(player.getPlaybackStatus(), status);
  assert.equal(actor.movementStatus?.status, 'moving');
  actor.cancelMovement();
  assert.equal((await movement).status, 'cancelled');
  actor.play('walk', { rootMotion: 'apply' });
  await expect(actor.moveTo(300, 200)).rejects.toThrow(/conflict/);
  await expect(actor.walkTo(300, 200, { locomotion: { walk: 'walk', idle: 'legacy' } })).rejects.toThrow(/conflict/);
  assert.throws(() => actor.setPosition(0, 0), /conflict/);
  actor.pauseAnimation();
  await expect(actor.moveTo(300, 200)).rejects.toThrow(/conflict/);
  actor.stop();
  const replacement = actor.moveTo(200, 200, { speed: 100 });
  assert.throws(() => puppet.restart(), /conflict/);
  puppet.update(1000);
  assert.equal((await replacement).status, 'completed');
});

test('invalid policies and overlay application reject without replacing valid playback', () => {
  const { actor, player, puppet } = fixture();
  actor.play('finite');
  const status = player.getPlaybackStatus();
  assert.throws(() => actor.play('walk', { rootMotion: 'invalid' as never }), /policy/);
  assert.throws(() => actor.play('walk', { layer: 'overlay', rootMotion: 'apply' }), /base/);
  assert.throws(() => puppet.queue('finite', { rootMotion: 'invalid' as never }), /policy/);
  assert.deepEqual(player.getPlaybackStatus(), status);
});

test('a conflicting queue replacement preserves pending requests and the movement owner', async () => {
  const { actor, puppet, player } = fixture();
  actor.play('finite');
  puppet.queue('back');
  const queue = puppet.getQueue();
  const status = player.getPlaybackStatus();
  const movement = actor.moveTo(300, 200);
  assert.throws(() => puppet.replaceQueue([{ name: 'finite', options: { rootMotion: 'apply' } }]), /conflict/);
  assert.deepEqual(puppet.getQueue(), queue);
  assert.deepEqual(player.getPlaybackStatus(), status);
  actor.cancelMovement();
  assert.equal((await movement).status, 'cancelled');
  actor.play('finite', { rootMotion: 'apply' });
  puppet.update(1000);
  assert.deepEqual(actor.position, { x: 140, y: 200 });
});

test('event-driven replacement captures already-applied travel without stale outgoing application', () => {
  const { actor, puppet } = fixture({
    animations: [{ ...clip('first', 40, false), events: [{ time: 250, name: 'switch' }] }, clip('next', 80, false)],
  });
  const positions: unknown[] = [];
  puppet.onAnimationEvent(() => {
    positions.push(actor.position);
    actor.play('next', { rootMotion: 'apply', fadeDuration: 500 });
  });
  actor.play('first', { rootMotion: 'apply' });
  puppet.update(250);
  assert.deepEqual(positions, [{ x: 110, y: 190 }]);
  puppet.update(250);
  assert.deepEqual(actor.position, { x: 130, y: 180 });
});

test('pose synchronization failure still settles completion and releases translation ownership', async () => {
  const { actor, puppet, player } = fixture();
  const wait = actor.playAndWait('finite', { rootMotion: 'apply' });
  vi.spyOn(puppet, 'syncPose').mockImplementationOnce(() => {
    throw new Error('IK host failed');
  });
  assert.throws(() => puppet.update(1000), /IK host failed/);
  assert.equal((await wait).status, 'completed');
  assert.isFalse(player.isApplyingRootMotion);
  assert.deepEqual(actor.position, { x: 140, y: 200 });
  actor.setPosition(5, 6);
});

test('default playback and rootless clips retain placement, including preview reconstruction', () => {
  const { actor, puppet, player } = fixture();
  actor.play('walk');
  puppet.update(3500);
  assert.deepEqual(actor.position, { x: 100, y: 200 });
  actor.play('legacy', { rootMotion: 'apply' });
  puppet.update(3500);
  assert.deepEqual(actor.position, { x: 100, y: 200 });
  player.setPreviewMode(true);
  actor.play('walk', { rootMotion: 'apply' });
  puppet.update(3500);
  assert.deepEqual(actor.position, { x: 100, y: 200 });
});

test('standalone core consumers explicitly supply an application owner and receive absolute displacement', () => {
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const bare = new AnimationPlayer(rig, joints, [compileClip(clip(), rig)]);
  assert.throws(() => bare.play('walk', { rootMotion: 'apply' }), /application host/);
  const application = { validate: vi.fn(), begin: vi.fn(), apply: vi.fn() };
  const player = new AnimationPlayer(rig, joints, [compileClip(clip(), rig)], application);
  player.play('walk', { rootMotion: 'apply' });
  player.update(3000);
  assert.deepEqual(application.apply.mock.calls, [[{ x: 120, y: 0 }]]);
  assert.equal(application.begin.mock.calls.length, 1);
  player.sampleRootMotion(1);
  player.sample(1);
  assert.equal(application.apply.mock.calls.length, 1);
  player.dispose();
  bare.dispose();
});

test('disposal settles playback and releases owned movement without later application', async () => {
  const { actor, puppet } = fixture();
  const wait = actor.playAndWait('finite', { rootMotion: 'apply' });
  puppet.update(250);
  const position = actor.position;
  puppet.destroy();
  assert.equal((await wait).status, 'disposed');
  puppet.update(1000);
  assert.deepEqual({ x: puppet.container.x, y: puppet.container.y }, position);
});
