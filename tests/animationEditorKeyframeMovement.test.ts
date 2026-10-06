import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { KEYFRAME_TIME_TOLERANCE_MS, moveBonePropertyKeyframe } from '../src/devtools/animation-editor/keyframes.js';
import { snapKeyframeTime } from '../src/devtools/animation-editor/timeline.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] });
function clip(): AnimationClip {
  return {
    name: 'move',
    duration: 1000,
    loop: true,
    interpolation: 'linear',
    tracks: {
      root: [
        { time: 0, rotation: -0.2 },
        { time: 500, rotation: 0.3, x: 4 },
        { time: 1000, rotation: -0.1, y: 8 },
      ],
      arm: [{ time: 500, rotation: 0.5 }],
    },
    events: [{ time: 500, name: 'event', data: { value: 3 } }],
  };
}
function session() {
  const input = clip();
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation('move');
  state.selectKeyframe({ boneId: 'root', property: 'rotation', time: 0.5 });
  return { state, input };
}
const move = (animation: AnimationClip, to: number, from = 500) =>
  moveBonePropertyKeyframe(animation, rig, 'root', 'rotation', from, to);

test('pure time move preserves values, sparse siblings, interpolation, events and source ownership', () => {
  const source = clip();
  const before = JSON.stringify(source);
  const next = move(source, 800);
  assert.deepEqual(next.tracks.root, [
    { time: 0, rotation: -0.2 },
    { time: 500, x: 4 },
    { time: 800, rotation: 0.3 },
    { time: 1000, rotation: -0.1, y: 8 },
  ]);
  assert.strictEqual(next.tracks.arm, source.tracks.arm);
  assert.strictEqual(next.events, source.events);
  assert.equal(next.interpolation, 'linear');
  assert.equal(JSON.stringify(source), before);
  assert.isFalse(Object.isFrozen(source));
  assert.isFalse(Object.isFrozen(source.tracks.root));
});

test.each([-500, 0, 200, 800, 1000, 5000])('move to %s clamps and remains sorted across neighbors', (time) => {
  const next = move(clip(), time);
  const rows = next.tracks.root!;
  assert.isTrue(
    rows.every((row, index) => row.time >= 0 && row.time <= 1000 && (index === 0 || row.time >= rows[index - 1]!.time)),
  );
  const moved = rows.find((row) => row.rotation === 0.3)!;
  assert.equal(moved.time, Math.max(0, Math.min(time, 1000)));
  assert.equal(rows.filter((row) => row.time === moved.time && row.rotation !== undefined).length, 1);
  assert.deepEqual(
    rows.find((row) => row.time === 500),
    { time: 500, x: 4 },
  );
});

test('collision replaces destination property only, merging at its canonical tolerant time', () => {
  const source = clip();
  const next = move(source, 1000 - KEYFRAME_TIME_TOLERANCE_MS / 2);
  assert.deepEqual(next.tracks.root, [
    { time: 0, rotation: -0.2 },
    { time: 500, x: 4 },
    { time: 1000, rotation: 0.3, y: 8 },
  ]);
  assert.deepEqual(source.tracks.root![2], { time: 1000, rotation: -0.1, y: 8 });
});

test('all destination property matches are replaced; nearby sibling times remain unchanged', () => {
  const source = clip();
  const near = 800 + KEYFRAME_TIME_TOLERANCE_MS / 2;
  const animation = {
    ...source,
    tracks: {
      ...source.tracks,
      root: [
        ...source.tracks.root!.slice(0, 2),
        { time: 800, rotation: 0.1, x: 10 },
        { time: near, rotation: 0.2, y: 12 },
        ...source.tracks.root!.slice(2),
      ],
    },
  };
  const next = move(animation, 800);
  assert.deepEqual(next.tracks.root, [
    { time: 0, rotation: -0.2 },
    { time: 500, x: 4 },
    { time: 800, x: 10, rotation: 0.3 },
    { time: near, y: 12 },
    { time: 1000, rotation: -0.1, y: 8 },
  ]);
  const siblings = {
    ...source,
    tracks: {
      root: [
        { time: 500, rotation: 0.3 },
        { time: near, x: 10 },
      ],
    },
  };
  assert.deepEqual(move(siblings, 800).tracks.root, [
    { time: 800, rotation: 0.3 },
    { time: near, x: 10 },
  ]);
});

