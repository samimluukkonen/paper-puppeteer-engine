import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  constrainKeyframeMoveDelta,
  KEYFRAME_TIME_TOLERANCE_MS,
  moveBonePropertyKeyframes,
} from '../src/devtools/animation-editor/keyframes.js';
import type { KeyframeSelection } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] });

test.each(['constructor', 'toString', 'hasOwnProperty'])(
  'moving all keys recreates the own track for bone %s',
  (boneId) => {
    const skeleton = new Rig({ root: boneId, bones: [{ id: boneId }] });
    const animation: AnimationClip = {
      name: 'group',
      duration: 1000,
      loop: false,
      tracks: {
        [boneId]: [
          { time: 100, x: 1 },
          { time: 200, x: 2 },
        ],
      },
    };
    const before = JSON.stringify(animation);
    const result = moveBonePropertyKeyframes(
      animation,
      skeleton,
      [
        { boneId, property: 'x', timeMs: 100 },
        { boneId, property: 'x', timeMs: 200 },
      ],
      100,
    );
    assert.isTrue(Object.hasOwn(result.animation.tracks, boneId));
    assert.deepEqual(result.animation.tracks[boneId], [
      { time: 200, x: 1 },
      { time: 300, x: 2 },
    ]);
    assert.deepEqual(
      result.keys.map((entry) => entry.timeMs),
      [200, 300],
    );
    assert.equal(JSON.stringify(animation), before);
  },
);

const key = (time: number, property: KeyframeSelection['property'] = 'x', boneId = 'root'): KeyframeSelection => ({
  boneId,
  property,
  time,
});
const group = [
  key(0.2),
  key(0.2, 'y'),
  key(0.5),
  key(0.9),
  key(1.2),
  key(0.35, 'rotation', 'arm'),
  key(0.6, 'rotation', 'arm'),
  key(0.9, 'x', 'arm'),
];
function session() {
  const input: AnimationClip = {
    name: 'group',
    duration: 2000,
    loop: false,
    interpolation: 'linear',
    tracks: {
      root: [
        { time: 200, x: 1, y: 5 },
        { time: 500, x: 2 },
        { time: 900, x: 3 },
        { time: 1200, x: 4 },
        { time: 1400, x: 99, y: 8 },
      ],
      arm: [
        { time: 350, rotation: 0.3 },
        { time: 600, rotation: 0.6 },
        { time: 900, x: 10 },
        { time: 1100, rotation: 99, y: 12 },
      ],
    },
    events: [{ time: 500, name: 'cue', data: { value: 3 } }],
  };
  const state = new AnimationEditorState(rig, [input, { ...input, name: 'other' }]);
  state.selectAnimation('group');
  state.selectKeyframes(group);
  state.setTimelineBoneExpanded('arm', true);
  return { state, input };
}
const targets = (keys: readonly KeyframeSelection[]) =>
  keys.map(({ boneId, property, time }) => ({ boneId, property, timeMs: time * 1000 }));
const shifted = (keys: readonly KeyframeSelection[], deltaMs: number) =>
  keys.map((entry) => ({ ...entry, time: (entry.time * 1000 + deltaMs) / 1000 }));
function checkValues(state: AnimationEditorState, keys: readonly KeyframeSelection[]) {
  for (const [index, ref] of keys.entries()) {
    const moved = state.findBonePropertyKeyframe(ref.boneId, ref.property, ref.time);
    assert.equal(moved?.value, [1, 5, 2, 3, 4, 0.3, 0.6, 10][index]);
  }
}

test.each([400, -150])('all eight selected properties preserve spacing and values at delta %s ms', (deltaMs) => {
  const { state, input } = session();
  const source = JSON.stringify(input);
  const before = state.workingAnimation;
  state.playback.play();
  assert.isTrue(state.keyframes.beginKeyframeDrag(group[0]!));
  assert.isFalse(state.playback.isPlaying);
  state.keyframes.previewKeyframeDrag((200 + deltaMs) / 1000);
  assert.deepEqual(state.keyframes.keyframeDrag?.originalKeys, group);
  assert.approximately(state.keyframes.keyframeDrag!.previewDelta, deltaMs / 1000, 1e-12);
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  state.keyframes.commitKeyframeDrag();
  assert.deepEqual(state.selectedKeys, shifted(group, deltaMs));
  assert.deepEqual(state.primaryKey, shifted(group, deltaMs)[0]);
  checkValues(state, state.selectedKeys);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.equal(state.validationIssues.length, 0);
  assert.equal(JSON.stringify(input), source);
  assert.isFalse(Object.isFrozen(input.tracks.root));
  assert.deepEqual(state.sourceAnimation?.tracks, input.tracks);
  assert.strictEqual(state.workingAnimation?.events, before?.events);
  const moved = state.workingAnimation;
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
  assert.isFalse(state.playback.isPlaying);
});

