import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  copyKeyframeSelection,
  pasteKeyframeClipboard,
  type KeyframeClipboard,
} from '../src/devtools/animation-editor/keyframeClipboard.js';
import {
  KEYFRAME_TIME_TOLERANCE_MS,
  moveBonePropertyKeyframe,
  setBonePropertyKeyframes,
} from '../src/devtools/animation-editor/keyframes.js';
import type { KeyframeSelection } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { compileClip, sampleProperty } from '../src/engine/AnimationClip.js';
import { ANIMATION_FORMAT_VERSION } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

const key = (time: number, property: KeyframeSelection['property'] = 'x', boneId = 'torso'): KeyframeSelection => ({
  boneId,
  property,
  time,
});
const group = [
  key(0.5),
  key(0.5, 'y'),
  key(0.8, 'rotation', 'upper_arm'),
  key(1.2, 'rotation', 'forearm'),
  key(1.2, 'scaleX'),
];
function session(playback?: AnimationClip['playback']) {
  const rig = new Rig({
    root: 'torso',
    bones: [{ id: 'torso' }, { id: 'upper_arm', parent: 'torso' }, { id: 'forearm', parent: 'upper_arm' }],
  });
  const input: AnimationClip = {
    name: 'idle',
    duration: 2000,
    loop: true,
    interpolation: 'linear',
    events: [{ time: 700, name: 'cue', data: { preserved: [1, 2, 3] } }],
    ...(playback ? { playback } : {}),
    tracks: {
      torso: [
        { time: 500, x: 3.141592653589793, y: -20 },
        { time: 1200, scaleX: -1.25 },
      ],
      upper_arm: [{ time: 800, rotation: Math.PI * 5 }],
      forearm: [{ time: 1200, rotation: -9.876543210123 }],
    },
  };
  const state = new AnimationEditorState(rig, [input, { ...input, name: 'walk', tracks: {} }]);
  assert.isTrue(state.selectAnimation('idle'));
  state.selectKeyframes(group);
  return { state, input, rig };
}

test('copy snapshots every authored value/track and relative time without touching navigation, drafts or history', () => {
  const { state, input } = session();
  const working = state.workingAnimation;
  const source = state.sourceAnimation;
  const before = JSON.stringify(input);
  state.setCurrentTime(0.35);
  state.setTemporaryBoneProperty('x', 999);
  const selection = state.selectedKeys;
  assert.isTrue(state.copySelectedKeyframes());
  assert.deepEqual(state.keyframeClipboard, {
    anchorTimeMs: 500,
    entries: [
      { boneId: 'torso', property: 'x', relativeTimeMs: 0, value: Math.PI },
      { boneId: 'torso', property: 'y', relativeTimeMs: 0, value: -20 },
      { boneId: 'upper_arm', property: 'rotation', relativeTimeMs: 300, value: Math.PI * 5 },
      { boneId: 'forearm', property: 'rotation', relativeTimeMs: 700, value: -9.876543210123 },
      { boneId: 'torso', property: 'scaleX', relativeTimeMs: 700, value: -1.25 },
    ],
  });
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.selectedKeys, selection);
  assert.equal(state.currentTime, 0.35);
  assert.equal(state.boneTransformDraft.x, 999);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(JSON.stringify(input), before);
  assert.isFalse(Object.isFrozen(input));
  assert.isTrue(Object.isFrozen(state.keyframeClipboard));
  assert.isTrue(Object.isFrozen(state.keyframeClipboard!.entries));
  assert.isTrue(state.keyframeClipboard!.entries.every(Object.isFrozen));
  const clipboard = state.keyframeClipboard;
  state.clearKeyframeSelection();
  assert.isFalse(state.copySelectedKeyframes());
  assert.strictEqual(state.keyframeClipboard, clipboard);
});

test('empty clipboard/selection and unloaded sessions are safe no-ops', () => {
  const unloaded = new AnimationEditorState();
  for (const state of [unloaded, session().state]) {
    state.clearKeyframeSelection();
    assert.isFalse(state.pasteKeyframes());
    assert.isFalse(state.copySelectedKeyframes());
    assert.isFalse(state.duplicateSelectedKeyframes());
    assert.equal(state.historyLength, 0);
    assert.isNull(state.keyframeClipboard);
  }
  assert.isNull(copyKeyframeSelection(session().input, [key(123)]));
});

