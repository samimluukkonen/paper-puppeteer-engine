import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clip: AnimationClip = {
  name: 'move',
  duration: 2000,
  loop: true,
  tracks: {
    root: [
      { time: 0, x: 0 },
      { time: 2000, x: 20 },
    ],
  },
  events: [{ time: 1000, name: 'middle', data: { value: [1, 2] } }],
};
function session(): AnimationEditorState {
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation('move');
  return state;
}

test.each([30, 60, 120, 144])('elapsed time drives playback at %s FPS', (fps) => {
  const state = session();
  state.setCurrentTime(0.25);
  state.playback.play();
  for (let frame = 0; frame < fps; frame += 1) state.playback.advancePlayback(1 / fps);
  assert.approximately(state.currentTime, 1.25, 1e-12);
  assert.isTrue(state.playback.isPlaying);
});

test('pause holds time and resume continues from that position', () => {
  const state = session();
  state.playback.advancePlayback(1);
  assert.equal(state.currentTime, 0);
  state.playback.play();
  state.playback.advancePlayback(0.23);
  state.playback.advancePlayback(0.07);
  state.playback.pause();
  const held = state.currentTime;
  const listener = vi.fn();
  state.subscribe(listener);
  state.playback.pause();
  state.playback.advancePlayback(9);
  assert.equal(state.currentTime, held);
  assert.equal(listener.mock.calls.length, 0);
  state.playback.togglePlayback();
  state.playback.advancePlayback(0.5);
  assert.approximately(state.currentTime, 0.8, 1e-12);
  state.playback.togglePlayback();
  assert.isFalse(state.playback.isPlaying);
});

test.each([false, true])('restart rewinds immediately and preserves playing=%s', (playing) => {
  const state = session();
  state.setCurrentTime(0.7);
  if (playing) state.playback.play();
  const listener = vi.fn();
  state.subscribe(listener);
  state.playback.restart();
  assert.equal(state.currentTime, 0);
  assert.equal(state.playback.isPlaying, playing);
  assert.equal(listener.mock.calls.length, 1);
  state.playback.advancePlayback(0.2);
  assert.equal(state.currentTime, playing ? 0.2 : 0);
});

test.each([0.75, 10, Number.MAX_VALUE])('delta %s stops exactly at duration and notifies only once', (delta) => {
  const state = session();
  state.setCurrentTime(1.25);
  state.playback.play();
  const listener = vi.fn();
  state.subscribe(listener);
  state.playback.advancePlayback(delta);
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.playback.isPlaying);
  for (let frame = 0; frame < 20; frame += 1) state.playback.advancePlayback(delta);
  assert.equal(state.currentTime, 2);
  assert.equal(listener.mock.calls.length, 1);
  state.playback.play();
  assert.equal(state.currentTime, 0);
  assert.isTrue(state.playback.isPlaying);
  state.playback.advancePlayback(0.1);
  assert.equal(state.currentTime, 0.1);
});

test('invalid deltas leave playing time intact', () => {
  const state = session();
  state.playback.play();
  state.playback.advancePlayback(0.25);
  for (const delta of [NaN, Infinity, -Infinity, -1, 0]) state.playback.advancePlayback(delta);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.playback.isPlaying);
});

test('missing and rejected zero-duration animations remain safe', () => {
  for (const state of [
    new AnimationEditorState(),
    new AnimationEditorState(rig),
    new AnimationEditorState(rig, [{ ...clip, duration: 0, tracks: {}, events: [] }]),
  ]) {
    state.selectAnimation('move');
    state.playback.play();
    state.playback.togglePlayback();
    state.playback.advancePlayback(10);
    state.playback.pause();
    state.playback.restart();
    assert.equal(state.duration, 0);
    assert.equal(state.currentTime, 0);
    assert.isFalse(state.playback.isPlaying);
    assert.isFalse(state.dirty);
  }
});