test.each([-10, 10])('one boundary constraint preserves the whole group at target %s seconds', (time) => {
  const { state } = session();
  state.keyframes.beginKeyframeDrag(group[2]!); // Middle key is the drag anchor/primary.
  state.keyframes.previewKeyframeDrag(time);
  const delta = time < 0 ? -200 : 800;
  assert.approximately(state.currentTime, (500 + delta) / 1000, 1e-12);
  state.keyframes.commitKeyframeDrag();
  assert.deepEqual(state.selectedKeys, shifted(group, delta));
  assert.deepEqual(state.primaryKey, shifted(group, delta)[2]);
  checkValues(state, state.selectedKeys);
  const times = state.selectedKeys.map((entry) => entry.time);
  assert.equal(time < 0 ? Math.min(...times) : Math.max(...times), time < 0 ? 0 : 2);
  const history = state.historyLength;
  state.nudgeSelectedKeyframe(time < 0 ? -1 : 1);
  assert.equal(state.historyLength, history, 'blocked boundary nudge adds no operation');
});

test('group filling duration and zero-duration clips cannot move or create history', () => {
  assert.equal(constrainKeyframeMoveDelta([0, 2000], 500, 2000), 0);
  assert.equal(constrainKeyframeMoveDelta([1, 1999], 500, 2000), 1);
  const input: AnimationClip = { name: 'zero', duration: 0, loop: false, tracks: { root: [{ time: 0, x: 1, y: 2 }] } };
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation('zero');
  state.selectKeyframes([key(0), key(0, 'y')]);
  const before = state.workingAnimation;
  state.keyframes.beginKeyframeDrag(key(0));
  state.keyframes.previewKeyframeDrag(10);
  state.keyframes.commitKeyframeDrag();
  state.nudgeSelectedKeyframe(1);
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
  assert.equal(state.selectedKeys.length, 0);
  assert.isNull(state.workingAnimation);
  assert.isNotEmpty(state.validationIssues);
  assert.isFalse(state.dirty);
});

test('frame snapping comes only from the anchor; off-frame offsets and boundary spacing survive', () => {
  const { state } = session();
  state.setKeyframeSnapMode('frame');
  state.keyframes.beginKeyframeDrag(group[5]!); // 0.35 seconds, on another bone.
  state.keyframes.previewKeyframeDrag(0.67);
  assert.equal(state.currentTime, 0.7);
  assert.approximately(state.keyframes.keyframeDrag!.previewDelta, 0.35, 1e-12);
  assert.equal(state.primaryKey?.boneId, 'arm');
  assert.equal(state.selectedTimelineProperty, 'rotation');
  state.keyframes.previewKeyframeDrag(0.673, true);
  assert.equal(state.currentTime, 0.673);
  state.keyframes.previewKeyframeDrag(0.67);
  state.keyframes.commitKeyframeDrag();
  assert.deepEqual(state.selectedKeys, shifted(group, 350));
  assert.deepEqual(state.primaryKey, key(0.7, 'rotation', 'arm'));
  assert.equal(state.selectedKeys[0]?.time, 0.55, 'other keys do not snap independently');
});

test('source positions of selected keys never cause self-collisions', () => {
  const { state } = session();
  state.selectKeyframes([group[0]!, group[2]!]);
  state.keyframes.moveSelectedKeyframe(0.5); // Earliest moves onto the selected second key's original time.
  assert.deepEqual(state.selectedKeys, [key(0.5), key(0.8)]);
  assert.equal(state.findBonePropertyKeyframe('root', 'x', 0.5)?.value, 1);
  assert.equal(state.findBonePropertyKeyframe('root', 'x', 0.8)?.value, 2);
  assert.equal(state.findBonePropertyKeyframe('root', 'y', 0.2)?.value, 5);
});

