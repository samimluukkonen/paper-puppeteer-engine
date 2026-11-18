import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { InterpolationController } from '../src/devtools/animation-editor/InterpolationController.js';
import {
  AUTHORED_INTERPOLATION_MODES,
  selectedInterpolationControl,
} from '../src/devtools/animation-editor/interpolationPresentation.js';
import type { KeyframeSelection } from '../src/devtools/animation-editor/timelineTracks.js';
import type { AnimationPlaybackMode } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';
import { animationClipSchema } from '../src/engine/schemas.js';
import { stubRigEditorDom } from './helpers/rigEditorDom.js';

afterEach(() => vi.unstubAllGlobals());

const key = (time = 0, property: KeyframeSelection['property'] = 'x', boneId = 'root'): KeyframeSelection => ({
  time,
  property,
  boneId,
});
const group = [key(), key(0.5), key(0, 'rotation', 'arm')];

function fixture(playback: AnimationPlaybackMode = { mode: 'smooth' }, selectAnimation = true) {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }] });
  const source = {
    name: 'move',
    duration: 1000,
    loop: false,
    playback,
    tracks: {
      root: [
        { time: 0, x: 0, y: 0 },
        { time: 250, y: 1 },
        { time: 500, x: 50 },
        { time: 1000, x: 100 },
      ],
      arm: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 1, scaleX: 2 },
      ],
    },
  };
  const state = new AnimationEditorState(rig, [source]);
  if (selectAnimation) state.selectAnimation('move');
  const query = stubRigEditorDom();
  const controller = new InterpolationController(query('#editor-app') as unknown as HTMLElement, () => state);
  controller.render();
  state.subscribe(() => controller.render());
  return { state, source, query, controller };
}

test('interpolation options come from the authored schema and exclude playback sampling modes', () => {
  assert.deepEqual(AUTHORED_INTERPOLATION_MODES, [animationClipSchema.shape.interpolation.unwrap().value]);
  assert.isTrue(Object.isFrozen(AUTHORED_INTERPOLATION_MODES));
  assert.isFalse(AUTHORED_INTERPOLATION_MODES.some((mode: string) => mode === 'smooth' || mode === 'stepped'));
});

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  'one selected key in $mode playback shows inherited authored Linear with a clip-only explanation',
  (playback) => {
    const { state, query } = fixture(playback);
    state.selectKeyframe(key());
    assert.equal(query('#timeline-interpolation').value, 'linear');
    assert.isTrue(query('#timeline-interpolation').disabled);
    assert.include(query('#timeline-interpolation-help').textContent, 'inherited from the clip');
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
  },
);

test('no selection and no animation show a disabled blank control with distinct explanations', () => {
  const { state, query } = fixture({ mode: 'smooth' }, false);
  assert.isTrue(query('#timeline-interpolation').disabled);
  assert.equal(query('#timeline-interpolation').value, '');
  assert.isTrue(query('#animation-interpolation').disabled);
  assert.include(query('#timeline-interpolation-help').textContent, 'Select an animation');
  state.selectAnimation('move');
  assert.isFalse(query('#animation-interpolation').disabled);
  assert.include(query('#timeline-interpolation-help').textContent, 'Select a key');
  state.selectKeyframe(key());
  state.clearKeyframeSelection();
  assert.equal(query('#timeline-interpolation').value, '');
  assert.isTrue(query('#timeline-interpolation').disabled);
  assert.isFalse(state.dirty);
});

test.each([key(1), key(1, 'scaleX', 'arm'), key(0.25, 'y')])(
  'terminal/single keys show unavailable safely: %j',
  (ref) => {
    const { state, query } = fixture();
    state.selectKeyframe(ref);
    assert.equal(query('#timeline-interpolation').value, '');
    assert.isTrue(query('#timeline-interpolation').disabled);
    assert.include(query('#timeline-interpolation-help').textContent, 'no outgoing segment');
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
  },
);

