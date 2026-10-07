import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getInterpolationForKeys } from '../src/devtools/animation-editor/interpolation.js';
import { copyKeyframeSelection, pasteKeyframeClipboard } from '../src/devtools/animation-editor/keyframeClipboard.js';
import { findBonePropertyKeyframe } from '../src/devtools/animation-editor/keyframes.js';
import type { KeyframeSelection } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationClip, AnimationPlaybackMode } from '../src/engine/AnimationClip.js';
import {
  ANIMATION_FORMAT_VERSION,
  parseAnimationClip,
  validateAnimationDefinition,
} from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] });
const key = (
  time: number,
  property: KeyframeSelection['property'] = 'rotation',
  boneId = 'root',
): KeyframeSelection => ({
  time,
  property,
  boneId,
});
const outgoing = [key(0), key(0.5), key(0.2, 'x', 'arm')];
function clip(interpolation?: 'linear', playback: AnimationPlaybackMode = { mode: 'smooth' }): AnimationClip {
  return {
    name: 'hardening',
    duration: 1000,
    loop: true,
    playback,
    ...(interpolation === undefined ? {} : { interpolation }),
    tracks: {
      root: [
        { time: 0, rotation: 0, y: 7 },
        { time: 500, rotation: 0.5 },
        { time: 1000, rotation: 1 },
      ],
      arm: [
        { time: 200, x: 20 },
        { time: 800, x: 80 },
      ],
    },
    events: [{ time: 400, name: 'cue', data: { nested: [1, 2] } }],
  };
}
function session(interpolation?: 'linear', playback?: AnimationPlaybackMode) {
  const input = clip(interpolation, playback);
  const state = new AnimationEditorState(rig, [input]);
  assert.isTrue(state.selectAnimation(input.name));
  return { input, state };
}
function checkState(state: AnimationEditorState) {
  const working = state.workingAnimation!;
  const file: unknown = JSON.parse(state.exportJson());
  assert.deepEqual(validateAnimationDefinition(file, rig), []);
  assert.deepEqual({ version: ANIMATION_FORMAT_VERSION, ...parseAnimationClip(file, rig) }, working);
  assert.equal(Object.hasOwn(parseAnimationClip(file, rig), 'interpolation'), Object.hasOwn(working, 'interpolation'));
  assert.deepEqual(state.validationIssues, []);
  for (const selected of state.selectedKeys)
    assert.isDefined(state.findBonePropertyKeyframe(selected.boneId, selected.property, selected.time));
  if (state.primaryKey) assert.include(state.selectedKeys, state.primaryKey);
}

test('selection unavailability has stable precedence regardless of terminal/missing member order', () => {
  const input = clip();
  const terminal = key(1);
  const missing = key(0.3, 'x', 'arm');
  for (const keys of [
    [terminal, missing, ...outgoing],
    [missing, ...outgoing, terminal],
    [...outgoing, terminal, missing],
  ])
    assert.deepEqual(getInterpolationForKeys(input, keys), { kind: 'unavailable', reason: 'missing-key' });
});

test.each([undefined, 'linear'] as const)(
  'paste and duplicate preserve distinct nearby keys and %s clip metadata',
  (interpolation) => {
    const input: AnimationClip = {
      ...clip(interpolation),
      tracks: {
        root: [
          { time: 0, x: 1 },
          { time: 0.0000005, x: 2 },
        ],
      },
    };
    const before = structuredClone(input);
    const keys = [key(0, 'x'), key(0.0000005 / 1000, 'x')];
    const clipboard = copyKeyframeSelection(input, keys)!;
    const pasted = pasteKeyframeClipboard(input, rig, clipboard, 200);
    assert.deepEqual(pasted.animation.tracks.root, [
      ...input.tracks.root!,
      { time: 200, x: 1 },
      { time: 200.0000005, x: 2 },
    ]);
    assert.deepEqual(pasted.keys, [key(0.2, 'x'), key(200.0000005 / 1000, 'x')]);
    assert.deepEqual(input, before);
    assert.isFalse(Object.isFrozen(input.tracks.root));
    const state = new AnimationEditorState(rig, [input]);
    state.selectAnimation(input.name);
    state.selectKeyframes(keys);
    assert.isTrue(state.duplicateSelectedKeyframes());
    assert.equal(state.selectedKeys.length, 2);
    assert.equal(state.findBonePropertyKeyframe('root', 'x', 0.01)?.value, 1);
    assert.equal(state.findBonePropertyKeyframe('root', 'x', 10.0000005 / 1000)?.value, 2);
    assert.equal(state.workingAnimation!.interpolation, interpolation);
    checkState(state);
  },
);

