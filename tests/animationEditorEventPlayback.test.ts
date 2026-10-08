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
  state.onAnimationEvent((event) => events.push(event));
  return { state, events, names: () => events.map(({ name }) => name) };
}

test.each([false, true])('editor and runtime deliver identical forward/loop/large-delta events, loop=%s', (loop) => {
  const { state, events } = session();
  state.setPreviewLoop(loop);
  const player = new AnimationPlayer(rig, new Map([['root', new Joint('root')]]), [
    compileClip({ ...clip, loop }, rig),
  ]);
  const runtime: FiredAnimationEvent[] = [];
  player.onAnimationEvent((event) => runtime.push(event));
  player.play('events');
  state.play();
  for (const [delta, speed] of [
    [0.1, 1],
    [0.15, 1],
    [0.1, 2],
    [0.001, 0.25],
    [0.8, 1],
    [5.2, 1.5],
    [0.02, 1],
  ] as const) {
    state.setPlaybackSpeed(speed);
    player.setSpeed(speed);
    state.advancePlayback(delta);
    player.update(delta * 1000);
    assert.deepEqual(events, runtime);
    assert.approximately(state.currentTime * 1000, player.elapsedTime, 1e-8);
  }
  player.dispose();
});

test('navigation across all markers, key/event selection, editing and Undo/Redo cause no event side effects', () => {
  const { state, events } = session();
  for (const time of [0, 1, 2, 0.5, 0]) state.setCurrentTime(time);
  state.restart();
  for (const marker of state.eventTimelineTrack.markers) state.selectAnimationEvent(marker.ref);
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  state.setBonePropertyKeyframe('root', 'x', 10);
  state.undo();
  state.redo();
  state.selectAnimationEvent(state.eventTimelineTrack.markers[0]!.ref);
  state.copySelectedEvent();
  state.pasteEvent();
  state.duplicateSelectedEvent();
  state.moveSelectedEvent(1.2);
  state.deleteSelectedEvent();
  state.undo();
  state.redo();
  assert.deepEqual(events, []);
  state.play();
  events.length = 0;
  state.beginScrub();
  for (const time of [2, 0, 1.95, 0.05, 0.5, 0]) {
    state.setCurrentTime(time);
    state.advancePlayback(10);
  }
  state.endScrub();
  assert.deepEqual(events, []);
  state.advancePlayback(0.05);
  assert.deepEqual(events, [], 'scrub release at zero does not restart start events');
  state.advancePlayback(0.1);
  assert.deepEqual(
    events.map(({ name }) => name),
    ['early'],
  );
});

test('crossings exclude the previous time, include the end, and dispatch all same-time markers once', () => {
  const { state, events, names } = session();
  state.setCurrentTime(0.1);
  state.play();
  state.advancePlayback(0.4);
  assert.deepEqual(names(), ['left', 'right', 'cloth']);
  state.advancePlayback(0);
  state.advancePlayback(0.000001);
  assert.deepEqual(names(), ['left', 'right', 'cloth']);
  events.length = 0;
  state.advancePlayback(0.4);
  assert.deepEqual(names(), ['impact']);
});

test('wrap crosses the tail, endpoint/start boundary, and head in runtime order', () => {
  const { state, names } = session();
  state.setPreviewLoop(true);
  state.setCurrentTime(1.8);
  state.play();
  state.advancePlayback(0.4);
  assert.deepEqual(names(), ['near-end', 'start', 'end', 'early']);
  assert.approximately(state.currentTime, 0.2, 1e-12);
});

test('whole-cycle updates dispatch events even when wrapped currentTime is unchanged', () => {
  const { state, events, names } = session();
  state.setPreviewLoop(true);
  state.play();
  events.length = 0;
  state.advancePlayback(6);
  const cycle = ['early', 'left', 'right', 'cloth', 'impact', 'near-end', 'start', 'end'];
  assert.deepEqual(names(), [...cycle, ...cycle, ...cycle]);
  assert.equal(state.currentTime, 0);
  state.pause();
  state.play();
  assert.equal(events.length, 24, 'resume at a wrapped zero cannot replay start events');
});