test('multi-selection is uniform across bones/properties; a terminal member makes the whole selection unavailable', () => {
  const { state, query } = fixture();
  state.selectKeyframes(group);
  assert.equal(query('#timeline-interpolation').value, 'linear');
  assert.equal(state.selectedKeys.length, 3);
  state.selectKeyframes([...group, key(1)]);
  assert.equal(query('#timeline-interpolation').value, '');
  assert.isTrue(query('#timeline-interpolation').disabled);
  assert.include(query('#timeline-interpolation-help').textContent, 'no outgoing segment');
  assert.isFalse(state.dirty);
});

test('missing-key presentation uses the query API unavailable reason', () => {
  assert.deepEqual(selectedInterpolationControl({ kind: 'unavailable', reason: 'missing-key' }), {
    value: '',
    disabled: true,
    reason: 'missing-key',
    help: 'A selected key is no longer available.',
  });
});

test('selection events cannot promote disabled single/batch edits to a clip mutation', async () => {
  const { state, query } = fixture();
  state.selectKeyframes(group);
  const held = state.workingAnimation;
  const clipEdit = vi.spyOn(state, 'setAuthoredInterpolation');
  query('#timeline-interpolation').value = 'linear';
  await query('#timeline-interpolation').dispatch('change');
  assert.equal(clipEdit.mock.calls.length, 0);
  assert.strictEqual(state.workingAnimation, held);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
});

test('explicit clip edit with multiple selected keys calls one mutation, preserves time/selection/source and refreshes Undo/Redo', async () => {
  const { state, source, query } = fixture();
  state.selectKeyframes(group);
  state.setCurrentTime(0.375);
  const before = JSON.stringify(source);
  const baseline = state.workingAnimation;
  const selection = state.selectedKeys;
  const primary = state.primaryKey;
  const bone = state.selectedBoneId;
  const property = state.selectedTimelineProperty;
  const mutation = vi.spyOn(state, 'setAuthoredInterpolation');
  const notifications = vi.fn();
  state.subscribe(notifications);
  query('#animation-interpolation').value = 'linear';
  await query('#animation-interpolation').dispatch('change');
  const authored = state.workingAnimation;
  assert.deepEqual(mutation.mock.calls, [['linear']]);
  assert.equal(notifications.mock.calls.length, 1);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.strictEqual(authored!.tracks, baseline!.tracks);
  assert.equal(query('#animation-interpolation').value, 'linear');
  assert.equal(query('#timeline-interpolation').value, 'linear');
  state.undo();
  assert.strictEqual(state.workingAnimation, baseline);
  assert.equal(query('#animation-interpolation').value, '');
  assert.equal(query('#timeline-interpolation').value, 'linear');
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, authored);
  assert.equal(query('#animation-interpolation').value, 'linear');
  assert.isTrue(state.dirty);
  assert.strictEqual(state.selectedKeys, selection);
  assert.strictEqual(state.primaryKey, primary);
  assert.equal(state.selectedBoneId, bone);
  assert.equal(state.selectedTimelineProperty, property);
  assert.equal(state.currentTime, 0.375);
  assert.equal(JSON.stringify(source), before);
  assert.isUndefined(state.sourceAnimation!.interpolation);
});

test('opening/querying controls and no-op or invalid edits preserve dirty, drafts and redo history', async () => {
  const { state, query, controller } = fixture();
  state.selectKeyframe(key());
  query('#animation-interpolation').value = 'linear';
  await query('#animation-interpolation').dispatch('change');
  state.undo();
  state.setTemporaryBoneProperty('x', 99);
  const held = state.workingAnimation;
  for (const value of ['', 'smooth', 'stepped', 'invalid']) {
    controller.render();
    await query('#animation-interpolation').dispatch('focus');
    query('#animation-interpolation').value = value;
    await query('#animation-interpolation').dispatch('change');
    assert.equal(query('#animation-interpolation').value, '');
    assert.strictEqual(state.workingAnimation, held);
    assert.isTrue(state.hasTemporaryTransform);
    assert.isTrue(state.canRedo);
    assert.isFalse(state.dirty);
  }
});

test('returning to Default removes only the clip declaration and restores a clean baseline', async () => {
  const { state, query } = fixture();
  query('#animation-interpolation').value = 'linear';
  await query('#animation-interpolation').dispatch('change');
  query('#animation-interpolation').value = '';
  await query('#animation-interpolation').dispatch('change');
  assert.isFalse(Object.hasOwn(state.workingAnimation!, 'interpolation'));
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 2);
  state.undo();
  assert.equal(query('#animation-interpolation').value, 'linear');
  state.redo();
  assert.equal(query('#animation-interpolation').value, '');
});