test.each([false, true])('playback preserves caller/source/working data and dirty=%s without history', (dirty) => {
  const before = JSON.stringify(clip);
  const state = session();
  if (dirty) state.replaceWorkingAnimation({ ...clip, version: 1, duration: 3000 });
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  const snapshot = JSON.stringify(working);
  const history = state.historyLength;
  for (const action of [
    () => state.playback.play(),
    () => state.playback.advancePlayback(0.4),
    () => state.playback.pause(),
    () => state.playback.restart(),
    () => state.playback.play(),
    () => state.playback.restart(),
    () => state.playback.advancePlayback(10),
  ]) {
    action();
    assert.equal(state.dirty, dirty);
    assert.equal(state.historyLength, history);
    assert.strictEqual(state.sourceAnimation, source);
    assert.strictEqual(state.workingAnimation, working);
    assert.equal(JSON.stringify(working), snapshot);
    assert.equal(JSON.stringify(clip), before);
  }
});

test('successful selection stops playback; failed selection preserves playback', () => {
  const state = session();
  state.playback.play();
  state.playback.advancePlayback(0.2);
  assert.isFalse(state.selectAnimation('missing'));
  assert.isTrue(state.playback.isPlaying);
  assert.equal(state.currentTime, 0.2);
  state.selectAnimation('move');
  assert.isFalse(state.playback.isPlaying);
  assert.equal(state.currentTime, 0);
  state.playback.play();
  state.selectAnimation(null);
  assert.isFalse(state.playback.isPlaying);
  state.playback.advancePlayback(1);
  assert.equal(state.currentTime, 0);
});

test('shortening duration and history restoration clamp and stop playback', () => {
  const state = session();
  state.replaceWorkingAnimation({ ...clip, version: 1, duration: 3000 });
  state.playback.play();
  state.playback.advancePlayback(2.5);
  state.undo();
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.playback.isPlaying);
  state.playback.play();
  state.playback.advancePlayback(1.5);
  state.replaceWorkingAnimation({ ...clip, version: 1, duration: 1000, tracks: {}, events: [] });
  assert.equal(state.currentTime, 1);
  assert.isFalse(state.playback.isPlaying);
});

const endpointCases = [false, true].flatMap((loop) => [false, true].map((scrubbing) => ({ loop, scrubbing })));

test.each(endpointCases)(
  'authored edits and undo/redo retain endpoint playback intent with loop=$loop, scrubbing=$scrubbing',
  ({ loop, scrubbing }) => {
    for (const operation of ['edit', 'undo', 'redo'] as const) {
      const state = session();
      const short = { ...clip, version: 1, duration: 1000, tracks: {}, events: [] };
      if (operation === 'undo') state.replaceWorkingAnimation({ ...short, duration: 3000 });
      if (operation === 'redo') {
        state.replaceWorkingAnimation(short);
        state.undo();
      }
      state.playback.setPreviewLoop(loop);
      state.playback.play();
      if (scrubbing) state.playback.beginScrub();
      state.setCurrentTime(operation === 'undo' ? 2.5 : 1.5);
      if (operation === 'edit') state.replaceWorkingAnimation(short);
      else state[operation]();
      assert.equal(state.currentTime, state.duration);
      assert.equal(state.playback.isPlaying, loop || scrubbing, operation);
      state.playback.endScrub();
      assert.equal(state.playback.isPlaying, loop, operation);
      state.playback.advancePlayback(0.1);
      assert.approximately(state.currentTime, loop ? 0.1 : state.duration, 1e-12);
    }
  },
);

test('equivalent replacement at a looping endpoint preserves playback and history', () => {
  const state = session();
  state.playback.setPreviewLoop(true);
  state.playback.play();
  state.setCurrentTime(state.duration);
  state.replaceWorkingAnimation(structuredClone(state.workingAnimation));
  assert.isTrue(state.playback.isPlaying);
  assert.equal(state.historyLength, 0);
  state.playback.advancePlayback(0.1);
  assert.approximately(state.currentTime, 0.1, 1e-12);
});

test.each([
  { start: 1.75, delta: 0.25, expected: 0 },
  { start: 1.9, delta: 0.3, expected: 0.2 },
  { start: 1.9, delta: 10.3, expected: 0.2 },
  { start: 0.25, delta: 2_000_000.5, expected: 0.75 },
  { start: 0.25, delta: Number.MAX_VALUE, expected: 0.25 },
])('preview loop preserves overshoot for $start + $delta', ({ start, delta, expected }) => {
  // Event-free clocks can reduce even astronomical deltas; event catch-up is bounded separately.
  const state = new AnimationEditorState(rig, [{ ...clip, events: [] }]);
  state.selectAnimation('move');
  state.playback.setPreviewLoop(true);
  state.setCurrentTime(start);
  state.playback.play();
  state.playback.advancePlayback(delta);
  assert.approximately(state.currentTime, expected, 1e-10);
  assert.isTrue(Number.isFinite(state.currentTime));
  assert.isTrue(state.playback.isPlaying);
});

