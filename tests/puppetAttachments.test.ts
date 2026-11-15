import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { Puppet } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture() {
  const scene = puppetScene();
  const puppet = new Puppet(scene, {
    rig: {
      root: 'root',
      bones: [{ id: 'root' }, { id: 'hand', parent: 'root' }],
      slots: [{ id: 'propSlot', bone: 'hand', x: 4, y: 6, rotation: 0.2, depth: -20 }],
    },
    autoUpdate: false,
  });
  const prop = scene.add.container(0, 0);
  const events = new EventEmitter();
  const callbacks = new Map<Parameters<typeof prop.once>[1], (...args: unknown[]) => void>();
  prop.once = (event, listener, context) => {
    const callback = (...args: unknown[]): void => {
      listener.apply(context, args);
    };
    callbacks.set(listener, callback);
    events.once(event, callback);
    return prop;
  };
  prop.off = (event, listener) => {
    const callback = listener && callbacks.get(listener);
    if (callback) {
      events.off(event, callback);
      callbacks.delete(listener);
    }
    return prop;
  };
  prop.destroy = () => {
    if (prop.isDestroyed) return;
    Reflect.set(prop, 'isDestroyed', true);
    // Match Phaser's child removal before the puppet's destroy listener runs.
    prop.parentContainer?.remove(prop);
    events.emit('destroy', prop);
    events.removeAllListeners();
  };
  const mount = (): Phaser.GameObjects.Container => {
    const wrapper = prop.parentContainer;
    if (!wrapper) throw new Error('Prop is not attached.');
    return wrapper;
  };
  return { puppet, prop, events, mount };
}

test('invalid attachments do not allocate lazy render branches or wrappers', () => {
  const { puppet, prop } = fixture();
  const create = vi.spyOn(prop.scene.add, 'container');
  const foreign = puppetScene().add.container(0, 0);
  assert.throws(() => puppet.attach('hand', prop, { x: Number.NaN }), /finite/);
  assert.throws(() => puppet.attach('hand', foreign), /puppet scene/);
  assert.throws(() => puppet.attach('hand', puppet.container), /ancestor/);
  assert.equal(create.mock.calls.length, 0);
  assert.doesNotThrow(() => puppet.attach('hand', prop));
  assert.isAbove(create.mock.calls.length, 0);
  create.mockRestore();
  puppet.destroy();
});

test('destroying an attached prop releases its registration and destroys the empty wrapper', () => {
  const { puppet, prop, events, mount } = fixture();
  puppet.attach('root', prop);
  const wrapper = mount();
  const destroy = vi.spyOn(wrapper, 'destroy');
  assert.equal(events.listenerCount('destroy'), 1);
  prop.destroy();
  assert.equal(destroy.mock.calls.length, 1);
  assert.isTrue(wrapper.isDestroyed);
  assert.isFalse(puppet.detach(prop));
  assert.equal(events.listenerCount('destroy'), 0);
  puppet.destroy();
});

test('detaching and reattaching transfer the destruction listener to the current mount', () => {
  const { puppet, prop, events, mount } = fixture();
  puppet.attach('root', prop);
  const first = mount();
  puppet.attach('hand', prop);
  assert.isTrue(first.isDestroyed);
  assert.isFalse(prop.isDestroyed);
  assert.equal(events.listenerCount('destroy'), 1);
  const second = mount();
  assert.isTrue(puppet.detach(prop));
  assert.isTrue(second.isDestroyed);
  assert.equal(events.listenerCount('destroy'), 0);
  puppet.attach('root', prop);
  const current = mount();
  prop.destroy();
  assert.isTrue(current.isDestroyed);
  assert.isFalse(puppet.detach(prop));
  puppet.destroy();
});

test('destroying a wrapper does not recursively destroy it through its prop listener', () => {
  const { puppet, prop, mount } = fixture();
  puppet.attach('root', prop);
  const wrapper = mount();
  const destroy = vi.spyOn(wrapper, 'destroy').mockImplementation(() => {
    Reflect.set(wrapper, 'isDestroyed', true);
    prop.destroy();
  });
  wrapper.destroy();
  assert.equal(destroy.mock.calls.length, 1);
  assert.isFalse(puppet.detach(prop));
  puppet.destroy();
});

