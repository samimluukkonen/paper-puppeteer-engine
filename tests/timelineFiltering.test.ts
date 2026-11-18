import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { defaultTimelineFilters } from '../src/devtools/animation-editor/timelineFiltering.js';
import type { TimelineTrack } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

function fixture() {
  const rig = new Rig({
    root: 'character',
    bones: [
      { id: 'character' },
      { id: 'rightUpperArm', parent: 'character' },
      { id: 'rightForearm', parent: 'rightUpperArm', y: 50 },
      { id: 'hand', parent: 'rightForearm', y: 40 },
      { id: 'leg', parent: 'character' },
    ],
    ik: [{ name: 'ReachTarget', rootBone: 'rightUpperArm', middleBone: 'rightForearm', endBone: 'hand' }],
  });
  const input: AnimationClip = {
    name: 'move',
    duration: 2000,
    loop: false,
    tracks: {
      rightForearm: [
        { time: 0, rotation: 1 },
        { time: 1000, rotation: 2 },
      ],
      leg: [{ time: 0, x: 5 }],
    },
    ikTracks: { ReachTarget: [{ time: 0, x: 40, mix: 0.5 }] },
    events: [{ time: 500, name: 'step' }],
  };
  const state = new AnimationEditorState(rig, [input]);
  assert.isTrue(state.selectAnimation('move'));
  return { state, rig, input };
}

function rowName(row: TimelineTrack): string {
  const owner = 'boneId' in row ? row.boneId : `IK: ${row.constraintId}`;
  return row.kind === 'property' || row.kind === 'ik-property' ? `${owner}.${row.property}` : owner;
}
function visible(state: AnimationEditorState): string[] {
  return state.timelineTracks.filter((row) => state.timelineVisibility.rows.has(row)).map(rowName);
}

test('case-insensitive bone ID search temporarily opens matches and keeps nested ancestors in order', () => {
  const { state } = fixture();
  state.setTimelineBoneExpanded('leg', true);
  state.setTimelineFilters({ search: '  FOREARM  ' });
  assert.deepEqual(visible(state), [
    'character',
    'rightUpperArm',
    'rightForearm',
    'rightForearm.x',
    'rightForearm.y',
    'rightForearm.rotation',
    'rightForearm.scaleX',
    'rightForearm.scaleY',
  ]);
  assert.deepEqual([...state.timelineVisibility.context].map(rowName), ['character', 'rightUpperArm']);
  const rows = state.timelineTracks;
  state.setTimelineFilters({ search: 'forearm' });
  assert.strictEqual(state.timelineTracks, rows);
  state.setTimelineFilters({ search: 'forear' });
  assert.strictEqual(state.timelineTracks, rows);
  state.setTimelineFilters(defaultTimelineFilters);
  assert.isFalse(state.isTimelineBoneExpanded('rightForearm'));
  assert.isTrue(state.isTimelineBoneExpanded('leg'));
});

test('property and supported IK label searches expose matching channels', () => {
  const { state, rig } = fixture();
  state.setTimelineFilters({ search: 'ROTATION' });
  assert.lengthOf(
    visible(state).filter((name) => name.endsWith('.rotation')),
    rig.bones.length,
  );
  assert.isFalse(state.timelineVisibility.eventVisible);
  state.setTimelineFilters({ search: 'INFLUENCE' });
  assert.deepEqual(visible(state), ['IK: ReachTarget', 'IK: ReachTarget.mix']);
  state.setTimelineFilters({ search: 'reachtarget' });
  assert.deepEqual(visible(state), [
    'IK: ReachTarget',
    'IK: ReachTarget.x',
    'IK: ReachTarget.y',
    'IK: ReachTarget.mix',
  ]);
  state.setTimelineFilters({ search: 'Events' });
  assert.deepEqual(visible(state), []);
  assert.isTrue(state.timelineVisibility.eventVisible);
});