test('repeated loops preserve elapsed time rather than losing overshoot', () => {
  const state = session();
  state.playback.setPreviewLoop(true);
  state.playback.play();
  for (let frame = 0; frame < 1000; frame += 1) state.playback.advancePlayback(0.03);
  assert.approximately(state.currentTime, 0, 1e-10);
  assert.isTrue(state.playback.isPlaying);
  state.playback.setPreviewLoop(false);
  state.playback.advancePlayback(10);
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.playback.isPlaying);
});

test.each([false, true])('scrubbing suspends advancement and restores playing=%s', (playing) => {
  const state = session();
  state.setCurrentTime(0.4);
  if (playing) state.playback.play();
  state.playback.beginScrub();
  state.playback.beginScrub(); // A duplicate pointer-down must not overwrite playback intent.
  assert.isTrue(state.playback.isScrubbing);
  state.playback.advancePlayback(10);
  assert.equal(state.currentTime, 0.4);
  state.setCurrentTime(1.3);
  state.playback.advancePlayback(100);
  assert.equal(state.currentTime, 1.3);
  state.playback.endScrub();
  state.playback.endScrub();
  assert.isFalse(state.playback.isScrubbing);
  assert.equal(state.playback.isPlaying, playing);
  state.playback.advancePlayback(0.2);
  assert.approximately(state.currentTime, playing ? 1.5 : 1.3, 1e-12);
});

test.each([false, true])('release at the endpoint stops once or resumes loop=%s', (loop) => {
  const state = session();
  state.playback.setPreviewLoop(loop);
  state.playback.play();
  state.playback.beginScrub();
  state.setCurrentTime(2);
  assert.isTrue(state.playback.isPlaying);
  state.playback.advancePlayback(0.5);
  assert.equal(state.currentTime, 2);
  state.playback.endScrub();
  assert.equal(state.playback.isPlaying, loop);
  state.playback.advancePlayback(0.5);
  assert.equal(state.currentTime, loop ? 0.5 : 2);
});

test('explicit pause during a playing scrub cancels automatic resume', () => {
  const state = session();
  state.playback.play();
  state.playback.beginScrub();
  state.playback.pause();
  state.setCurrentTime(0.5);
  state.playback.endScrub();
  state.playback.advancePlayback(1);
  assert.equal(state.currentTime, 0.5);
  assert.isFalse(state.playback.isPlaying);
});

test('switching during a playing scrub clears drag and playback while preserving the loop preference', () => {
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other', duration: 3000 }]);
  state.selectAnimation('move');
  state.playback.setPreviewLoop(true);
  state.playback.play();
  state.playback.beginScrub();
  state.setCurrentTime(1.3);
  assert.isFalse(state.selectAnimation('missing'));
  assert.isTrue(state.playback.isScrubbing);
  assert.isTrue(state.playback.isPlaying);
  assert.isTrue(state.selectAnimation('other'));
  assert.equal(state.duration, 3);
  assert.equal(state.currentTime, 0);
  assert.equal(state.workingAnimation!.name, 'other');
  assert.isFalse(state.playback.isPlaying);
  assert.isFalse(state.playback.isScrubbing);
  assert.isTrue(state.playback.previewLoop);
  state.playback.endScrub();
  state.playback.advancePlayback(1);
  assert.equal(state.currentTime, 0);
});

test.each([false, true])('looping and scrubbing preserve snapshots, history and dirty=%s', (dirty) => {
  const input = JSON.stringify(clip);
  const state = session();
  if (dirty) state.replaceWorkingAnimation({ ...clip, version: 1, duration: 3000 });
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  const snapshot = JSON.stringify(working);
  const history = state.historyLength;
  for (const action of [
    () => state.playback.setPreviewLoop(true),
    () => state.playback.play(),
    () => state.playback.advancePlayback(100.3),
    () => state.playback.beginScrub(),
    () => state.setCurrentTime(0.7),
    () => state.playback.advancePlayback(Number.MAX_VALUE),
    () => state.playback.endScrub(),
    () => state.playback.advancePlayback(100.3),
    () => state.playback.setPreviewLoop(false),
    () => state.playback.pause(),
    () => state.playback.beginScrub(),
    () => state.setCurrentTime(1),
    () => state.playback.endScrub(),
  ]) {
    action();
    assert.equal(state.dirty, dirty);
    assert.equal(state.historyLength, history);
    assert.strictEqual(state.sourceAnimation, source);
    assert.strictEqual(state.workingAnimation, working);
    assert.equal(JSON.stringify(working), snapshot);
    assert.equal(JSON.stringify(clip), input);
  }
});

