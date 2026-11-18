import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { KEYFRAME_TIME_TOLERANCE_MS } from '../src/devtools/animation-editor/keyframes.js';
import { timeToTimelineX } from '../src/devtools/animation-editor/timeline.js';
import { buildTimelineTracks } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';
import type { TransformProperty } from '../src/engine/types.js';

const rig = new Rig({
  root: 'root',
  bones: [
    { id: 'root', x: 4 },
    { id: 'arm', parent: 'root' },
  ],
});
function session() {
  const input: AnimationClip = {
    name: 'move',
    duration: 2000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 500, x: 10, y: 3 },
        { time: 2000, x: 20 },
      ],
      arm: [{ time: 750, rotation: 0.4 }],
    },
    events: [{ time: 500, name: 'event' }],
  };
  const state = new AnimationEditorState(rig, [input, { ...input, name: 'empty', tracks: {} }]);
  state.selectAnimation('move');
  state.setTimelineBoneExpanded('root', true);
  return { state, input };
}
function markers(state: AnimationEditorState, boneId = 'root', property: TransformProperty = 'x') {
  const track = state.timelineTracks.find(
    (row) => row.kind === 'property' && row.boneId === boneId && row.property === property,
  );
  if (track?.kind !== 'property') throw new Error('Missing property track');
  return track.keyframes;
}

test('marker model contains only authored property samples with seconds, values and shared endpoint coordinates', () => {
  const { state, input } = session();
  const before = JSON.stringify(input);
  assert.deepEqual(markers(state), [
    { boneId: 'root', property: 'x', time: 0, value: 0 },
    { boneId: 'root', property: 'x', time: 0.5, value: 10 },
    { boneId: 'root', property: 'x', time: 2, value: 20 },
  ]);
  assert.deepEqual(markers(state, 'root', 'y'), [{ boneId: 'root', property: 'y', time: 0.5, value: 3 }]);
  assert.deepEqual(markers(state, 'root', 'rotation'), []);
  assert.isTrue(Object.isFrozen(markers(state)));
  assert.isTrue(markers(state).every(Object.isFrozen));
  for (const width of [220, 800])
    assert.deepEqual(
      markers(state).map((key) => timeToTimelineX(key.time, state.duration, width)),
      [0, width / 4, width],
    );
  const tracks = state.timelineTracks;
  state.setCurrentTime(1.25);
  assert.strictEqual(state.timelineTracks, tracks);
  assert.equal(JSON.stringify(input), before);
  assert.isTrue(
    buildTimelineTracks(rig, null, new Set(['root'])).every(
      (row) => row.kind !== 'property' || row.keyframes.length === 0,
    ),
  );
});

test('key selection atomically selects bone/property, cancels drafts, pauses and seeks without authored changes', () => {
  const { state, input } = session();
  const before = JSON.stringify(input);
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  state.selectBone('root');
  state.playback.play();
  const observations: unknown[] = [];
  state.subscribe(() =>
    observations.push([
      state.selectedBoneId,
      state.selectedTimelineProperty,
      state.currentTime,
      state.playback.isPlaying,
    ]),
  );
  assert.isTrue(state.selectKeyframe({ boneId: 'arm', property: 'rotation', time: 0.75 }));
  assert.deepEqual(observations, [['arm', 'rotation', 0.75, false]]);
  assert.deepEqual(state.selectedKeyframe, { boneId: 'arm', property: 'rotation', time: 0.75 });
  assert.isTrue(Object.isFrozen(state.selectedKeyframe));
  assert.isTrue(state.isTimelineBoneExpanded('arm'));
  assert.equal(state.selectedBoneTransform?.rotation, 0.4);
  assert.isTrue(state.hasKeyframeAtTime('arm', 'rotation'));
  assert.isFalse(state.hasTemporaryTransform);
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.workingAnimation, working);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(JSON.stringify(input), before);
  state.setTemporaryBoneProperty('rotation', 0.6);
  assert.isTrue(state.hasTemporaryTransform);
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  assert.isFalse(state.hasTemporaryTransform);
  assert.equal(state.selectedKeyframe?.boneId, 'root');
  assert.equal(state.currentTime, 0.5);
});