test('keyed filtering preserves unkeyed ancestors and removes empty properties and events', () => {
  const { state } = fixture();
  state.expandTimeline('all');
  const rows = state.timelineTracks;
  state.setTimelineFilters({ mode: 'keyed' });
  assert.strictEqual(state.timelineTracks, rows);
  assert.deepEqual(visible(state), [
    'character',
    'rightUpperArm',
    'rightForearm',
    'rightForearm.rotation',
    'leg',
    'leg.x',
    'IK: ReachTarget',
    'IK: ReachTarget.x',
    'IK: ReachTarget.mix',
  ]);
  assert.isTrue(state.timelineVisibility.eventVisible);
  assert.isTrue(state.selectAnimation(null));
  assert.deepEqual(visible(state), []);
  assert.isFalse(state.timelineVisibility.eventVisible);
});

test('keyed property search keeps collapsed groups only when that property is authored', () => {
  const { state } = fixture();
  state.setTimelineFilters({ search: 'rotation', mode: 'keyed' });
  state.expandTimeline('none');
  assert.deepEqual(visible(state), ['character', 'rightUpperArm', 'rightForearm']);
  state.setTimelineFilters({ search: 'influence' });
  state.expandTimeline('none');
  assert.deepEqual(visible(state), ['IK: ReachTarget']);
});

test('selected target mode follows preview-style bone picks, properties, IK targets and events', () => {
  const { state } = fixture();
  state.setTimelineFilters({ mode: 'selected' });
  assert.deepEqual(visible(state), []);
  state.selectBone('rightForearm');
  assert.deepEqual(visible(state), ['character', 'rightUpperArm', 'rightForearm']);
  state.expandTimeline('selected');
  state.selectTimelineProperty('rightForearm', 'rotation');
  assert.isFalse(state.timelineVisibility.selectionHidden);
  state.ik.selectIKConstraint('ReachTarget', 'mix');
  state.expandTimeline('selected');
  assert.deepEqual(visible(state), [
    'IK: ReachTarget',
    'IK: ReachTarget.x',
    'IK: ReachTarget.y',
    'IK: ReachTarget.mix',
  ]);
  state.selectAnimationEvent(state.eventTimelineTrack.markers[0]!.ref);
  assert.deepEqual(visible(state), []);
  assert.isTrue(state.timelineVisibility.eventVisible);
});

test('IK/event visibility toggles compose with search and retain row references', () => {
  const { state } = fixture();
  state.expandTimeline('all');
  const rows = state.timelineTracks;
  state.setTimelineFilters({ showIK: false, showEvents: false });
  assert.isTrue(visible(state).every((name) => !name.startsWith('IK:')));
  assert.isFalse(state.timelineVisibility.eventVisible);
  state.setTimelineFilters({ search: 'ReachTarget' });
  assert.deepEqual(visible(state), []);
  state.setTimelineFilters(defaultTimelineFilters);
  assert.deepEqual(state.timelineTracks, rows);
  assert.isTrue(state.timelineVisibility.eventVisible);
});

test('expand/collapse all and selected reuse layout state and do not change selection', () => {
  const { state, rig } = fixture();
  state.expandTimeline('all');
  assert.lengthOf(state.timelineTracks, rig.bones.length * 6 + 4);
  state.selectKeyframes([
    { boneId: 'rightForearm', property: 'rotation', time: 0 },
    { boneId: 'leg', property: 'x', time: 0 },
  ]);
  const keys = state.selectedKeys;
  state.expandTimeline('none');
  assert.lengthOf(state.timelineTracks, rig.bones.length + 1);
  assert.equal(state.timelineVisibility.hiddenKeyCount, 2);
  state.expandTimeline('selected');
  assert.isTrue(state.isTimelineBoneExpanded('rightForearm'));
  assert.isTrue(state.isTimelineBoneExpanded('leg'));
  assert.isFalse(state.isTimelineBoneExpanded('hand'));
  assert.strictEqual(state.selectedKeys, keys);
  assert.equal(state.timelineVisibility.hiddenKeyCount, 0);
});

test('search expansion can be collapsed and cleared without replacing manual preferences', () => {
  const { state } = fixture();
  state.setTimelineBoneExpanded('hand', true);
  state.setTimelineFilters({ search: 'rotation' });
  state.expandTimeline('none');
  assert.deepEqual(visible(state), ['character', 'rightUpperArm', 'rightForearm', 'hand', 'leg']);
  state.expandTimeline('all');
  assert.isTrue(state.isTimelineBoneExpanded('rightForearm'));
  state.setTimelineFilters(defaultTimelineFilters);
  assert.isFalse(state.isTimelineBoneExpanded('rightForearm'));
  assert.isTrue(state.isTimelineBoneExpanded('hand'));
});

