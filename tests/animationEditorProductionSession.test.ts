import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getAnimationEventReferences } from '../src/devtools/animation-editor/animationEvents.js';
import { TimelineSessionController } from '../src/devtools/animation-editor/TimelineSessionController.js';
import { Rig } from '../src/engine/Rig.js';
import { EditorElement, stubRigEditorDom } from './helpers/rigEditorDom.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clip = {
  name: 'walk',
  duration: 1000,
  loop: true,
  tracks: {
    root: [
      { time: 0, x: 1 },
      { time: 1000, x: 5 },
    ],
  },
  events: [
    { time: 0, name: 'start' },
    { time: 1000, name: 'end', data: { value: 1 } },
  ],
};
function session() {
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'idle' }]);
  state.selectAnimation('walk');
  return state;
}
function fixture() {
  const state = session();
  const query = stubRigEditorDom();
  const confirm = vi.fn(() => false);
  vi.stubGlobal('window', { confirm });
  vi.stubGlobal('Option', EditorElement);
  const controller = new TimelineSessionController(query('#editor-app') as unknown as HTMLElement, () => state, {
    endScrub: () => state.endScrub(),
  });
  controller.bind('test');
  const release = state.subscribe(() => controller.render());
  controller.render();
  return {
    state,
    query,
    confirm,
    controller,
    dispose: () => {
      release();
      controller.dispose();
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('full authoring workflow keeps checkpoints, history and loaded/imported sources separate', () => {
  const state = session();
  const source = state.sourceAnimation;
  const original = state.exportJson();
  assert.isFalse(state.dirty);
  state.setBonePropertyKeyframe('root', 'x', 8, 0.25);
  state.setAuthoredInterpolation('linear');
  const event = getAnimationEventReferences(state.workingAnimation)[1]!;
  state.updateAnimationEvent(event, { ...state.workingAnimation!.events![1]!, name: 'changed', data: [1, null] });
  const edited = state.exportJson();
  for (let i = 0; i < 3; ++i) assert.isTrue(state.undo());
  assert.isFalse(state.dirty);
  assert.equal(state.exportJson(), original);
  for (let i = 0; i < 3; ++i) assert.isTrue(state.redo());
  assert.isTrue(state.dirty);
  state.markSaved();
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 3);
  state.undo();
  assert.isTrue(state.dirty);
  state.redo();
  assert.isFalse(state.dirty);
  state.setBonePropertyKeyframe('root', 'y', 9);
  assert.isTrue(state.dirty);
  assert.isFalse(state.revertAnimation());
  assert.equal(state.historyLength, 4);
  assert.isTrue(state.revertAnimation({ discardChanges: true }));
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.workingAnimation, source);
  assert.equal(state.exportJson(), original);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.isFalse(state.canRedo);
  state.selectAnimation('idle');
  state.selectAnimation('walk');
  assert.equal(state.exportJson(), original, 'revert also resets the stored checkpoint');
  state.importJson(edited);
  const imported = state.sourceAnimation;
  state.setBonePropertyKeyframe('root', 'x', 99);
  state.undo();
  assert.isFalse(state.dirty);
  state.redo();
  assert.isTrue(state.dirty);
  state.revertAnimation({ discardChanges: true });
  assert.strictEqual(state.sourceAnimation, imported);
  assert.equal(state.exportJson(), edited, 'import is the new source for subsequent revert');
  assert.isFalse(state.undo());
});

test.each(['key', 'event', 'scrub', 'draft'] as const)(
  'revert resets %s state, preview time and history silently without fetching',
  (kind) => {
    const state = session();
    state.setBonePropertyKeyframe('root', 'x', 12);
    state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
    state.copySelectedKeyframes();
    const clipboard = state.timelineClipboard;
    const source = state.sourceAnimation;
    if (kind === 'key') {
      state.beginKeyframeDrag(state.primaryKey!);
      state.previewKeyframeDrag(0.4);
    }
    if (kind === 'event') {
      state.beginEventDrag(getAnimationEventReferences(state.workingAnimation)[1]!);
      state.previewEventDrag(0.4);
    }
    if (kind === 'scrub') {
      state.play();
      state.beginScrub();
    }
    if (kind === 'draft') state.setTemporaryBoneProperty('y', 33);
    const fired = vi.fn();
    state.onAnimationEvent(fired);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const notified = vi.fn();
    state.subscribe(notified);
    state.revertAnimation({ discardChanges: true });
    assert.equal(notified.mock.calls.length, 1);
    assert.equal(fired.mock.calls.length, 0);
    assert.equal(fetcher.mock.calls.length, 0);
    assert.strictEqual(state.sourceAnimation, source);
    assert.strictEqual(state.timelineClipboard, clipboard);
    assert.isFalse(state.isPlaying);
    assert.isFalse(state.isScrubbing);
    assert.isFalse(state.hasTemporaryTransform);
    assert.isNull(state.selectedBoneId);
    assert.isNull(state.selectedEvent);
    assert.isNull(state.keyframeDrag);
    assert.isNull(state.eventDrag);
    assert.deepEqual(state.selectedKeys, []);
    assert.equal(state.currentTime, 0);
    assert.equal(state.historyLength, 0);
    assert.deepEqual(
      state.timelineTracks.filter((row) => row.kind === 'bone').map((row) => row.boneId),
      ['root'],
    );
  },
);

test('switch confirmation cancellation keeps playback, drafts, history and selection; acceptance starts clean', async () => {
  const { state, query, confirm, dispose } = fixture();
  state.setBonePropertyKeyframe('root', 'x', 12);
  state.setCurrentTime(0.4);
  state.play();
  state.beginScrub();
  const before = state.workingAnimation;
  query('#animation-selection').value = 'idle';
  await query('#animation-selection').dispatch('change');
  assert.equal(confirm.mock.calls.length, 1);
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.currentTime, 0.4);
  assert.isTrue(state.isPlaying);
  assert.isTrue(state.isScrubbing);
  assert.equal(query('#animation-selection').value, 'walk');
  assert.match(query('#animation-session-status').textContent, /Animation: walk.*Status: Modified/);
  confirm.mockReturnValue(true);
  query('#animation-selection').value = 'idle';
  await query('#animation-selection').dispatch('change');
  assert.equal(state.selectedAnimationId, 'idle');
  assert.isFalse(state.dirty);
  assert.isFalse(state.isPlaying);
  assert.equal(state.historyLength, 0);
  assert.match(query('#animation-session-status').textContent, /Animation: idle.*Status: Clean/);
  dispose();
});

