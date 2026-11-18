import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getEditorEventClip } from '../src/devtools/animation-editor/editorPlaybackEvents.js';
import { compileClip, type AnimationClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer, type FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clip: AnimationClip = {
  name: 'events',
  duration: 2000,
  loop: true,
  tracks: { root: [{ time: 500, x: 5 }] },
  events: [
    { time: 1900, name: 'near-end' },
    { time: 0, name: 'start', data: { nested: [1] } },
    { time: 100, name: 'early' },
    { time: 250, name: 'left' },
    { time: 500, name: 'right' },
    { time: 500, name: 'cloth' },
    { time: 900, name: 'impact' },
    { time: 2000, name: 'end' },
  ],
};
function session(input = clip) {
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation(input.name);
  const events: FiredAnimationEvent[] = [];
  state.playback.onAnimationEvent((event) => events.push(event));
  return { state, events, names: () => events.map(({ name }) => name) };
}

test.each([false, true])('editor and runtime deliver identical forward/loop/large-delta events, loop=%s', (loop) => {
  const { state, events } = session();
  state.playback.setPreviewLoop(loop);
  const player = new AnimationPlayer(rig, new Map([['root', new Joint('root')]]), [
    compileClip({ ...clip, loop }, rig),
  ]);
  const runtime: FiredAnimationEvent[] = [];
  player.onAnimationEvent((event) => runtime.push(event));
  player.play('events');
  state.playback.play();
  for (const [delta, speed] of [
    [0.1, 1],
    [0.15, 1],
    [0.1, 2],
    [0.001, 0.25],
    [0.8, 1],
    [5.2, 1.5],
    [0.02, 1],
  ] as const) {
    state.playback.setPlaybackSpeed(speed);
    player.setSpeed(speed);
    state.playback.advancePlayback(delta);
    player.update(delta * 1000);
    assert.deepEqual(events, runtime);
    assert.approximately(state.currentTime * 1000, player.elapsedTime, 1e-8);
  }
  player.dispose();
});

test('navigation across all markers, key/event selection, editing and Undo/Redo cause no event side effects', () => {
  const { state, events } = session();
  for (const time of [0, 1, 2, 0.5, 0]) state.setCurrentTime(time);
  state.playback.restart();
  for (const marker of state.events.eventTimelineTrack.markers) state.events.selectAnimationEvent(marker.ref);
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  state.keyframes.setBonePropertyKeyframe('root', 'x', 10);
  state.undo();
  state.redo();
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  state.events.copySelectedEvent();
  state.events.pasteEvent();
  state.events.duplicateSelectedEvent();
  state.events.moveSelectedEvent(1.2);
  state.events.deleteSelectedEvent();
  state.undo();
  state.redo();
  assert.deepEqual(events, []);
  state.playback.play();
  events.length = 0;
  state.playback.beginScrub();
  for (const time of [2, 0, 1.95, 0.05, 0.5, 0]) {
    state.setCurrentTime(time);
    state.playback.advancePlayback(10);
  }
  state.playback.endScrub();
  assert.deepEqual(events, []);
  state.playback.advancePlayback(0.05);
  assert.deepEqual(events, [], 'scrub release at zero does not restart start events');
  state.playback.advancePlayback(0.1);
  assert.deepEqual(
    events.map(({ name }) => name),
    ['early'],
  );
});

test('crossings exclude the previous time, include the end, and dispatch all same-time markers once', () => {
  const { state, events, names } = session();
  state.setCurrentTime(0.1);
  state.playback.play();
  state.playback.advancePlayback(0.4);
  assert.deepEqual(names(), ['left', 'right', 'cloth']);
  state.playback.advancePlayback(0);
  state.playback.advancePlayback(0.000001);
  assert.deepEqual(names(), ['left', 'right', 'cloth']);
  events.length = 0;
  state.playback.advancePlayback(0.4);
  assert.deepEqual(names(), ['impact']);
});

test('wrap crosses the tail, endpoint/start boundary, and head in runtime order', () => {
  const { state, names } = session();
  state.playback.setPreviewLoop(true);
  state.setCurrentTime(1.8);
  state.playback.play();
  state.playback.advancePlayback(0.4);
  assert.deepEqual(names(), ['near-end', 'start', 'end', 'early']);
  assert.approximately(state.currentTime, 0.2, 1e-12);
});

test('whole-cycle updates dispatch events even when wrapped currentTime is unchanged', () => {
  const { state, events, names } = session();
  state.playback.setPreviewLoop(true);
  state.playback.play();
  events.length = 0;
  state.playback.advancePlayback(6);
  const cycle = ['early', 'left', 'right', 'cloth', 'impact', 'near-end', 'start', 'end'];
  assert.deepEqual(names(), [...cycle, ...cycle, ...cycle]);
  assert.equal(state.currentTime, 0);
  state.playback.pause();
  state.playback.play();
  assert.equal(events.length, 24, 'resume at a wrapped zero cannot replay start events');
});

test('initial play, endpoint replay and playing restart fire start once; paused restart waits for play', () => {
  const { state, events, names } = session({ ...clip, loop: false });
  state.playback.restart();
  assert.deepEqual(events, []);
  state.playback.play();
  state.playback.play();
  assert.deepEqual(names(), ['start']);
  state.playback.pause();
  state.playback.play();
  assert.deepEqual(names(), ['start']);
  state.playback.restart();
  assert.deepEqual(names(), ['start', 'start']);
  state.playback.advancePlayback(10);
  assert.isFalse(state.playback.isPlaying);
  events.length = 0;
  state.playback.play();
  assert.deepEqual(names(), ['start']);
  state.playback.advancePlayback(0.1);
  assert.deepEqual(names(), ['start', 'early']);
  state.playback.pause();
  state.playback.restart();
  assert.deepEqual(names(), ['start', 'early']);
  state.playback.play();
  assert.deepEqual(names(), ['start', 'early', 'start']);
});

test('editor start and restart budgets preserve clocks, drafts and authored history on rejection', () => {
  const { state, events } = session({
    ...clip,
    loop: false,
    events: Array.from({ length: 10001 }, () => ({ time: 0, name: 'start' })),
  });
  state.selectBone('root');
  state.setTemporaryBoneProperty('x', 123);
  const working = state.workingAnimation;
  state.playback.play();
  assert.isFalse(state.playback.isPlaying);
  assert.equal(state.currentTime, 0);
  assert.equal(state.boneTransformDraft.x, 123);
  assert.isEmpty(events);
  assert.match(state.validationIssues[0]!.message, /exceeds 10000 events/);
  state.setCurrentTime(0.25);
  state.playback.play();
  assert.isTrue(state.playback.isPlaying, 'resuming after zero does not emit start events');
  state.playback.restart();
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.playback.isPlaying);
  assert.isEmpty(events);
  state.setCurrentTime(2);
  state.playback.play();
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.playback.isPlaying);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});

