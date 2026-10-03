import { afterEach, assert, test, vi } from 'vitest';
import { IKDebug } from '../src/engine/ik/IKDebug.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetDebug } from '../src/engine/PuppetDebug.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { SlotDebug } from '../src/engine/SlotDebug.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const puppet = new Puppet(puppetScene(), {
    autoUpdate: false,
    rig: {
      root: 'root',
      bones: [
        { id: 'root' },
        { id: 'upper', parent: 'root', rotation: 0.1 },
        { id: 'lower', parent: 'upper', y: 60, rotation: 0.2 },
        { id: 'hand', parent: 'lower', y: 50 },
        { id: 'otherUpper', parent: 'root', x: 10 },
        { id: 'otherLower', parent: 'otherUpper', y: 60 },
        { id: 'otherHand', parent: 'otherLower', y: 50 },
      ],
      slots: [{ id: 'item', bone: 'hand', x: 3, y: 4 }],
      attachments: [{ id: 'art', texture: 'part' }],
    },
  });
  puppet.setAttachment('item', 'art');
  const constraint = puppet.addIK({ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix: 0.5 });
  return { puppet, constraint };
}

const rejectedCommands: [string, (puppet: Puppet) => unknown][] = [
  ['unknown clip', (puppet) => puppet.play('missing')],
  ['negative fade', (puppet) => puppet.play('held', { fadeDuration: -1 })],
  ['nonfinite fade', (puppet) => puppet.play('held', { fadeDuration: NaN })],
  ['negative clip speed', (puppet) => puppet.play('held', { speed: -1 })],
  ['empty playback layer', (puppet) => puppet.play('held', { layer: '' })],
  ['invalid FPS', (puppet) => puppet.setAnimationFPS(0)],
  ['nonfinite FPS', (puppet) => puppet.setAnimationFPS(NaN)],
  ['base mask', (puppet) => puppet.setLayerMask('base', ['upper'])],
  ['unknown masked bone', (puppet) => puppet.setLayerMask('upper', ['upper', 'missing'])],
  ['empty masked layer', (puppet) => puppet.setLayerMask('', ['upper'])],
  ['base weight', (puppet) => puppet.setLayerWeight('base', 0.5)],
  ['invalid weight', (puppet) => puppet.setLayerWeight('upper', 2)],
  ['nonfinite weight', (puppet) => puppet.setLayerWeight('upper', NaN)],
  ['empty weighted layer', (puppet) => puppet.setLayerWeight('', 0.5)],
  ['clear base', (puppet) => puppet.clearLayer('base')],
  ['clear empty layer', (puppet) => puppet.clearLayer('')],
  ['unknown rotated bone', (puppet) => puppet.setBoneRotation('missing', 1)],
];

test.each(rejectedCommands)('rejected %s preserves the preset, IK, playback, and rendering', (_name, command) => {
  const { puppet, constraint } = fixture();
  puppet.addAnimation({
    name: 'held',
    duration: 1000,
    loop: true,
    tracks: { upper: [{ time: 0, rotation: 0.7 }] },
  });
  puppet.play('held').play('held', { fadeDuration: 1000 });
  puppet.addPose({ version: 1, name: 'preset', bones: { upper: { x: 5, rotation: 1 } } }).applyPose('preset');
  constraint.setTarget(60, 70);
  puppet.syncPose();
  const snapshot = () => ({
    bones: puppet.rig.bones.map(({ id }) => {
      const bone = puppet.getBone(id);
      const mount = puppet.getSlotImage('item')!.getWorldTransformMatrix();
      return {
        pose: { ...bone.pose },
        x: bone.container.x,
        rotation: bone.container.rotation,
        slot: { x: mount.tx, y: mount.ty },
      };
    }),
    time: puppet.animationPlayer.elapsedTime,
    transition: puppet.animationPlayer.transition,
    mode: puppet.animationPlayer.playbackMode,
    ikStatus: constraint.status,
  });
  const before = snapshot();
  const prepare = vi.spyOn(puppet, 'preparePose');
  assert.throws(() => command(puppet));
  assert.equal(prepare.mock.calls.length, 0);
  assert.deepEqual(snapshot(), before);
  puppet.syncPose();
  assert.deepEqual(snapshot(), before);
  puppet.clearPose();
  constraint.enabled = false;
  puppet.syncPose();
  assert.equal(puppet.getBone('upper').pose.rotation, 0.7);
  assert.equal(puppet.getBone('upper').pose.x, 0);
  puppet.destroy();
});