test('no-op/missing source reuse input; invalid data is rejected without mutation', () => {
  const source = clip();
  assert.strictEqual(move(source, 500 + KEYFRAME_TIME_TOLERANCE_MS / 2), source);
  assert.strictEqual(move(source, 800, 750), source);
  for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => move(source, time));
  assert.throws(() => moveBonePropertyKeyframe(source, rig, 'missing', 'rotation', 500, 800));
  assert.throws(() => move({ ...source, tracks: { root: [{ time: 1200, x: 1 }] } }, 800));
});

test('moving onto a distinct near-source key honors nearest-match identity and replaces it', () => {
  const source = clip();
  const near = 500 + KEYFRAME_TIME_TOLERANCE_MS / 2;
  const animation = {
    ...source,
    tracks: {
      root: [
        { time: 500, rotation: 0.3, x: 4 },
        { time: near, rotation: 0.9, y: 8 },
      ],
    },
  };
  assert.deepEqual(move(animation, near).tracks.root, [
    { time: 500, x: 4 },
    { time: near, rotation: 0.3, y: 8 },
  ]);
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation('move');
  state.selectKeyframe({ boneId: 'root', property: 'rotation', time: 0.5 });
  state.moveSelectedKeyframe(near / 1000);
  assert.equal(state.selectedKeyframe?.time, near / 1000);
  assert.equal(state.selectedBoneTransform?.rotation, 0.3);
  assert.equal(state.historyLength, 1);
  state.undo();
  assert.deepEqual(state.workingAnimation?.tracks, animation.tracks);
});

test('nearest-frame snapping uses seconds, supports continuous time and safe FPS fallback/bounds', () => {
  assert.equal(snapKeyframeTime(0.143, 1, 'frame', 10), 0.1);
  assert.equal(snapKeyframeTime(0.16, 1, 'frame', 10), 0.2);
  assert.equal(snapKeyframeTime(0.143, 1, 'none', 10), 0.143);
  for (const fps of [undefined, 0, -1, NaN, Infinity]) assert.equal(snapKeyframeTime(0.143, 1, 'frame', fps), 0.1);
  assert.equal(snapKeyframeTime(0.143, 1, 'frame', 20), 0.15);
  assert.equal(snapKeyframeTime(-1, 1, 'frame', 10), 0);
  assert.equal(snapKeyframeTime(2, 1.06, 'frame', 10), 1.06);
  assert.equal(snapKeyframeTime(2, 1.04, 'frame', 10), 1.04);
  assert.equal(snapKeyframeTime(NaN, 1, 'frame', 10), 0);
});

test('provisional drag follows the sole clock and blocks playback without history/dirty churn', () => {
  const { state, input } = session();
  const before = state.workingAnimation;
  const source = state.sourceAnimation;
  state.play();
  assert.isTrue(state.beginKeyframeDrag(state.selectedKeyframe!));
  state.previewKeyframeDrag(0.8);
  assert.equal(state.currentTime, 0.8);
  assert.equal(state.keyframeDrag?.previewTime, 0.8);
  assert.equal(state.selectedKeyframe?.time, 0.5);
  state.play();
  state.advancePlayback(0.1);
  assert.isFalse(state.isPlaying);
  assert.equal(state.currentTime, 0.8);
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  state.previewKeyframeDrag(0.7);
  state.previewKeyframeDrag(0.8);
  assert.isTrue(state.commitKeyframeDrag());
  const moved = state.workingAnimation;
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.isNull(state.keyframeDrag);
  assert.equal(state.selectedKeyframe?.time, 0.8);
  assert.equal(state.selectedTimelineProperty, 'rotation');
  assert.equal(state.selectedBoneTransform?.rotation, 0.3);
  assert.isTrue(state.hasKeyframeAtTime('root', 'rotation'));
  assert.isFalse(state.isPlaying);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  assert.isNull(state.selectedKeyframe, 'history validates transient selection rather than restoring it');
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
  assert.strictEqual(state.sourceAnimation, source);
  assert.deepEqual(input, clip());
});