test('simultaneous external collisions replace properties atomically and Undo/Redo restores exact rows', () => {
  const { state } = session();
  const before = state.workingAnimation;
  state.keyframes.moveSelectedKeyframe(0.7);
  const moved = state.workingAnimation;
  assert.deepEqual(
    state.workingAnimation?.tracks.root?.find((row) => row.time === 1400),
    { time: 1400, x: 3, y: 8 },
  );
  assert.deepEqual(
    state.workingAnimation?.tracks.arm?.find((row) => row.time === 1100),
    { time: 1100, rotation: 0.6, y: 12 },
  );
  assert.equal(state.selectedKeys.length, 8);
  assert.equal(state.historyLength, 1);
  for (const rows of Object.values(state.workingAnimation!.tracks)) {
    assert.equal(new Set(rows.map((row) => row.time)).size, rows.length);
    assert.isTrue(rows.every((row, index) => index === 0 || row.time > rows[index - 1]!.time));
  }
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
});

test('tolerant external collisions retain one common delta and nearby selected keys remain distinct', () => {
  const epsilon = KEYFRAME_TIME_TOLERANCE_MS / 2;
  const input: AnimationClip = {
    name: 'near',
    duration: 2000,
    loop: false,
    tracks: {
      root: [
        { time: 200, x: 1 },
        { time: 200 + epsilon, x: 2 },
        { time: 500 + epsilon, x: 99, y: 7 },
      ],
      arm: [
        { time: 350, rotation: 0.3 },
        { time: 650 - epsilon, rotation: 99, y: 8 },
      ],
    },
  };
  const moved = moveBonePropertyKeyframes(
    input,
    rig,
    targets([key(0.2), key((200 + epsilon) / 1000), key(0.35, 'rotation', 'arm')]),
    300,
  );
  assert.deepEqual(moved.animation.tracks.root, [
    { time: 500, x: 1 },
    { time: 500 + epsilon, y: 7, x: 2 },
  ]);
  assert.deepEqual(moved.animation.tracks.arm, [
    { time: 650 - epsilon, y: 8 },
    { time: 650, rotation: 0.3 },
  ]);
});

test.each(['missing', 'bone', 'property', 'nonfinite', 'source-time'])(
  'invalid %s in a group rejects the entire pure move',
  (invalid) => {
    const { state } = session();
    const source = state.workingAnimation!;
    const original = JSON.stringify(source);
    const entries = targets(group);
    if (invalid === 'missing') entries[7]!.timeMs = 700;
    if (invalid === 'bone') entries[7]!.boneId = 'missing';
    if (invalid === 'property') Object.assign(entries[7]!, { property: 'invalid' });
    if (invalid === 'source-time') entries[7]!.timeMs = -1;
    assert.throws(() => moveBonePropertyKeyframes(source, rig, entries, invalid === 'nonfinite' ? NaN : 500));
    assert.equal(JSON.stringify(source), original);
    assert.strictEqual(state.workingAnimation, source);
    assert.equal(state.historyLength, 0);
    assert.deepEqual(state.selectedKeys, group);
  },
);

test('cancel restores the original set and primary, with no authored/history/dirty changes or redo loss', () => {
  const { state } = session();
  state.keyframes.moveSelectedKeyframe(0.7);
  state.undo();
  state.selectKeyframes(group);
  const before = state.workingAnimation;
  state.keyframes.beginKeyframeDrag(group[5]!);
  state.keyframes.previewKeyframeDrag(1.1);
  state.playback.play();
  assert.isFalse(state.playback.isPlaying);
  state.keyframes.cancelKeyframeDrag();
  assert.strictEqual(state.workingAnimation, before);
  assert.deepEqual(state.selectedKeys, group);
  assert.deepEqual(state.primaryKey, group[0]);
  assert.equal(state.currentTime, group[5]!.time);
  assert.equal(state.historyLength, 0);
  assert.isTrue(state.canRedo);
  assert.isFalse(state.dirty);
});

