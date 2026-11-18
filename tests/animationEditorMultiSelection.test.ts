import { assert, test } from 'vitest';
import { AnimationEditorSelection } from '../src/devtools/animation-editor/AnimationEditorSelection.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { KEYFRAME_TIME_TOLERANCE_MS } from '../src/devtools/animation-editor/keyframes.js';
import {
  keyIdentity,
  keyframeSelectionIndex,
  keysInMarquee,
  reconcileKeyframeSelection,
} from '../src/devtools/animation-editor/keyframeSelection.js';
import type { KeyframeSelection } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const key = (time: number, property: KeyframeSelection['property'] = 'x', boneId = 'root'): KeyframeSelection => ({
  boneId,
  property,
  time,
});

test('selection indexes preserve exact identities and order, and cache only deeply immutable references', () => {
  const near = key(0.5 + KEYFRAME_TIME_TOLERANCE_MS / 2000);
  const first = Object.freeze(key(0.5));
  const keys = Object.freeze([first, Object.freeze(near), Object.freeze(key(0.5))]);
  const index = keyframeSelectionIndex(keys);
  assert.deepEqual([...index.values()], [first, near]);
  assert.strictEqual(index.get(keyIdentity(first)), first);
  assert.strictEqual(keyframeSelectionIndex(keys), index);
  assert.notEqual(keyIdentity(key(1, 'x', 'a:x')), keyIdentity(key(1, 'x', 'a')));
  const mutable = [{ boneId: 'root', property: 'x' as const, time: 0 }];
  const before = keyframeSelectionIndex(mutable);
  mutable[0]!.time = 1;
  assert.isTrue(keyframeSelectionIndex(mutable).has(keyIdentity(key(1))));
  assert.isFalse(before.has(keyIdentity(key(1))));
  Object.freeze(mutable);
  mutable[0]!.time = 2;
  assert.isTrue(keyframeSelectionIndex(mutable).has(keyIdentity(key(2))));
});

test('dense selection deduplication reads identities in linear work and retains deterministic primary order', () => {
  let identityReads = 0;
  const keys = Array.from(
    { length: 2000 },
    (_, time) =>
      new Proxy(key(time), {
        get(target, property, receiver): unknown {
          if (property === 'boneId') identityReads += 1;
          return Reflect.get(target, property, receiver);
        },
      }),
  );
  const selection = new AnimationEditorSelection(undefined);
  selection.setKeys([...keys, ...keys], key(1000));
  assert.equal(selection.keys.length, 2000);
  assert.deepEqual(selection.key, key(1000));
  assert.deepEqual(
    selection.keys.map((entry) => entry.time),
    Array.from({ length: 2000 }, (_, time) => time),
  );
  assert.isBelow(identityReads, keys.length * 4, 'duplicates must not rescan the growing selection');
  assert.isTrue(selection.hasKey(key(1999)));
});
function session() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] });
  const input: AnimationClip = {
    name: 'move',
    duration: 2000,
    loop: false,
    events: [{ time: 500, name: 'cue' }],
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 500, x: 1, y: 5 },
        { time: 1000, x: 2 },
        { time: 2000, x: 3 },
      ],
      arm: [
        { time: 750, rotation: 0.5 },
        { time: 1500, rotation: 1 },
      ],
    },
  };
  const state = new AnimationEditorState(rig, [input, { ...input, name: 'other' }]);
  state.selectAnimation('move');
  state.setTimelineBoneExpanded('root', true);
  state.setTimelineBoneExpanded('arm', true);
  return { state, input };
}

test('normal selection replaces the set; additive toggles preserve primary/time with deterministic fallback', () => {
  const { state } = session();
  const working = state.workingAnimation;
  state.playback.play();
  state.selectKeyframe(key(0.5));
  assert.deepEqual(state.selectedKeys, [key(0.5)]);
  assert.deepEqual(state.primaryKey, key(0.5));
  assert.strictEqual(state.selectedKeyframe, state.primaryKey);
  assert.isFalse(state.playback.isPlaying);
  state.selectKeyframe(key(0.75, 'rotation', 'arm'), { additive: true });
  assert.deepEqual(state.selectedKeys, [key(0.5), key(0.75, 'rotation', 'arm')]);
  assert.deepEqual(state.primaryKey, key(0.5));
  assert.equal(state.currentTime, 0.5);
  assert.equal(state.selectedBoneId, 'root');
  state.selectKeyframe(key(0.5), { additive: true });
  assert.deepEqual(state.primaryKey, key(0.75, 'rotation', 'arm'));
  assert.equal(state.selectedBoneId, 'arm');
  assert.equal(state.selectedTimelineProperty, 'rotation');
  assert.equal(state.currentTime, 0.5, 'fallback primary does not seek');
  state.selectKeyframe(key(0.75, 'rotation', 'arm'), { additive: true });
  assert.isNull(state.primaryKey);
  assert.deepEqual(state.selectedKeys, []);
  state.selectKeyframe(key(0), { additive: true });
  assert.deepEqual(state.primaryKey, key(0));
  assert.equal(state.currentTime, 0.5, 'additive selection never seeks');
  state.selectKeyframe(key(2));
  assert.deepEqual(state.selectedKeys, [key(2)]);
  assert.equal(state.currentTime, 2);
  assert.isTrue(Object.isFrozen(state.selectedKeys));
  assert.isTrue(state.selectedKeys.every(Object.isFrozen));
  assert.strictEqual(state.workingAnimation, working);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});

