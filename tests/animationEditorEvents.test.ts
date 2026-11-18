import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  addAnimationEvent,
  buildEventTimelineTrack,
  findAnimationEvent,
  getAnimationEventReferences,
  getAnimationEvents,
  getEventsAtTime,
  removeAnimationEvent,
  updateAnimationEvent,
} from '../src/devtools/animation-editor/animationEvents.js';
import { timeToTimelineX } from '../src/devtools/animation-editor/timeline.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { AnimationValidationError, parseAnimationClip } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
function clip(): AnimationClip {
  return {
    name: 'move',
    duration: 2000,
    loop: true,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 2000, x: 20 },
      ],
    },
    events: [
      { time: 2000, name: 'end' },
      { time: 500, name: 'step', data: { foot: 'left' } },
      { time: 0, name: 'start' },
      { time: 500, name: 'step', data: { foot: 'right' } },
      { time: 500, name: 'step', data: { foot: 'right' } },
    ],
  };
}
function session() {
  const input = clip();
  const state = new AnimationEditorState(rig, [input, { ...clip(), name: 'empty', events: [] }]);
  state.selectAnimation('move');
  return { input, state };
}

test('pure event queries use authored milliseconds and distinguish even identical same-time events', () => {
  const input = clip();
  const before = JSON.stringify(input);
  assert.strictEqual(getAnimationEvents(input), input.events);
  const refs = getAnimationEventReferences(input);
  assert.strictEqual(getAnimationEventReferences(input), refs);
  assert.equal(new Set(refs).size, 5);
  assert.isTrue(refs.every(Object.isFrozen));
  refs.forEach((ref, index) => assert.strictEqual(findAnimationEvent(input, ref), input.events![index]));
  assert.deepEqual(
    getEventsAtTime(input, 500).map((event) => event.data),
    [{ foot: 'left' }, { foot: 'right' }, { foot: 'right' }],
  );
  for (const time of [0.5, NaN, 501]) assert.deepEqual(getEventsAtTime(input, time), []);
  assert.isUndefined(findAnimationEvent(input, getAnimationEventReferences(clip())[0]!));
  assert.deepEqual(getAnimationEvents(null), []);
  assert.deepEqual(getAnimationEvents({ ...input, events: undefined } as unknown as AnimationClip), []);
  assert.equal(JSON.stringify(input), before);
  assert.isFalse(Object.isFrozen(input));
});

test('event mutations own payloads, preserve source and references, and stably sort without time collisions', () => {
  const input = clip();
  const before = JSON.stringify(input);
  const refs = getAnimationEventReferences(input);
  const event = { time: 500, name: 'added', data: { nested: [1, 2] } };
  const added = addAnimationEvent(input, rig, event);
  assert.deepEqual(
    getAnimationEvents(added).map(({ time, name }) => [time, name]),
    [
      [0, 'start'],
      [500, 'step'],
      [500, 'step'],
      [500, 'step'],
      [500, 'added'],
      [2000, 'end'],
    ],
  );
  event.data.nested.push(3);
  assert.deepEqual(getAnimationEvents(added)[4]!.data, { nested: [1, 2] });
  assert.isFalse(Object.isFrozen(event));
  assert.isFalse(Object.isFrozen(input.tracks.root));
  for (const ref of refs) assert.deepEqual(findAnimationEvent(added, ref), findAnimationEvent(input, ref));
  const moved = updateAnimationEvent(added, rig, refs[0]!, { time: 500, name: 'end', data: null });
  assert.equal(getEventsAtTime(moved, 500).length, 5);
  assert.strictEqual(getAnimationEventReferences(moved).at(-1), refs[0]);
  assert.deepEqual(findAnimationEvent(moved, refs[0]!), { time: 500, name: 'end', data: null });
  const noData = updateAnimationEvent(moved, rig, refs[0]!, { time: 500, name: 'end' });
  assert.isFalse(Object.hasOwn(findAnimationEvent(noData, refs[0]!)!, 'data'));
  const removed = removeAnimationEvent(noData, rig, refs[3]!);
  assert.isUndefined(findAnimationEvent(removed, refs[3]!));
  assert.isDefined(findAnimationEvent(removed, refs[4]!));
  assert.equal(getEventsAtTime(removed, 500).length, 4);
  assert.strictEqual(removeAnimationEvent(removed, rig, refs[3]!), removed);
  assert.strictEqual(updateAnimationEvent(removed, rig, refs[0]!, { time: 500, name: 'end' }), removed);
  assert.throws(() => updateAnimationEvent(removed, rig, refs[3]!, { time: 100, name: 'missing' }));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(parseAnimationClip({ version: 1, ...removed }, rig).events, removed.events);
  assert.isTrue(Object.isFrozen(removed.events));
});