test('group arrow nudge uses frame/small/large steps and one snapshot per changed keypress', () => {
  const { state } = session();
  const before = state.workingAnimation;
  state.nudgeSelectedKeyframe(1);
  assert.deepEqual(state.selectedKeys, shifted(group, 10));
  assert.equal(state.currentTime, 0.21);
  assert.equal(state.historyLength, 1);
  const moved = state.workingAnimation;
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
  state.selectKeyframes(shifted(group, 10));
  state.nudgeSelectedKeyframe(-1, true);
  assert.deepEqual(state.selectedKeys, shifted(group, -90));
  state.playback.setAuthoredPlaybackMode('stepped');
  state.playback.setAuthoredFPS(20);
  state.setKeyframeSnapMode('frame');
  state.nudgeSelectedKeyframe(1);
  assert.deepEqual(state.selectedKeys, shifted(group, -50)); // 0.11 anchor + frame snaps to 0.15.
  assert.equal(state.primaryKey?.time, 0.15);
});

test('copy/paste/duplicate/delete and marquee resolve moved authored times with no stale selection', () => {
  const { state } = session();
  state.keyframes.moveSelectedKeyframe(0.6);
  state.keyframes.copySelectedKeyframes();
  assert.equal(state.keyframes.keyframeClipboard?.anchorTimeMs, 600);
  assert.deepEqual(
    state.keyframes.keyframeClipboard?.entries.map((entry) => entry.relativeTimeMs),
    [0, 0, 150, 300, 400, 700, 700, 1000],
  );
  state.setCurrentTime(2);
  state.keyframes.pasteKeyframes();
  assert.deepEqual(
    state.selectedKeys,
    shifted(group, 1800).sort((a, b) => a.time - b.time),
  );
  checkValues(state, shifted(group, 1800));
  state.keyframes.duplicateSelectedKeyframes();
  assert.deepEqual(
    state.selectedKeys,
    shifted(group, 1810).sort((a, b) => a.time - b.time),
  );
  const beforeDelete = state.workingAnimation;
  const history = state.historyLength;
  state.deleteSelectedKeyframes();
  assert.equal(state.historyLength, history + 1);
  assert.equal(state.selectedKeys.length, 0);
  state.undo();
  assert.strictEqual(state.workingAnimation, beforeDelete);
  const rows = state.timelineTracks;
  const row = rows.findIndex((entry) => entry.kind === 'property' && entry.boneId === 'root' && entry.property === 'x');
  state.selectKeyframeMarquee({ startTime: 2.009, endTime: 2.011, firstRow: row, lastRow: row });
  assert.deepEqual(state.selectedKeys, [key(2.01)]);
});

test('animation switching and authored mutation cancel group previews and reconcile selection', () => {
  const { state } = session();
  state.keyframes.beginKeyframeDrag(group[0]!);
  state.keyframes.previewKeyframeDrag(0.7);
  state.selectAnimation('other');
  assert.isNull(state.keyframes.keyframeDrag);
  assert.deepEqual(state.selectedKeys, []);
  state.selectKeyframes(group);
  state.keyframes.beginKeyframeDrag(group[0]!);
  state.keyframes.previewKeyframeDrag(0.7);
  state.keyframes.removeBonePropertyKeyframe('root', 'x', 0.2);
  assert.isNull(state.keyframes.keyframeDrag);
  assert.equal(state.selectedKeys.length, 7);
  state.undo();
  assert.isTrue(
    state.selectedKeys.every((entry) => state.findBonePropertyKeyframe(entry.boneId, entry.property, entry.time)),
  );
});

test('unrepresentable destination spacing rejects a valid group without partial movement', () => {
  const input: AnimationClip = {
    name: 'precision',
    duration: 1e20,
    loop: false,
    tracks: {
      root: [
        { time: 1, x: 1 },
        { time: 2, x: 2 },
      ],
    },
  };
  const before = JSON.stringify(input);
  assert.throws(
    () => moveBonePropertyKeyframes(input, rig, targets([key(0.001), key(0.002)]), 1e20),
    /cannot preserve spacing/,
  );
  assert.equal(JSON.stringify(input), before);
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation('precision');
  state.selectKeyframes([key(0.001), key(0.002)]);
  const animation = state.workingAnimation;
  const selection = state.selectedKeys;
  assert.isFalse(state.keyframes.moveSelectedKeyframe(1e17));
  assert.strictEqual(state.workingAnimation, animation);
  assert.strictEqual(state.selectedKeys, selection);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});
