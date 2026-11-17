import { afterEach, assert, test, vi } from 'vitest';
import { Subscribers } from '../src/devtools/shared/subscriberNotifications.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('a throwing listener does not stop later listeners and report mode reports the failure', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  const failure = new Error('UI failed');
  const later = vi.fn();
  subscribers.subscribe(() => {
    throw failure;
  });
  subscribers.subscribe(later);

  let returned: unknown[] | undefined;
  assert.doesNotThrow(() => (returned = subscribers.notify()));
  assert.deepEqual(returned, []);
  assert.equal(later.mock.calls.length, 1);
  assert.equal(reporter.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
});

test('collect mode returns every failure and does not report them', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.', onError: 'collect' });
  const first = new Error('First');
  const second = new Error('Second');
  subscribers.subscribe(() => {
    throw first;
  });
  subscribers.subscribe(() => {
    throw second;
  });

  assert.deepEqual(subscribers.notify(), [first, second]);
  assert.equal(reporter.mock.calls.length, 0);
});

test('a listener added during delivery is first notified on the next notify', () => {
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  const added = vi.fn();
  subscribers.subscribe(() => {
    subscribers.subscribe(added);
  });

  subscribers.notify();
  assert.equal(added.mock.calls.length, 0);
  subscribers.notify();
  assert.equal(added.mock.calls.length, 1);
});

test('a listener removed during delivery still receives the current notification', () => {
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  let release = () => {};
  subscribers.subscribe(() => release());
  const removed = vi.fn();
  release = subscribers.subscribe(removed);

  subscribers.notify();
  assert.equal(removed.mock.calls.length, 1);
  subscribers.notify();
  assert.equal(removed.mock.calls.length, 1);
});

test('getSnapshot advances once per notify and unsubscribe stops delivery', () => {
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  const listener = vi.fn();
  const release = subscribers.subscribe(listener);
  assert.equal(subscribers.getSnapshot(), 0);

  subscribers.notify();
  assert.equal(subscribers.getSnapshot(), 1);
  release();
  subscribers.notify();
  assert.equal(subscribers.getSnapshot(), 2);
  assert.equal(listener.mock.calls.length, 1);
});

test('clear drops every listener', () => {
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  const first = vi.fn();
  const second = vi.fn();
  subscribers.subscribe(first);
  subscribers.subscribe(second);

  subscribers.clear();
  subscribers.notify();
  assert.equal(first.mock.calls.length + second.mock.calls.length, 0);
});

test('report mode groups several failures into one AggregateError', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  const errors = [new Error('First'), new Error('Second')];
  for (const error of errors)
    subscribers.subscribe(() => {
      throw error;
    });

  subscribers.notify();
  const failure: unknown = reporter.mock.calls[0]![0];
  assert.instanceOf(failure, AggregateError);
  if (failure instanceof AggregateError) {
    assert.equal(failure.message, 'Widget subscribers failed.');
    assert.deepEqual(failure.errors, errors);
  }
});

test('hosts without reportError receive a deferred error after the operation finishes', () => {
  vi.stubGlobal('reportError', undefined);
  let deferred: (() => void) | undefined;
  vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    deferred = callback;
  });
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  subscribers.subscribe(() => {
    throw new Error('Subscriber failed');
  });

  assert.doesNotThrow(() => subscribers.notify());
  assert.isDefined(deferred);
  assert.throws(() => deferred!(), /Subscriber failed/);
});

test('size counts current subscriptions so owners can be checked for leaks', () => {
  const subscribers = new Subscribers({ label: 'Widget subscribers failed.' });
  const release = subscribers.subscribe(() => {});
  subscribers.subscribe(() => {});
  assert.equal(subscribers.size, 2);
  release();
  assert.equal(subscribers.size, 1);
  subscribers.clear();
  assert.equal(subscribers.size, 0);
});