test('paste rejects translated group identities lost to floating point precision atomically', () => {
  const input: AnimationClip = {
    ...clip('linear'),
    duration: 1e20,
    tracks: {
      root: [
        { time: 0, x: 1 },
        { time: 1, x: 2 },
      ],
    },
  };
  const before = structuredClone(input);
  const clipboard = copyKeyframeSelection(input, [key(0, 'x'), key(0.001, 'x')])!;
  assert.throws(() => pasteKeyframeClipboard(input, rig, clipboard, 1e20), /precision/);
  assert.deepEqual(input, before);
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation(input.name);
  state.selectKeyframes([key(0, 'x'), key(0.001, 'x')]);
  state.copySelectedKeyframes();
  state.setCurrentTime(1e17);
  const held = state.workingAnimation;
  const selection = state.selectedKeys;
  assert.isFalse(state.pasteKeyframes());
  assert.strictEqual(state.workingAnimation, held);
  assert.strictEqual(state.selectedKeys, selection);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});

test('copy canonicalizes and deduplicates repeated references before translating a group', () => {
  const input = clip('linear');
  const clipboard = copyKeyframeSelection(input, [key(0), key(0.0000000001), key(0.5), key(0.5)])!;
  assert.equal(clipboard.entries.length, 2);
  const pasted = pasteKeyframeClipboard(input, rig, clipboard, 100);
  assert.deepEqual(pasted.keys, [key(0.1), key(0.6)]);
  assert.equal(pasted.animation.interpolation, 'linear');
});

test('multi-key paste replaces external tolerant collisions while keeping group spacing and sparse siblings', () => {
  const input: AnimationClip = {
    ...clip('linear'),
    tracks: {
      root: [
        { time: 0, x: 1 },
        { time: 0.0000005, x: 2 },
        { time: 200.0000002, x: 99, y: 7 },
        { time: 200.0000007, x: 100, rotation: 0.4 },
      ],
    },
  };
  const before = structuredClone(input);
  const clipboard = copyKeyframeSelection(input, [key(0, 'x'), key(0.0000005 / 1000, 'x')])!;
  const pasted = pasteKeyframeClipboard(input, rig, clipboard, 200);
  assert.deepEqual(pasted.animation.tracks.root, [
    { time: 0, x: 1 },
    { time: 0.0000005, x: 2 },
    { time: 200, x: 1 },
    { time: 200.0000002, y: 7 },
    { time: 200.0000005, x: 2 },
    { time: 200.0000007, rotation: 0.4 },
  ]);
  assert.deepEqual(input, before);
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation(input.name);
  state.selectKeyframes([key(0, 'x'), key(0.0000005 / 1000, 'x')]);
  state.copySelectedKeyframes();
  state.setCurrentTime(0.2);
  const baseline = state.workingAnimation;
  state.pasteKeyframes();
  const result = state.workingAnimation;
  checkState(state);
  state.undo();
  assert.strictEqual(state.workingAnimation, baseline);
  state.redo();
  assert.strictEqual(state.workingAnimation, result);
});

for (const interpolation of [undefined, 'linear'] as const) {
  test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
    `declaration ${interpolation ?? 'implicit'} survives the full $mode workflow and exact history round trips`,
    (playback) => {
      const { input, state } = session(interpolation, playback);
      const original = JSON.stringify(input);
      const source = state.sourceAnimation;
      const snapshots = [state.workingAnimation];
      const capture = () => {
        checkState(state);
        snapshots.push(state.workingAnimation);
      };
      state.selectKeyframes(outgoing);
      assert.isTrue(state.setAuthoredInterpolation(interpolation === undefined ? 'linear' : undefined));
      const authored = state.workingAnimation!.interpolation;
      capture();
      assert.isTrue(state.moveSelectedKeyframe(0.1));
      assert.equal(state.workingAnimation!.interpolation, authored);
      assert.deepEqual(state.selectedKeys, [key(0.1), key(0.6), key(0.3, 'x', 'arm')]);
      capture();
      assert.isTrue(state.copySelectedKeyframes());
      const clipboard = state.keyframeClipboard;
      state.setCurrentTime(0.6); // Replace the destination rotation and extend the group.
      assert.isTrue(state.pasteKeyframes());
      assert.equal(state.findBonePropertyKeyframe('root', 'rotation', 0.6)?.value, 0);
      assert.equal(state.duration, 1.1);
      capture();
      assert.isTrue(state.duplicateSelectedKeyframes());
      assert.strictEqual(state.keyframeClipboard, clipboard);
      assert.equal(state.workingAnimation!.interpolation, authored);
      capture();
      assert.isTrue(state.deleteSelectedKeyframes());
      assert.deepEqual(state.selectedKeys, []);
      assert.deepEqual(state.selectedInterpolation, { kind: 'unavailable', reason: 'empty-selection' });
      capture();
      assert.equal(state.historyLength, 5);
      for (let index = snapshots.length - 2; index >= 0; index--) {
        assert.isTrue(state.undo());
        assert.strictEqual(state.workingAnimation, snapshots[index]);
        assert.deepEqual(state.selectedKeys, [], 'history must not resurrect deleted transient selection');
        checkState(state);
      }
      assert.isFalse(state.dirty);
      assert.isFalse(state.undo());
      for (const snapshot of snapshots.slice(1)) {
        assert.isTrue(state.redo());
        assert.strictEqual(state.workingAnimation, snapshot);
        checkState(state);
      }
      assert.isFalse(state.redo());
      assert.strictEqual(state.sourceAnimation, source);
      assert.equal(JSON.stringify(input), original);
      assert.isFalse(Object.isFrozen(input));
    },
  );
}

