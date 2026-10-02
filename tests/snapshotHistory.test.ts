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
