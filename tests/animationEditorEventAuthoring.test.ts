import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { findAnimationEvent, getAnimationEventReferences } from '../src/devtools/animation-editor/animationEvents.js';
import { snapKeyframeTime } from '../src/devtools/animation-editor/timeline.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

function session() {
  const input = {
    name: 'move',
    duration: 2050,
    loop: true,
    tracks: {
      root: [
        { time: 0, x: 2 },
        { time: 2050, x: 4 },
      ],
    },
    events: [
      { time: 500, name: 'one', data: { values: [1, null, false] } },
      { time: 1000, name: 'two' },
    ],
  };
  const state = new AnimationEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }), [input]);
  state.selectAnimation('move');
  const source = state.sourceAnimation;
  const before = JSON.stringify(input);
  return { state, input, source, before };
}

test('creation uses currentTime, selects its identity, pauses and records one reversible owned snapshot', () => {
  const { state, source, input, before } = session();
  state.setCurrentTime(0.75);
  state.play();
  assert.isTrue(state.createAnimationEvent());
  const ref = state.selectedEvent!;
  assert.deepEqual(state.selectedEventData, { time: 750, name: 'event' });
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.isFalse(state.isPlaying);
  const authored = state.workingAnimation;
  assert.isTrue(state.undo());
  assert.isUndefined(findAnimationEvent(state.workingAnimation, ref));
  assert.isNull(state.selectedEvent);
  assert.isFalse(state.dirty);
  assert.isTrue(state.redo());
  assert.strictEqual(state.workingAnimation, authored);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(input), before);
});

test('name and JSON data commits preserve other fields/events and restore exact authored data', () => {
  const { state, source, input, before } = session();
  const [ref, other] = getAnimationEventReferences(state.workingAnimation);
  state.selectAnimationEvent(ref!);
  const original = state.workingAnimation;
  const otherEvent = findAnimationEvent(original, other!);
  assert.isTrue(state.updateAnimationEvent(ref!, { ...state.selectedEventData!, name: 'renamed' }));
  const renamed = state.workingAnimation;
  assert.deepEqual(state.selectedEventData, { ...original!.events![0], name: 'renamed' });
  assert.deepEqual(findAnimationEvent(renamed, other!), otherEvent);
  assert.isTrue(state.setSelectedEventDataJson('{"nested":[null,true,{"text":"hello"}]}'));
  assert.deepEqual(state.selectedEventData!.data, { nested: [null, true, { text: 'hello' }] });
  const payload = state.workingAnimation;
  assert.equal(state.historyLength, 2);
  state.undo();
  assert.strictEqual(state.workingAnimation, renamed);
  state.undo();
  assert.strictEqual(state.workingAnimation, original);
  state.redo();
  state.redo();
  assert.strictEqual(state.workingAnimation, payload);
  assert.isTrue(state.setSelectedEventDataJson('null'));
  assert.isTrue(Object.hasOwn(state.selectedEventData!, 'data'));
  assert.isNull(state.selectedEventData!.data);
  assert.isTrue(state.setSelectedEventDataJson('  '));
  assert.isFalse(Object.hasOwn(state.selectedEventData!, 'data'));
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(input), before);
});

test('invalid authored values fail atomically, including unsupported and non-JSON data', () => {
  const { state } = session();
  const ref = getAnimationEventReferences(state.workingAnimation)[0]!;
  state.selectAnimationEvent(ref);
  const original = state.workingAnimation;
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const bad = [undefined, () => {}, new Map(), new Set(), cyclic, { value: undefined }, { value: Infinity }];
  for (const data of bad) assert.isFalse(state.updateAnimationEvent(ref, { time: 500, name: 'one', data }));
  for (const time of [NaN, Infinity, -Infinity]) assert.isFalse(state.moveSelectedEvent(time));
  for (const event of [
    { time: 500, name: '' },
    { time: 500, name: 'one', unsupported: true },
  ])
    assert.isFalse(state.updateAnimationEvent(ref, event));
  for (const json of ['{', 'undefined', '{"n":1e999}']) assert.isFalse(state.setSelectedEventDataJson(json));
  assert.strictEqual(state.workingAnimation, original);
  assert.strictEqual(state.selectedEvent, ref);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.isTrue(state.validationIssues.length > 0);
});

test('delete removes only selected event and Undo/Redo restores exact data without restoring transient selection', () => {
  const { state, source } = session();
  const [ref, other] = getAnimationEventReferences(state.workingAnimation);
  const original = state.workingAnimation;
  state.selectAnimationEvent(ref!);
  assert.isTrue(state.deleteSelectedEvent());
  assert.isNull(state.selectedEvent);
  assert.isUndefined(findAnimationEvent(state.workingAnimation, ref!));
  assert.deepEqual(findAnimationEvent(state.workingAnimation, other!), original!.events![1]);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  const deleted = state.workingAnimation;
  state.undo();
  assert.strictEqual(state.workingAnimation, original);
  assert.isNull(state.selectedEvent);
  state.redo();
  assert.strictEqual(state.workingAnimation, deleted);
  assert.strictEqual(state.sourceAnimation, source);
});