test.each([10000, 2_000_000.5, Number.MAX_VALUE])(
  'unbounded catch-up %s is rejected atomically using runtime limits',
  (delta) => {
    const { state, events } = session();
    state.playback.setPreviewLoop(true);
    state.setCurrentTime(0.25);
    state.playback.play();
    const working = state.workingAnimation;
    state.playback.advancePlayback(delta);
    assert.equal(state.currentTime, 0.25);
    assert.deepEqual(events, []);
    assert.isTrue(state.playback.isPlaying);
    assert.strictEqual(state.workingAnimation, working);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
    assert.isNotEmpty(state.validationIssues);
  },
);

test('bounded multi-loop catch-up and huge nonlooping deltas retain every relevant event', () => {
  const { state, events } = session();
  state.playback.setPreviewLoop(true);
  state.setCurrentTime(0.25);
  state.playback.play();
  state.playback.advancePlayback(100);
  assert.equal(events.length, 400);
  assert.approximately(state.currentTime, 0.25, 1e-12);
  events.length = 0;
  state.playback.setPreviewLoop(false);
  state.playback.setPlaybackSpeed(2);
  state.playback.advancePlayback(Number.MAX_VALUE);
  assert.deepEqual(
    events.map(({ name }) => name),
    ['right', 'cloth', 'impact', 'near-end', 'end'],
  );
  assert.equal(state.currentTime, 2);
});

