import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import * as keyframeEdits from '../src/devtools/animation-editor/keyframeEdits.js';
import { MirrorToolsController } from '../src/devtools/animation-editor/MirrorToolsController.js';
import { MirrorToolsPanel } from '../src/devtools/animation-editor/MirrorToolsPanel.js';
import * as boneSymmetry from '../src/devtools/shared/boneSymmetry.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import type { AnimationPose } from '../src/engine/AnimationPose.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root', x: -10 }, { id: 'rightArm', parent: 'root', x: 10 }],
});
const animation: AnimationClip = {
  name: 'wave',
  duration: 1000,
  loop: false,
  interpolation: 'linear',
  tracks: {
    leftArm: [
      { time: 0, rotation: -0.2 },
      { time: 1000, rotation: 0.5 },
    ],
    rightArm: [
      { time: 0, rotation: 0.8 },
      { time: 1000, rotation: 0.4 },
    ],
  },
  events: [{ time: 500, name: 'beat' }],
};
function fixture(storage = new Map<string, string>()) {
  const state = new AnimationEditorState(rig, [animation, { ...animation, name: 'other' }]);
  state.selectAnimation('wave');
  const preview = vi.fn<(pose: AnimationPose | null) => void>();
  const controller = new MirrorToolsController(preview, () => ({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
  }));
  controller.bind(state, 'rig');
  return { state, controller, preview, storage };
}
const render = (controller: MirrorToolsController) =>
  renderToStaticMarkup(createElement(MirrorToolsPanel, { controller }));

test('playback, preview and key readiness construct edited tracks only when a mirror command is committed', () => {
  const edit = vi.spyOn(keyframeEdits, 'setBonePropertyKeyframes');
  const { state, controller, preview } = fixture();
  try {
    const original = state.workingAnimation;
    state.play();
    for (let frame = 0; frame < 30; ++frame) state.advancePlayback(1 / 60);
    assert.isFalse(controller.getSnapshot().preview);
    assert.isNull(preview.mock.lastCall![0]);
    controller.togglePreview();
    for (let frame = 0; frame < 15; ++frame) state.advancePlayback(1 / 60);
    assert.isNotNull(preview.mock.lastCall![0]);
    controller.hidePreview();
    state.selectKeyframe({ boneId: 'leftArm', property: 'rotation', time: 0 });
    assert.equal(controller.getSnapshot().keysReason, '');
    assert.equal(edit.mock.calls.length, 0);
    assert.strictEqual(state.workingAnimation, original);
    assert.equal(state.historyLength, 0);
    assert.isFalse(state.dirty);
    assert.isTrue(controller.commitKeys());
    assert.equal(edit.mock.calls.length, 1);
    assert.equal(state.historyLength, 1);
  } finally {
    controller.dispose();
    edit.mockRestore();
  }
});

test('clock changes still update unsupported-transform readiness while mirror preview is off', () => {
  const { state, controller } = fixture();
  state.keyframes.setBonePropertyKeyframe('leftArm', 'scaleX', 1, 0);
  state.keyframes.setBonePropertyKeyframe('leftArm', 'scaleX', -1, 1);
  assert.equal(controller.getSnapshot().poseReason, '');
  state.setCurrentTime(0.75);
  assert.isFalse(controller.getSnapshot().preview);
  assert.include(controller.getSnapshot().poseReason, 'axis sign');
  assert.isFalse(controller.commitPose());
  state.setCurrentTime(0.25);
  assert.equal(controller.getSnapshot().poseReason, '');
  controller.dispose();
});

test('playback reuses rig and pair presentation data; changing pairs invalidates only pair data', () => {
  const { state, controller } = fixture();
  const validate = vi.spyOn(boneSymmetry, 'validateBoneSymmetryMapping');
  try {
    const before = controller.getSnapshot();
    state.play();
    for (let frame = 0; frame < 30; ++frame) state.advancePlayback(1 / 60);
    assert.strictEqual(controller.getSnapshot(), before);
    assert.equal(validate.mock.calls.filter(([, data]) => data.pairs === before.pairs).length, 0);
    assert.isTrue(Object.isFrozen(before.boneIds));
    assert.isTrue(Object.isFrozen(before.unpaired));
    assert.isTrue(Object.isFrozen(before.mappingErrors));

    controller.setPairs([{ leftBoneId: 'leftArm', rightBoneId: 'missing' }]);
    const changed = controller.getSnapshot();
    assert.strictEqual(changed.boneIds, before.boneIds);
    assert.notStrictEqual(changed.unpaired, before.unpaired);
    assert.include(changed.mappingErrors.join(' '), 'does not exist');
    const calls = validate.mock.calls.length;
    state.setCurrentTime(0.75);
    assert.strictEqual(controller.getSnapshot(), changed);
    assert.equal(validate.mock.calls.length, calls);

    controller.unbind();
    assert.lengthOf(controller.getSnapshot().boneIds, 0);
    assert.notStrictEqual(controller.getSnapshot().boneIds, before.boneIds);
  } finally {
    controller.dispose();
    validate.mockRestore();
  }
});

