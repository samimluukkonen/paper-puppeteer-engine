import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  buildTimelineSnapTargets,
  defaultTimelineSnapSettings,
  resolveTimelineSnap,
  type TimelineSnapContext,
  type TimelineSnapSettings,
  type TimelineSnapTarget,
} from '../src/devtools/animation-editor/timelineSnapping.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const settings: TimelineSnapSettings = { ...defaultTimelineSnapSettings, enabled: true };
const context: TimelineSnapContext = { duration: 2, contentWidth: 1000, fps: 10, playheadTime: 1.2, targets: [] };
const marker = (time: number): TimelineSnapTarget => ({
  type: 'keyframe',
  time,
  key: { boneId: 'root', property: 'x', time },
});

test.each([
  ['frame', 0.505, 'frames', []],
  ['keyframe', 0.505, 'keyframes', [marker(0.5)]],
  ['event', 0.505, 'events', [{ type: 'event', time: 0.5 }]],
  ['playhead', 1.205, 'playhead', []],
] as const)('%s snapping resolves metadata/guide and respects its individual toggle', (type, time, toggle, targets) => {
  const only = { enabled: true, frames: false, keyframes: false, events: false, playhead: false, [toggle]: true };
  const result = resolveTimelineSnap(time, { ...context, targets }, only);
  const expected = type === 'playhead' ? 1.2 : 0.5;
  assert.deepEqual(result, { time: expected, targetType: type, targetTime: expected, guide: { type, time: expected } });
  assert.equal(resolveTimelineSnap(time, { ...context, targets }, { ...only, [toggle]: false }).time, time);
});

test('nearest eligible target wins before type priority; shuffled candidates resolve identically', () => {
  const targets: TimelineSnapTarget[] = [marker(0.505), { type: 'event', time: 0.51 }, marker(0.496)];
  for (const ordered of [targets, [...targets].reverse(), [targets[1]!, targets[0]!, targets[2]!]]) {
    const result = resolveTimelineSnap(0.504, { ...context, playheadTime: 0.51, targets: ordered }, settings);
    assert.equal(result.time, 0.505);
    assert.equal(result.targetType, 'keyframe');
  }
});

test('equal distances use playhead > event > keyframe > frame, then earlier time', () => {
  const targets: TimelineSnapTarget[] = [{ type: 'event', time: 0.5 }, marker(0.5)];
  const tied = { ...context, playheadTime: 0.5, targets };
  assert.equal(resolveTimelineSnap(0.51, tied, settings).targetType, 'playhead');
  assert.equal(resolveTimelineSnap(0.51, tied, { ...settings, playhead: false }).targetType, 'event');
  assert.equal(resolveTimelineSnap(0.51, tied, { ...settings, playhead: false, events: false }).targetType, 'keyframe');
  assert.equal(
    resolveTimelineSnap(0.51, tied, { ...settings, playhead: false, events: false, keyframes: false }).targetType,
    'frame',
  );
  for (const targets of [
    [marker(0.51), marker(0.49)],
    [marker(0.49), marker(0.51)],
  ])
    assert.equal(resolveTimelineSnap(0.5, { ...context, targets }, { ...settings, frames: false }).time, 0.49);
  assert.equal(
    resolveTimelineSnap(0.55, { ...context, contentWidth: 100 }, { ...settings, playhead: false }).time,
    0.5,
  );
});

test('8 pixel threshold converts through zoom and includes its exact boundary', () => {
  const framesOnly = { ...settings, keyframes: false, events: false, playhead: false };
  assert.equal(resolveTimelineSnap(0.516, context, framesOnly).time, 0.5);
  assert.isNull(resolveTimelineSnap(0.5161, context, framesOnly).guide);
  assert.isNull(resolveTimelineSnap(0.51, { ...context, contentWidth: 2000 }, framesOnly).guide);
  assert.equal(resolveTimelineSnap(0.507, { ...context, contentWidth: 2000 }, framesOnly).time, 0.5);
});