test('start, timeline, and completion callbacks see synchronized transforms, presets, slots, and IK', () => {
  const { puppet, constraint } = fixture();
  constraint.setTarget(60, 70);
  puppet.addPose({ version: 1, name: 'preset', bones: { upper: { y: 5 } } }).applyPose('preset');
  puppet.addAnimation({
    name: 'move',
    duration: 100,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 100, x: 20 },
      ],
    },
    events: [
      { time: 0, name: 'start' },
      { time: 50, name: 'middle' },
    ],
  });
  const observed: string[] = [];
  const checkProjection = (name: string): void => {
    observed.push(name);
    const root = puppet.getBone('root');
    assert.equal(root.container.x, root.pose.x);
    const upper = puppet.getBone('upper');
    assert.equal(upper.pose.y, 5);
    assert.equal(upper.container.y, 5);
    assert.equal(constraint.status, 'solved');
    assert.approximately(Math.sin(upper.container.rotation), Math.sin(upper.pose.rotation), 1e-12);
    const hand = puppet.getBone('hand').container.getWorldTransformMatrix();
    const expected = hand.transformPoint(3, 4);
    const image = puppet.getSlotImage('item')!.getWorldTransformMatrix();
    assert.approximately(image.tx, expected.x, 1e-10);
    assert.approximately(image.ty, expected.y, 1e-10);
  };
  puppet.onAnimationEvent(({ name }) => checkProjection(name));
  puppet.onAnimationComplete(() => checkProjection('complete'));
  puppet.play('move');
  puppet.update(50);
  puppet.update(50);
  assert.deepEqual(observed, ['start', 'middle', 'complete']);
  puppet.destroy();
});

test('throwing listeners preserve rendering, finish fades, and deliver remaining events and completion once', () => {
  const { puppet } = fixture();
  puppet.addAnimation({ name: 'held', duration: 100, loop: true, tracks: { root: [{ time: 0, x: 0 }] } });
  puppet.addAnimation({
    name: 'move',
    duration: 100,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 100, x: 100 },
      ],
    },
    events: [
      { time: 50, name: 'middle' },
      { time: 100, name: 'end' },
    ],
  });
  puppet.play('held').play('move', { fadeDuration: 100 });
  const failure = new Error('listener failed');
  const observed: string[] = [];
  puppet.onAnimationEvent(({ name }) => {
    if (name === 'middle') throw failure;
  });
  puppet.onAnimationEvent(({ name }) => {
    assert.equal(puppet.getBone('root').container.x, 100);
    observed.push(name);
  });
  puppet.onAnimationComplete(() => observed.push('complete'));
  assert.throws(() => puppet.update(100), /listener failed/);
  assert.equal(puppet.getBone('root').pose.x, 100);
  assert.equal(puppet.getBone('root').container.x, 100);
  assert.isUndefined(puppet.animationPlayer.transition);
  assert.deepEqual(observed, ['middle', 'end', 'complete']);
  puppet.update(100);
  assert.deepEqual(observed, ['middle', 'end', 'complete']);
  puppet.destroy();
});

