import { afterEach, assert, test, vi } from 'vitest';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
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

test('later providers see both bone and descendant slot projections after earlier IK', () => {
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
  for (let frame = 0; frame < 5; frame += 1) puppet.update(16);
  assert.equal(sync.mock.calls.length, 5);
  assert.equal(partial.mock.calls.length, 20);
  const end = puppet.getBone('otherHand').container.getWorldTransformMatrix();
  assert.approximately(end.tx, observed!.x, 1e-8);
  assert.approximately(end.ty, observed!.y, 1e-8);
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
