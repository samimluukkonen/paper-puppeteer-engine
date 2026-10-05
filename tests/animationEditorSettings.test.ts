import { assert, test, vi } from 'vitest';
import {
  AnimationEditorState,
  AUTHORED_FPS_MAX,
  AUTHORED_FPS_MIN,
  PREVIEW_PLAYBACK_SPEEDS,
} from '../src/devtools/animation-editor/AnimationEditorState.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clip: AnimationClip = {
  name: 'move',
  duration: 2000,
  loop: false,
  playback: { mode: 'stepped', fps: 10 },
  tracks: {
    root: [
      { time: 0, x: 0 },
      { time: 2000, x: 200 },
    ],
  },
  events: [{ time: 1234, name: 'event', data: { value: [1, 2] } }],
};

function session(): AnimationEditorState {
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other' }]);
  state.selectAnimation('move');
  return state;
}

test.each(PREVIEW_PLAYBACK_SPEEDS)('%s× scales elapsed time independently of render rate', (speed) => {
  for (const renderFPS of [30, 60, 120]) {
    const state = session();
    assert.equal(state.playbackSpeed, 1);
    state.setPlaybackSpeed(speed);
    state.play();
    for (let frame = 0; frame < renderFPS / 2; frame += 1) state.advancePlayback(1 / renderFPS);
    assert.approximately(state.currentTime, 0.5 * speed, 1e-12);
  }
});

test.each([false, true])('speed changes preserve caller/source/working data, history and dirty=%s', (dirty) => {
  const state = session();
  const before = JSON.stringify(clip);
  if (dirty) state.setAuthoredFPS(20);
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  const snapshot = JSON.stringify(working);
  const history = state.historyLength;
  for (const speed of PREVIEW_PLAYBACK_SPEEDS) {
    state.setPlaybackSpeed(speed);
    state.play();
    state.advancePlayback(0.01);
    state.pause();
    assert.equal(state.dirty, dirty);
    assert.equal(state.historyLength, history);
    assert.strictEqual(state.sourceAnimation, source);
    assert.strictEqual(state.workingAnimation, working);
    assert.equal(JSON.stringify(working), snapshot);
    assert.equal(JSON.stringify(clip), before);
  }
});

test.each([NaN, Infinity, -Infinity, -1, 0, 0.1, 3])(
  'unsupported speed %s is rejected without notification',
  (speed) => {
    const state = session();
    state.setPlaybackSpeed(0.5);
    const listener = vi.fn();
    state.subscribe(listener);
    assert.isFalse(state.setPlaybackSpeed(speed));
    assert.equal(state.playbackSpeed, 0.5);
    assert.isTrue(state.setPlaybackSpeed(0.5));
    assert.equal(listener.mock.calls.length, 0);
    assert.isFalse(state.dirty);
  },
);

test('speed changes during playback and scrubbing take effect without resetting time or intent', () => {
  const state = session();
  state.play();
  state.advancePlayback(0.2);
  state.setPlaybackSpeed(0.5);
  assert.equal(state.currentTime, 0.2);
  assert.isTrue(state.isPlaying);
  state.advancePlayback(0.4);
  assert.equal(state.currentTime, 0.4);
  state.beginScrub();
  state.setPlaybackSpeed(2);
  state.setCurrentTime(0.74212345);
  state.advancePlayback(1);
  assert.equal(state.currentTime, 0.74212345);
  state.endScrub();
  state.advancePlayback(0.1);
  assert.approximately(state.currentTime, 0.94212345, 1e-12);
  state.selectAnimation('other');
  assert.equal(state.playbackSpeed, 2);
  assert.equal(state.currentTime, 0);
  assert.isFalse(state.isPlaying);
});

test.each(PREVIEW_PLAYBACK_SPEEDS)('%s× preserves loop overshoot and stops at a non-loop endpoint', (speed) => {
  const state = session();
  state.setPlaybackSpeed(speed);
  state.setPreviewLoop(true);
  state.setCurrentTime(1.75);
  state.play();
  state.advancePlayback(4.5 / speed);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.isPlaying);
  state.setPreviewLoop(false);
  state.advancePlayback(4 / speed);
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.isPlaying);
});

