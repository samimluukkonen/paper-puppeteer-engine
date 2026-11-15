import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { type AnimationClip, compileClip } from '../src/engine/AnimationClip.js';
import { dispatchAnimationEvents } from '../src/engine/animationNotifications.js';
import {
  AnimationPlayer,
  type AnimationPlayerOptions,
  type FiredAnimationEvent,
} from '../src/engine/AnimationPlayer.js';
import { MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK } from '../src/engine/animationTimeline.js';
import { Joint } from '../src/engine/Joint.js';
import { copyJsonData, jsonDataCopyWork } from '../src/engine/jsonData.js';
import { freezeData } from '../src/engine/readonlyData.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => vi.restoreAllMocks());
const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
function fixture(clip: AnimationClip, options?: AnimationPlayerOptions) {
  return new AnimationPlayer(rig, new Map([['root', new Joint('root')]]), [compileClip(clip, rig)], options);
}
function payloadClip(time = 0.5, data: unknown = Array.from({ length: 10_000 }, (_, index) => index)): AnimationClip {
  return { name: 'payload', duration: 1, loop: true, tracks: {}, events: [{ time, name: 'marker', data }] };
}

test('small imported clips cannot amplify JSON payload copies across a large loop catch-up', () => {
  const clip = payloadClip();
  assert.isBelow(JSON.stringify(clip).length, 50_000);
  const player = fixture(clip);
  const listener = vi.fn();
  player.onAnimationEvent(listener);
  player.play(clip.name);
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const before = player.getPlaybackStatus();
  try {
    assert.throws(() => player.update(1000), /payload copy budget/);
    assert.deepEqual(player.getPlaybackStatus(), before);
    assert.equal(listener.mock.calls.length, 0);
    assert.equal(clone.mock.calls.length, 0);
    player.update(1);
    assert.equal(listener.mock.calls.length, 1);
  } finally {
    player.dispose();
  }
});

test.each(['start', 'queue'] as const)(
  'oversized payload %s rejection retains the selected playback and queue',
  (operation) => {
    const prepare = vi.fn();
    const player = fixture(payloadClip(0, 'x'.repeat(MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK)), {
      poseHooks: { prepare },
    });
    player.addAnimation({ name: 'existing', duration: 100, loop: false, tracks: {} });
    player.play('existing');
    const before = player.getPlaybackStatus();
    prepare.mockClear();
    try {
      assert.throws(() => {
        if (operation === 'start') player.play('payload');
        else {
          player.addAnimation({
            ...payloadClip(0, 'x'.repeat(MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK)),
            name: 'queued',
            loop: false,
          });
          player.queue('queued');
        }
      }, /payload copy budget/);
      assert.deepEqual(player.getPlaybackStatus(), before);
      assert.isEmpty(player.getQueue());
      assert.equal(prepare.mock.calls.length, 0);
    } finally {
      player.dispose();
    }
  },
);

test('payload work combines all layers and listener copies before any clock or fade advances', () => {
  const player = fixture(payloadClip(0.5, 'x'.repeat(300_000)));
  player.play('payload');
  player.play('payload', { layer: 'upper', fadeDuration: 100 });
  const first = vi.fn();
  const second = vi.fn();
  player.onAnimationEvent(first);
  const releaseSecond = player.onAnimationEvent(second);
  const before = [player.getPlaybackStatus(), player.getPlaybackStatus('upper')];
  try {
    assert.throws(() => player.update(0.5), /payload copy budget/);
    assert.deepEqual([player.getPlaybackStatus(), player.getPlaybackStatus('upper')], before);
    assert.equal(first.mock.calls.length, 0);
    assert.equal(second.mock.calls.length, 0);
    releaseSecond();
    player.update(0.5);
    assert.equal(first.mock.calls.length, 2);
  } finally {
    player.dispose();
  }
});