test.each([undefined, 'linear'] as const)(
  'cross-clip paste retains destination declaration %s and sampling settings',
  (interpolation) => {
    const input = clip(interpolation === undefined ? 'linear' : undefined);
    const destination = { ...clip(interpolation, { mode: 'stepped', fps: 17 }), name: 'destination', tracks: {} };
    const state = new AnimationEditorState(rig, [input, destination]);
    state.selectAnimation(input.name);
    state.selectKeyframes(outgoing);
    state.copySelectedKeyframes();
    state.selectAnimation(destination.name);
    const baseline = state.workingAnimation;
    assert.isTrue(state.pasteKeyframes());
    assert.equal(state.workingAnimation!.interpolation, interpolation);
    assert.equal(Object.hasOwn(state.workingAnimation!, 'interpolation'), interpolation !== undefined);
    assert.strictEqual(state.workingAnimation!.playback, baseline!.playback);
    checkState(state);
    state.undo();
    assert.strictEqual(state.workingAnimation, baseline);
    assert.isFalse(state.dirty);
  },
);

test.each([{}, { root: [{ time: 400, x: 9 }] }])(
  'empty/single-key tracks query, sample, copy and serialize safely: %j',
  (tracks) => {
    const input: AnimationClip = { ...clip('linear'), tracks };
    const state = new AnimationEditorState(rig, [input]);
    state.selectAnimation(input.name);
    assert.isUndefined(state.getSegmentInterpolation(key(0.4, 'x')));
    for (const time of [0, 0.4, 0.8, 1])
      assert.equal(state.getEvaluatedBonePropertyValue('root', 'x', time), tracks.root ? 9 : 0);
    state.selectKeyframes([key(0.4, 'x')]);
    assert.deepEqual(state.selectedInterpolation, {
      kind: 'unavailable',
      reason: tracks.root ? 'no-outgoing-segment' : 'empty-selection',
    });
    if (tracks.root) {
      assert.isTrue(state.copySelectedKeyframes());
      state.setCurrentTime(1);
      assert.isTrue(state.pasteKeyframes());
      assert.deepEqual(state.selectedInterpolation, { kind: 'unavailable', reason: 'no-outgoing-segment' });
      state.selectKeyframe(key(0.4, 'x'));
      assert.equal(state.selectedInterpolation.kind, 'uniform', 'the original singleton gains an outgoing segment');
    } else {
      assert.isFalse(state.copySelectedKeyframes());
      assert.isFalse(state.duplicateSelectedKeyframes());
    }
    checkState(state);
  },
);

test.each(['smooth', 'stepped', 'bezier', '', null, 42])(
  'invalid interpolation %j is rejected after edited-data serialization',
  (mode) => {
    const { state } = session('linear');
    state.selectKeyframes(outgoing);
    state.moveSelectedKeyframe(0.1);
    const held = state.workingAnimation;
    const selection = state.selectedKeys;
    const invalid = { ...held, interpolation: mode };
    assert.isNotEmpty(validateAnimationDefinition(invalid, rig));
    assert.throws(() => parseAnimationClip(JSON.parse(JSON.stringify(invalid)), rig));
    assert.isFalse(state.replaceWorkingAnimation(invalid));
    assert.strictEqual(state.workingAnimation, held);
    assert.strictEqual(state.selectedKeys, selection);
    assert.equal(state.historyLength, 1);
  },
);

test('group collision replacement restores destination values, siblings and clip metadata exactly', () => {
  const { state } = session('linear');
  const baseline = state.workingAnimation;
  state.selectKeyframes([key(0), key(0.2, 'x', 'arm')]);
  state.moveSelectedKeyframe(0.5);
  assert.deepEqual(state.workingAnimation!.tracks.root, [
    { time: 0, y: 7 },
    { time: 500, rotation: 0 },
    { time: 1000, rotation: 1 },
  ]);
  assert.equal(findBonePropertyKeyframe(state.workingAnimation!, 'arm', 'x', 700)?.value, 20);
  assert.equal(state.workingAnimation!.interpolation, 'linear');
  const moved = state.workingAnimation;
  state.undo();
  assert.strictEqual(state.workingAnimation, baseline);
  assert.deepEqual(
    state.selectedKeys,
    [key(0.5)],
    'the replaced destination survives reconciliation; the absent arm key is discarded',
  );
  state.redo();
  assert.strictEqual(state.workingAnimation, moved);
  checkState(state);
});