test('puppet teardown removes prop listeners before destroying rendering', () => {
  const { puppet, prop, events } = fixture();
  puppet.attach('root', prop);
  puppet.destroy();
  assert.equal(events.listenerCount('destroy'), 0);
  assert.doesNotThrow(() => prop.destroy());
  assert.doesNotThrow(() => puppet.destroy());
});

test('slot props inherit the slot transform and global depth, and retain attachment lifecycle', () => {
  const { puppet, prop, mount, events } = fixture();
  puppet.setFacing('left');
  Object.assign(puppet.getBone('hand').pose, { x: 10, y: 20, rotation: 0.3, scaleX: 1.2, scaleY: 0.8 });
  puppet.posePipeline.syncPose();
  puppet.attachToSlot('propSlot', prop, { x: 2, y: 3 });
  const slotPoint = {
    x: 4 + 2 * Math.cos(0.2) - 3 * Math.sin(0.2),
    y: 6 + 2 * Math.sin(0.2) + 3 * Math.cos(0.2),
  };
  const expected = puppet.getBone('hand').container.getWorldTransformMatrix().transformPoint(slotPoint.x, slotPoint.y);
  const actual = prop.getWorldTransformMatrix().transformPoint(0, 0);
  assert.approximately(actual.x, expected.x, 1e-8);
  assert.approximately(actual.y, expected.y, 1e-8);
  let branch = mount();
  while (branch.parentContainer?.parentContainer !== puppet.container) branch = branch.parentContainer!;
  assert.equal(branch.depth, -20);
  puppet.setSlotDepth('propSlot', -25);
  assert.equal(branch.depth, -25);
  assert.equal(events.listenerCount('destroy'), 1);
  const wrapper = mount();
  puppet.attach('hand', prop);
  assert.isTrue(wrapper.isDestroyed);
  assert.equal(events.listenerCount('destroy'), 1);
  puppet.attachToSlot('propSlot', prop);
  const current = mount();
  prop.destroy();
  assert.isTrue(current.isDestroyed);
  assert.isFalse(puppet.detach(prop));
  puppet.destroy();
});

test('invalid slot props fail before allocating wrappers or changing an existing attachment', () => {
  const { puppet, prop, mount } = fixture();
  puppet.attach('hand', prop);
  const current = mount();
  const create = vi.spyOn(prop.scene.add, 'container');
  assert.throws(() => puppet.attachToSlot('unknown', prop), /Unknown slot/);
  assert.throws(() => puppet.attachToSlot('propSlot', prop, { rotation: Number.NaN }), /finite/);
  assert.throws(() => puppet.attachToSlot('propSlot', puppetScene().add.container()), /puppet scene/);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(mount(), current);
  create.mockRestore();
  puppet.destroy();
});

test('slot artwork replacement preserves props on both sides of its depth', () => {
  const scene = puppetScene();
  const puppet = new Puppet(scene, {
    rig: {
      root: 'root',
      bones: [{ id: 'root' }],
      slots: [{ id: 'hand', bone: 'root' }],
      attachments: [
        { id: 'open', texture: 'open-hand' },
        { id: 'closed', texture: 'closed-hand' },
      ],
      skins: [
        { version: 1, name: 'default', slots: { hand: 'open' } },
        { version: 1, name: 'alternate', slots: { hand: 'closed' } },
      ],
    },
    skin: 'default',
    autoUpdate: false,
  });
  const front = scene.add.container();
  const behind = scene.add.container();
  puppet.attachToSlot('hand', front, { depth: 1 });
  puppet.attachToSlot('hand', behind, { depth: -1 });
  const mount = front.parentContainer.parentContainer;
  const assertOrder = () => {
    assert.deepEqual(mount.list, [behind.parentContainer, puppet.getSlotImage('hand')!, front.parentContainer]);
  };
  assertOrder();
  puppet.setAttachment('hand', 'closed');
  assertOrder();
  puppet.setSkin('default');
  assertOrder();
  puppet.applySkin('alternate');
  assertOrder();
  puppet.clearAttachment('hand');
  assert.deepEqual(mount.list, [behind.parentContainer, front.parentContainer]);
  puppet.setAttachment('hand', 'open');
  assertOrder();
  puppet.destroy();
});