test('disabled snapping, override, absent geometry and invalid FPS have safe deterministic results', () => {
  for (const width of [0, -1, Infinity, NaN])
    assert.isNull(resolveTimelineSnap(0.505, { ...context, contentWidth: width }, settings).guide);
  assert.isNull(resolveTimelineSnap(0.505, context, { ...settings, enabled: false }).guide);
  assert.isNull(resolveTimelineSnap(0.505, { ...context, disableSnapping: true }, settings).guide);
  for (const fps of [0, -1, Infinity, NaN])
    assert.equal(resolveTimelineSnap(0.505, { ...context, fps }, settings).time, 0.5);
  assert.equal(resolveTimelineSnap(-5, context, settings).time, 0);
  assert.equal(resolveTimelineSnap(Infinity, context, { ...settings, enabled: false }).time, 2);
  assert.isNull(
    resolveTimelineSnap(1.04, { ...context, duration: 1.04 }, settings).guide,
    'off-grid endpoints are not frames',
  );
  assert.equal(resolveTimelineSnap(9, { ...context, duration: 1.04, contentWidth: 100 }, settings).time, 1.04);
  assert.equal(resolveTimelineSnap(-9, { ...context, minTime: 0.35, contentWidth: 100 }, settings).time, 0.35);
  assert.equal(resolveTimelineSnap(9, { ...context, maxTime: 1.35, contentWidth: 100 }, settings).time, 1.35);
});

test('self exclusion uses exact bone/IK/property/time identity and preserves other same-time markers', () => {
  const own = marker(0.5);
  const other = { ...own, key: { boneId: 'root', property: 'y' as const, time: 0.5 } };
  const onlyKeys = { ...settings, frames: false, events: false, playhead: false };
  const excludedKeys = [own.key!];
  assert.isNull(resolveTimelineSnap(0.505, { ...context, targets: [own], excludedKeys }, onlyKeys).guide);
  assert.equal(resolveTimelineSnap(0.505, { ...context, targets: [own, other], excludedKeys }, onlyKeys).time, 0.5);
  const ik = {
    type: 'keyframe' as const,
    time: 0.5,
    key: { kind: 'ik' as const, constraintId: 'arm', property: 'x' as const, time: 0.5 },
  };
  assert.isNull(resolveTimelineSnap(0.505, { ...context, targets: [ik], excludedKeys: [ik.key] }, onlyKeys).guide);
  assert.equal(resolveTimelineSnap(0.505, { ...context, targets: [ik], excludedKeys }, onlyKeys).time, 0.5);
});

function session() {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'arm', parent: 'root' },
      { id: 'lower', parent: 'arm', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
    ],
    ik: [{ name: 'arm', rootBone: 'arm', middleBone: 'lower', endBone: 'hand' }],
  });
  const input: AnimationClip = {
    name: 'snap',
    duration: 2000,
    loop: false,
    tracks: {
      root: [
        { time: 200, x: 10 },
        { time: 350, x: 20 },
        { time: 800, x: 99, y: 4 },
      ],
      arm: [{ time: 500, rotation: 0.1 }],
    },
    events: [
      { time: 750, name: 'event', data: { keep: true } },
      { time: 1100, name: 'second' },
    ],
    ikTracks: {
      arm: [
        { time: 100, x: 10, y: 20 },
        { time: 950, x: 99 },
      ],
    },
  };
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation('snap');
  state.setTimelineSnapContentWidth(1000);
  state.setTimelineSnapSettings(settings);
  return { state, input };
}
const a = { boneId: 'root', property: 'x' as const, time: 0.2 };
const b = { ...a, time: 0.35 };

test('group anchor resolves once, excludes all moving keys, preserves spacing and installs one reversible snapshot', () => {
  const { state, input } = session();
  const inputJson = JSON.stringify(input);
  const before = state.workingAnimation;
  const source = state.sourceAnimation;
  state.setTimelineSnapSettings({ frames: false, playhead: false });
  state.selectKeyframes([a, b]);
  state.keyframes.beginKeyframeDrag(a);
  state.keyframes.previewKeyframeDrag(0.355);
  assert.isNull(state.timelineSnapGuide, 'the other selected key is excluded');
  state.keyframes.previewKeyframeDrag(0.755);
  assert.deepEqual(state.timelineSnapGuide, { type: 'event', time: 0.75 });
  assert.closeTo(state.keyframes.keyframeDrag!.previewDelta, 0.55, 1e-12);
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.isTrue(state.keyframes.commitKeyframeDrag());
  const after = state.workingAnimation;
  assert.deepEqual(
    state.selectedKeys.map((key) => key.time),
    [0.75, 0.9],
  );
  assert.isNull(state.timelineSnapGuide);
  assert.equal(state.historyLength, 1);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.strictEqual(state.workingAnimation, after);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(input), inputJson);
});