test('many drag previews are provisional, playhead follows, same-time events survive and one commit changes time only', () => {
  const { state, source, input, before } = session();
  const [ref, other] = getAnimationEventReferences(state.workingAnimation);
  const original = state.workingAnimation;
  const event = original!.events![0]!;
  state.play();
  assert.isTrue(state.beginEventDrag(ref!));
  state.play();
  assert.isFalse(state.isPlaying);
  for (const time of [0.6, 0.7, 0.8, 1]) {
    assert.isTrue(state.previewEventDrag(time));
    assert.equal(state.currentTime, time);
    assert.equal(state.selectedEventData!.time, time * 1000);
    assert.strictEqual(state.workingAnimation, original);
    assert.equal(state.historyLength, 0);
    assert.isFalse(state.dirty);
  }
  assert.isTrue(state.commitEventDrag());
  assert.equal(state.historyLength, 1);
  assert.deepEqual(state.selectedEventData, { ...event, time: 1000 });
  assert.equal(state.eventTimelineTrack.markers.filter(({ time }) => time === 1).length, 2);
  assert.deepEqual(findAnimationEvent(state.workingAnimation, other!), original!.events![1]);
  assert.strictEqual(state.selectedEvent, ref);
  const moved = state.workingAnimation;
  state.undo();
  assert.deepEqual(state.selectedEventData, event);
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
  assert.strictEqual(state.selectedEvent, ref);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(input), before);
});

test('event movement shares snapping and nudging policy, clamps endpoints and keeps no-op moves out of history', () => {
  const { state } = session();
  const ref = getAnimationEventReferences(state.workingAnimation)[0]!;
  state.selectAnimationEvent(ref);
  state.setAuthoredPlaybackMode('stepped');
  state.setAuthoredFPS(24);
  state.setKeyframeSnapMode('frame');
  state.beginEventDrag(ref);
  state.previewEventDrag(0.73);
  assert.equal(state.eventDrag!.previewTime, snapKeyframeTime(0.73, state.duration, 'frame', 24));
  state.previewEventDrag(0.731, true);
  assert.equal(state.eventDrag!.previewTime, 0.731);
  state.cancelEventDrag();
  assert.equal(state.currentTime, 0.5);
  state.nudgeSelectedEvent(1);
  assert.closeTo(state.selectedEventData!.time, (13 / 24) * 1000, 1e-9);
  state.nudgeSelectedEvent(-1, true);
  assert.closeTo(state.selectedEventData!.time, 125, 1e-9);
  state.setKeyframeSnapMode('none');
  state.nudgeSelectedEvent(1);
  assert.closeTo(state.selectedEventData!.time, 135, 1e-9);
  state.moveSelectedEvent(-50);
  assert.equal(state.selectedEventData!.time, 0);
  const history = state.historyLength;
  state.nudgeSelectedEvent(-1);
  assert.equal(state.historyLength, history);
  state.moveSelectedEvent(50);
  assert.equal(state.selectedEventData!.time, 2050);
  state.beginEventDrag(ref);
  state.previewEventDrag(-10);
  assert.equal(state.eventDrag!.previewTime, 0);
  state.previewEventDrag(20);
  assert.equal(state.eventDrag!.previewTime, state.duration);
  state.cancelEventDrag();
});

test('navigation, selection, history and authored changes cancel event previews without leaking into export', () => {
  for (const cancel of [
    (s: AnimationEditorState) => s.setCurrentTime(0.2),
    (s: AnimationEditorState) => s.selectBone('root'),
    (s: AnimationEditorState) => s.clearTimelineSelection(),
    (s: AnimationEditorState) => s.undo(),
    (s: AnimationEditorState) => s.selectAnimation('move'),
    (s: AnimationEditorState) => s.setAuthoredPlaybackMode('stepped'),
  ]) {
    const { state } = session();
    const ref = getAnimationEventReferences(state.workingAnimation)[0]!;
    state.beginEventDrag(ref);
    state.previewEventDrag(1.7);
    const exported = JSON.parse(state.exportJson()) as AnimationClip;
    assert.equal(exported.events![0]!.time, 500);
    cancel(state);
    assert.isNull(state.eventDrag);
    assert.equal(state.workingAnimation!.events![0]!.time, 500);
  }
});

test('unchanged field commits and marker clicks preserve an unsorted event snapshot and clean history', () => {
  const input = {
    name: 'move',
    duration: 1000,
    loop: false,
    tracks: {},
    events: [
      { time: 1000, name: 'end' },
      { time: 55 / 7, name: 'start' },
    ],
  };
  const state = new AnimationEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }), [input]);
  state.selectAnimation('move');
  const original = state.workingAnimation;
  const ref = getAnimationEventReferences(original)[1]!;
  state.beginEventDrag(ref);
  state.commitEventDrag();
  state.updateAnimationEvent(ref, state.selectedEventData!);
  state.setSelectedEventDataJson('');
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});
