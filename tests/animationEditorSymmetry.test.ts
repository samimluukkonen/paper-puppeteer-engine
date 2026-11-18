import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { createBoneSymmetryMapping, inferBoneSymmetryPairs } from '../src/devtools/shared/boneSymmetry.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root' }, { id: 'rightArm', parent: 'root' }],
});
const animation: AnimationClip = {
  name: 'wave',
  duration: 1000,
  loop: false,
  tracks: {
    leftArm: [
      { time: 0, rotation: -0.2 },
      { time: 1000, rotation: 0.5 },
    ],
  },
  events: [{ time: 500, name: 'beat' }],
};
function acceptedMapping(currentRig = rig) {
  const result = createBoneSymmetryMapping(currentRig, {
    automaticCandidates: inferBoneSymmetryPairs(currentRig).pairs,
  });
  assert.isTrue(result.success);
  return result.mapping;
}

test('mapping preferences preserve authored data, preview, clock, selection, playback, history and event silence', () => {
  const inputJson = JSON.stringify(animation);
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation('wave');
  state.selectBone('leftArm');
  state.setCurrentTime(0.25);
  state.setTemporaryBoneProperty('x', 12);
  state.play();
  const source = state.sourceAnimation;
  const working = state.workingAnimation;
  const json = state.exportJson();
  const draft = state.boneTransformDraft;
  const pose = state.getEvaluatedBoneTransform('leftArm');
  const events = vi.fn();
  const subscriber = vi.fn();
  state.onAnimationEvent(events);
  state.subscribe(subscriber);
  assert.isNull(state.getMirroredBoneId('leftArm'));
  assert.isTrue(state.setSymmetryMapping(acceptedMapping()));
  assert.equal(state.getMirroredBoneId('leftArm'), 'rightArm');
  assert.equal(state.getMirroredBoneId('rightArm'), 'leftArm');
  assert.isNull(state.getMirroredBoneId('root'));
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.exportJson(), json);
  assert.equal(JSON.stringify(animation), inputJson);
  assert.deepEqual(state.getEvaluatedBoneTransform('leftArm'), pose);
  assert.deepEqual(state.boneTransformDraft, draft);
  assert.equal(state.currentTime, 0.25);
  assert.equal(state.selectedBoneId, 'leftArm');
  assert.isTrue(state.isPlaying);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(events.mock.calls.length, 0);
  assert.equal(subscriber.mock.calls.length, 1);
  assert.deepEqual(state.validationIssues, []);
});

test('mapping changes preserve existing animation undo and redo', () => {
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation('wave');
  state.keyframes.setBonePropertyKeyframe('leftArm', 'rotation', 1, 0);
  state.undo();
  const working = state.workingAnimation;
  const history = state.historyLength;
  assert.isTrue(state.canRedo);
  assert.isTrue(state.setSymmetryMapping(acceptedMapping()));
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, history);
  assert.isTrue(state.canRedo);
  assert.isTrue(state.redo());
  assert.equal(state.getMirroredBoneId('leftArm'), 'rightArm');
  assert.equal(state.getEvaluatedBonePropertyValue('leftArm', 'rotation', 0), 1);
});

test('preferences survive animation switch, import, and reload within the same rig session', () => {
  const state = new AnimationEditorState(rig, [animation, { ...animation, name: 'other' }]);
  state.selectAnimation('wave');
  state.setSymmetryMapping(acceptedMapping());
  const mapping = state.symmetryMapping;
  assert.isTrue(state.selectAnimation('other'));
  assert.strictEqual(state.symmetryMapping, mapping);
  assert.isTrue(state.importJson(JSON.stringify({ ...animation, version: 1, name: 'imported' })));
  assert.strictEqual(state.symmetryMapping, mapping);
  assert.isTrue(state.reloadCurrentExport());
  assert.strictEqual(state.symmetryMapping, mapping);
  assert.deepEqual(state.symmetryValidationIssues, []);
});

test('a different or reloaded rig rejects a foreign mapping and preserves session data', () => {
  const other = new Rig({ root: 'root', bones: rig.bones });
  const state = new AnimationEditorState(other, [animation]);
  state.selectAnimation('wave');
  const mapping = state.symmetryMapping;
  const working = state.workingAnimation;
  assert.isFalse(state.setSymmetryMapping(acceptedMapping()));
  assert.strictEqual(state.symmetryMapping, mapping);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.symmetryValidationIssues[0]!.code, 'rig-mismatch');
  assert.deepEqual(state.validationIssues, []);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.isTrue(state.setSymmetryMapping(acceptedMapping(other)));
  assert.deepEqual(state.symmetryValidationIssues, []);
});

test('an editor without a rig stays safely unpaired and rejects assigned mappings', () => {
  const state = new AnimationEditorState();
  assert.isNull(state.symmetryMapping);
  assert.isNull(state.getMirroredBoneId('leftArm'));
  assert.isFalse(state.setSymmetryMapping(acceptedMapping()));
  assert.isNull(state.symmetryMapping);
  assert.equal(state.symmetryValidationIssues[0]!.code, 'rig-mismatch');
});

test('failed mapping replacement holds the previous mapping and separate animation diagnostics', () => {
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation('wave');
  state.setSymmetryMapping(acceptedMapping());
  const mapping = state.symmetryMapping!;
  const working = state.workingAnimation;
  assert.isFalse(
    state.setSymmetryMapping({
      ...mapping,
      pairs: [{ leftBoneId: 'leftArm', rightBoneId: 'missing' }],
    }),
  );
  assert.strictEqual(state.symmetryMapping, mapping);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.symmetryValidationIssues[0]!.code, 'missing-bone');
  assert.isFalse(state.setSymmetryMapping({ ...mapping, getMirroredBoneId: () => null }));
  assert.equal(state.symmetryValidationIssues[0]!.code, 'invalid-reciprocal');
  assert.strictEqual(state.symmetryMapping, mapping);
  assert.deepEqual(state.validationIssues, []);
  assert.isFalse(state.dirty);
});

test('hierarchy warnings remain available and an empty mapping safely clears pairs', () => {
  const nested = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root' }, { id: 'rightArm', parent: 'leftArm' }],
  });
  const result = createBoneSymmetryMapping(nested, { automaticCandidates: inferBoneSymmetryPairs(nested).pairs });
  assert.isTrue(result.success);
  const state = new AnimationEditorState(nested);
  assert.isTrue(state.setSymmetryMapping(result.mapping));
  assert.deepEqual(
    state.symmetryValidationIssues.map((entry) => entry.code),
    ['ancestor-pair', 'parent-mismatch'],
  );
  const empty = createBoneSymmetryMapping(nested);
  assert.isTrue(empty.success);
  assert.isTrue(state.setSymmetryMapping(empty.mapping));
  assert.isNull(state.getMirroredBoneId('leftArm'));
  assert.deepEqual(state.symmetryValidationIssues, []);
});
