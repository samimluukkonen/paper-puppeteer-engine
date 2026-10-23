import { assert, test, vi } from 'vitest';
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
