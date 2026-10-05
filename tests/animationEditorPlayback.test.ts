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
  state.play();
  for (let frame = 0; frame < fps; frame += 1) state.advancePlayback(1 / fps);
  assert.approximately(state.currentTime, 1.25, 1e-12);
  assert.isTrue(state.isPlaying);
});

test('pause holds time and resume continues from that position', () => {
  const state = session();
  state.advancePlayback(1);
  assert.equal(state.currentTime, 0);
  state.play();
  state.advancePlayback(0.23);
  state.advancePlayback(0.07);
  state.pause();
  const held = state.currentTime;
  const listener = vi.fn();
  state.subscribe(listener);
  state.pause();
  state.advancePlayback(9);
  assert.equal(state.currentTime, held);
  assert.equal(listener.mock.calls.length, 0);
  state.togglePlayback();
  state.advancePlayback(0.5);
  assert.approximately(state.currentTime, 0.8, 1e-12);
  state.togglePlayback();
  assert.isFalse(state.isPlaying);
});

test.each([false, true])('restart rewinds immediately and preserves playing=%s', (playing) => {
  const state = session();
  state.setCurrentTime(0.7);
  if (playing) state.play();
  const listener = vi.fn();
  state.subscribe(listener);
  state.restart();
  assert.equal(state.currentTime, 0);
  assert.equal(state.isPlaying, playing);
  assert.equal(listener.mock.calls.length, 1);
  state.advancePlayback(0.2);
  assert.equal(state.currentTime, playing ? 0.2 : 0);
});

test.each([0.75, 10, Number.MAX_VALUE])('delta %s stops exactly at duration and notifies only once', (delta) => {
  const state = session();
  state.setCurrentTime(1.25);
  state.play();
  const listener = vi.fn();
  state.subscribe(listener);
  state.advancePlayback(delta);
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.isPlaying);
  for (let frame = 0; frame < 20; frame += 1) state.advancePlayback(delta);
  assert.equal(state.currentTime, 2);
  assert.equal(listener.mock.calls.length, 1);
  state.play();
  assert.equal(state.currentTime, 0);
  assert.isTrue(state.isPlaying);
  state.advancePlayback(0.1);
  assert.equal(state.currentTime, 0.1);
});

test('invalid deltas leave playing time intact', () => {
  const state = session();
  state.play();
  state.advancePlayback(0.25);
  for (const delta of [NaN, Infinity, -Infinity, -1, 0]) state.advancePlayback(delta);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.isPlaying);
});

test('missing and rejected zero-duration animations remain safe', () => {
  for (const state of [
    new AnimationEditorState(),
    new AnimationEditorState(rig),
    new AnimationEditorState(rig, [{ ...clip, duration: 0, tracks: {}, events: [] }]),
  ]) {
    state.selectAnimation('move');
    state.play();
    state.togglePlayback();
    state.advancePlayback(10);
    state.pause();
    state.restart();
    assert.equal(state.duration, 0);
    assert.equal(state.currentTime, 0);
    assert.isFalse(state.isPlaying);
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
    () => state.play(),
    () => state.advancePlayback(0.4),
    () => state.pause(),
    () => state.restart(),
    () => state.play(),
    () => state.restart(),
    () => state.advancePlayback(10),
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
  state.play();
  state.advancePlayback(0.2);
  assert.isFalse(state.selectAnimation('missing'));
  assert.isTrue(state.isPlaying);
  assert.equal(state.currentTime, 0.2);
  state.selectAnimation('move');
  assert.isFalse(state.isPlaying);
  assert.equal(state.currentTime, 0);
  state.play();
  state.selectAnimation(null);
  assert.isFalse(state.isPlaying);
  state.advancePlayback(1);
  assert.equal(state.currentTime, 0);
});

test('shortening duration and history restoration clamp and stop playback', () => {
  const state = session();
  state.replaceWorkingAnimation({ ...clip, version: 1, duration: 3000 });
  state.play();
  state.advancePlayback(2.5);
  state.undo();
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.isPlaying);
  state.play();
  state.advancePlayback(1.5);
  state.replaceWorkingAnimation({ ...clip, version: 1, duration: 1000, tracks: {}, events: [] });
  assert.equal(state.currentTime, 1);
  assert.isFalse(state.isPlaying);
});