test('paste anchors at the held clock, extends duration, selects all five keys and refreshes one installed snapshot', () => {
  const { state, input, rig } = session();
  const source = state.sourceAnimation;
  state.copySelectedKeyframes();
  state.play();
  state.setTemporaryBoneProperty('x', 500);
  state.setCurrentTime(2);
  const installed: AnimationClip[] = [];
  const unsubscribe = state.subscribe(() => {
    if (state.dirty) {
      installed.push(state.workingAnimation!);
      assert.equal(state.selectedKeys.length, 5, 'observers see pasted selection with the authored snapshot');
    }
  });
  assert.isTrue(state.pasteKeyframes());
  unsubscribe();
  assert.equal(installed.length, 1);
  assert.equal(state.currentTime, 2);
  assert.equal(state.duration, 2.7);
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.hasTemporaryTransform);
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  assert.deepEqual(state.selectedKeys, [
    key(2),
    key(2, 'y'),
    key(2.3, 'rotation', 'upper_arm'),
    key(2.7, 'rotation', 'forearm'),
    key(2.7, 'scaleX'),
  ]);
  assert.deepEqual(state.primaryKey, key(2));
  assert.equal(state.selectedBoneId, 'torso');
  assert.equal(state.selectedTimelineProperty, 'x');
  assert.equal(state.getEvaluatedBonePropertyValue('torso', 'x'), Math.PI);
  assert.equal(state.findBonePropertyKeyframe('upper_arm', 'rotation', 2.3)?.value, Math.PI * 5);
  assert.equal(state.findBonePropertyKeyframe('forearm', 'rotation', 2.7)?.value, -9.876543210123);
  assert.deepEqual(state.workingAnimation!.events, input.events);
  assert.equal(state.workingAnimation!.interpolation, 'linear');
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(source!.duration, 2000);
  assert.equal(input.tracks.torso!.length, 2);
  const compiled = compileClip(state.workingAnimation!, rig);
  const values = compiled.tracks.find((track) => track.bone === 'forearm')!.properties.get('rotation')!;
  assert.equal(sampleProperty(values, 2700, 'rotation'), -9.876543210123);
});

test('one Undo/Redo restores exact source/result snapshots including extension and replacement', () => {
  const { state } = session();
  state.copySelectedKeyframes();
  const before = state.workingAnimation;
  state.setCurrentTime(1.8);
  state.pasteKeyframes();
  const after = state.workingAnimation;
  assert.isTrue(state.undo());
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.currentTime, 1.8);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.deepEqual(state.selectedKeys, []);
  assert.isTrue(state.redo());
  assert.strictEqual(state.workingAnimation, after);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.deepEqual(state.selectedKeys, [], 'authored history does not resurrect transient selection');
});

test('paste uses the exact movement collision policy, including tolerant duplicate removal and sibling isolation', () => {
  const { state, rig } = session();
  const near = 1000 + KEYFRAME_TIME_TOLERANCE_MS / 2;
  const source: AnimationClip = {
    name: 'collision',
    duration: 2000,
    loop: false,
    tracks: {
      torso: [
        { time: 500, x: 15 },
        { time: 1000, x: 99, y: 7 },
        { time: near, x: 101, rotation: 2 },
      ],
    },
  };
  const clipboard = copyKeyframeSelection(source, [key(0.5)])!;
  const before = structuredClone(source);
  const { animation, keys } = pasteKeyframeClipboard(source, rig, clipboard, 1000 - KEYFRAME_TIME_TOLERANCE_MS / 4);
  const moved = moveBonePropertyKeyframe(source, rig, 'torso', 'x', 500, 1000 - KEYFRAME_TIME_TOLERANCE_MS / 4);
  assert.deepEqual(animation.tracks.torso!.slice(1), moved.tracks.torso);
  assert.deepEqual(animation.tracks.torso, [
    { time: 500, x: 15 },
    { time: 1000, x: 15, y: 7 },
    { time: near, rotation: 2 },
  ]);
  assert.deepEqual(keys, [key(1)]);
  assert.deepEqual(source, before);
  assert.isFalse(Object.isFrozen(source.tracks.torso));
  assert.isTrue(state.replaceWorkingAnimation({ ...source, name: 'idle', version: ANIMATION_FORMAT_VERSION }));
  state.markSaved();
  state.selectKeyframe(key(0.5));
  state.copySelectedKeyframes();
  state.setCurrentTime(1);
  const original = state.workingAnimation;
  const length = state.historyLength;
  state.pasteKeyframes();
  const replaced = state.workingAnimation;
  assert.equal(state.historyLength, length + 1);
  state.undo();
  assert.strictEqual(state.workingAnimation, original);
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, replaced);
});

test.each([{ mode: 'smooth' } as const, { mode: 'stepped', fps: 20 } as const])(
  'duplicate uses deterministic offset for %j and retains clipboard/playhead',
  (playback) => {
    const { state } = session(playback);
    state.selectKeyframe(key(1.2, 'scaleX'));
    state.copySelectedKeyframes();
    const clipboard = state.keyframeClipboard;
    state.selectKeyframes(group);
    state.setCurrentTime(0.9);
    const before = state.workingAnimation;
    assert.isTrue(state.duplicateSelectedKeyframes());
    const step = playback.mode === 'stepped' ? 0.05 : 0.01;
    for (const [index, selected] of state.selectedKeys.entries()) {
      assert.approximately(selected.time, group[index]!.time + step, 1e-12);
      assert.equal(selected.boneId, group[index]!.boneId);
      assert.equal(selected.property, group[index]!.property);
    }
    assert.equal(state.currentTime, 0.9);
    assert.strictEqual(state.keyframeClipboard, clipboard);
    assert.equal(state.historyLength, 1);
    const after = state.workingAnimation;
    state.undo();
    assert.strictEqual(state.workingAnimation, before);
    state.redo();
    assert.strictEqual(state.workingAnimation, after);
  },
);

