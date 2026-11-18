import { assert, test, vi } from 'vitest';
import {
  AnimationEditorState,
  AUTHORED_FPS_MAX,
  AUTHORED_FPS_MIN,
  PREVIEW_PLAYBACK_SPEEDS,
} from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getCompiledPreviewClip } from '../src/devtools/animation-editor/previewClip.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import * as externalData from '../src/engine/externalData.js';
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
    assert.equal(state.playback.playbackSpeed, 1);
    state.playback.setPlaybackSpeed(speed);
    state.playback.play();
    for (let frame = 0; frame < renderFPS / 2; frame += 1) state.playback.advancePlayback(1 / renderFPS);
    assert.approximately(state.currentTime, 0.5 * speed, 1e-12);
  }
});

test.each([false, true])('speed changes preserve caller/source/working data, history and dirty=%s', (dirty) => {
  const state = session();
  const before = JSON.stringify(clip);
  if (dirty) state.playback.setAuthoredFPS(20);
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  const snapshot = JSON.stringify(working);
  const history = state.historyLength;
  for (const speed of PREVIEW_PLAYBACK_SPEEDS) {
    state.playback.setPlaybackSpeed(speed);
    state.playback.play();
    state.playback.advancePlayback(0.01);
    state.playback.pause();
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
    state.playback.setPlaybackSpeed(0.5);
    const listener = vi.fn();
    state.subscribe(listener);
    assert.isFalse(state.playback.setPlaybackSpeed(speed));
    assert.equal(state.playback.playbackSpeed, 0.5);
    assert.isTrue(state.playback.setPlaybackSpeed(0.5));
    assert.equal(listener.mock.calls.length, 0);
    assert.isFalse(state.dirty);
  },
);

test('speed changes during playback and scrubbing take effect without resetting time or intent', () => {
  const state = session();
  state.playback.play();
  state.playback.advancePlayback(0.2);
  state.playback.setPlaybackSpeed(0.5);
  assert.equal(state.currentTime, 0.2);
  assert.isTrue(state.playback.isPlaying);
  state.playback.advancePlayback(0.4);
  assert.equal(state.currentTime, 0.4);
  state.playback.beginScrub();
  state.playback.setPlaybackSpeed(2);
  state.setCurrentTime(0.74212345);
  state.playback.advancePlayback(1);
  assert.equal(state.currentTime, 0.74212345);
  state.playback.endScrub();
  state.playback.advancePlayback(0.1);
  assert.approximately(state.currentTime, 0.94212345, 1e-12);
  state.selectAnimation('other');
  assert.equal(state.playback.playbackSpeed, 2);
  assert.equal(state.currentTime, 0);
  assert.isFalse(state.playback.isPlaying);
});

test.each(PREVIEW_PLAYBACK_SPEEDS)('%s× preserves loop overshoot and stops at a non-loop endpoint', (speed) => {
  const state = session();
  state.playback.setPlaybackSpeed(speed);
  state.playback.setPreviewLoop(true);
  state.setCurrentTime(1.75);
  state.playback.play();
  state.playback.advancePlayback(4.5 / speed);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.playback.isPlaying);
  state.playback.setPreviewLoop(false);
  state.playback.advancePlayback(4 / speed);
  assert.equal(state.currentTime, 2);
  assert.isFalse(state.playback.isPlaying);
});

test.each([1.5, 2])('overflowing scaled delta is finite for looping and non-looping at %s×', (speed) => {
  const state = new AnimationEditorState(rig, [{ ...clip, duration: speed * 1000, tracks: {}, events: [] }]);
  state.selectAnimation('move');
  state.playback.setPlaybackSpeed(speed);
  state.setCurrentTime(0.25);
  state.playback.setPreviewLoop(true);
  state.playback.play();
  state.playback.advancePlayback(Number.MAX_VALUE);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.playback.isPlaying);
  state.playback.setPreviewLoop(false);
  state.playback.advancePlayback(Number.MAX_VALUE);
  assert.equal(state.currentTime, speed);
  assert.isFalse(state.playback.isPlaying);
});