test.each([1.5, 2])('overflowing scaled delta is finite for looping and non-looping at %s×', (speed) => {
  const state = new AnimationEditorState(rig, [{ ...clip, duration: speed * 1000, tracks: {}, events: [] }]);
  state.selectAnimation('move');
  state.setPlaybackSpeed(speed);
  state.setCurrentTime(0.25);
  state.setPreviewLoop(true);
  state.play();
  state.advancePlayback(Number.MAX_VALUE);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.isPlaying);
  state.setPreviewLoop(false);
  state.advancePlayback(Number.MAX_VALUE);
  assert.equal(state.currentTime, speed);
  assert.isFalse(state.isPlaying);
});

test.each([AUTHORED_FPS_MIN, 12.5, AUTHORED_FPS_MAX])('FPS %s edits only the working copy without retiming', (fps) => {
  const state = session();
  const source = state.sourceAnimation;
  const before = JSON.stringify(clip);
  state.setCurrentTime(0.74212345);
  assert.isTrue(state.setAuthoredFPS(fps));
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps });
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(clip), before);
  assert.equal(source!.playback!.mode, 'stepped');
  assert.deepEqual(source!.playback, { mode: 'stepped', fps: 10 });
  assert.deepEqual(state.workingAnimation!.tracks, source!.tracks);
  assert.deepEqual(state.workingAnimation!.events, source!.events);
  assert.equal(state.duration, 2);
  assert.equal(state.currentTime, 0.74212345);
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  state.setPlaybackSpeed(2);
  state.undo();
  assert.isFalse(state.dirty);
  assert.deepEqual(state.workingAnimation!.playback, source!.playback);
  assert.equal(state.playbackSpeed, 2);
  state.redo();
  assert.isTrue(state.dirty);
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps });
});

test.each([NaN, Infinity, -Infinity, -10, 0, 0.5, 241])('invalid FPS %s preserves data, time and history', (fps) => {
  const state = session();
  const working = state.workingAnimation;
  state.play();
  state.advancePlayback(0.25);
  assert.isFalse(state.setAuthoredFPS(fps));
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.isPlaying);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(state.validationIssues[0]!.path, 'playback.fps');
  assert.isTrue(state.setAuthoredFPS(10));
  assert.lengthOf(state.validationIssues, 0);
  assert.equal(state.historyLength, 0);
});

test('mode edits use the schema union, preserve source and undo/redo the authored settings', () => {
  const state = session();
  const before = JSON.stringify(clip);
  state.setCurrentTime(0.15);
  state.play();
  assert.isTrue(state.setAuthoredPlaybackMode('smooth'));
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'smooth' });
  assert.isFalse(state.setAuthoredFPS(20));
  assert.isTrue(state.dirty);
  assert.equal(state.currentTime, 0.15);
  assert.isTrue(state.isPlaying);
  assert.equal(JSON.stringify(clip), before);
  assert.isTrue(state.setAuthoredPlaybackMode('stepped'));
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps: 10 });
  assert.isFalse(state.dirty);
  state.undo();
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'smooth' });
  state.undo();
  assert.isFalse(state.dirty);
  state.redo();
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'smooth' });
});

test('implicit smooth mode stays implicit until edited; setting controls are safe without selection', () => {
  const smooth: AnimationClip = { name: 'smooth', duration: 1000, loop: false, tracks: {} };
  const state = new AnimationEditorState(rig, [smooth]);
  assert.isFalse(state.setAuthoredFPS(20));
  assert.isFalse(state.setAuthoredPlaybackMode('stepped'));
  state.selectAnimation('smooth');
  const working = state.workingAnimation;
  assert.isTrue(state.setAuthoredPlaybackMode('smooth'));
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.setAuthoredFPS(20));
  assert.isTrue(state.setAuthoredPlaybackMode('stepped'));
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps: 10 });
  assert.isUndefined(state.sourceAnimation!.playback);
  assert.isTrue(state.dirty);
  assert.isFalse(state.selectAnimation(null));
  state.undo();
  assert.isTrue(state.selectAnimation(null));
});