test('restart budgets time-zero payloads across layers before resetting playback', () => {
  const prepare = vi.fn();
  const player = fixture(payloadClip(0, 'x'.repeat(600_000)), { poseHooks: { prepare } });
  player.play('payload');
  player.play('payload', { layer: 'upper' });
  player.update(0.25);
  const before = [player.getPlaybackStatus(), player.getPlaybackStatus('upper')];
  prepare.mockClear();
  try {
    assert.throws(() => player.restart(), /restart.*payload copy budget/);
    assert.deepEqual([player.getPlaybackStatus(), player.getPlaybackStatus('upper')], before);
    assert.equal(prepare.mock.calls.length, 0);
  } finally {
    player.dispose();
  }
});

test('editor payload rejection preserves its clock, authored edits, history and event delivery', () => {
  const state = new AnimationEditorState(rig, [payloadClip()]);
  state.selectAnimation('payload');
  state.setPreviewLoop(true);
  const listener = vi.fn();
  state.onAnimationEvent(listener);
  state.selectBone('root');
  state.setBonePropertyKeyframe('root', 'x', 123);
  state.play();
  const working = state.workingAnimation;
  const history = state.historyLength;
  state.advancePlayback(1);
  assert.match(state.validationIssues[0]!.message, /payload copy budget/);
  assert.equal(state.currentTime, 0);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, history);
  assert.isTrue(state.dirty);
  assert.equal(listener.mock.calls.length, 0);
  state.advancePlayback(0.001);
  assert.equal(listener.mock.calls.length, 1);
});

test('the exact payload work budget is accepted', () => {
  const player = fixture(payloadClip(0, 'x'.repeat(MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK - 1)));
  const listener = vi.fn();
  player.onAnimationEvent(listener);
  try {
    player.play('payload');
    assert.equal(listener.mock.calls.length, 1);
  } finally {
    player.dispose();
  }
});

test('editor time-zero payload rejection leaves playback stopped and temporary edits intact', () => {
  const state = new AnimationEditorState(rig, [payloadClip(0, 'x'.repeat(MAXIMUM_ANIMATION_EVENT_PAYLOAD_WORK))]);
  state.selectAnimation('payload');
  state.selectBone('root');
  state.setTemporaryBoneProperty('x', 123);
  state.play();
  assert.match(state.validationIssues[0]!.message, /start.*payload copy budget/);
  assert.isFalse(state.isPlaying);
  assert.equal(state.currentTime, 0);
  assert.equal(state.boneTransformDraft.x, 123);
});

test('listener growth during delivery cannot bypass the remaining payload copy budget', () => {
  const event: FiredAnimationEvent = {
    time: 1,
    name: 'event',
    clip: 'clip',
    layer: 'base',
    data: freezeData({ text: 'x'.repeat(300_000) }),
  };
  const late = vi.fn();
  const first = vi.fn(() => listeners.add(late));
  const listeners = new Set<(event: FiredAnimationEvent) => void>([first]);
  const errors = dispatchAnimationEvents([event, event, event], listeners);
  assert.equal(first.mock.calls.length, 2);
  assert.equal(late.mock.calls.length, 1);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /payload copy budget/);
});

test('immutable JSON copies remain detached while mutable runtime payloads are reclassified', () => {
  const source = freezeData({ nested: [1] });
  const first = copyJsonData(source);
  first.nested.push(2);
  assert.deepEqual(copyJsonData(source), { nested: [1] });
  const mutable: { nested: { value: unknown } } = Object.freeze({ nested: { value: 1 } });
  assert.notStrictEqual(copyJsonData(mutable), mutable);
  mutable.nested.value = () => {};
  assert.strictEqual(copyJsonData(mutable), mutable);
  assert.equal(jsonDataCopyWork(mutable), 0);
  mutable.nested.value = 'x'.repeat(100);
  assert.isAbove(jsonDataCopyWork(mutable), 100);
  assert.notStrictEqual(copyJsonData(mutable), mutable);
});