test('unavailable animation diagnostics refresh even when the document identity remains null', () => {
  const state = new AnimationEditorState(rig);
  const controller = new MirrorToolsController(vi.fn(), () => ({ getItem: () => null, setItem: () => {} }));
  try {
    controller.bind(state, 'rig');
    assert.include(controller.getSnapshot().poseReason, 'Load a valid animation');
    state.selectAnimation('missing');
    assert.include(controller.getSnapshot().poseReason, 'Animation "missing" is missing');
    assert.include(controller.getSnapshot().keysReason, 'Animation "missing" is missing');
  } finally {
    controller.dispose();
  }
});

test('React panel reflects direction, inferred pairs, readiness and authoritative selection', () => {
  const { state, controller } = fixture();
  assert.lengthOf(controller.getSnapshot().pairs, 1);
  assert.include(render(controller), 'Left → Right');
  assert.include(render(controller), 'Source: Left. Destination: Right.');
  assert.include(render(controller), 'Select source transform keys');
  assert.equal(controller.getSnapshot().poseReason, '');
  state.selectBone('leftArm');
  assert.include(controller.getSnapshot().scope, 'leftArm');
  state.selectKeyframe({ boneId: 'leftArm', property: 'rotation', time: 0 });
  assert.equal(controller.getSnapshot().keysReason, '');
  controller.setDirection('right-to-left');
  assert.include(controller.getSnapshot().poseReason, 'source side');
  assert.include(controller.getSnapshot().keysReason, 'source side');
  assert.include(render(controller), 'Source: Right. Destination: Left.');
  controller.setDirection('swap');
  assert.equal(controller.getSnapshot().poseReason, '');
  assert.equal(controller.getSnapshot().keysReason, '');
  assert.include(render(controller), 'Source and destination: both sides.');
  state.clearTimelineSelection();
  assert.include(controller.getSnapshot().keysReason, 'Select source transform keys');
  controller.dispose();
});

test('invalid drafts disable actions and preview, preserve the installed mapping and last durable pairs', () => {
  const { state, controller, preview, storage } = fixture();
  const pairs = controller.getSnapshot().pairs;
  controller.setPairs(pairs);
  const saved = [...storage.values()];
  const mapping = state.symmetryMapping;
  controller.togglePreview();
  controller.setPairs([{ leftBoneId: 'leftArm', rightBoneId: 'missing' }]);
  assert.include(controller.getSnapshot().mappingErrors.join(' '), 'does not exist');
  assert.isFalse(controller.getSnapshot().preview);
  assert.isNull(preview.mock.lastCall![0]);
  assert.isFalse(controller.commitPose());
  assert.isFalse(controller.commitKeys());
  assert.strictEqual(state.symmetryMapping, mapping);
  assert.deepEqual([...storage.values()], saved);
  assert.include(render(controller), 'role="alert"');
  controller.setPairs([{ leftBoneId: 'leftArm', rightBoneId: 'leftArm' }]);
  assert.include(controller.getSnapshot().poseReason, 'itself');
  controller.setPairs([...pairs, ...pairs]);
  assert.include(controller.getSnapshot().poseReason, 'more than once');
  controller.setPairs([]);
  assert.include(controller.getSnapshot().poseReason, 'No paired bones');
  controller.setPairs(pairs);
  assert.equal(controller.getSnapshot().poseReason, '');
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  controller.dispose();
});