test('a throwing time-zero listener leaves the new clip rendered and other listeners notified', () => {
  const { puppet } = fixture();
  puppet.addAnimation({
    name: 'move',
    duration: 100,
    loop: false,
    tracks: { root: [{ time: 0, x: 25 }] },
    events: [{ time: 0, name: 'start' }],
  });
  puppet.onAnimationEvent(() => {
    throw new Error('start failed');
  });
  const observed = vi.fn(() => assert.equal(puppet.getBone('root').container.x, 25));
  puppet.onAnimationEvent(observed);
  assert.throws(() => puppet.play('move'), /start failed/);
  assert.equal(puppet.getBone('root').pose.x, 25);
  assert.equal(puppet.getBone('root').container.x, 25);
  assert.equal(observed.mock.calls.length, 1);
  puppet.destroy();
});

test('a completion callback can start a new clip without overwriting its synchronized pose', () => {
  const { puppet } = fixture();
  puppet.addAnimation({ name: 'once', duration: 100, loop: false, tracks: { root: [{ time: 0, x: 10 }] } });
  puppet.addAnimation({ name: 'next', duration: 100, loop: true, tracks: { root: [{ time: 0, x: 20 }] } });
  puppet.onAnimationComplete(() => {
    assert.equal(puppet.getBone('root').container.x, 10);
    puppet.play('next', { fadeDuration: 50 });
  });
  puppet.play('once').update(100);
  assert.equal(puppet.currentAnimation, 'next');
  assert.equal(puppet.animationPlayer.elapsedTime, 0);
  assert.equal(puppet.animationPlayer.transition?.progress, 0);
  puppet.update(50);
  assert.equal(puppet.getBone('root').container.x, 20);
  puppet.destroy();
});

test.each(['negative delta', 'nonfinite delta', 'clock overflow', 'event limit'] as const)(
  'rejected updates preserve presets, IK, clocks, transitions, and rendering: %s',
  (reason) => {
    const { puppet, constraint } = fixture();
    puppet.addAnimation({
      name: 'held',
      duration: 1000,
      loop: true,
      tracks: { upper: [{ time: 0, rotation: 0.7 }] },
      events: [{ time: 50, name: 'marker' }],
    });
    puppet.play('held').play('held', { fadeDuration: 1000 }).setAnimationSpeed(2);
    puppet.addPose({ version: 1, name: 'preset', bones: { upper: { x: 5, rotation: 1 } } }).applyPose('preset');
    constraint.setTarget(60, 70);
    puppet.syncPose();
    const snapshot = () =>
      puppet.rig.bones.map(({ id }) => {
        const bone = puppet.getBone(id);
        return { pose: { ...bone.pose }, x: bone.container.x, rotation: bone.container.rotation };
      });
    const before = snapshot();
    const transition = puppet.animationPlayer.transition;
    const prepare = vi.spyOn(puppet, 'preparePose');
    const event = vi.fn();
    puppet.onAnimationEvent(event);
    const delta =
      reason === 'negative delta'
        ? -1
        : reason === 'nonfinite delta'
          ? NaN
          : reason === 'clock overflow'
            ? Number.MAX_VALUE
            : 10_001_000;
    assert.throws(() => puppet.update(delta));
    assert.equal(prepare.mock.calls.length, 0);
    assert.deepEqual(snapshot(), before);
    assert.equal(puppet.animationPlayer.elapsedTime, 0);
    assert.deepEqual(puppet.animationPlayer.transition, transition);
    assert.equal(event.mock.calls.length, 0);
    // Retrying must still restore the correct pre-IK/preset baseline.
    puppet.update(10);
    assert.equal(puppet.animationPlayer.elapsedTime, 20);
    assert.deepEqual(snapshot(), before);
    puppet.destroy();
  },
);