test('hidden bone/property and multi-key selections persist and reveal opens every selected group', () => {
  const { state } = fixture();
  state.selectTimelineProperty('hand', 'scaleX');
  state.setTimelineFilters({ search: 'forearm', mode: 'keyed', showIK: false, showEvents: false });
  assert.isTrue(state.timelineVisibility.selectionHidden);
  state.revealTimelineSelection();
  assert.equal(state.selectedBoneId, 'hand');
  assert.equal(state.selectedTimelineProperty, 'scaleX');
  assert.isFalse(state.timelineVisibility.selectionHidden);
  state.selectKeyframes([
    { boneId: 'rightForearm', property: 'rotation', time: 0 },
    { boneId: 'leg', property: 'x', time: 0 },
  ]);
  const keys = state.selectedKeys;
  const primary = state.primaryKey;
  state.setTimelineFilters({ search: 'forearm' });
  assert.equal(state.timelineVisibility.hiddenKeyCount, 1);
  assert.strictEqual(state.selectedKeys, keys);
  assert.strictEqual(state.primaryKey, primary);
  state.revealTimelineSelection();
  assert.isFalse(state.timelineVisibility.selectionHidden);
  assert.strictEqual(state.selectedKeys, keys);
});

test('hidden IK keys and events keep their typed selections and can be revealed', () => {
  const { state } = fixture();
  state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'ReachTarget', property: 'mix', time: 0 });
  const key = state.ik.selectedIKKeyframe;
  state.setTimelineFilters({ showIK: false });
  assert.equal(state.timelineVisibility.hiddenKeyCount, 1);
  assert.strictEqual(state.ik.selectedIKKeyframe, key);
  state.revealTimelineSelection();
  assert.strictEqual(state.ik.selectedIKKeyframe, key);
  assert.isFalse(state.timelineVisibility.selectionHidden);
  const ref = state.eventTimelineTrack.markers[0]!.ref;
  state.selectAnimationEvent(ref);
  state.setTimelineFilters({ showEvents: false, search: 'none' });
  assert.strictEqual(state.selectedEvent, ref);
  assert.isTrue(state.timelineVisibility.selectionHidden);
  state.revealTimelineSelection();
  assert.strictEqual(state.selectedEvent, ref);
  assert.isFalse(state.timelineVisibility.selectionHidden);
});

test('filtering preserves source, working animation, rig, dirty/history/redo, exports and playback caches', () => {
  const { state, input, rig } = fixture();
  const original = JSON.stringify(input);
  const skeleton = JSON.stringify(rig);
  state.keyframes.setBonePropertyKeyframe('hand', 'y', 8);
  state.undo();
  const working = state.workingAnimation;
  const source = state.sourceAnimation;
  const exported = state.exportJson();
  const history = state.historyLength;
  for (const patch of [{ search: 'forearm' }, { mode: 'keyed' as const }, { showIK: false, showEvents: false }])
    state.setTimelineFilters(patch);
  state.expandTimeline('all');
  state.expandTimeline('none');
  state.selectBone('leg');
  state.revealTimelineSelection();
  const rows = state.timelineTracks;
  const visibility = state.timelineVisibility;
  state.play();
  state.advancePlayback(0.25);
  assert.equal(state.currentTime, 0.25);
  assert.strictEqual(state.timelineTracks, rows);
  assert.strictEqual(state.timelineVisibility, visibility);
  state.beginScrub();
  state.setCurrentTime(0.6);
  state.endScrub();
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(state.exportJson(), exported);
  assert.equal(JSON.stringify(input), original);
  assert.equal(JSON.stringify(rig), skeleton);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, history);
  assert.isTrue(state.canRedo);
});

test('empty and cleared search retain the selected keys and all authored data', () => {
  const { state } = fixture();
  state.selectKeyframe({ boneId: 'rightForearm', property: 'rotation', time: 0 });
  const working = state.workingAnimation;
  const keys = state.selectedKeys;
  state.setTimelineFilters({ search: 'no-matching-track' });
  assert.deepEqual(visible(state), []);
  assert.isFalse(state.timelineVisibility.eventVisible);
  state.setTimelineFilters({ search: '   ' });
  assert.equal(state.timelineVisibility.rows.size, state.timelineTracks.length);
  assert.strictEqual(state.selectedKeys, keys);
  assert.strictEqual(state.workingAnimation, working);
});