test('dispatch uses runtime payload ownership, listener snapshots and failure isolation after pose synchronization', () => {
  const { state } = session();
  const synchronized = vi.fn();
  state.subscribe(synchronized);
  state.playback.onAnimationEvent((event) => {
    assert.isTrue(synchronized.mock.calls.length > 0);
    if (event.name === 'start') (event.data as { nested: number[] }).nested.push(2);
    throw new Error('listener failed');
  });
  const healthy = vi.fn<(event: FiredAnimationEvent) => void>();
  const unsubscribe = state.playback.onAnimationEvent(healthy);
  assert.throws(() => state.playback.play(), /listener failed/);
  assert.deepEqual(healthy.mock.calls[0]![0].data, { nested: [1] });
  assert.deepEqual(state.workingAnimation!.events![1]!.data, { nested: [1] });
  healthy.mockClear();
  assert.throws(() => state.playback.advancePlayback(1), AggregateError);
  assert.deepEqual(
    healthy.mock.calls.map(([event]) => event.name),
    ['early', 'left', 'right', 'cloth', 'impact'],
  );
  assert.equal(state.currentTime, 1);
  unsubscribe();
  assert.throws(() => state.playback.restart(), /listener failed/);
  assert.equal(healthy.mock.calls.length, 5);
});

test('failing state subscribers cannot consume start, crossing or restart events without delivering them', () => {
  const { state, events, names } = session();
  const failure = new Error('UI subscriber failed');
  const release = state.subscribe(() => {
    throw failure;
  });
  const synchronizedTimes: number[] = [];
  state.subscribe(() => synchronizedTimes.push(state.currentTimeMilliseconds));
  state.playback.onAnimationEvent(() => {
    assert.equal(synchronizedTimes.at(-1), state.currentTimeMilliseconds);
  });

  assert.throws(() => state.playback.play(), failure);
  assert.isTrue(state.playback.isPlaying);
  assert.deepEqual(names(), ['start']);
  events.length = 0;
  assert.throws(() => state.playback.advancePlayback(1), failure);
  assert.equal(state.currentTimeMilliseconds, 1000);
  assert.deepEqual(names(), ['early', 'left', 'right', 'cloth', 'impact']);
  events.length = 0;
  assert.throws(() => state.playback.restart(), failure);
  assert.equal(state.currentTimeMilliseconds, 0);
  assert.deepEqual(names(), ['start']);
  release();
  state.playback.advancePlayback(0.1);
  assert.deepEqual(names(), ['start', 'early']);
});

test('playback retains subscriber and event failures after delivering every committed marker', () => {
  const { state, names } = session();
  state.playback.play();
  const subscriberFailure = new Error('UI failed');
  const eventFailure = new Error('event listener failed');
  state.subscribe(() => {
    throw subscriberFailure;
  });
  state.playback.onAnimationEvent(() => {
    throw eventFailure;
  });
  const healthy = vi.fn();
  state.playback.onAnimationEvent(healthy);
  let caught: unknown;
  try {
    state.playback.advancePlayback(0.5);
  } catch (error) {
    caught = error;
  }
  assert.instanceOf(caught, AggregateError);
  assert.deepEqual(caught.errors, [subscriberFailure, eventFailure, eventFailure, eventFailure, eventFailure]);
  assert.equal(healthy.mock.calls.length, 4);
  assert.deepEqual(names(), ['start', 'early', 'left', 'right', 'cloth']);
  assert.equal(state.currentTimeMilliseconds, 500);
});

test('stepped pose sampling never quantizes event crossings', () => {
  const { state, names } = session({ ...clip, playback: { mode: 'stepped', fps: 1 } });
  state.playback.play();
  state.playback.advancePlayback(0.5);
  assert.deepEqual(names(), ['start', 'early', 'left', 'right', 'cloth']);
  assert.equal(state.currentTime, 0.5);
});

test('authored millisecond clock cannot replay a boundary after fractional seconds addition', () => {
  const { state, names } = session();
  state.setCurrentTime(0.3);
  state.playback.play();
  state.playback.advancePlayback(0.6);
  assert.equal(state.currentTime, 0.9);
  assert.deepEqual(names(), ['right', 'cloth', 'impact']);
  state.playback.advancePlayback(0.01);
  assert.deepEqual(names(), ['right', 'cloth', 'impact']);
});