test('ineligible group-bound targets never produce a misleading guide or change relative timing', () => {
  const { state } = session();
  state.selectKeyframes([a, { ...a, time: 0.8 }]);
  state.keyframes.beginKeyframeDrag(a);
  state.keyframes.previewKeyframeDrag(1.99);
  assert.closeTo(state.keyframes.keyframeDrag!.previewTime, 1.4, 1e-12);
  assert.equal(state.timelineSnapGuide?.time, 1.4);
  state.keyframes.commitKeyframeDrag();
  assert.closeTo(state.selectedKeys[1]!.time - state.selectedKeys[0]!.time, 0.6, 1e-12);
});

test('playhead snap holds the time captured before selection and never chases drag preview notifications', () => {
  const { state } = session();
  state.setTimelineSnapSettings({ frames: false, keyframes: false, events: false });
  state.setCurrentTime(1.234);
  state.keyframes.beginKeyframeDrag(a);
  state.keyframes.previewKeyframeDrag(1.24);
  assert.deepEqual(state.timelineSnapGuide, { type: 'playhead', time: 1.234 });
  state.keyframes.previewKeyframeDrag(1.255);
  assert.equal(state.currentTime, 1.255);
  assert.isNull(state.timelineSnapGuide);
  state.keyframes.previewKeyframeDrag(1.24, true);
  assert.equal(state.currentTime, 1.24);
  assert.isNull(state.timelineSnapGuide);
  state.keyframes.cancelKeyframeDrag();
  assert.isNull(state.timelineSnapGuide);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});

test('snapped key collisions preserve siblings and Undo/Redo restores destination value', () => {
  const { state } = session();
  state.setTimelineSnapSettings({ frames: false, events: false, playhead: false });
  const before = state.workingAnimation;
  state.keyframes.beginKeyframeDrag(a);
  state.keyframes.previewKeyframeDrag(0.807);
  assert.equal(state.timelineSnapGuide?.type, 'keyframe');
  state.keyframes.commitKeyframeDrag();
  assert.deepEqual(state.workingAnimation!.tracks.root!.at(-1), { time: 800, x: 10, y: 4 });
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  assert.equal(state.workingAnimation!.tracks.root!.at(-1)!.x, 10);
});

test('event identity exclusions allow same-time events and event movement stays atomic', () => {
  const { state } = session();
  state.setTimelineSnapSettings({ frames: false, keyframes: false, playhead: false });
  const refs = state.events.eventTimelineTrack.markers.map((entry) => entry.ref);
  const before = state.workingAnimation;
  state.events.beginEventDrag(refs[0]!);
  state.events.previewEventDrag(0.755);
  assert.isNull(state.timelineSnapGuide, 'own event is excluded');
  state.events.previewEventDrag(1.105);
  assert.deepEqual(state.timelineSnapGuide, { type: 'event', time: 1.1 });
  assert.strictEqual(state.workingAnimation, before);
  state.events.commitEventDrag();
  assert.equal(state.workingAnimation!.events!.length, 2);
  assert.deepEqual(
    state.workingAnimation!.events!.map((event) => event.time),
    [1100, 1100],
  );
  assert.deepEqual(state.events.selectedEventData!.data, { keep: true });
  assert.equal(state.historyLength, 1);
  assert.isNull(state.timelineSnapGuide);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.redo();
  state.events.beginEventDrag(refs[0]!);
  state.events.previewEventDrag(1.11);
  assert.deepEqual(state.timelineSnapGuide, { type: 'event', time: 1.1 }, 'other same-time event remains eligible');
  state.events.cancelEventDrag();
  assert.isNull(state.timelineSnapGuide);
});