test.each([
  { start: 1.75, delta: 0.25, expected: 0 },
  { start: 1.9, delta: 0.3, expected: 0.2 },
  { start: 1.9, delta: 10.3, expected: 0.2 },
  { start: 0.25, delta: 2_000_000.5, expected: 0.75 },
  { start: 0.25, delta: Number.MAX_VALUE, expected: 0.25 },
])('preview loop preserves overshoot for $start + $delta', ({ start, delta, expected }) => {
  const state = session();
  state.setPreviewLoop(true);
  state.setCurrentTime(start);
  state.play();
  state.advancePlayback(delta);
  assert.approximately(state.currentTime, expected, 1e-10);
  assert.isTrue(Number.isFinite(state.currentTime));
  assert.isTrue(state.isPlaying);
});

test('repeated loops preserve elapsed time rather than losing overshoot', () => {
  const state = session();
  state.setPreviewLoop(true);
  state.play();
  for (let frame = 0; frame < 1000; frame += 1) state.advancePlayback(0.03);
  assert.approximately(state.currentTime, 0, 1e-10);
  assert.isTrue(state.isPlaying);
  state.setPreviewLoop(false);
  state.advancePlayback(10);
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.isPlaying);
});

test.each([false, true])('scrubbing suspends advancement and restores playing=%s', (playing) => {
  const state = session();
  state.setCurrentTime(0.4);
  if (playing) state.play();
  state.beginScrub();
  state.beginScrub(); // A duplicate pointer-down must not overwrite playback intent.
  assert.isTrue(state.isScrubbing);
  state.advancePlayback(10);
  assert.equal(state.currentTime, 0.4);
  state.setCurrentTime(1.3);
  state.advancePlayback(100);
  assert.equal(state.currentTime, 1.3);
  state.endScrub();
  state.endScrub();
  assert.isFalse(state.isScrubbing);
  assert.equal(state.isPlaying, playing);
  state.advancePlayback(0.2);
  assert.approximately(state.currentTime, playing ? 1.5 : 1.3, 1e-12);
});

test.each([false, true])('release at the endpoint stops once or resumes loop=%s', (loop) => {
  const state = session();
  state.setPreviewLoop(loop);
  state.play();
  state.beginScrub();
  state.setCurrentTime(2);
  assert.isTrue(state.isPlaying);
  state.advancePlayback(0.5);
  assert.equal(state.currentTime, 2);
  state.endScrub();
  assert.equal(state.isPlaying, loop);
  state.advancePlayback(0.5);
  assert.equal(state.currentTime, loop ? 0.5 : 2);
});

test('explicit pause during a playing scrub cancels automatic resume', () => {
  const state = session();
  state.play();
  state.beginScrub();
  state.pause();
  state.setCurrentTime(0.5);
  state.endScrub();
  state.advancePlayback(1);
  assert.equal(state.currentTime, 0.5);
  assert.isFalse(state.isPlaying);
});

test('switching during a playing scrub clears drag and playback while preserving the loop preference', () => {
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other', duration: 3000 }]);
  state.selectAnimation('move');
  state.setPreviewLoop(true);
  state.play();
  state.beginScrub();
  state.setCurrentTime(1.3);
  assert.isFalse(state.selectAnimation('missing'));
  assert.isTrue(state.isScrubbing);
  assert.isTrue(state.isPlaying);
  assert.isTrue(state.selectAnimation('other'));
  assert.equal(state.duration, 3);
  assert.equal(state.currentTime, 0);
  assert.equal(state.workingAnimation!.name, 'other');
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.isScrubbing);
  assert.isTrue(state.previewLoop);
  state.endScrub();
  state.advancePlayback(1);
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
    () => state.setPreviewLoop(true),
    () => state.play(),
    () => state.advancePlayback(100.3),
    () => state.beginScrub(),
    () => state.setCurrentTime(0.7),
    () => state.advancePlayback(Number.MAX_VALUE),
    () => state.endScrub(),
    () => state.advancePlayback(100.3),
    () => state.setPreviewLoop(false),
    () => state.pause(),
    () => state.beginScrub(),
    () => state.setCurrentTime(1),
    () => state.endScrub(),
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
  state.setPreviewLoop(true);
  state.beginScrub();
  state.setCurrentTime(Infinity);
  state.play();
  state.advancePlayback(Number.MAX_VALUE);
  state.endScrub();
  assert.equal(state.currentTime, 0);
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.isScrubbing);
});