test('invalid event mutations reject bounds, fields and non-JSON data atomically without freezing caller payloads', () => {
  const input = clip();
  const before = JSON.stringify(input);
  const ref = getAnimationEventReferences(input)[0]!;
  for (const event of [
    { time: -1, name: 'invalid' },
    { time: 2001, name: 'invalid' },
    { time: NaN, name: 'invalid' },
    { time: 0, name: '' },
    { time: 0, name: 'invalid', data: undefined },
    { time: 0, name: 'invalid', data: { value: Infinity } },
    { time: 0, name: 'invalid', data: () => {} },
    { time: 0, name: 'invalid', payload: {} },
  ]) {
    assert.throws(() => addAnimationEvent(input, rig, event), AnimationValidationError);
    assert.throws(() => updateAnimationEvent(input, rig, ref, event), AnimationValidationError);
    assert.isFalse(Object.isFrozen(event));
    assert.equal(JSON.stringify(input), before);
  }
  let reads = 0;
  const accessor = {
    get time() {
      reads++;
      return 0;
    },
    name: 'unsafe',
  };
  assert.throws(() => addAnimationEvent(input, rig, accessor), AnimationValidationError);
  assert.equal(reads, 0);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(
    () => addAnimationEvent(input, rig, { time: 0, name: 'cyclic', data: cyclic }),
    AnimationValidationError,
  );
  assert.isFalse(Object.isFrozen(cyclic));
});

test('dedicated marker model stably sorts authored events, preserves duplicates and uses shared endpoint coordinates', () => {
  const { state } = session();
  const track = state.eventTimelineTrack;
  assert.equal(track.kind, 'events');
  assert.equal(track.stackCount, 3);
  assert.deepEqual(
    track.markers.map(({ time, stackIndex }) => [time, stackIndex]),
    [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0.5, 2],
      [2, 0],
    ],
  );
  assert.isTrue(Object.isFrozen(track));
  assert.isTrue(track.markers.every(Object.isFrozen));
  for (const width of [220, 800])
    assert.deepEqual(
      track.markers.map(({ time }) => timeToTimelineX(time, state.duration, width)),
      [0, width / 4, width / 4, width / 4, width],
    );
  state.setCurrentTime(1.3);
  state.play();
  state.advancePlayback(0.2);
  assert.strictEqual(state.eventTimelineTrack, track);
  state.keyframes.setBonePropertyKeyframe('root', 'y', 3);
  assert.strictEqual(state.eventTimelineTrack, track, 'unrelated key edits share the event model');
  const animation = clip();
  const mutableTrack = buildEventTimelineTrack(animation);
  animation.events![0]!.name = 'changed';
  assert.notStrictEqual(buildEventTimelineTrack(animation), mutableTrack);
  assert.equal(buildEventTimelineTrack(animation).markers.at(-1)!.name, 'changed');
});

test('event selection atomically pauses, ends scrubbing, clears keys/drafts and seeks without dirty/history changes', () => {
  const { state, input } = session();
  const before = JSON.stringify(input);
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  state.setTemporaryBoneProperty('y', 7);
  state.play();
  state.beginScrub();
  const ref = state.eventTimelineTrack.markers[2]!.ref;
  const observations: unknown[] = [];
  state.subscribe(() =>
    observations.push([state.selectedEvent, state.selectedKeys.length, state.currentTime, state.isPlaying]),
  );
  assert.isTrue(state.selectAnimationEvent(ref));
  assert.deepEqual(observations, [[ref, 0, 0.5, false]]);
  assert.isFalse(state.isScrubbing);
  assert.isFalse(state.hasTemporaryTransform);
  assert.isNull(state.selectedBoneId);
  assert.isNull(state.selectedTimelineProperty);
  assert.deepEqual(state.selectedEventData, { time: 500, name: 'step', data: { foot: 'right' } });
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.sourceAnimation, source);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(JSON.stringify(input), before);
  state.play();
  assert.isFalse(state.selectAnimationEvent(getAnimationEventReferences(clip())[0]!));
  assert.strictEqual(state.selectedEvent, ref);
  assert.isTrue(state.isPlaying);
  state.setCurrentTime(1.25);
  assert.strictEqual(state.selectedEvent, ref, 'navigation retains selection without forcing the clock');
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 2 });
  assert.isNull(state.selectedEvent);
  state.selectAnimationEvent(ref);
  state.selectKeyframes([{ boneId: 'root', property: 'x', time: 0 }], true);
  assert.isNull(state.selectedEvent);
  state.selectAnimationEvent(ref);
  state.selectTimelineProperty('root', 'y');
  assert.isNull(state.selectedEvent);
  state.selectAnimationEvent(ref);
  state.selectBone('root');
  assert.isNull(state.selectedEvent);
  state.selectAnimationEvent(ref);
  state.clearTimelineSelection();
  assert.isNull(state.selectedEvent);
  assert.equal(state.currentTime, 0.5);
  state.selectAnimationEvent(ref);
  state.selectAnimation('empty');
  assert.isNull(state.selectedEvent);
});