test('playback-only notifications reuse selection queries; selection and history edits invalidate them', () => {
  const { state } = fixture();
  const query = vi.spyOn(state, 'selectedInterpolation', 'get');
  state.selectKeyframe(key());
  assert.equal(query.mock.calls.length, 1);
  state.setCurrentTime(0.1);
  state.playback.play();
  state.playback.advancePlayback(0.1);
  assert.equal(query.mock.calls.length, 1);
  state.setAuthoredInterpolation('linear');
  assert.equal(query.mock.calls.length, 2);
  state.undo();
  assert.equal(query.mock.calls.length, 3);
});

test('rebinds use the current state, and disposal/remount do not retain declaration listeners', async () => {
  const { state: previous, query, controller } = fixture();
  controller.dispose();
  controller.dispose();
  let current = previous;
  const nextController = new InterpolationController(query('#editor-app') as unknown as HTMLElement, () => current);
  current = new AnimationEditorState(previous.rig, [previous.sourceAnimation!]);
  current.selectAnimation('move');
  nextController.render();
  query('#animation-interpolation').value = 'linear';
  await query('#animation-interpolation').dispatch('change');
  assert.isTrue(current.dirty);
  assert.equal(current.historyLength, 1);
  assert.isFalse(previous.dirty);
  nextController.dispose();
  query('#animation-interpolation').value = '';
  await query('#animation-interpolation').dispatch('change');
  assert.equal(current.workingAnimation!.interpolation, 'linear');
});

test('the inspector reconciles paste, duplicate, group move, delete and repeated history restoration', () => {
  const { state, query } = fixture();
  state.selectKeyframes(group);
  state.setAuthoredInterpolation('linear');
  assert.equal(query('#timeline-interpolation').value, 'linear');
  state.keyframes.copySelectedKeyframes();
  state.setCurrentTime(1);
  state.keyframes.pasteKeyframes();
  assert.equal(query('#timeline-interpolation').value, '');
  assert.equal(query('#timeline-interpolation').getAttribute('data-unavailable-reason'), 'no-outgoing-segment');
  state.keyframes.duplicateSelectedKeyframes();
  assert.equal(query('#timeline-interpolation').value, '');
  state.keyframes.moveSelectedKeyframe(0.2);
  assert.equal(query('#timeline-interpolation').value, 'linear');
  state.deleteSelectedKeyframes();
  assert.equal(query('#timeline-interpolation').getAttribute('data-unavailable-reason'), 'empty-selection');
  for (let index = 0; index < 5; index++) {
    assert.isTrue(state.undo());
    assert.equal(query('#timeline-interpolation').value, '');
    assert.equal(query('#animation-interpolation').value, index === 4 ? '' : 'linear');
  }
  for (let index = 0; index < 5; index++) {
    assert.isTrue(state.redo());
    assert.equal(query('#timeline-interpolation').getAttribute('data-unavailable-reason'), 'empty-selection');
    assert.equal(query('#animation-interpolation').value, 'linear');
  }
  state.selectKeyframe(key());
  assert.equal(query('#timeline-interpolation').value, 'linear');
});

test('surviving selected keys refresh availability when their outgoing successor is deleted and restored', () => {
  const { state, query } = fixture();
  state.selectKeyframe(key(0.5));
  assert.equal(query('#timeline-interpolation').value, 'linear');
  state.keyframes.removeBonePropertyKeyframe('root', 'x', 1);
  assert.deepEqual(state.selectedKeys, [key(0.5)]);
  assert.equal(query('#timeline-interpolation').getAttribute('data-unavailable-reason'), 'no-outgoing-segment');
  state.undo();
  assert.equal(query('#timeline-interpolation').value, 'linear');
  state.redo();
  assert.equal(query('#timeline-interpolation').value, '');
  state.keyframes.removeBonePropertyKeyframe('root', 'x', 0.5);
  assert.equal(query('#timeline-interpolation').getAttribute('data-unavailable-reason'), 'empty-selection');
});