test.each([false, true])('resetPose clears presets and restores bind transforms with active IK: %s', (withIK) => {
  const { puppet, constraint } = fixture();
  if (withIK) constraint.setTarget(60, 70);
  puppet.syncPose();
  const expected = puppet.rig.bones.map(({ id }) => ({ ...puppet.getBone(id).pose }));
  puppet
    .addAnimation({
      name: 'move',
      duration: 1000,
      loop: true,
      tracks: { upper: [{ time: 0, rotation: 0.7 }] },
    })
    .play('move');
  puppet.addPose({ version: 1, name: 'preset', bones: { upper: { rotation: 1, x: 10 } } }).applyPose('preset');
  puppet.resetPose();
  assert.isFalse(puppet.isPlaying);
  assert.isTrue(constraint.enabled);
  assert.deepEqual(
    puppet.rig.bones.map(({ id }) => ({ ...puppet.getBone(id).pose })),
    expected,
  );
  puppet.update(16);
  assert.deepEqual(
    puppet.rig.bones.map(({ id }) => ({ ...puppet.getBone(id).pose })),
    expected,
  );
  puppet.destroy();
});

test.each(['disabled', 'zero mix', 'no target', 'empty provider', 'unsupported scale', 'singular parent'] as const)(
  '%s IK clears status without extra transform or projection passes',
  (mode) => {
    const { puppet, constraint } = fixture();
    constraint.setTarget(60, 70);
    puppet.update(16);
    if (mode === 'disabled') constraint.enabled = false;
    if (mode === 'zero mix') constraint.mix = 0;
    if (mode === 'no target') constraint.target = undefined;
    if (mode === 'empty provider') constraint.setTargetProvider(() => undefined);
    if (mode === 'unsupported scale') puppet.getBone('upper').pose.scaleX = 2;
    if (mode === 'singular parent') puppet.container.setScale(0);
    const sync = vi.spyOn(PuppetRenderer.prototype, 'sync');
    const partial = vi.spyOn(PuppetRenderer.prototype, 'syncBone');
    const boneSync = vi.spyOn(puppet.getBone('upper'), 'syncTransform');
    puppet.update(16);
    assert.equal(sync.mock.calls.length, 1);
    assert.equal(partial.mock.calls.length, 0);
    assert.equal(boneSync.mock.calls.length, 1);
    assert.equal(puppet.getBone('upper').pose.rotation, 0.1);
    assert.equal(puppet.getBone('lower').pose.rotation, 0.2);
    assert.equal(
      constraint.status,
      mode === 'unsupported scale'
        ? 'unsupported-scale'
        : mode === 'singular parent'
          ? 'singular-transform'
          : 'inactive',
    );
    if (constraint.status === 'inactive') assert.isUndefined(constraint.resolvedTarget);
  },
);

test.each([false, true])('later providers see synchronized projections with deferred debug: %s', (deferred) => {
  const { puppet, constraint } = fixture();
  constraint.setTarget(60, 70);
  const image = puppet.getSlotImage('item')!;
  const dependent = puppet.addIK({
    name: 'dependent',
    rootBone: 'otherUpper',
    middleBone: 'otherLower',
    endBone: 'otherHand',
    priority: 1,
  });
  let observed: { x: number; y: number } | undefined;
  dependent.setTargetProvider(() => {
    const projected = image.getWorldTransformMatrix();
    const logical = puppet.getBone('hand').container.getWorldTransformMatrix();
    assert.approximately(projected.tx, logical.tx + logical.a * 3 + logical.c * 4, 1e-8);
    assert.approximately(projected.ty, logical.ty + logical.b * 3 + logical.d * 4, 1e-8);
    observed = { x: projected.tx, y: projected.ty };
    return observed;
  });
  const sync = vi.spyOn(PuppetRenderer.prototype, 'sync');
  const partial = vi.spyOn(PuppetRenderer.prototype, 'syncBone');
  const debug = [PuppetDebug, IKDebug, SlotDebug].map((view) => vi.spyOn(view.prototype, 'update'));
  for (let frame = 0; frame < 5; frame += 1) {
    if (deferred) puppet.syncPose({ updateDebug: false });
    else puppet.update(16);
  }
  assert.equal(sync.mock.calls.length, 5);
  assert.equal(partial.mock.calls.length, 20);
  const end = puppet.getBone('otherHand').container.getWorldTransformMatrix();
  assert.approximately(end.tx, observed!.x, 1e-8);
  assert.approximately(end.ty, observed!.y, 1e-8);
  for (const update of debug) assert.equal(update.mock.calls.length, deferred ? 0 : 5);
  const solved = { ...puppet.getBone('otherUpper').pose };
  puppet.refreshDebugViews();
  for (const update of debug) assert.equal(update.mock.calls.length, deferred ? 1 : 6);
  assert.deepEqual(puppet.getBone('otherUpper').pose, solved);
});