test('collision Undo/Redo restores exact immutable snapshots and sparse destination siblings', () => {
  const { state } = session();
  const before = state.workingAnimation;
  state.beginKeyframeDrag(state.selectedKeyframe!);
  state.previewKeyframeDrag(9);
  state.commitKeyframeDrag();
  const moved = state.workingAnimation;
  assert.equal(state.selectedKeyframe?.time, 1);
  assert.deepEqual(state.workingAnimation?.tracks.root![2], { time: 1000, rotation: 0.3, y: 8 });
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
  assert.equal(state.historyLength, 1);
});

test('cancelled drag and unchanged gestures preserve authored data, saved state, history and redo', () => {
  const { state } = session();
  state.moveSelectedKeyframe(0.8);
  state.undo();
  state.selectKeyframe({ boneId: 'root', property: 'rotation', time: 0.5 });
  const before = state.workingAnimation;
  state.beginKeyframeDrag(state.selectedKeyframe!);
  state.previewKeyframeDrag(-4);
  assert.equal(state.currentTime, 0);
  state.cancelKeyframeDrag();
  assert.equal(state.currentTime, 0.5);
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.isTrue(state.canRedo);
  state.beginKeyframeDrag(state.selectedKeyframe!);
  state.commitKeyframeDrag();
  assert.equal(state.historyLength, 0);
  assert.isTrue(state.canRedo);
  assert.isFalse(state.commitKeyframeDrag());
});

test('snap preference is transient, authored FPS drives gestures, Shift bypasses drag snapping', () => {
  const { state } = session();
  state.setAuthoredPlaybackMode('stepped');
  state.setAuthoredFPS(20);
  state.markSaved();
  state.setKeyframeSnapMode('frame');
  const history = state.historyLength;
  state.beginKeyframeDrag(state.selectedKeyframe!);
  state.previewKeyframeDrag(0.143);
  assert.equal(state.currentTime, 0.15);
  state.previewKeyframeDrag(0.143, true);
  assert.equal(state.currentTime, 0.143);
  state.cancelKeyframeDrag();
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, history);
  assert.notInclude(state.exportJson(), 'snap');
});

test('keyboard nudge follows selection, pauses, clamps and records one action per change', () => {
  const { state } = session();
  const before = state.workingAnimation;
  state.play();
  state.setCurrentTime(0.7);
  state.nudgeSelectedKeyframe(1);
  assert.approximately(state.selectedKeyframe!.time, 0.51, 1e-12);
  assert.equal(state.currentTime, state.selectedKeyframe!.time);
  assert.isFalse(state.isPlaying);
  assert.equal(state.historyLength, 1);
  const moved = state.workingAnimation;
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
  state.selectKeyframe({ boneId: 'root', property: 'rotation', time: 0.51 });
  state.setKeyframeSnapMode('frame');
  state.nudgeSelectedKeyframe(1);
  assert.equal(state.selectedKeyframe!.time, 0.6);
  state.nudgeSelectedKeyframe(-1, true);
  assert.equal(state.selectedKeyframe!.time, 0);
  const history = state.historyLength;
  state.nudgeSelectedKeyframe(-1);
  assert.equal(state.historyLength, history);
});

test.each(['undo', 'navigation', 'selection', 'settings', 'scrub', 'animation', 'collapse'])(
  'drag cancels at %s boundary',
  (boundary) => {
    const { state } = session();
    state.beginKeyframeDrag(state.selectedKeyframe!);
    state.previewKeyframeDrag(0.8);
    const before = state.workingAnimation;
    if (boundary === 'undo') state.undo();
    if (boundary === 'navigation') state.setCurrentTime(0.2);
    if (boundary === 'selection') state.selectBone('arm');
    if (boundary === 'settings') state.setAuthoredPlaybackMode('stepped');
    if (boundary === 'scrub') state.beginScrub();
    if (boundary === 'animation') state.selectAnimation(null);
    if (boundary === 'collapse') state.setTimelineBoneExpanded('root', false);
    assert.isNull(state.keyframeDrag);
    if (boundary !== 'settings' && boundary !== 'animation') assert.strictEqual(state.workingAnimation, before);
    assert.equal(state.historyLength, boundary === 'settings' ? 1 : 0);
  },
);