test('initial play, endpoint replay and playing restart fire start once; paused restart waits for play', () => {
  const { state, events, names } = session({ ...clip, loop: false });
  state.restart();
  assert.deepEqual(events, []);
  state.play();
  state.play();
  assert.deepEqual(names(), ['start']);
  state.pause();
  state.play();
  assert.deepEqual(names(), ['start']);
  state.restart();
  assert.deepEqual(names(), ['start', 'start']);
  state.advancePlayback(10);
  assert.isFalse(state.isPlaying);
  events.length = 0;
  state.play();
  assert.deepEqual(names(), ['start']);
  state.advancePlayback(0.1);
  assert.deepEqual(names(), ['start', 'early']);
  state.pause();
  state.restart();
  assert.deepEqual(names(), ['start', 'early']);
  state.play();
  assert.deepEqual(names(), ['start', 'early', 'start']);
});

test.each([10000, 2_000_000.5, Number.MAX_VALUE])(
  'unbounded catch-up %s is rejected atomically using runtime limits',
  (delta) => {
    const { state, events } = session();
    state.setPreviewLoop(true);
    state.setCurrentTime(0.25);
    state.play();
    const working = state.workingAnimation;
    state.advancePlayback(delta);
    assert.equal(state.currentTime, 0.25);
    assert.deepEqual(events, []);
    assert.isTrue(state.isPlaying);
    assert.strictEqual(state.workingAnimation, working);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
    assert.isNotEmpty(state.validationIssues);
  },
);

test('bounded multi-loop catch-up and huge nonlooping deltas retain every relevant event', () => {
  const { state, events } = session();
  state.setPreviewLoop(true);
  state.setCurrentTime(0.25);
  state.play();
  state.advancePlayback(100);
  assert.equal(events.length, 400);
  assert.approximately(state.currentTime, 0.25, 1e-12);
  events.length = 0;
  state.setPreviewLoop(false);
  state.setPlaybackSpeed(2);
  state.advancePlayback(Number.MAX_VALUE);
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
  state.onAnimationEvent((event) => {
    assert.isTrue(synchronized.mock.calls.length > 0);
    if (event.name === 'start') (event.data as { nested: number[] }).nested.push(2);
    throw new Error('listener failed');
  });
  const healthy = vi.fn<(event: FiredAnimationEvent) => void>();
  const unsubscribe = state.onAnimationEvent(healthy);
  assert.throws(() => state.play(), /listener failed/);
  assert.deepEqual(healthy.mock.calls[0]![0].data, { nested: [1] });
  assert.deepEqual(state.workingAnimation!.events![1]!.data, { nested: [1] });
  healthy.mockClear();
  assert.throws(() => state.advancePlayback(1), AggregateError);
  assert.deepEqual(
    healthy.mock.calls.map(([event]) => event.name),
    ['early', 'left', 'right', 'cloth', 'impact'],
  );
  assert.equal(state.currentTime, 1);
  unsubscribe();
  assert.throws(() => state.restart(), /listener failed/);
  assert.equal(healthy.mock.calls.length, 5);
});

test('stepped pose sampling never quantizes event crossings', () => {
  const { state, names } = session({ ...clip, playback: { mode: 'stepped', fps: 1 } });
  state.play();
  state.advancePlayback(0.5);
  assert.deepEqual(names(), ['start', 'early', 'left', 'right', 'cloth']);
  assert.equal(state.currentTime, 0.5);
});

test('authored millisecond clock cannot replay a boundary after fractional seconds addition', () => {
  const { state, names } = session();
  state.setCurrentTime(0.3);
  state.play();
  state.advancePlayback(0.6);
  assert.equal(state.currentTime, 0.9);
  assert.deepEqual(names(), ['right', 'cloth', 'impact']);
  state.advancePlayback(0.01);
  assert.deepEqual(names(), ['right', 'cloth', 'impact']);
});

test('fractional millisecond marker boundaries remain exact across following updates', () => {
  const timestamp = 0.000000123456789;
  const { state, events } = session({ ...clip, events: [{ time: timestamp, name: 'fractional' }] });
  state.play();
  state.advancePlayback(timestamp / 1000);
  const count = events.length;
  state.advancePlayback(0.001);
  assert.equal(events.length, 1);
  assert.equal(count, 1);
});

test('selection seeks to exact fractional authored time and excludes it on the next playback update', () => {
  const timestamp = 0.031101767270538955;
  const { state, events } = session({ ...clip, events: [{ time: timestamp, name: 'fractional' }] });
  state.selectAnimationEvent(state.eventTimelineTrack.markers[0]!.ref);
  state.play();
  state.advancePlayback(0.000001);
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