test('dynamic priorities retain registration order for ties', () => {
  const { puppet, constraint } = fixture();
  const second = puppet.addIK({
    name: 'second',
    rootBone: 'upper',
    middleBone: 'lower',
    endBone: 'hand',
    priority: -1,
  });
  const order: string[] = [];
  constraint.setTargetProvider(() => {
    order.push('first');
    return undefined;
  });
  second.setTargetProvider(() => {
    order.push('second');
    return undefined;
  });
  puppet.update(16);
  assert.deepEqual(order, ['second', 'first']);
  order.length = 0;
  second.priority = 0;
  puppet.update(16);
  assert.deepEqual(order, ['first', 'second']);
});

test('overlapping chains restore one authored baseline across repeated partial solves', () => {
  const { puppet, constraint } = fixture();
  constraint.setTarget(60, 70);
  const overlapping = puppet.addIK({
    name: 'overlapping',
    rootBone: 'upper',
    middleBone: 'lower',
    endBone: 'hand',
    mix: 0.5,
  });
  overlapping.setTarget(50, 80);
  puppet.update(16);
  const rotation = puppet.getBone('upper').pose.rotation;
  for (let frame = 0; frame < 5; frame += 1) {
    puppet.update(16);
    assert.equal(puppet.getBone('upper').pose.rotation, rotation);
  }
  constraint.enabled = false;
  overlapping.enabled = false;
  puppet.update(16);
  assert.equal(puppet.getBone('upper').pose.rotation, 0.1);
  assert.equal(puppet.getBone('lower').pose.rotation, 0.2);
});

test("inactive IK avoids resyncing authored rotations outside Phaser's wrapped range", () => {
  const { puppet, constraint } = fixture();
  constraint.enabled = false;
  puppet.getBone('upper').pose.rotation = 4;
  const partial = vi.spyOn(PuppetRenderer.prototype, 'syncBone');
  puppet.update(16);
  assert.equal(puppet.getBone('upper').pose.rotation, 4);
  assert.isBelow(puppet.getBone('upper').container.rotation, 0);
  assert.equal(partial.mock.calls.length, 0);
});

test('provider edits to chain translations remain visible to later providers', () => {
  const { puppet, constraint } = fixture();
  constraint.setTargetProvider(() => {
    puppet.getBone('upper').pose.x = 12;
    return undefined;
  });
  const dependent = puppet.addIK({
    name: 'dependent',
    rootBone: 'otherUpper',
    middleBone: 'otherLower',
    endBone: 'otherHand',
  });
  dependent.setTargetProvider(() => {
    assert.equal(puppet.getBone('upper').container.x, 12);
    const logical = puppet.getBone('hand').container.getWorldTransformMatrix();
    const projected = puppet.getSlotImage('item')!.getWorldTransformMatrix();
    assert.approximately(projected.tx, logical.tx + logical.a * 3 + logical.c * 4, 1e-8);
    return undefined;
  });
  puppet.update(16);
});

