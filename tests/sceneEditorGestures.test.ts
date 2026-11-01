import { assert, test, vi } from 'vitest';
import { SceneEditorGestures } from '../src/devtools/scene-editor/SceneEditorGestures.js';
import { SnapshotHistory } from '../src/devtools/shared/SnapshotHistory.js';

function documentHistory() {
  let position = 0;
  const history = new SnapshotHistory(
    () => position,
    (snapshot) => {
      position = snapshot;
    },
    (left, right) => left === right,
  );
  return {
    history,
    position: () => position,
    move: (next: number) =>
      history.change(() => {
        position = next;
      }),
  };
}

test.each(['actor', 'image', 'action', 'audio', 'camera', 'cameraKey'] as const)(
  '%s gestures group movement, clear ownership before notifying, and preserve redo on cancellation',
  (kind) => {
    const document = documentHistory();
    const notify = vi.fn(() => assert.isFalse(gestures.hasActiveGesture));
    const gestures = new SceneEditorGestures(notify);
    const target = kind === 'camera' ? 0 : kind === 'cameraKey' ? true : 'selected';
    gestures.begin(kind, target, document.history);
    document.move(10);
    document.move(20);
    assert.isFalse(document.history.canUndo);
    // Ending another tool must leave the operation open.
    if (kind !== 'actor') gestures.end('actor');
    assert.isTrue(gestures.hasActiveGesture);
    gestures.end(kind);
    assert.equal(document.history.length, 1);
    assert.equal(notify.mock.calls.length, 1);
    document.history.undo();
    gestures.begin(kind, target, document.history);
    document.move(30);
    gestures.cancel();
    assert.equal(document.position(), 0);
    assert.isTrue(document.history.canRedo);
    document.history.redo();
    assert.equal(document.position(), 20);
    assert.equal(notify.mock.calls.length, 2);
    gestures.cancel();
    gestures.end();
    assert.equal(notify.mock.calls.length, 2, 'release after cancellation is inert');
  },
);

test('a new gesture rolls back the previous document and retains its own originating history', () => {
  const first = documentHistory();
  const second = documentHistory();
  const gestures = new SceneEditorGestures(() => {});
  gestures.begin('actor', 'first-actor', first.history);
  first.move(10);
  gestures.begin('camera', 0, second.history);
  second.move(20);
  assert.equal(first.position(), 0);
  assert.isFalse(first.history.inOperation);
  assert.equal(gestures.target('camera'), 0, 'time zero is an active camera gesture');
  assert.isNull(gestures.target('actor'));
  gestures.end('camera', 'cameraKey');
  assert.equal(first.history.length, 0);
  assert.equal(second.history.length, 1);
  second.history.undo();
  assert.equal(second.position(), 0);
});
