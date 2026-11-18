import { assert, test } from 'vitest';
import { Scope } from '../src/devtools/shared/scope.js';

test('close releases in reverse registration order', () => {
  const scope = new Scope();
  const order: string[] = [];
  scope.add(() => order.push('first'));
  scope.add(() => order.push('second'));
  scope.add(() => order.push('third'));
  scope.close();
  assert.deepEqual(order, ['third', 'second', 'first']);
});

test('a second close releases nothing', () => {
  const scope = new Scope();
  let releases = 0;
  scope.add(() => releases++);
  scope.close();
  scope.close();
  assert.equal(releases, 1);
});

test('add after close releases immediately', () => {
  const scope = new Scope();
  scope.close();
  let released = false;
  scope.add(() => {
    released = true;
  });
  assert.isTrue(released);
});

test('close runs every release and rethrows all failures together', () => {
  const scope = new Scope();
  const order: string[] = [];
  const first = new Error('first');
  const third = new Error('third');
  scope.add(() => {
    order.push('first');
    throw first;
  });
  scope.add(() => order.push('second'));
  scope.add(() => {
    order.push('third');
    throw third;
  });
  try {
    scope.close();
    assert.fail('close should throw');
  } catch (error) {
    assert.instanceOf(error, AggregateError);
    assert.deepEqual(error.errors, [third, first]);
  }
  assert.deepEqual(order, ['third', 'second', 'first']);
  scope.close();
  assert.deepEqual(order, ['third', 'second', 'first']);
});