test('a failing provider leaves earlier IK restorable on the next frame', () => {
  const { puppet, constraint } = fixture();
  constraint.setTarget(60, 70);
  const failing = puppet.addIK({
    name: 'failure',
    rootBone: 'otherUpper',
    middleBone: 'otherLower',
    endBone: 'otherHand',
    priority: 1,
  });
  failing.setTargetProvider(() => {
    throw new Error('provider failed');
  });
  assert.throws(() => puppet.update(16), /provider failed/);
  assert.notEqual(puppet.getBone('upper').pose.rotation, 0.1);
  constraint.enabled = false;
  failing.enabled = false;
  puppet.update(16);
  assert.equal(puppet.getBone('upper').pose.rotation, 0.1);
  assert.equal(puppet.getBone('lower').pose.rotation, 0.2);
});

test.each([false, true])(
  'IK-only corrections match full sync without accumulating partial mix (preset: %s)',
  (preset) => {
    const optimized = fixture();
    const baseline = fixture();
    for (const { puppet, constraint } of [optimized, baseline]) {
      puppet
        .addAnimation({ name: 'held', duration: 100, loop: true, tracks: { upper: [{ time: 0, rotation: 4 }] } })
        .play('held');
      if (preset)
        puppet
          .addPose({ version: 1, name: 'preset', bones: { upper: { rotation: 0.8, x: 5 }, otherHand: { y: 70 } } })
          .applyPose('preset', { mix: 0.35 });
      puppet
        .addIK({ name: 'overlap', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix: 0.25 })
        .setTarget(50, 80);
      constraint.setTarget(60, 70);
      puppet.syncPose();
    }
    const fullProjection = vi.spyOn(PuppetRenderer.prototype, 'sync');
    const untouchedBone = vi.spyOn(optimized.puppet.getBone('otherHand'), 'syncTransform');
    for (let frame = 0; frame < 30; frame += 1) {
      for (const { constraint } of [optimized, baseline]) {
        constraint.setTarget(50 + frame, 70 - frame);
        constraint.mix = frame === 20 ? 0 : 0.5;
        constraint.enabled = frame !== 10;
        constraint.priority = frame % 2;
      }
      fullProjection.mockClear();
      optimized.puppet.syncIK({ updateDebug: false });
      assert.equal(fullProjection.mock.calls.length, 0);
      assert.equal(untouchedBone.mock.calls.length, 0);
      baseline.puppet.syncPose({ updateDebug: false });
      for (const bone of optimized.puppet.rig.bones)
        assert.deepEqual(optimized.puppet.getBone(bone.id).pose, baseline.puppet.getBone(bone.id).pose);
      const actual = optimized.puppet.getSlotImage('item')!.getWorldTransformMatrix();
      const expected = baseline.puppet.getSlotImage('item')!.getWorldTransformMatrix();
      for (const property of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const)
        assert.approximately(actual[property], expected[property], 1e-8);
    }
    optimized.puppet.preparePose();
    baseline.puppet.preparePose();
    for (const bone of optimized.puppet.rig.bones)
      assert.deepEqual(optimized.puppet.getBone(bone.id).pose, baseline.puppet.getBone(bone.id).pose);
  },
);

test('IK-only provider failures remain restorable, including disabled constraints and destroyed puppets', () => {
  const { puppet, constraint } = fixture();
  constraint.setTarget(60, 70);
  puppet.syncPose();
  const failing = puppet.addIK({
    name: 'failure',
    rootBone: 'otherUpper',
    middleBone: 'otherLower',
    endBone: 'otherHand',
    priority: 1,
  });
  failing.setTargetProvider(() => {
    throw new Error('provider failed');
  });
  assert.throws(() => puppet.syncIK(), /provider failed/);
  constraint.enabled = false;
  failing.enabled = false;
  puppet.syncIK();
  for (const id of ['upper', 'lower']) {
    const bone = puppet.getBone(id);
    assert.equal(bone.pose.rotation, bone.bindPose.rotation);
    assert.approximately(bone.container.rotation, bone.bindPose.rotation, 1e-8);
  }
  puppet.destroy();
  assert.doesNotThrow(() => puppet.syncIK());
});
