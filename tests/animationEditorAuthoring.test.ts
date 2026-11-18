import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

function session() {
  const rig = new Rig({
    root: 'torso',
    bones: [
      { id: 'torso', x: 100, rotation: 0.7, scaleX: 2 },
      { id: 'upper', parent: 'torso', x: 5, y: 10, rotation: 0.2 },
      { id: 'forearm', parent: 'upper', x: 3, y: 40, scaleY: 1.2 },
      { id: 'hand', parent: 'forearm', y: 30 },
    ],
  });
  const clip: AnimationClip = {
    name: 'move',
    duration: 2000,
    loop: false,
    tracks: {
      torso: [
        { time: 0, x: 100 },
        { time: 2000, x: 200 },
      ],
      forearm: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 1 },
      ],
    },
  };
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other' }]);
  state.selectAnimation('move');
  state.setCurrentTime(0.5);
  return { state, rig, clip };
}

test('bone selection reads evaluator values without mutation, dirty state, or history', () => {
  const { state, rig, clip } = session();
  const before = JSON.stringify(clip);
  const working = state.workingAnimation;
  for (const bone of ['torso', 'upper', 'forearm', 'hand']) {
    assert.isTrue(state.selectBone(bone));
    assert.deepEqual(state.selectedBoneTransform, state.getEvaluatedBoneTransform(bone));
    assert.strictEqual(state.workingAnimation, working);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
  }
  state.selectBone('forearm');
  assert.deepEqual(state.selectedBoneTransform, { x: 3, y: 40, rotation: 0.5, scaleX: 1, scaleY: 1.2 });
  assert.isFalse(state.hasKeyframeAtTime('forearm', 'rotation'));
  assert.isFalse(state.selectBone('missing'));
  assert.equal(state.selectedBoneId, 'forearm');
  assert.equal(JSON.stringify(clip), before);
  assert.equal(rig.getBone('torso').rotation, 0.7);
});

test('temporary edit pauses at the held time and explicit property commit creates/updates sparse local keys', () => {
  const { state, rig, clip } = session();
  const source = state.sourceAnimation;
  const working = state.workingAnimation!;
  const before = JSON.stringify(clip);
  state.selectBone('forearm');
  state.playback.play();
  state.beginTransformEdit();
  assert.isFalse(state.playback.isPlaying);
  assert.equal(state.currentTime, 0.5);
  state.setTemporaryBoneProperty('rotation', 0.6);
  state.setTemporaryBoneProperty('x', 7);
  assert.isTrue(state.hasTemporaryTransform);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.selectedBoneTransform!.rotation, 0.6);
  assert.isFalse(state.hasKeyframeAtTime('forearm', 'rotation'));
  assert.isTrue(state.commitBoneProperty('rotation'));
  assert.deepEqual(state.findBonePropertyKeyframe('forearm', 'rotation'), { time: 500, value: 0.6 });
  assert.deepEqual(state.getKeyedPropertiesAtTime('forearm'), ['rotation']);
  assert.deepEqual(state.boneTransformDraft, { x: 7 });
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  state.setTemporaryBoneProperty('rotation', 0.8);
  state.commitBoneProperty('rotation');
  assert.equal(state.workingAnimation!.tracks.forearm!.length, 3);
  assert.equal(state.findBonePropertyKeyframe('forearm', 'rotation')!.value, 0.8);
  assert.strictEqual(state.workingAnimation!.tracks.torso, working.tracks.torso);
  assert.equal(rig.getBone('forearm').x, 3);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(clip), before);
});

test('delete removes only the current property and restores interpolation, with undo/redo', () => {
  const { state } = session();
  state.selectBone('forearm');
  state.setTemporaryBoneProperty('rotation', 0.8);
  state.commitBoneProperty('rotation');
  state.setTemporaryBoneProperty('x', 7);
  state.commitBoneProperty('x');
  state.setTemporaryBoneProperty('rotation', 2);
  state.deleteBonePropertyKey('rotation');
  assert.equal(state.selectedBoneTransform!.rotation, 0.5);
  assert.deepEqual(state.getKeyedPropertiesAtTime('forearm'), ['x']);
  assert.equal(state.findBonePropertyKeyframe('forearm', 'x')!.value, 7);
  assert.deepEqual(state.boneTransformDraft, {});
  assert.isTrue(state.dirty);
  state.undo();
  assert.approximately(state.selectedBoneTransform!.rotation, 0.8, 1e-12);
  state.redo();
  assert.equal(state.selectedBoneTransform!.rotation, 0.5);
  state.deleteBonePropertyKey('x');
  assert.equal(state.selectedBoneTransform!.x, 3);
  assert.isFalse(state.dirty);
});

test('Set Key without a draft keys the evaluated local property, leaving all others absent', () => {
  const { state } = session();
  state.selectBone('forearm');
  state.commitBoneProperty('y');
  assert.deepEqual(state.findBonePropertyKeyframe('forearm', 'y'), { time: 500, value: 40 });
  assert.deepEqual(state.getKeyedPropertiesAtTime('forearm'), ['y']);
  state.markSaved();
  state.commitBoneProperty('y');
  assert.isFalse(state.dirty);
});

test.each(['time', 'bone', 'animation', 'cancel', 'play', 'mode', 'undo', 'redo'])(
  '%s navigation/history discards drafts without carrying them to the next pose',
  (action) => {
    const { state } = session();
    state.selectBone('forearm');
    if (action === 'undo' || action === 'redo') {
      state.commitBoneProperty('rotation');
      if (action === 'redo') state.undo();
    }
    const dirty = state.dirty;
    state.setTemporaryBoneProperty('rotation', 2);
    switch (action) {
      case 'time':
        state.setCurrentTime(1.2);
        break;
      case 'bone':
        state.selectBone('hand');
        break;
      case 'animation':
        state.selectAnimation('other');
        break;
      case 'cancel':
        state.cancelTransformEdit();
        break;
      case 'play':
        state.playback.play();
        break;
      case 'mode':
        state.playback.setAuthoredPlaybackMode('stepped');
        break;
      case 'undo':
        state.undo();
        break;
      case 'redo':
        state.redo();
        break;
    }
    assert.isFalse(state.hasTemporaryTransform);
    assert.deepEqual(state.selectedBoneTransform, state.getEvaluatedBoneTransform(state.selectedBoneId!));
    if (!['mode', 'undo', 'redo'].includes(action)) assert.equal(state.dirty, dirty);
  },
);

test('invalid or unavailable temporary edits never write nonfinite data', () => {
  const { state } = session();
  assert.isFalse(state.setTemporaryBoneProperty('x', 10));
  assert.isFalse(state.commitBoneProperty('x'));
  state.selectBone('forearm');
  assert.isFalse(state.setTemporaryBoneProperty('rotation', NaN));
  assert.isFalse(state.setTemporaryBoneProperty('rotation', Infinity));
  assert.deepEqual(state.boneTransformDraft, {});
  state.selectAnimation(null);
  assert.isFalse(state.setTemporaryBoneProperty('x', 10));
  assert.isFalse(state.commitBoneProperty('x'));
  assert.isFalse(state.dirty);
});
