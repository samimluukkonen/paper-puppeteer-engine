import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { pasteEventClipboard } from '../src/devtools/animation-editor/TimelineClipboard.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { parseAnimationClip } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const payload = { nested: [1, null, { escaped: 'line\n"quote"', precise: Math.PI }], flag: false };
function session(playback?: AnimationClip['playback']) {
  const input: AnimationClip = {
    name: 'move',
    duration: 1000,
    loop: false,
    ...(playback ? { playback } : {}),
    tracks: { root: [{ time: 100, x: 7 }] },
    events: [{ time: 250.123456789, name: 'cue', data: payload }],
  };
  const state = new AnimationEditorState(rig, [input, { ...input, name: 'other', duration: 500, events: [] }]);
  state.selectAnimation('move');
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  return { state, input };
}

test('copy owns exact authored data, changes neither history nor dirty state, and excludes editor identities', () => {
  const { state, input } = session();
  const before = JSON.stringify(input);
  const working = state.workingAnimation;
  const ref = state.selectedEvent;
  const time = state.currentTime;
  assert.isTrue(state.copyTimelineSelection());
  assert.deepEqual(state.events.eventClipboard, { event: input.events![0] });
  assert.notStrictEqual(state.events.eventClipboard!.event.data, state.events.selectedEventData!.data);
  assert.isTrue(Object.isFrozen(state.events.eventClipboard!.event.data));
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.selectedEvent, ref);
  assert.equal(state.currentTime, time);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.equal(JSON.stringify(input), before);
  state.clearTimelineSelection();
  assert.isFalse(state.copyTimelineSelection());
  assert.isNotNull(state.events.eventClipboard);
});

test('paste uses playhead, retains identical same-time events, selects the new identity and is one exact undo', () => {
  const { state, input } = session();
  state.events.copySelectedEvent();
  state.setCurrentTime(0.5);
  const original = state.workingAnimation;
  assert.isTrue(state.pasteTimelineClipboard());
  const first = state.selectedEvent;
  assert.deepEqual(state.events.selectedEventData, { ...input.events![0], time: 500 });
  assert.isTrue(state.pasteTimelineClipboard());
  assert.notStrictEqual(state.selectedEvent, first);
  assert.lengthOf(state.workingAnimation!.events!, 3);
  assert.equal(state.historyLength, 2);
  const pasted = state.workingAnimation;
  state.undo();
  assert.lengthOf(state.workingAnimation!.events!, 2);
  assert.isNull(state.selectedEvent);
  state.undo();
  assert.strictEqual(state.workingAnimation, original);
  assert.isFalse(state.dirty);
  state.redo();
  state.redo();
  assert.strictEqual(state.workingAnimation, pasted);
  assert.deepEqual(parseAnimationClip(JSON.parse(state.exportJson()), rig).events, pasted!.events);
  assert.deepEqual(state.sourceAnimation!.events, input.events);
});

test('one typed clipboard routes paste by content, independent of event/key selection and animation instance', () => {
  const { state } = session();
  state.events.copySelectedEvent();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.1 });
  assert.isNull(state.selectedEvent);
  assert.isTrue(state.pasteTimelineClipboard());
  assert.equal(state.events.selectedEventData!.time, 100);
  assert.isNull(state.selectedKeyframe);
  state.undo();
  state.selectAnimation('other');
  state.setCurrentTime(0.4);
  assert.isTrue(state.pasteTimelineClipboard());
  assert.equal(state.events.selectedEventData!.time, 400);
  assert.equal(state.workingAnimation!.name, 'other');
  state.undo();
  state.selectAnimation('move');
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.1 });
  state.copyTimelineSelection();
  assert.isNull(state.events.eventClipboard);
  assert.isFalse(state.events.pasteEvent());
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  state.setCurrentTime(0.6);
  assert.isTrue(state.pasteTimelineClipboard());
  assert.deepEqual(state.selectedKeys, [{ boneId: 'root', property: 'x', time: 0.6 }]);
  assert.isNull(state.selectedEvent);
  assert.equal(state.workingAnimation!.events!.length, 1);
  assert.isTrue(state.duplicateTimelineSelection());
  assert.approximately(state.selectedKeyframe!.time, 0.61, 1e-12);
});