test.each(['key', 'event'] as const)(
  '%s drag cancellation and cross-track selection publish one complete update',
  (drag) => {
    const { state } = session();
    const working = state.workingAnimation;
    const ref = state.events.eventTimelineTrack.markers[0]!.ref;
    if (drag === 'key') {
      assert.isTrue(state.keyframes.beginKeyframeDrag({ boneId: 'root', property: 'x', time: 0.5 }));
      assert.isTrue(state.keyframes.previewKeyframeDrag(1));
    } else {
      assert.isTrue(state.events.beginEventDrag(ref));
      assert.isTrue(state.events.previewEventDrag(1));
    }
    assert.strictEqual(state.workingAnimation, working);
    assert.equal(state.keyframes.keyframeDrag?.previewTime ?? state.events.eventDrag?.previewTime, 1);
    const observations: unknown[] = [];
    state.subscribe(() => {
      assert.strictEqual(state.workingAnimation, working);
      assert.isNull(state.keyframes.keyframeDrag);
      assert.isNull(state.events.eventDrag);
      assert.isFalse(state.dirty);
      assert.equal(state.historyLength, 0);
      observations.push([state.selectedKeyframe, state.selectedEvent, state.currentTime]);
    });
    const key = { boneId: 'arm', property: 'rotation' as const, time: 0.75 };
    if (drag === 'key') {
      assert.isTrue(state.events.selectAnimationEvent(ref));
      assert.deepEqual(observations, [[null, ref, 0.5]]);
    } else {
      assert.isTrue(state.selectKeyframe(key));
      assert.deepEqual(observations, [[key, null, 0.75]]);
    }
  },
);

test('invalid key targets preserve held selection, time, playback and history', () => {
  const { state } = session();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  const selected = state.selectedKeyframe;
  state.playback.play();
  for (const target of [
    { boneId: 'missing', property: 'x' as const, time: 0.5 },
    { boneId: 'root', property: 'rotation' as const, time: 0.5 },
    { boneId: 'root', property: 'x' as const, time: 1 },
    { boneId: 'root', property: 'x' as const, time: NaN },
    { boneId: 'root', property: 'opacity' as TransformProperty, time: 0.5 },
  ])
    assert.isFalse(state.selectKeyframe(target));
  assert.strictEqual(state.selectedKeyframe, selected);
  assert.equal(state.currentTime, 0.5);
  assert.isTrue(state.playback.isPlaying);
  assert.equal(state.historyLength, 0);
});

test('selection uses centralized tolerance and snaps to canonical authored time, including close distinct keys', () => {
  const { state } = session();
  const near = 500 + KEYFRAME_TIME_TOLERANCE_MS / 2;
  const animation = structuredClone(state.workingAnimation!) as AnimationClip;
  const root = [...animation.tracks.root!.slice(0, 2), { time: near, x: 11 }, ...animation.tracks.root!.slice(2)];
  assert.isTrue(state.replaceWorkingAnimation({ ...animation, tracks: { ...animation.tracks, root } }));
  state.selectKeyframe({ boneId: 'root', property: 'x', time: (near + KEYFRAME_TIME_TOLERANCE_MS / 10) / 1000 });
  assert.equal(state.selectedKeyframe?.time, near / 1000);
  assert.equal(state.currentTime, near / 1000);
  state.deleteSelectedKeyframe();
  assert.isNull(state.selectedKeyframe);
  assert.deepEqual(
    markers(state).map((key) => key.time),
    [0, 0.5, 2],
  );
  assert.isFalse(
    state.selectKeyframe({ boneId: 'root', property: 'x', time: (500 + KEYFRAME_TIME_TOLERANCE_MS * 2) / 1000 }),
  );
});

test('delete uses the selected time after scrubbing, records one edit and preserves other properties/source', () => {
  const { state, input } = session();
  const sourceJson = JSON.stringify(state.sourceAnimation);
  const inputJson = JSON.stringify(input);
  const original = state.workingAnimation;
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  state.setCurrentTime(1.2);
  const history = state.historyLength;
  assert.isTrue(state.deleteSelectedKeyframe());
  assert.isNull(state.selectedKeyframe);
  assert.equal(state.currentTime, 1.2);
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, history + 1);
  assert.deepEqual(
    markers(state).map((key) => key.time),
    [0, 2],
  );
  assert.isTrue(state.hasKeyframeAtTime('root', 'y', 0.5));
  assert.deepEqual(state.workingAnimation?.tracks.arm, original?.tracks.arm);
  assert.deepEqual(state.workingAnimation?.events, original?.events);
  assert.equal(state.getEvaluatedBonePropertyValue('root', 'x', 0.5), 5);
  assert.isFalse(state.deleteSelectedKeyframe());
  assert.equal(state.historyLength, history + 1);
  assert.isTrue(state.undo());
  assert.deepEqual(
    markers(state).map((key) => key.time),
    [0, 0.5, 2],
  );
  assert.isFalse(state.dirty);
  assert.isNull(state.selectedKeyframe);
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  assert.isTrue(state.canRedo, 'transient selection preserves redo');
  assert.isTrue(state.redo());
  assert.isNull(state.selectedKeyframe);
  assert.isTrue(state.dirty);
  assert.deepEqual(
    markers(state).map((key) => key.time),
    [0, 2],
  );
  assert.equal(JSON.stringify(state.sourceAnimation), sourceJson);
  assert.equal(JSON.stringify(input), inputJson);
});

