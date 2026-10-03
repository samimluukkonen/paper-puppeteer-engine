import { assert, test } from 'vitest';
import { SnapshotHistory } from '../src/devtools/shared/SnapshotHistory.js';

function fixture(limit = 100) {
  let value = 0;
  const history = new SnapshotHistory(
    () => value,
    (snapshot) => {
      value = snapshot;
    },
    (left, right) => left === right,
    limit,
  );
  return {
    history,
    value: () => value,
    edit: (next: number) =>
      history.change(() => {
        value = next;
      }),
    fail: (next: number, error: Error) =>
      history.change(() => {
        value = next;
        throw error;
      }),
  };
}

test('grouped edits form one entry, repeated begin is harmless, and undo finishes an open group', () => {
  const { history, value, edit } = fixture();
  history.beginOperation();
  edit(1);
  history.beginOperation();
  edit(2);
  assert.isTrue(history.inOperation);
  assert.equal(history.length, 0);
  assert.isTrue(history.undo());
  assert.equal(value(), 0);
  assert.isFalse(history.inOperation);
  assert.isFalse(history.endOperation());
  assert.isTrue(history.redo());
  assert.equal(value(), 2);
  assert.equal(history.length, 1);
});

test('no-op edits and groups preserve redo, while a changed edit clears it', () => {
  const { history, value, edit } = fixture();
  edit(1);
  history.undo();
  edit(0);
  history.beginOperation();
  edit(2);
  edit(0);
  assert.isTrue(history.endOperation());
  assert.equal(history.length, 0);
  assert.isTrue(history.canRedo);
  edit(3);
  assert.isFalse(history.canRedo);
  assert.isFalse(history.redo());
  history.undo();
  assert.equal(value(), 0);
});

test('bounded history drops oldest entries and redo respects the same limit', () => {
  const { history, value, edit } = fixture(2);
  for (const next of [1, 2, 3]) edit(next);
  assert.equal(history.length, 2);
  history.undo();
  history.undo();
  assert.equal(value(), 1);
  assert.isFalse(history.undo());
  history.redo();
  history.redo();
  assert.equal(value(), 3);
  assert.equal(history.length, 2);
  assert.isFalse(history.redo());
});

test.each([0, 100])('failed standalone edits roll back without changing undo/redo (limit %s)', (limit) => {
  const { history, value, edit, fail } = fixture(limit);
  edit(1);
  if (limit) {
    edit(2);
    history.undo();
  }
  const length = history.length;
  const canRedo = history.canRedo;
  const failure = new Error('Edit failed');
  assert.throws(() => fail(99, failure), /Edit failed/);
  assert.equal(value(), 1);
  assert.equal(history.length, length);
  assert.equal(history.canRedo, canRedo);
  assert.isFalse(history.inOperation);
  if (limit) {
    history.redo();
    assert.equal(value(), 2);
    history.undo();
    history.undo();
    assert.equal(value(), 0);
  }
});

test('failed grouped edits abort the whole group and preserve earlier history', () => {
  const { history, value, edit, fail } = fixture();
  edit(1);
  edit(2);
  history.undo();
  history.beginOperation();
  edit(3);
  edit(4);
  assert.throws(() => fail(99, new Error('Group failed')), /Group failed/);
  assert.equal(value(), 1);
  assert.isFalse(history.inOperation);
  assert.isFalse(history.endOperation());
  assert.equal(history.length, 1);
  assert.isTrue(history.canRedo);
  history.redo();
  assert.equal(value(), 2);
  history.beginOperation();
  edit(5);
  history.endOperation();
  history.undo();
  assert.equal(value(), 2);
});

test.each(['undo', 'redo'] as const)(
  'failed %s restoration rolls back state and retains its history entry',
  (action) => {
    let value = 0;
    let failNextRestore = false;
    const history = new SnapshotHistory(
      () => value,
      (entry) => {
        value = entry;
        if (failNextRestore) {
          failNextRestore = false;
          throw new Error('Restore failed');
        }
      },
      (left, right) => left === right,
    );
    history.change(() => {
      value = 1;
    });
    if (action === 'redo') history.undo();
    const before = value;
    const length = history.length;
    failNextRestore = true;
    assert.throws(() => history[action](), /Restore failed/);
    assert.equal(value, before);
    assert.equal(history.length, length);
    assert.isTrue(action === 'undo' ? history.canUndo : history.canRedo);
    assert.isTrue(history[action]());
    assert.equal(value, action === 'undo' ? 0 : 1);
  },
);

test('a failed rollback reports both the original edit error and the restoration error', () => {
  const editError = new Error('Edit failed');
  const rollbackError = new Error('Rollback failed');
  const history = new SnapshotHistory(
    () => 0,
    () => {
      throw rollbackError;
    },
    (left, right) => left === right,
  );
  let caught: unknown;
  try {
    history.change(() => {
      throw editError;
    });
  } catch (error) {
    caught = error;
  }
  assert.instanceOf(caught, AggregateError);
  assert.deepEqual((caught as AggregateError).errors, [editError, rollbackError]);
  assert.isFalse(history.inOperation);
  assert.equal(history.length, 0);
});

test('zero history limit keeps edits available without undo or redo entries', () => {
  const { history, value, edit } = fixture(0);
  history.beginOperation();
  edit(1);
  history.endOperation();
  assert.equal(value(), 1);
  assert.equal(history.length, 0);
  assert.isFalse(history.undo());
  assert.isFalse(history.redo());
});

test.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('history rejects invalid limit %s', (limit) => {
  assert.throws(() => fixture(limit), /nonnegative safe integer/);
});