test('programmatic event edits integrate dirty/history, retain references across movement/undo/redo and protect source', () => {
  const { state, input } = session();
  const before = JSON.stringify(input);
  const source = JSON.stringify(state.sourceAnimation);
  const ref = state.eventTimelineTrack.markers[2]!.ref;
  state.selectAnimationEvent(ref);
  assert.isTrue(state.updateAnimationEvent(ref, { time: 1200, name: 'moved', data: { value: 1 } }));
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  assert.strictEqual(state.selectedEvent, ref);
  assert.equal(state.selectedEventData!.time, 1200);
  assert.equal(state.currentTime, 0.5, 'authored edits do not implicitly navigate');
  state.undo();
  assert.strictEqual(state.selectedEvent, ref);
  assert.equal(state.selectedEventData!.time, 500);
  assert.isFalse(state.dirty);
  state.selectAnimationEvent(ref);
  assert.isTrue(state.canRedo);
  state.redo();
  assert.equal(state.selectedEventData!.time, 1200);
  assert.isFalse(state.selectAnimation('empty'));
  assert.strictEqual(state.selectedEvent, ref);
  assert.isTrue(state.removeAnimationEvent(ref));
  assert.isNull(state.selectedEvent);
  state.undo();
  assert.isNull(state.selectedEvent, 'history does not restore transient selection');
  assert.isTrue(state.selectAnimationEvent(ref));
  state.redo();
  assert.isNull(state.selectedEvent);
  const working = state.workingAnimation;
  const history = state.historyLength;
  assert.isFalse(state.addAnimationEvent({ time: 2001, name: 'bad' }));
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, history);
  assert.isTrue(state.addAnimationEvent({ time: 0, name: 'another' }));
  const newRef = state.eventTimelineTrack.markers.find(({ name }) => name === 'another')!.ref;
  state.selectAnimationEvent(newRef);
  state.undo();
  assert.isNull(state.selectedEvent);
  state.redo();
  assert.isTrue(state.selectAnimationEvent(newRef));
  assert.isFalse(state.exportJson().includes('animation-event'));
  assert.equal(JSON.stringify(state.sourceAnimation), source);
  assert.equal(JSON.stringify(input), before);
  state.selectAnimation('empty', { discardChanges: true });
  assert.isNull(state.selectedEvent);
  assert.isFalse(state.selectAnimationEvent(newRef));
});

test('no animation, empty events, invalid events and rejected zero duration leave a safe empty track', () => {
  const missing = new AnimationEditorState();
  assert.deepEqual(missing.eventTimelineTrack.markers, []);
  assert.isUndefined(missing.selectedEventData);
  assert.isFalse(missing.addAnimationEvent({ time: 0, name: 'event' }));
  const invalid = new AnimationEditorState(rig, [
    { ...clip(), name: 'zero', duration: 0 },
    { ...clip(), name: 'bad', events: [{ time: 2001, name: 'event' }] },
  ]);
  for (const id of ['zero', 'bad']) {
    assert.isFalse(invalid.selectAnimation(id));
    assert.isTrue(invalid.validationIssues.length > 0);
    assert.deepEqual(invalid.eventTimelineTrack.markers, []);
    assert.equal(invalid.duration, 0);
  }
  const { state } = session();
  state.selectAnimation('empty');
  assert.deepEqual(state.eventTimelineTrack.markers, []);
  assert.equal(state.eventTimelineTrack.stackCount, 1);
  state.selectAnimation(null);
  assert.deepEqual(state.eventTimelineTrack.markers, []);
});