test('Shift selects an inclusive same-track range with a stable anchor; cross-track adds clicked primary', () => {
  const { state } = session();
  state.selectKeyframe(key(0));
  state.selectKeyframe(key(2), { range: true });
  assert.deepEqual(state.selectedKeys, [key(0), key(0.5), key(1), key(2)]);
  assert.deepEqual(state.primaryKey, key(2));
  state.selectKeyframe(key(1), { range: true });
  assert.deepEqual(state.selectedKeys, [key(0), key(0.5), key(1)]);
  assert.equal(state.currentTime, 1);
  state.selectKeyframe(key(0.75, 'rotation', 'arm'), { range: true });
  assert.equal(state.selectedKeys.length, 4);
  assert.equal(state.primaryKey?.boneId, 'arm');
  assert.equal(state.selectedBoneId, 'arm');
  assert.equal(state.currentTime, 0.75);
  state.selectKeyframe(key(2), { additive: true, range: true });
  assert.equal(state.selectedKeys.length, 5);
  assert.isFalse(state.dirty);
});

test('marquee respects inclusive/reversed time and visible-row boundaries across tracks, and additive union', () => {
  const { state } = session();
  const tracks = state.timelineTracks;
  const rootX = tracks.findIndex((row) => row.kind === 'property' && row.boneId === 'root' && row.property === 'x');
  const armRotation = tracks.findIndex(
    (row) => row.kind === 'property' && row.boneId === 'arm' && row.property === 'rotation',
  );
  const box = { startTime: 1, endTime: 0.5, firstRow: armRotation, lastRow: rootX };
  assert.deepEqual(
    keysInMarquee(tracks, box).map(({ boneId, property, time }) => ({ boneId, property, time })),
    [key(0.5), key(1), key(0.5, 'y'), key(0.75, 'rotation', 'arm')],
  );
  state.selectKeyframeMarquee(box);
  assert.equal(state.selectedKeys.length, 4);
  assert.deepEqual(state.primaryKey, key(0.5));
  assert.equal(state.currentTime, 0.5);
  state.selectKeyframeMarquee({ ...box, startTime: 2, endTime: 2, firstRow: rootX, lastRow: rootX }, true);
  assert.equal(state.selectedKeys.length, 5);
  assert.equal(state.currentTime, 0.5);
  state.selectKeyframeMarquee({ ...box, firstRow: -1, lastRow: -1 });
  assert.deepEqual(state.selectedKeys, []);
  assert.isNull(state.primaryKey);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});

test('clear/navigation/switch discard selection; failed animation switch preserves it; collapse retains it', () => {
  const { state } = session();
  state.selectKeyframes([key(0.5), key(0.75, 'rotation', 'arm')]);
  state.setTimelineBoneExpanded('root', false);
  assert.equal(state.selectedKeys.length, 2);
  state.clearKeyframeSelection();
  assert.deepEqual(state.selectedKeys, []);
  assert.equal(state.selectedBoneId, 'root');
  assert.equal(state.selectedTimelineProperty, 'x');
  for (const clear of [
    () => state.selectBone('root'),
    () => state.selectTimelineProperty('root', 'y'),
    () => state.selectAnimation('other'),
  ]) {
    state.selectKeyframes([key(0), key(0.5)]);
    clear();
    assert.deepEqual(state.selectedKeys, []);
    assert.isNull(state.primaryKey);
  }
  state.selectKeyframe(key(0.5));
  state.keyframes.setBonePropertyKeyframe('root', 'x', 9, 0.5);
  assert.isFalse(state.selectAnimation('move'));
  assert.deepEqual(state.selectedKeys, [key(0.5)]);
});

test('reconciliation retains value edits, drops deleted keys, resolves normalized times, and deduplicates', () => {
  const { state } = session();
  state.selectKeyframes([key(0.5), key(0.75, 'rotation', 'arm')]);
  state.keyframes.setBonePropertyKeyframe('root', 'x', 99, 0.5);
  assert.equal(state.selectedKeys.length, 2);
  state.keyframes.removeBonePropertyKeyframe('root', 'x', 0.5);
  assert.deepEqual(state.selectedKeys, [key(0.75, 'rotation', 'arm')]);
  assert.equal(state.selectedBoneId, 'arm');
  assert.equal(state.selectedTimelineProperty, 'rotation');
  const next = structuredClone(state.workingAnimation!) as AnimationClip;
  next.tracks.arm![0]!.time += KEYFRAME_TIME_TOLERANCE_MS / 2;
  state.replaceWorkingAnimation(next);
  assert.equal(state.primaryKey?.time, next.tracks.arm![0]!.time / 1000);
  const result = reconcileKeyframeSelection(state.workingAnimation, {
    selectedKeys: [key(0), key(0), key(0.5), key(0.75, 'rotation', 'arm')],
    primaryKey: key(0.5),
  });
  assert.equal(result.selectedKeys.length, 2);
  assert.deepEqual(result.primaryKey, key(0));
  assert.deepEqual(reconcileKeyframeSelection(null, result).selectedKeys, []);
});

