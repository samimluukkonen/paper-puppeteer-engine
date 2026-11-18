import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { toDisplayTransformValue, toLocalTransformValue } from '../src/devtools/animation-editor/transformValues.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { validateAnimationDefinition } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

function session() {
  const rig = new Rig({
    root: 'parent',
    bones: [
      { id: 'parent', x: 100, rotation: 0.7, scaleX: 2 },
      { id: 'child', parent: 'parent', x: 8, y: 40, rotation: 0.2, scaleY: 1.2 },
    ],
  });
  const clip: AnimationClip = {
    name: 'move',
    duration: 1000,
    loop: true,
    interpolation: 'linear',
    tracks: { parent: [{ time: 0, rotation: 1 }] },
    events: [{ time: 500, name: 'marker', data: { nested: [1, 2] } }],
  };
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other' }]);
  state.selectAnimation('move');
  state.selectBone('child');
  state.setCurrentTime(0.5);
  return { state, rig, clip };
}

test('create/update/delete undo and redo restore exact sparse snapshots and clean checkpoints', () => {
  const { state, rig, clip } = session();
  const caller = JSON.stringify(clip);
  const source = state.sourceAnimation;
  const baseline = state.workingAnimation!;
  const rotation = toLocalTransformValue('rotation', 35.123456789);
  for (const value of [0.1, 0.3, rotation]) state.setTemporaryBoneProperty('rotation', value);
  assert.equal(state.historyLength, 0, 'intermediate input events remain temporary');
  assert.isFalse(state.dirty);
  state.commitBoneProperty('rotation');
  const created = state.workingAnimation!;
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.deepEqual(created.tracks.child, [{ time: 500, rotation }]);
  state.undo();
  assert.strictEqual(state.workingAnimation, baseline);
  assert.isFalse(state.hasKeyframeAtTime('child', 'rotation'));
  assert.equal(state.selectedBoneTransform!.rotation, 0.2);
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, created);
  assert.isTrue(state.hasKeyframeAtTime('child', 'rotation'));

  state.markSaved();
  state.setTemporaryBoneProperty('rotation', 0.9);
  state.commitBoneProperty('rotation');
  const updated = state.workingAnimation!;
  state.undo();
  assert.strictEqual(state.workingAnimation, created);
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, updated);
  assert.isTrue(state.dirty);
  state.deleteBonePropertyKey('rotation');
  const deleted = state.workingAnimation!;
  assert.isUndefined(deleted.tracks.child);
  assert.equal(state.selectedBoneTransform!.rotation, 0.2, 'final deletion restores bind fallback');
  state.undo();
  assert.strictEqual(state.workingAnimation, updated, 'deletion restores exact authored data');
  state.redo();
  assert.strictEqual(state.workingAnimation, deleted);
  assert.isFalse(state.hasKeyframeAtTime('child', 'rotation'));

  for (const snapshot of [baseline, created, updated, deleted]) {
    assert.deepEqual(validateAnimationDefinition(snapshot, rig), []);
    assert.strictEqual(snapshot.tracks.parent, baseline.tracks.parent);
    assert.strictEqual(snapshot.events, baseline.events);
    assert.equal(snapshot.interpolation, 'linear');
  }
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(clip), caller);
  assert.equal(rig.getBone('child').rotation, 0.2);
});

test('new authored branches invalidate redo, while temporary and no-op edits preserve it', () => {
  const { state } = session();
  state.commitBoneProperty('x');
  state.setTemporaryBoneProperty('x', 12);
  state.commitBoneProperty('x');
  state.undo();
  state.setTemporaryBoneProperty('y', 60);
  state.cancelTransformEdit();
  state.commitBoneProperty('x');
  assert.isTrue(state.canRedo);
  state.setTemporaryBoneProperty('rotation', 0.5);
  state.commitBoneProperty('rotation');
  assert.isFalse(state.canRedo);
  assert.isFalse(state.redo());
  assert.equal(state.findBonePropertyKeyframe('child', 'x')!.value, 8);
  assert.equal(state.historyLength, 2);
});