test('inspector mutations refresh markers and invalidate only removed selection; undo of creation clears it', () => {
  const { state } = session();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  const selected = state.selectedKeyframe;
  state.keyframes.setBonePropertyKeyframe('root', 'x', 12);
  assert.strictEqual(state.selectedKeyframe, selected);
  assert.equal(markers(state)[1]!.value, 12);
  state.keyframes.removeBonePropertyKeyframe('root', 'y');
  assert.strictEqual(state.selectedKeyframe, selected);
  state.deleteBonePropertyKey('x');
  assert.isNull(state.selectedKeyframe);
  state.keyframes.setBonePropertyKeyframe('root', 'x', 15, 1.25);
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 1.25 });
  state.undo();
  assert.isNull(state.selectedKeyframe);
  assert.isFalse(markers(state).some((key) => key.time === 1.25));
  state.redo();
  assert.isTrue(markers(state).some((key) => key.time === 1.25));
});

test('replacement canonicalizes tolerated selection time and clears missing key without seeking', () => {
  const { state } = session();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  state.setCurrentTime(0.9);
  const animation = structuredClone(state.workingAnimation!) as AnimationClip;
  animation.tracks.root![1]!.time += KEYFRAME_TIME_TOLERANCE_MS / 2;
  state.replaceWorkingAnimation(animation);
  assert.equal(state.selectedKeyframe?.time, animation.tracks.root![1]!.time / 1000);
  assert.equal(state.currentTime, 0.9);
  delete animation.tracks.root![1]!.x;
  state.replaceWorkingAnimation(animation);
  assert.isNull(state.selectedKeyframe);
  assert.equal(state.currentTime, 0.9);
});

test('bone/track/animation navigation clears key selection coherently; failed switches retain it', () => {
  const { state } = session();
  const select = () => state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  select();
  state.selectBone('root');
  assert.isNull(state.selectedKeyframe);
  assert.isNull(state.selectedTimelineProperty);
  select();
  state.selectTimelineProperty('arm', 'rotation');
  assert.isNull(state.selectedKeyframe);
  assert.equal(state.selectedBoneId, 'arm');
  select();
  state.clearKeyframeSelection();
  assert.equal(state.selectedTimelineProperty, 'x');
  assert.equal(state.currentTime, 0.5);
  select();
  state.keyframes.setBonePropertyKeyframe('root', 'x', 12);
  assert.isFalse(state.selectAnimation('empty'));
  assert.isNotNull(state.selectedKeyframe);
  state.selectAnimation('empty', { discardChanges: true });
  assert.isNull(state.selectedKeyframe);
  assert.isNull(state.selectedTimelineProperty);
  assert.equal(state.currentTime, 0);
});

test('playback and scrubbing retain selection and stationary markers without forcing the clock', () => {
  const { state } = session();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  const selected = state.selectedKeyframe;
  const rows = state.timelineTracks;
  state.playback.play();
  state.playback.advancePlayback(0.2);
  assert.equal(state.currentTime, 0.7);
  state.playback.beginScrub();
  state.setCurrentTime(1.3);
  state.playback.advancePlayback(0.4);
  assert.equal(state.currentTime, 1.3);
  state.playback.endScrub();
  state.playback.advancePlayback(0.2);
  assert.equal(state.currentTime, 1.5);
  assert.strictEqual(state.selectedKeyframe, selected);
  assert.strictEqual(state.timelineTracks, rows);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  state.playback.beginScrub();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  assert.isFalse(state.playback.isPlaying);
  assert.isFalse(state.playback.isScrubbing);
});

test('adjacent navigation stays on the selected property and skips the current key using tolerance', () => {
  const { state } = session();
  assert.isFalse(state.selectAdjacentKeyframe(1));
  state.selectTimelineProperty('root', 'x');
  assert.isUndefined(state.getAdjacentKeyframe(-1));
  state.playback.play();
  assert.isTrue(state.selectAdjacentKeyframe(1));
  assert.equal(state.currentTime, 0.5);
  assert.isFalse(state.playback.isPlaying);
  state.setCurrentTime(0.5 + KEYFRAME_TIME_TOLERANCE_MS / 2000);
  assert.equal(state.getAdjacentKeyframe(1)?.time, 2);
  assert.equal(state.getAdjacentKeyframe(-1)?.time, 0);
  state.selectAdjacentKeyframe(1);
  assert.isUndefined(state.getAdjacentKeyframe(1));
  state.selectAdjacentKeyframe(-1);
  assert.equal(state.currentTime, 0.5);
  state.setTimelineBoneExpanded('root', false);
  state.selectAdjacentKeyframe(-1);
  assert.equal(state.currentTime, 0);
  assert.isTrue(state.isTimelineBoneExpanded('root'));
  state.selectTimelineProperty('root', 'y');
  state.selectAdjacentKeyframe(1);
  assert.equal(state.currentTime, 0.5);
  assert.equal(state.selectedKeyframe?.property, 'y');
  assert.isUndefined(state.getAdjacentKeyframe(1));
  assert.isFalse(state.dirty);
});