test.each([250.03, 3.97])('canceling an event drag restores exact %s ms without replaying its marker', (timestamp) => {
  const { state, events, names } = session({
    ...clip,
    events: [
      { time: timestamp, name: 'fractional' },
      { time: 500, name: 'later' },
    ],
  });
  const authored = state.workingAnimation;
  const ref = state.events.eventTimelineTrack.markers[0]!.ref;
  assert.isTrue(state.events.beginEventDrag(ref));
  assert.equal(state.currentTimeMilliseconds, timestamp);
  assert.isTrue(state.events.previewEventDrag(0.8));
  assert.isTrue(state.events.cancelEventDrag());
  assert.equal(state.currentTimeMilliseconds, timestamp);
  assert.strictEqual(state.workingAnimation, authored);
  assert.strictEqual(state.selectedEvent, ref);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.deepEqual(events, []);
  state.playback.play();
  state.playback.advancePlayback(0.1);
  assert.deepEqual(events, []);
  state.playback.advancePlayback(1);
  assert.deepEqual(names(), ['later']);
});

test('fractional millisecond marker boundaries remain exact across following updates', () => {
  const timestamp = 0.000000123456789;
  const { state, events } = session({ ...clip, events: [{ time: timestamp, name: 'fractional' }] });
  state.playback.play();
  state.playback.advancePlayback(timestamp / 1000);
  const count = events.length;
  state.playback.advancePlayback(0.001);
  assert.equal(events.length, 1);
  assert.equal(count, 1);
});

test('editor and runtime preserve fractional loop crossings and close, distinct markers', () => {
  const input = {
    ...clip,
    duration: 1000,
    events: [
      { time: 100.1, name: 'early' },
      { time: 100.100000000001, name: 'later' },
    ],
  };
  const { state, events } = session(input);
  state.playback.setPreviewLoop(true);
  const player = new AnimationPlayer(rig, new Map([['root', new Joint('root')]]), [compileClip(input, rig)]);
  const runtime: FiredAnimationEvent[] = [];
  player.onAnimationEvent((event) => runtime.push(event));
  state.playback.play();
  player.play(input.name);
  for (const delta of [1.1001, 0.001, 0.999]) {
    state.playback.advancePlayback(delta);
    player.update(delta * 1000);
    assert.deepEqual(events, runtime);
    assert.equal(state.currentTime * 1000, player.elapsedTime);
  }
  assert.deepEqual(
    runtime.map(({ name }) => name),
    ['early', 'later', 'early', 'later', 'early'],
  );
});

test('editor wrap distinguishes tail markers from tiny markers in the new cycle', () => {
  const { state, events } = session({
    ...clip,
    duration: 1000,
    events: [
      { time: 0, name: 'start' },
      { time: 1e-14, name: 'tiny' },
      { time: 999.9999999999999, name: 'tail' },
      { time: 1000, name: 'end' },
    ],
  });
  state.playback.setPreviewLoop(true);
  state.playback.play();
  state.playback.advancePlayback(2);
  events.length = 0;
  state.playback.advancePlayback(0.001);
  assert.isEmpty(events);
});

test('selection seeks to exact fractional authored time and excludes it on the next playback update', () => {
  const timestamp = 0.031101767270538955;
  const { state, events } = session({ ...clip, events: [{ time: timestamp, name: 'fractional' }] });
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  state.playback.play();
  state.playback.advancePlayback(0.000001);
  assert.deepEqual(events, []);
});

test('event projection caches only immutable validated snapshots and revalidates mutable callers', () => {
  const input: AnimationClip & { version: 1 } = { ...clip, version: 1, events: [{ time: 100, name: 'mutable' }] };
  const first = getEditorEventClip(input, rig, false);
  input.events![0]!.time = 200;
  const second = getEditorEventClip(input, rig, false);
  assert.notStrictEqual(first, second);
  assert.equal(first.events[0]!.time, 100);
  assert.equal(second.events[0]!.time, 200);
  input.events![0]!.time = 3000;
  assert.throws(() => getEditorEventClip(input, rig, false));
  const { state } = session();
  assert.strictEqual(
    getEditorEventClip(state.workingAnimation!, rig, true),
    getEditorEventClip(state.workingAnimation!, rig, true),
  );
});