test.each([
  { playback: undefined, snap: 'none' as const, step: 10 },
  { playback: undefined, snap: 'frame' as const, step: 100 },
  { playback: { mode: 'stepped' as const, fps: 25 }, snap: 'none' as const, step: 40 },
])('duplicate shares clone/paste without overwriting clipboard: $step ms', ({ playback, snap, step }) => {
  const { state } = session(playback);
  state.events.copySelectedEvent();
  const clipboard = state.timelineClipboard;
  state.setKeyframeSnapMode(snap);
  const source = state.events.selectedEventData!;
  const time = state.currentTime;
  assert.isTrue(state.duplicateTimelineSelection());
  assert.deepEqual(state.events.selectedEventData, { ...source, time: source.time + step });
  assert.equal(state.currentTime, time);
  assert.equal(state.historyLength, 1);
  assert.strictEqual(state.timelineClipboard, clipboard);
  const duplicated = state.workingAnimation;
  state.undo();
  state.redo();
  assert.strictEqual(state.workingAnimation, duplicated);
});

test('duplicate at duration steps backwards and clips shorter than a frame still use a distinct time', () => {
  const { state } = session({ mode: 'stepped', fps: 1 });
  state.events.moveSelectedEvent(1);
  state.markSaved();
  assert.isTrue(state.events.duplicateSelectedEvent());
  assert.equal(state.events.selectedEventData!.time, 0);
  state.undo();
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  state.events.moveSelectedEvent(0);
  assert.isTrue(state.replaceWorkingAnimation({ ...state.workingAnimation, duration: 1, tracks: {} }));
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  assert.isTrue(state.events.duplicateSelectedEvent());
  assert.equal(state.events.selectedEventData!.time, 1);
});

test.each([{}, { data: null }, { data: { nested: [] } }])(
  'payload presence survives paste, history and serialization: %j',
  (fields) => {
    const { state } = session();
    state.events.updateAnimationEvent(state.selectedEvent!, { time: 250, name: 'cue', ...fields });
    state.events.copySelectedEvent();
    state.setCurrentTime(0.7);
    state.events.pasteEvent();
    const snapshot = state.workingAnimation;
    assert.equal(Object.hasOwn(state.events.selectedEventData!, 'data'), Object.hasOwn(fields, 'data'));
    state.undo();
    state.redo();
    assert.strictEqual(state.workingAnimation, snapshot);
    assert.deepEqual(parseAnimationClip(JSON.parse(state.exportJson()), rig).events, snapshot!.events);
  },
);

test.each([
  { time: -1, name: 'bad' },
  { time: 1001, name: 'bad' },
  { time: NaN, name: 'bad' },
  { time: 100 },
  { time: 100, name: '' },
  { time: 100, name: 'bad', data: { bad: undefined } },
  { time: 100, name: 'bad', type: 'unsupported' },
])('destination validation rejects malformed events without weakening the schema: %j', (event) => {
  const { state } = session();
  const original = state.workingAnimation!;
  assert.isFalse(state.events.addAnimationEvent(event as never));
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.throws(() => pasteEventClipboard(original, rig, { event: event as never }, event.time));
});

test('create/edit/move/duplicate/delete stress restores exact snapshots and reconciles selection', () => {
  const { state } = session();
  const snapshots = [state.workingAnimation];
  state.setCurrentTime(0.4);
  state.events.createAnimationEvent();
  snapshots.push(state.workingAnimation);
  state.events.setSelectedEventDataJson(JSON.stringify(payload));
  snapshots.push(state.workingAnimation);
  state.events.moveSelectedEvent(0.7);
  snapshots.push(state.workingAnimation);
  state.events.duplicateSelectedEvent();
  snapshots.push(state.workingAnimation);
  state.events.deleteSelectedEvent();
  snapshots.push(state.workingAnimation);
  for (const snapshot of snapshots.slice(0, -1).reverse()) {
    assert.isTrue(state.undo());
    assert.strictEqual(state.workingAnimation, snapshot);
    assert.isNull(state.selectedEvent);
  }
  assert.isFalse(state.dirty);
  for (const snapshot of snapshots.slice(1)) {
    assert.isTrue(state.redo());
    assert.strictEqual(state.workingAnimation, snapshot);
  }
  assert.deepEqual(parseAnimationClip(JSON.parse(state.exportJson()), rig).events, state.workingAnimation!.events);
});

test('paste on a selected fractional marker uses its exact authored timestamp', () => {
  const { state } = session();
  const timestamp = 0.031101767270538955;
  state.events.updateAnimationEvent(state.selectedEvent!, { time: timestamp, name: 'fractional' });
  state.events.selectAnimationEvent(state.selectedEvent!);
  state.events.copySelectedEvent();
  assert.isTrue(state.events.pasteEvent());
  assert.equal(state.events.selectedEventData!.time, timestamp);
  assert.lengthOf(
    state.events.eventTimelineTrack.markers.filter(({ time }) => time === timestamp / 1000),
    2,
  );
});