test.each([AUTHORED_FPS_MIN, 12.5, AUTHORED_FPS_MAX])('FPS %s edits only the working copy without retiming', (fps) => {
  const state = session();
  const source = state.sourceAnimation;
  const before = JSON.stringify(clip);
  state.setCurrentTime(0.74212345);
  assert.isTrue(state.playback.setAuthoredFPS(fps));
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
  state.playback.setPlaybackSpeed(2);
  state.undo();
  assert.isFalse(state.dirty);
  assert.deepEqual(state.workingAnimation!.playback, source!.playback);
  assert.equal(state.playback.playbackSpeed, 2);
  state.redo();
  assert.isTrue(state.dirty);
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps });
});

test.each([NaN, Infinity, -Infinity, -10, 0, 0.5, 241])('invalid FPS %s preserves data, time and history', (fps) => {
  const state = session();
  const working = state.workingAnimation;
  state.playback.play();
  state.playback.advancePlayback(0.25);
  assert.isFalse(state.playback.setAuthoredFPS(fps));
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.playback.isPlaying);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(state.validationIssues[0]!.path, 'playback.fps');
  assert.isTrue(state.playback.setAuthoredFPS(10));
  assert.lengthOf(state.validationIssues, 0);
  assert.equal(state.historyLength, 0);
});

test('mode edits use the schema union, preserve source and undo/redo the authored settings', () => {
  const state = session();
  const before = JSON.stringify(clip);
  state.setCurrentTime(0.15);
  state.playback.play();
  assert.isTrue(state.playback.setAuthoredPlaybackMode('smooth'));
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'smooth' });
  assert.isFalse(state.playback.setAuthoredFPS(20));
  assert.isTrue(state.dirty);
  assert.equal(state.currentTime, 0.15);
  assert.isTrue(state.playback.isPlaying);
  assert.equal(JSON.stringify(clip), before);
  assert.isTrue(state.playback.setAuthoredPlaybackMode('stepped'));
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
  assert.isFalse(state.playback.setAuthoredFPS(20));
  assert.isFalse(state.playback.setAuthoredPlaybackMode('stepped'));
  state.selectAnimation('smooth');
  const working = state.workingAnimation;
  assert.isTrue(state.playback.setAuthoredPlaybackMode('smooth'));
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.playback.setAuthoredFPS(20));
  assert.isTrue(state.playback.setAuthoredPlaybackMode('stepped'));
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps: 10 });
  assert.isUndefined(state.sourceAnimation!.playback);
  assert.isTrue(state.dirty);
  assert.isFalse(state.selectAnimation(null));
  state.undo();
  assert.isTrue(state.selectAnimation(null));
});

test('FPS and mode edits validate metadata once and reuse unchanged tracks, events and compiled properties', () => {
  const state = session();
  const original = state.workingAnimation!;
  const compiled = getCompiledPreviewClip(original, rig);
  const parse = vi.spyOn(externalData, 'parseAnimationClip');
  try {
    for (const edit of [
      () => state.playback.setAuthoredFPS(25),
      () => state.playback.setAuthoredPlaybackMode('smooth'),
      () => state.playback.setAuthoredPlaybackMode('stepped'),
    ]) {
      parse.mockClear();
      assert.isTrue(edit());
      const working = state.workingAnimation!;
      assert.strictEqual(working.tracks, original.tracks);
      assert.strictEqual(working.events, original.events);
      const preview = getCompiledPreviewClip(working, rig);
      assert.strictEqual(preview.tracks[0]!.properties, compiled.tracks[0]!.properties);
      assert.equal(parse.mock.calls.length, 1);
      assert.deepEqual(parse.mock.calls[0]![0], { ...working, tracks: {}, events: [] });
      assert.strictEqual(parse.mock.calls[0]![1], rig);
    }
    parse.mockClear();
    state.undo();
    getCompiledPreviewClip(state.workingAnimation!, rig);
    state.redo();
    getCompiledPreviewClip(state.workingAnimation!, rig);
    assert.equal(parse.mock.calls.length, 0);
  } finally {
    parse.mockRestore();
  }
});
