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
    rig: { root: 'root', bones: [{ id: 'root' }, { id: 'hand', parent: 'root' }] },
    autoUpdate: false,
  });
  const prop = scene.add.container(0, 0);
  const events = new EventEmitter();
  const callbacks = new Map<Parameters<typeof prop.once>[1], (...args: unknown[]) => void>();
  prop.once = (event, listener, context) => {
    const callback = (...args: unknown[]): void => listener.apply(context, args);
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
  const create = vi.spyOn(prop.scene!.add, 'container');
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