test('all preview directions remain immutable, event silent, and follow working copy and playhead', () => {
  const { state, controller, preview } = fixture();
  state.setCurrentTime(0.25);
  state.setTemporaryBoneProperty('rotation', 9);
  state.play();
  const working = state.workingAnimation;
  const source = state.sourceAnimation;
  const exportJson = state.exportJson();
  const draft = state.boneTransformDraft;
  const keys = state.selectedKeys;
  const subscriber = vi.fn();
  const events = vi.fn();
  state.subscribe(subscriber);
  state.onAnimationEvent(events);
  for (const direction of ['left-to-right', 'right-to-left', 'swap'] as const) {
    controller.setDirection(direction);
    if (!controller.getSnapshot().preview) controller.togglePreview();
    assert.isTrue(controller.getSnapshot().preview);
    const pose = preview.mock.lastCall![0]!;
    assert.closeTo(pose.get('rightArm')!.rotation!, direction === 'right-to-left' ? 0.7 : 0.025, 1e-9);
    assert.closeTo(pose.get('leftArm')!.rotation!, direction === 'left-to-right' ? -0.025 : -0.7, 1e-9);
  }
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.selectedKeys, keys);
  assert.strictEqual(state.boneTransformDraft, draft);
  assert.equal(state.exportJson(), exportJson);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.isPlaying);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(subscriber.mock.calls.length, 0);
  assert.equal(events.mock.calls.length, 0);
  state.setCurrentTime(0.75);
  assert.closeTo(preview.mock.lastCall![0]!.get('rightArm')!.rotation!, -0.325, 1e-9);
  state.selectAnimation('other');
  assert.isTrue(controller.getSnapshot().preview);
  controller.dispose();
  assert.isNull(preview.mock.lastCall![0]);
});

test('current-pose commit invokes existing command, pauses and updates history, timeline selection and preview', () => {
  const { state, controller, preview } = fixture();
  state.selectBone('leftArm');
  state.setCurrentTime(0.25);
  const source = state.sourceAnimation;
  const originalLeft = state.workingAnimation!.tracks.leftArm;
  const command = vi.spyOn(state.keyframes, 'mirrorCurrentPoseToKeys');
  controller.togglePreview();
  state.play();
  assert.isTrue(controller.commitPose());
  assert.deepEqual(command.mock.calls[0], ['left-to-right']);
  assert.isFalse(state.isPlaying);
  assert.equal(state.currentTime, 0.25);
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  assert.equal(state.selectedBoneId, 'rightArm');
  assert.deepEqual(
    state.selectedKeys.map((key) => [key.boneId, key.property, key.time]),
    [['rightArm', 'rotation', 0.25]],
  );
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.workingAnimation!.tracks.leftArm, originalLeft);
  assert.isNull(preview.mock.lastCall![0]);
  assert.closeTo(state.getEvaluatedBonePropertyValue('rightArm', 'rotation')!, 0.025, 1e-9);
  assert.isTrue(state.undo());
  assert.isFalse(state.dirty);
  assert.isTrue(state.redo());
  assert.isTrue(state.dirty);
  controller.dispose();
});

test('selected keys commit preserves exact time, interpolation, primary key and one history action', () => {
  const { state, controller } = fixture();
  state.selectKeyframe({ boneId: 'leftArm', property: 'rotation', time: 0 });
  state.selectKeyframe({ boneId: 'leftArm', property: 'rotation', time: 1 }, { additive: true });
  const command = vi.spyOn(state.keyframes, 'mirrorSelectedKeyframes');
  const source = state.sourceAnimation;
  assert.isTrue(controller.commitKeys());
  assert.deepEqual(command.mock.calls[0], ['left-to-right']);
  assert.equal(state.historyLength, 1);
  assert.equal(state.workingAnimation!.interpolation, 'linear');
  assert.deepEqual(
    state.selectedKeys.map((key) => [key.boneId, key.time]),
    [
      ['rightArm', 0],
      ['rightArm', 1],
    ],
  );
  assert.equal(state.selectedKeyframe!.boneId, 'rightArm');
  assert.equal(state.selectedKeyframe!.time, 0);
  assert.strictEqual(state.sourceAnimation, source);
  assert.deepEqual(state.workingAnimation!.tracks.leftArm, animation.tracks.leftArm);
  assert.isTrue(state.undo());
  assert.isFalse(state.dirty);
  assert.isTrue(state.redo());
  controller.dispose();
});