test('duplicate replaces frame-offset collisions and extends end keys without clamping the group', () => {
  const { state } = session({ mode: 'stepped', fps: 10 });
  state.setBonePropertyKeyframe('torso', 'x', 999, 0.6);
  state.markSaved();
  state.selectKeyframes([key(0.5), key(0.6)]);
  const before = state.workingAnimation;
  const length = state.historyLength;
  state.duplicateSelectedKeyframes();
  assert.equal(state.findBonePropertyKeyframe('torso', 'x', 0.6)?.value, Math.PI);
  assert.equal(
    state.findBonePropertyKeyframe('torso', 'x', 0.7)?.value,
    999,
    'copy captures values before replacing collisions',
  );
  assert.equal(state.historyLength, length + 1);
  assert.deepEqual(state.primaryKey, key(0.6));
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  state.selectKeyframes(group);
  state.copySelectedKeyframes();
  state.setCurrentTime(2);
  state.pasteKeyframes();
  state.duplicateSelectedKeyframes();
  assert.approximately(state.duration, 2.8, 1e-12);
  assert.equal(state.selectedKeys.length, 5);
});

test('clipboard survives selection, playback, key edits, history and animation switching; compatible rigs need no existing tracks', () => {
  const { state, rig } = session();
  state.copySelectedKeyframes();
  const clipboard = state.keyframeClipboard;
  state.clearKeyframeSelection();
  state.play();
  state.advancePlayback(0.4);
  state.pause();
  state.setBonePropertyKeyframe('torso', 'x', 900, 0.5);
  state.undo();
  assert.isTrue(state.canRedo);
  state.selectKeyframes(group);
  state.copySelectedKeyframes();
  assert.isTrue(state.canRedo, 'copy must retain redo history');
  state.selectAnimation('walk');
  assert.deepEqual(state.selectedKeys, []);
  state.setCurrentTime(1.8);
  assert.isTrue(state.pasteKeyframes());
  assert.equal(state.workingAnimation!.name, 'walk');
  assert.equal(state.workingAnimation!.tracks.torso![0]!.x, Math.PI);
  assert.deepEqual(state.sourceAnimation!.tracks, {});
  assert.equal(state.historyLength, 1);
  const compatible = new Rig({
    root: 'torso',
    bones: rig.bones.map((bone) => ({ id: bone.id, ...(bone.parent ? { parent: bone.parent } : {}) })),
  });
  assert.doesNotThrow(() => pasteKeyframeClipboard(state.workingAnimation!, compatible, clipboard!, 0));
  assert.deepEqual(state.validationIssues, []);
});

test('invalid destination bone/property/value/time rejects the entire group without source mutation', () => {
  const { state, input, rig } = session();
  state.copySelectedKeyframes();
  const clipboard = state.keyframeClipboard!;
  const incompatible = new Rig({ root: 'torso', bones: [{ id: 'torso' }] });
  const before = structuredClone(input);
  assert.throws(() => pasteKeyframeClipboard(input, incompatible, clipboard, 1000));
  for (const patch of [
    { boneId: 'missing' },
    { property: 'invalid' },
    { value: NaN },
    { relativeTimeMs: Infinity },
    { relativeTimeMs: -1 },
  ]) {
    const invalid = {
      ...clipboard,
      entries: [clipboard.entries[0]!, { ...clipboard.entries[1]!, ...patch }],
    } as KeyframeClipboard;
    assert.throws(() => pasteKeyframeClipboard(input, rig, invalid, 1000));
    assert.deepEqual(input, before);
  }
  for (const anchor of [NaN, Infinity, -1]) assert.throws(() => pasteKeyframeClipboard(input, rig, clipboard, anchor));
  assert.throws(() =>
    setBonePropertyKeyframes(input, rig, [{ boneId: 'torso', property: 'x', timeMs: 2100, value: 5 }]),
  );
  const working = state.workingAnimation;
  const selection = state.selectedKeys;
  const lookup = vi.spyOn(rig, 'getBone').mockImplementation(() => {
    throw new Error('Clipboard bone is missing from destination rig.');
  });
  assert.isFalse(state.pasteKeyframes());
  lookup.mockRestore();
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.selectedKeys, selection);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.match(state.validationIssues[0]!.message, /missing from destination rig/);
});

test('pasting identical values is a selected no-op preserving dirty baseline and redo', () => {
  const { state } = session();
  state.copySelectedKeyframes();
  state.setCurrentTime(1.5);
  state.pasteKeyframes();
  state.undo();
  assert.isTrue(state.canRedo);
  state.setCurrentTime(0.5);
  assert.isTrue(state.pasteKeyframes());
  assert.equal(state.selectedKeys.length, 5);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.isTrue(state.canRedo);
});
