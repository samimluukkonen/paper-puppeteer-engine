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