test.each(['copy/paste', 'delete', 'group movement', 'duplicate'])(
  'hidden selected keys still participate in %s',
  (command) => {
    const { state } = fixture();
    state.selectKeyframes([
      { boneId: 'rightForearm', property: 'rotation', time: 0 },
      { boneId: 'leg', property: 'x', time: 0 },
    ]);
    state.setTimelineFilters({ search: 'forearm' });
    assert.equal(state.timelineVisibility.hiddenKeyCount, 1);
    const before = state.workingAnimation;
    if (command === 'copy/paste') {
      assert.isTrue(state.copyTimelineSelection());
      assert.strictEqual(state.workingAnimation, before);
      state.setCurrentTime(0.5);
      assert.isTrue(state.pasteTimelineClipboard());
      assert.deepEqual(
        state.selectedKeys.map((key) => key.boneId),
        ['rightForearm', 'leg'],
      );
    } else if (command === 'delete') {
      assert.isTrue(state.deleteSelectedKeyframes());
      assert.deepEqual(state.workingAnimation?.tracks.leg, undefined);
      assert.lengthOf(state.workingAnimation!.tracks.rightForearm!, 1);
    } else if (command === 'duplicate') {
      assert.isTrue(state.duplicateTimelineSelection());
      assert.lengthOf(state.selectedKeys, 2);
      assert.lengthOf(state.workingAnimation!.tracks.leg!, 2);
    } else {
      assert.isTrue(state.nudgeSelectedKeyframe(1));
      assert.deepEqual(
        state.selectedKeys.map((key) => key.time),
        [0.01, 0.01],
      );
    }
    assert.isTrue(state.undo());
    assert.strictEqual(state.workingAnimation, before);
  },
);

test('additive marquee excludes hidden rows between visible rows and retains previously hidden selected keys', () => {
  const { state } = fixture();
  state.selectKeyframe({ boneId: 'leg', property: 'x', time: 0 });
  state.expandTimeline('all');
  state.setTimelineFilters({ search: 'rotation' });
  state.selectKeyframeMarquee(
    { startTime: 0, endTime: 2, firstRow: 0, lastRow: state.timelineTracks.length - 1 },
    true,
  );
  assert.deepEqual(
    state.selectedKeys.map((key) => [key.boneId, key.property, key.time]),
    [
      ['leg', 'x', 0],
      ['rightForearm', 'rotation', 0],
      ['rightForearm', 'rotation', 1],
    ],
  );
});

test('missing rig and animation support filtering and expansion without creating authored state', () => {
  const state = new AnimationEditorState();
  state.setTimelineFilters({ search: 'forearm', mode: 'keyed' });
  state.expandTimeline('all');
  state.expandTimeline('none');
  state.revealTimelineSelection();
  assert.deepEqual(visible(state), []);
  assert.isNull(state.workingAnimation);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});

test.each(['key', 'event'])('changing filters cancels an active %s drag without committing authored data', (kind) => {
  const { state } = fixture();
  if (kind === 'key') {
    state.selectKeyframe({ boneId: 'rightForearm', property: 'rotation', time: 0 });
    assert.isTrue(state.keyframes.beginKeyframeDrag(state.primaryKey!));
    assert.isTrue(state.keyframes.previewKeyframeDrag(0.4));
  } else {
    assert.isTrue(state.beginEventDrag(state.eventTimelineTrack.markers[0]!.ref));
    assert.isTrue(state.previewEventDrag(0.8));
  }
  const working = state.workingAnimation;
  const keys = [...state.selectedKeys];
  const event = state.selectedEvent;
  state.setTimelineFilters({ search: 'nothing-matches', showEvents: false });
  assert.isNull(state.keyframes.keyframeDrag);
  assert.isNull(state.eventDrag);
  assert.deepEqual(state.selectedKeys, keys);
  assert.strictEqual(state.selectedEvent, event);
  assert.strictEqual(state.workingAnimation, working);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});