test('pairs persist per rig, restore against a fresh rig, and reject stale or malformed storage', () => {
  const { controller, storage } = fixture();
  controller.setPairs([{ leftBoneId: 'rightArm', rightBoneId: 'leftArm' }]);
  const other = fixture(storage);
  assert.equal(other.state.getMirroredBoneId('rightArm'), 'leftArm');
  assert.equal(other.controller.getSnapshot().pairs[0]!.leftBoneId, 'rightArm');
  const freshState = new AnimationEditorState(new Rig({ root: 'root', bones: rig.bones }), [animation]);
  freshState.selectAnimation('wave');
  other.controller.bind(freshState, 'rig');
  assert.equal(other.controller.getSnapshot().pairs[0]!.leftBoneId, 'rightArm');
  const key = [...storage.keys()][0]!;
  storage.set(key, JSON.stringify({ version: 1, rig: 'old', pairs: [] }));
  const stale = fixture(storage);
  assert.include(stale.controller.getSnapshot().persistence, 'do not match');
  assert.equal(stale.controller.getSnapshot().pairs[0]!.leftBoneId, 'leftArm');
  storage.set(key, '{broken');
  const broken = fixture(storage);
  assert.include(broken.controller.getSnapshot().persistence, 'unavailable');
  for (const value of [controller, other.controller, stale.controller, broken.controller]) value.dispose();
});

test('unsupported transforms and storage failure give actionable feedback and disposal releases subscriptions', () => {
  const { state, controller } = fixture();
  state.keyframes.setBonePropertyKeyframe('leftArm', 'scaleX', -1, 0);
  assert.include(controller.getSnapshot().poseReason, 'axis sign');
  assert.include(render(controller), 'axis sign');
  state.undo();
  assert.equal(controller.getSnapshot().poseReason, '');
  const listener = vi.fn();
  controller.subscribe(listener);
  controller.dispose();
  state.selectBone('leftArm');
  assert.equal(listener.mock.calls.length, 0);
  const unavailable = new MirrorToolsController(vi.fn(), () => {
    throw new Error('blocked');
  });
  unavailable.bind(state, 'rig');
  unavailable.setPairs([{ leftBoneId: 'leftArm', rightBoneId: 'rightArm' }]);
  assert.include(unavailable.getSnapshot().persistence, 'this session');
  assert.isFalse(state.dirty);
  unavailable.dispose();
});

test('stepped preview projects the commit values at the continuous playhead, without resampling past the proposed key', () => {
  const { state, controller, preview } = fixture();
  state.setAuthoredPlaybackMode('stepped');
  state.setAuthoredFPS(10);
  state.selectBone('leftArm');
  state.setCurrentTime(0.25);
  const history = state.historyLength;
  controller.togglePreview();
  const proposed = preview.mock.lastCall![0]!.get('rightArm')!.rotation!;
  assert.closeTo(proposed, 0.06, 1e-9);
  assert.equal(state.currentTime, 0.25);
  assert.equal(state.historyLength, history);
  assert.isTrue(controller.commitPose());
  assert.closeTo(state.findBonePropertyKeyframe('rightArm', 'rotation', 0.25)!.value, proposed, 1e-9);
  controller.dispose();
});

test('external pair replacement and animation edits update React without duplicate clock renders; rebinding releases old state', () => {
  const f = fixture();
  const listener = vi.fn();
  const release = f.controller.subscribe(listener);
  const snapshot = f.controller.getSnapshot();
  f.state.setCurrentTime(0.25);
  assert.strictEqual(f.controller.getSnapshot(), snapshot);
  assert.equal(listener.mock.calls.length, 0);
  f.state.setSymmetryMapping({ ...f.state.symmetryMapping!, pairs: [], getMirroredBoneId: () => null });
  assert.deepEqual(f.controller.getSnapshot().pairs, []);
  assert.include(f.controller.getSnapshot().poseReason, 'No paired bones');
  const other = fixture();
  f.controller.bind(other.state, 'other');
  listener.mockClear();
  f.state.selectBone('root');
  assert.equal(listener.mock.calls.length, 0);
  other.state.selectBone('root');
  assert.include(f.controller.getSnapshot().scope, 'root');
  assert.include(f.controller.getSnapshot().poseReason, 'symmetry pair');
  release();
  f.controller.dispose();
  other.controller.dispose();
});