test.each(['scrub', 'same time', 'clamped endpoint', 'restart', 'empty undo', 'empty redo'])(
  '%s cancels drafts and notifies even when authored data and time do not change',
  (action) => {
    const { state } = session();
    if (action === 'clamped endpoint') state.setCurrentTime(state.duration);
    if (action === 'restart') state.restart();
    const heldTime = state.currentTime;
    const held = state.workingAnimation;
    state.setTemporaryBoneProperty('x', 99);
    const listener = vi.fn();
    state.subscribe(listener);
    switch (action) {
      case 'scrub':
        state.beginScrub();
        break;
      case 'same time':
        state.setCurrentTime(heldTime);
        break;
      case 'clamped endpoint':
        state.setCurrentTime(99);
        break;
      case 'restart':
        state.restart();
        break;
      case 'empty undo':
        assert.isFalse(state.undo());
        break;
      case 'empty redo':
        assert.isFalse(state.redo());
        break;
    }
    assert.equal(listener.mock.calls.length, 1);
    assert.isFalse(state.hasTemporaryTransform);
    assert.equal(state.selectedBoneTransform!.x, 8);
    assert.strictEqual(state.workingAnimation, held);
    assert.equal(state.currentTime, heldTime);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
    state.commitBoneProperty('x');
    assert.equal(state.findBonePropertyKeyframe('child', 'x')!.value, 8, 'no ghost draft is committed');
  },
);

test('dirty switching is blocked and explicit discard resets animation-owned undo/redo and drafts', () => {
  const { state } = session();
  state.setTemporaryBoneProperty('rotation', 0.8);
  state.commitBoneProperty('rotation');
  const authored = state.workingAnimation;
  assert.isFalse(state.selectAnimation('other'));
  assert.equal(state.selectedAnimationId, 'move');
  assert.strictEqual(state.workingAnimation, authored);
  assert.equal(state.historyLength, 1);
  state.setTemporaryBoneProperty('x', 999);
  assert.isTrue(state.selectAnimation('other', { discardChanges: true }));
  assert.isFalse(state.hasTemporaryTransform);
  assert.equal(state.currentTime, 0);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.isFalse(state.canRedo);
  state.commitBoneProperty('y');
  state.undo();
  assert.isTrue(state.canRedo);
  assert.isTrue(state.selectAnimation('move'));
  assert.isFalse(state.canRedo, 'history from the other animation is never carried across');
  assert.isFalse(state.hasKeyframeAtTime('child', 'rotation', 0.5));
});

test('clamped endpoints and near-equal authoring retain sorted, deduplicated local keys through history', () => {
  const { state, rig } = session();
  state.setCurrentTime(-99);
  state.setTemporaryBoneProperty('rotation', toLocalTransformValue('rotation', -20));
  state.commitBoneProperty('rotation');
  state.setCurrentTime(0.5);
  state.setTemporaryBoneProperty('rotation', toLocalTransformValue('rotation', 35));
  state.commitBoneProperty('rotation');
  state.setCurrentTime(99);
  state.setTemporaryBoneProperty('rotation', toLocalTransformValue('rotation', -10));
  state.commitBoneProperty('rotation');
  const threeKeys = state.workingAnimation!;
  assert.deepEqual(
    threeKeys.tracks.child!.map((key) => key.time),
    [0, 500, 1000],
  );
  state.setCurrentTime(0.5000000001);
  state.setTemporaryBoneProperty('rotation', 0.8);
  state.commitBoneProperty('rotation');
  assert.deepEqual(
    state.workingAnimation!.tracks.child!.map((key) => key.time),
    [0, 500, 1000],
  );
  assert.equal(state.getEvaluatedBonePropertyValue('parent', 'rotation'), 1);
  assert.equal(state.getEvaluatedBonePropertyValue('child', 'x'), 8);
  state.undo();
  assert.strictEqual(state.workingAnimation, threeKeys);
  state.redo();
  assert.equal(state.findBonePropertyKeyframe('child', 'rotation')!.value, 0.8);
  assert.deepEqual(validateAnimationDefinition(state.workingAnimation, rig), []);
  const held = state.workingAnimation;
  assert.isFalse(state.keyframes.setBonePropertyKeyframe('child', 'rotation', Infinity));
  assert.isFalse(state.keyframes.setBonePropertyKeyframe('child', 'rotation', 1, 2));
  assert.strictEqual(state.workingAnimation, held);
});

test.each([-540, -20, 0, 35, 180, 540])('rotation %s° stores radians without authoring normalization', (degrees) => {
  const { state } = session();
  const radians = toLocalTransformValue('rotation', degrees);
  state.setTemporaryBoneProperty('rotation', radians);
  state.commitBoneProperty('rotation');
  assert.equal(state.findBonePropertyKeyframe('child', 'rotation')!.value, radians);
  assert.approximately(toDisplayTransformValue('rotation', radians), degrees, 1e-12);
  assert.equal(toLocalTransformValue('x', degrees), degrees);
  assert.equal(toDisplayTransformValue('scaleX', degrees), degrees);
});