test('valid import/reload confirms only after validation, cancellation preserves edits, and clean replacement needs no dialog', async () => {
  const { state, query, confirm, dispose } = fixture();
  state.setBonePropertyKeyframe('root', 'x', 12);
  const working = state.workingAnimation;
  query('#animation-import-text').value = '{broken';
  await query('#animation-import-submit').click();
  assert.equal(confirm.mock.calls.length, 0);
  query('#animation-import-text').value = JSON.stringify({ ...clip, version: 1, name: 'imported' });
  await query('#animation-import-submit').click();
  assert.strictEqual(state.workingAnimation, working);
  assert.isTrue(state.canUndo);
  assert.match(query('#animation-import-feedback').textContent, /cancelled/);
  await query('#animation-reload-export').click();
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(confirm.mock.calls.length, 2);
  confirm.mockReturnValue(true);
  await query('#animation-import-submit').click();
  assert.equal(state.selectedAnimationId, 'imported');
  assert.isFalse(state.dirty);
  await query('#animation-reload-export').click();
  assert.equal(confirm.mock.calls.length, 3);
  dispose();
});

test('revert works after a clean export and rejects empty sessions', async () => {
  const { state, query, confirm, dispose } = fixture();
  state.setBonePropertyKeyframe('root', 'x', 12);
  state.markSaved();
  await query('#animation-revert').click();
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(state.workingAnimation!.tracks.root![0]!.x, 1);
  assert.isFalse(state.dirty);
  assert.match(query('#animation-export-feedback').textContent, /reverted.*source/);
  state.setBonePropertyKeyframe('root', 'x', 14);
  await query('#animation-revert').click();
  assert.equal(state.workingAnimation!.tracks.root![0]!.x, 14);
  confirm.mockReturnValue(true);
  await query('#animation-revert').click();
  assert.equal(state.workingAnimation!.tracks.root![0]!.x, 1);
  assert.isFalse(new AnimationEditorState(rig).revertAnimation());
  dispose();
});

test('clock-only updates skip file controls while edits, history, and imports refresh them', () => {
  const { state, query, controller, dispose } = fixture();
  const app = query('#editor-app') as unknown as HTMLElement;
  const lookups = vi.spyOn(app, 'querySelector');
  const ids = state.animationIds;
  state.selectTimelineProperty('root', 'x');
  state.play();
  lookups.mockClear();
  state.advancePlayback(0.25);
  state.advancePlayback(0.25);
  assert.equal(query('#current-time').textContent, '0.500 / 1.000 s');
  assert.isFalse(query('#timeline-previous-key').disabled);
  assert.isFalse(query('#timeline-next-key').disabled);
  assert.equal(lookups.mock.calls.length, 0);
  assert.strictEqual(state.animationIds, ids);
  assert.isTrue(Object.isFrozen(ids));
  state.pause();
  state.setBonePropertyKeyframe('root', 'x', 12);
  assert.isTrue(lookups.mock.calls.length > 0);
  assert.isFalse(query('#animation-undo').disabled);
  assert.equal(query('#animation-dirty').textContent, 'Unsaved changes');
  state.markSaved();
  assert.equal(query('#animation-dirty').textContent, 'No unsaved changes');
  state.undo();
  assert.isFalse(query('#animation-redo').disabled);
  state.importJson(JSON.stringify({ ...clip, version: 1, name: 'imported' }));
  assert.deepEqual(state.animationIds, ['walk', 'idle', 'imported']);
  assert.notStrictEqual(state.animationIds, ids);
  assert.equal(query('#animation-selection').value, 'imported');
  assert.isTrue(query('#animation-undo').disabled);
  controller.showError('load failed');
  assert.equal(query('#animation-status').textContent, 'load failed');
  dispose();
});