test('loop and scrub commands on a zero-length session keep time finite and playback stopped', () => {
  const state = new AnimationEditorState(rig, [{ ...clip, duration: 0, tracks: {}, events: [] }]);
  assert.isFalse(state.selectAnimation('move'));
  state.playback.setPreviewLoop(true);
  state.playback.beginScrub();
  state.setCurrentTime(Infinity);
  state.playback.play();
  state.playback.advancePlayback(Number.MAX_VALUE);
  state.playback.endScrub();
  assert.equal(state.currentTime, 0);
  assert.isFalse(state.playback.isPlaying);
  assert.isFalse(state.playback.isScrubbing);
});

test.each([0.000001, 3_600_000, Number.MAX_VALUE])(
  'short/long duration %s stays finite across playback edges',
  (duration) => {
    const state = new AnimationEditorState(rig, [{ ...clip, duration, tracks: {}, events: [] }]);
    assert.isTrue(state.selectAnimation('move'));
    for (const loop of [false, true]) {
      state.playback.setPreviewLoop(loop);
      for (const speed of [0.25, 1, 2]) {
        state.playback.setPlaybackSpeed(speed);
        state.playback.restart();
        state.playback.play();
        state.playback.advancePlayback(state.duration / (4 * speed));
        assert.approximately(state.currentTime / state.duration, 0.25, 1e-12);
        state.playback.beginScrub();
        state.setCurrentTime(Infinity);
        state.playback.advancePlayback(Number.MAX_VALUE);
        assert.equal(state.currentTime, state.duration);
        state.playback.endScrub();
        assert.equal(state.playback.isPlaying, loop);
        state.playback.advancePlayback(Number.MAX_VALUE);
        assert.isTrue(Number.isFinite(state.currentTime));
        assert.isTrue(state.currentTime >= 0 && state.currentTime <= state.duration);
        assert.equal(state.playback.isPlaying, loop);
        state.playback.pause();
      }
    }
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
  },
);

test('repeated commands and animation switches leave one coherent transient session', () => {
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other' }]);
  const before = JSON.stringify(clip);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    assert.isTrue(state.selectAnimation(iteration % 2 ? 'move' : 'other'));
    assert.equal(state.currentTime, 0);
    assert.isFalse(state.playback.isPlaying);
    state.playback.play();
    state.playback.play();
    state.playback.setPreviewLoop(true);
    state.playback.setPreviewLoop(true);
    state.playback.advancePlayback(20.25);
    assert.equal(state.currentTime, 0.25);
    state.playback.pause();
    state.playback.pause();
    state.playback.togglePlayback();
    state.playback.restart();
    assert.equal(state.currentTime, 0);
    assert.isTrue(state.playback.isPlaying);
    state.playback.beginScrub();
    state.setCurrentTime(state.duration);
    state.playback.setPreviewLoop(false);
    state.playback.setPreviewLoop(false);
    assert.isTrue(state.playback.isPlaying);
    state.playback.endScrub();
    assert.isFalse(state.playback.isPlaying);
    assert.equal(state.currentTime, state.duration);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
  }
  assert.equal(JSON.stringify(clip), before);
});

test('event-free looping remains finite when a positive millisecond duration underflows in seconds', () => {
  const state = new AnimationEditorState(rig, [{ ...clip, duration: Number.MIN_VALUE, tracks: {}, events: [] }]);
  assert.isTrue(state.selectAnimation('move'));
  state.playback.setPreviewLoop(true);
  state.playback.play();
  state.playback.advancePlayback(Number.MAX_VALUE);
  assert.isTrue(Number.isFinite(state.currentTime));
  assert.equal(state.currentTime, 0);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});
