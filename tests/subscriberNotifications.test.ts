import { afterEach, assert, test, vi } from 'vitest';
import { notifySubscribers } from '../src/devtools/shared/subscriberNotifications.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('subscriber mutations affect the next notification and all failures are reported together', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const errors = [new Error('First'), new Error('Second')];
  const added = vi.fn();
  const removed = vi.fn(() => {
    throw errors[1];
  });
  const listeners = new Set<() => void>([
    () => {
      listeners.delete(removed);
      listeners.add(added);
      throw errors[0];
    },
    removed,
  ]);
  assert.doesNotThrow(() => notifySubscribers(listeners, 'Subscribers failed.'));
  assert.equal(removed.mock.calls.length, 1);
  assert.equal(added.mock.calls.length, 0);
  const failure: unknown = reporter.mock.calls[0]![0];
  assert.instanceOf(failure, AggregateError);
  if (failure instanceof AggregateError) assert.deepEqual(failure.errors, errors);
  notifySubscribers(listeners, 'Subscribers failed.');
  assert.equal(added.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[1]![0], errors[0]);
});

test('hosts without reportError receive a deferred error after the operation finishes', () => {
  vi.stubGlobal('reportError', undefined);
  let deferred: (() => void) | undefined;
  vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    deferred = callback;
  });
  const failure = new Error('Subscriber failed');
  assert.doesNotThrow(() =>
    notifySubscribers(
      new Set([
        () => {
          throw failure;
        },
      ]),
      'Subscribers failed.',
    ),
  );
  assert.isDefined(deferred);
  assert.throws(() => deferred!(), /Subscriber failed/);
});