test('IK movement shares authored bone/event/playhead targets and keeps typed sparse collision/history rules', () => {
  const { state } = session();
  state.setTimelineSnapSettings({ frames: false, playhead: false });
  state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'x', time: 0.1 });
  state.ik.moveSelectedIKKeyframe(0.755);
  assert.equal(state.ik.selectedIKKeyframe!.time, 0.75);
  assert.deepEqual(state.workingAnimation!.ikTracks!.arm![0], { time: 100, y: 20 });
  state.ik.moveSelectedIKKeyframe(0.957);
  assert.deepEqual(state.workingAnimation!.ikTracks!.arm!.at(-1), { time: 950, x: 10 });
  assert.equal(state.historyLength, 2);
  state.undo();
  assert.equal(state.workingAnimation!.ikTracks!.arm!.at(-1)!.x, 99);
  state.redo();
  assert.equal(state.workingAnimation!.ikTracks!.arm!.at(-1)!.x, 10);
});

test('preferences/geometry do not dirty or serialize and targets rebuild after history/document changes', () => {
  const { state, input } = session();
  const json = state.exportJson();
  const before = state.workingAnimation;
  state.setTimelineSnapSettings({ frames: false, events: false, playhead: false });
  state.setTimelineSnapContentWidth(2000);
  assert.isTrue(Object.isFrozen(state.timelineSnapSettings));
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.exportJson(), json);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  const sourceJson = JSON.stringify(input);
  const targets = buildTimelineSnapTargets(before);
  assert.isTrue(targets.some((target) => target.key && 'kind' in target.key));
  assert.isTrue(Object.isFrozen(targets));
  assert.equal(JSON.stringify(input), sourceJson);
  state.keyframes.beginKeyframeDrag(a);
  state.keyframes.previewKeyframeDrag(0.809);
  assert.isNull(state.timelineSnapGuide, '18 pixels misses');
  state.keyframes.cancelKeyframeDrag();
  state.keyframes.moveSelectedKeyframe(0.6);
  state.undo();
  state.keyframes.beginKeyframeDrag(b);
  state.keyframes.previewKeyframeDrag(0.605);
  assert.isNull(state.timelineSnapGuide, 'undone key target no longer exists');
  state.keyframes.cancelKeyframeDrag();
});

test.each(['key', 'event'] as const)(
  'changing snap settings refreshes an active %s preview from its raw time',
  (kind) => {
    const { state } = session();
    state.setTimelineSnapSettings({ frames: false, keyframes: false, playhead: false });
    if (kind === 'key') state.keyframes.beginKeyframeDrag(a);
    else state.events.beginEventDrag(state.events.eventTimelineTrack.markers[1]!.ref);
    const preview = (time: number) =>
      kind === 'key' ? state.keyframes.previewKeyframeDrag(time) : state.events.previewEventDrag(time);
    preview(0.755);
    assert.deepEqual(state.timelineSnapGuide, { type: 'event', time: 0.75 });
    let notifications = 0;
    state.subscribe(() => {
      notifications += 1;
    });
    state.setTimelineSnapSettings({ enabled: false });
    assert.equal(state.currentTime, 0.755);
    assert.isNull(state.timelineSnapGuide);
    assert.equal(notifications, 1);
    state.setTimelineSnapSettings({ enabled: true });
    assert.equal(state.currentTime, 0.75);
    assert.deepEqual(state.timelineSnapGuide, { type: 'event', time: 0.75 });
    preview(0.755);
    if (kind === 'key') state.keyframes.previewKeyframeDrag(0.755, true);
    else state.events.previewEventDrag(0.755, true);
    state.setTimelineSnapSettings({ events: false });
    state.setTimelineSnapSettings({ events: true });
    assert.equal(state.currentTime, 0.755, 'settings retain the active Shift override');
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
  },
);

test('nudges advance past coincident sparse sibling keys, events and playhead', () => {
  const { state } = session();
  state.setTimelineSnapSettings({ frames: false });
  state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'x', time: 0.1 });
  state.ik.nudgeSelectedIKKeyframe(1);
  assert.equal(state.ik.selectedIKKeyframe!.time, 0.11);
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.8 });
  state.nudgeSelectedKeyframe(1);
  assert.equal(state.selectedKeyframe!.time, 0.81);
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  state.events.nudgeSelectedEvent(1);
  assert.equal(state.events.selectedEventData!.time, 760);
  assert.equal(state.historyLength, 3);
});
