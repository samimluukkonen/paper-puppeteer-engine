import { assert, test, vi } from 'vitest';
import type { DemoState } from '../src/demo/DemoScene.js';
import { DemoUIStore } from '../src/demo/DemoUIStore.js';
import { dispatchListeners, throwNotificationErrors } from '../src/engine/notifications.js';

test('notification dispatch finishes a stable snapshot when subscribers add and remove listeners', () => {
  const calls: string[] = [];
  const second = () => calls.push('second');
  const late = () => calls.push('late');
  const listeners = new Set([
    () => {
      calls.push('first');
      listeners.delete(second);
      listeners.add(late);
    },
    second,
  ]);
  assert.deepEqual(
    dispatchListeners(listeners, (listener) => listener()),
    [],
  );
  assert.deepEqual(calls, ['first', 'second']);
  dispatchListeners(listeners, (listener) => listener());
  assert.deepEqual(calls, ['first', 'second', 'first', 'late']);
});

test('dispatch preserves failures, runs remaining subscribers, and respects host disposal', () => {
  const failure = new Error('listener failed');
  const remaining = vi.fn<() => void>();
  const listeners = new Set([
    () => {
      throw failure;
    },
    remaining,
    () => {
      throw 'second failure';
    },
  ]);
  const errors = dispatchListeners(listeners, (listener) => listener());
  assert.deepEqual(errors, [failure, 'second failure']);
  assert.equal(remaining.mock.calls.length, 1);
  assert.throws(() => throwNotificationErrors(errors, 'Listeners failed.'), AggregateError, 'Listeners failed.');
  try {
    throwNotificationErrors([failure], 'Single failure.');
    assert.fail('The original failure must be thrown.');
  } catch (error) {
    assert.strictEqual(error, failure);
  }
  let active = true;
  remaining.mockClear();
  dispatchListeners(
    new Set([
      () => {
        active = false;
      },
      remaining,
    ]),
    (listener) => listener(),
    () => active,
  );
  assert.equal(remaining.mock.calls.length, 0);
});

const state: DemoState = {
  animation: 'idle',
  animationRole: 'idle',
  facing: 'right',
  debug: false,
  playing: true,
  katanaVisible: true,
  handIK: false,
  footIK: false,
  ikDebug: false,
  playback: 'smooth',
  fps: 10,
  speed: 1,
  paused: false,
  upperBody: false,
  layerWeight: 0,
  transition: 'none',
  lastEvent: 'none',
  skin: 'default',
  gripHand: false,
  helmet: false,
  slotDebug: false,
  poseMode: false,
};

test('demo subscriptions use stable snapshots and unchanged UI state does not notify', () => {
  const store = new DemoUIStore();
  const second = vi.fn();
  const late = vi.fn();
  let releaseSecond = () => {};
  store.subscribe(() => {
    releaseSecond();
    store.subscribe(late);
  });
  releaseSecond = store.subscribe(second);
  store.update(state);
  assert.equal(second.mock.calls.length, 1);
  assert.equal(late.mock.calls.length, 0);
  store.update(state);
  assert.equal(late.mock.calls.length, 0);
  store.update({ ...state, lastEvent: 'next' });
  assert.equal(second.mock.calls.length, 1);
  assert.equal(late.mock.calls.length, 1);
});

test('a failing demo subscriber does not block other controls from reading the committed state', () => {
  const store = new DemoUIStore();
  const failure = new Error('broken control');
  store.subscribe(() => {
    throw failure;
  });
  const observer = vi.fn(() => {
    assert.isTrue(store.isPressed('walk'));
    assert.isFalse(store.isPressed('idle'));
    assert.include(store.getStatus(), 'Current: walk');
  });
  store.subscribe(observer);
  assert.throws(() => store.update({ ...state, animation: 'walk', animationRole: 'walk' }), 'broken control');
  assert.equal(observer.mock.calls.length, 1);
  assert.doesNotThrow(() => store.update({ ...state, animation: 'walk', animationRole: 'walk' }));
});