test('distinct authored times within tolerance stay distinct and deletion never selects a nearby survivor', () => {
  const { state } = session();
  const next = structuredClone(state.workingAnimation!) as AnimationClip;
  next.tracks = {
    ...next.tracks,
    root: [
      ...next.tracks.root!.slice(0, 2),
      { time: 500 + KEYFRAME_TIME_TOLERANCE_MS / 2, x: 3 },
      ...next.tracks.root!.slice(2),
    ],
  };
  state.replaceWorkingAnimation(next);
  const near = next.tracks.root![2]!.time / 1000;
  state.selectKeyframes([key(0.5), key(near)]);
  assert.equal(state.selectedKeys.length, 2);
  state.keyframes.removeBonePropertyKeyframe('root', 'x', 0.5);
  assert.deepEqual(state.selectedKeys, [key(near)]);
  state.deleteSelectedKeyframes();
  assert.deepEqual(state.selectedKeys, []);
});

test('single-key and group moves follow selection, and dragging an unselected key replaces the set', () => {
  const { state } = session();
  state.selectKeyframe(key(0.5));
  state.keyframes.moveSelectedKeyframe(0.6);
  assert.deepEqual(state.primaryKey, key(0.6));
  state.selectKeyframe(key(0.75, 'rotation', 'arm'), { additive: true });
  assert.isTrue(state.nudgeSelectedKeyframe(1));
  assert.deepEqual(state.selectedKeys, [key(0.61), key(0.76, 'rotation', 'arm')]);
  assert.isTrue(state.keyframes.moveSelectedKeyframe(0.8));
  assert.deepEqual(state.selectedKeys, [key(0.8), key(0.95, 'rotation', 'arm')]);
  assert.deepEqual(state.primaryKey, key(0.8));
  assert.isTrue(state.keyframes.beginKeyframeDrag(key(0.8)));
  state.keyframes.previewKeyframeDrag(0.7);
  state.keyframes.commitKeyframeDrag();
  assert.deepEqual(state.selectedKeys, [key(0.7), key(0.85, 'rotation', 'arm')]);
  assert.isTrue(state.keyframes.beginKeyframeDrag(key(1)));
  assert.deepEqual(state.selectedKeys, [key(1)]);
  state.keyframes.previewKeyframeDrag(1.1);
  state.keyframes.commitKeyframeDrag();
  assert.deepEqual(state.selectedKeys, [key(1.1)]);
});

test('multi-delete is one history action, preserves sparse siblings/source/events, and undo/redo restores authored data', () => {
  const { state, input } = session();
  const original = JSON.stringify(input);
  const source = state.sourceAnimation;
  const before = state.workingAnimation;
  state.selectKeyframes([key(0), key(0.5), key(0.75, 'rotation', 'arm')]);
  state.setCurrentTime(1.9);
  let notifications = 0;
  state.subscribe(() => notifications++);
  assert.isTrue(state.deleteSelectedKeyframes());
  assert.equal(notifications, 1);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.isNull(state.primaryKey);
  assert.deepEqual(state.selectedKeys, []);
  assert.isUndefined(state.findBonePropertyKeyframe('root', 'x', 0));
  assert.isUndefined(state.findBonePropertyKeyframe('root', 'x', 0.5));
  assert.equal(state.findBonePropertyKeyframe('root', 'y', 0.5)?.value, 5);
  assert.equal(state.findBonePropertyKeyframe('root', 'x', 1)?.value, 2);
  assert.isUndefined(state.findBonePropertyKeyframe('arm', 'rotation', 0.75));
  assert.equal(state.validationIssues.length, 0);
  assert.deepEqual(state.workingAnimation?.events, before?.events);
  const deleted = state.workingAnimation;
  assert.isTrue(state.undo());
  assert.deepEqual(state.workingAnimation, before);
  assert.isFalse(state.dirty);
  assert.deepEqual(state.selectedKeys, [], 'history does not restore transient selection');
  // Selection never destroys a pending redo branch.
  state.selectKeyframe(key(0.5));
  assert.isTrue(state.canRedo);
  assert.isTrue(state.redo());
  assert.deepEqual(state.workingAnimation, deleted);
  assert.deepEqual(state.selectedKeys, []);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(input), original);
});

test('deleting unrelated or secondary keys preserves pending drafts in the unchanged primary context', () => {
  const { state } = session();
  state.selectKeyframes([key(0.5), key(0.75, 'rotation', 'arm')]);
  state.setTemporaryBoneProperty('y', 123);
  state.keyframes.removeBonePropertyKeyframe('root', 'x', 1);
  assert.equal(state.boneTransformDraft.y, 123);
  state.keyframes.removeBonePropertyKeyframe('arm', 'rotation', 0.75);
  assert.equal(state.boneTransformDraft.y, 123);
  assert.deepEqual(state.selectedKeys, [key(0.5)]);
});