test('incompatible inferred hierarchy stays visible across editor clock notifications and invalid clips explain validation', () => {
  const nested = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root' }, { id: 'rightArm', parent: 'leftArm' }],
  });
  const state = new AnimationEditorState(nested, [
    { name: 'pose', duration: 1000, loop: false, tracks: { leftArm: [{ time: 0, rotation: 1 }] } },
  ]);
  state.selectAnimation('pose');
  const controller = new MirrorToolsController(vi.fn(), () => ({ getItem: () => null, setItem: () => {} }));
  controller.bind(state, 'nested');
  assert.lengthOf(controller.getSnapshot().pairs, 1);
  assert.include(controller.getSnapshot().poseReason, 'parents');
  state.setCurrentTime(0.25);
  assert.lengthOf(controller.getSnapshot().pairs, 1);
  assert.include(controller.getSnapshot().poseReason, 'parents');
  assert.isFalse(controller.commitPose());
  const invalidState = new AnimationEditorState(rig, [
    { ...animation, tracks: { missing: [{ time: 0, rotation: 1 }] } },
  ]);
  invalidState.selectAnimation('wave');
  controller.bind(invalidState, 'invalid');
  assert.include(controller.getSnapshot().poseReason, 'missing');
  assert.isFalse(controller.commitKeys());
  controller.dispose();
});

test('unbind clears readiness, preview and all cached session references and supports a fresh binding', () => {
  const { state, controller, preview } = fixture();
  controller.togglePreview();
  const listener = vi.fn();
  controller.subscribe(listener);
  controller.unbind();
  assert.isFalse(controller.getSnapshot().ready);
  assert.isFalse(controller.getSnapshot().preview);
  assert.deepEqual(controller.getSnapshot().pairs, []);
  assert.deepEqual(controller.getSnapshot().boneIds, []);
  assert.isNull(preview.mock.lastCall![0]);
  assert.include(controller.getSnapshot().poseReason, 'Load a rig');
  assert.isFalse(controller.commitPose());
  assert.isFalse(controller.commitKeys());
  for (const property of ['state', 'installedMapping']) assert.isUndefined(Reflect.get(controller, property));
  for (const property of ['poseDependencies', 'keysDependencies']) {
    const dependencies = Reflect.get(controller, property) as unknown[];
    assert.isFalse(dependencies.includes(state.workingAnimation));
    assert.isFalse(dependencies.includes(state.symmetryMapping));
  }
  listener.mockClear();
  state.setCurrentTime(0.5);
  assert.equal(listener.mock.calls.length, 0);
  controller.bind(state, 'fresh');
  assert.isTrue(controller.getSnapshot().ready);
  assert.equal(controller.getSnapshot().poseReason, '');
  assert.isFalse(controller.getSnapshot().preview);
  controller.dispose();
  controller.dispose();
  assert.isFalse(controller.getSnapshot().ready);
});

test('idempotent preview cleanup hides the overlay without changing the authored session', () => {
  const { state, controller, preview } = fixture();
  controller.togglePreview();
  const working = state.workingAnimation;
  controller.hidePreview();
  assert.isFalse(controller.getSnapshot().preview);
  assert.isNull(preview.mock.lastCall![0]);
  const calls = preview.mock.calls.length;
  controller.hidePreview();
  assert.equal(preview.mock.calls.length, calls);
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  controller.dispose();
});

test('rebind to a changed rig rejects saved pairs and hides old preview before new readiness is published', () => {
  const { state, controller, storage, preview } = fixture();
  controller.setPairs(controller.getSnapshot().pairs);
  controller.togglePreview();
  const changedRig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root' }] });
  const changed = new AnimationEditorState(changedRig, [
    { ...animation, tracks: { leftArm: animation.tracks.leftArm! } },
  ]);
  changed.selectAnimation('wave');
  controller.bind(changed, 'rig');
  assert.include(controller.getSnapshot().persistence, 'do not match');
  assert.deepEqual(controller.getSnapshot().pairs, []);
  assert.isFalse(controller.getSnapshot().preview);
  assert.isNull(preview.mock.lastCall![0]);
  assert.isNull(changed.symmetryMapping!.getMirroredBoneId('leftArm'));
  assert.equal(storage.size, 1);
  const snapshot = controller.getSnapshot();
  state.selectBone('leftArm');
  assert.strictEqual(controller.getSnapshot(), snapshot);
  controller.dispose();
});
