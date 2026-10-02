import { assert, test, vi } from 'vitest';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import * as externalData from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

const source = new Rig({
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'pelvis', parent: 'root', x: 4 },
    { id: 'arm', parent: 'pelvis', y: 20, sprite: { texture: 'arm', x: 3 } },
  ],
  slots: [{ id: 'handVisual', bone: 'arm', y: 5 }],
  attachments: [{ id: 'hand', texture: 'hand' }],
  skins: [{ version: 1, name: 'default', slots: { handVisual: 'hand' } }],
});

test('editor selection validates bones and slots and can be cleared', () => {
  const state = new RigEditorState(source);
  state.selectBone('arm');
  assert.deepEqual(state.selection, { type: 'bone', id: 'arm' });
  state.selectSlot('handVisual');
  assert.deepEqual(state.selection, { type: 'slot', id: 'handVisual' });
  state.clearSelection();
  assert.equal(state.selection, null);
  assert.throws(() => state.selectBone('missing'));
  assert.throws(() => state.selectSlot('missing'));
});

test('hierarchy is parent first and the working copy is independent', () => {
  const state = new RigEditorState(source);
  assert.deepEqual(state.childrenOf('pelvis'), ['arm']);
  assert.deepEqual(state.hierarchy(), [
    { id: 'root', depth: 0 },
    { id: 'pelvis', depth: 1 },
    { id: 'arm', depth: 2 },
  ]);
  (state.workingCopy.bones[2]!.sprite as { x: number }).x = 99;
  (state.workingCopy.slots![0] as { y: number }).y = 88;
  (state.workingCopy.skins![0]!.slots as Record<string, string>).handVisual = 'other';
  assert.equal(source.getBone('arm').sprite?.x, 3);
  assert.equal(source.slots[0]?.y, 5);
  assert.equal(source.skins[0]?.slots.handVisual, 'hand');
});

test('status and history reuse validation and serialization until the rig changes', () => {
  const state = new RigEditorState(source);
  const validation = vi.spyOn(externalData, 'validateRigDefinition');
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    const issues = state.validationIssues();
    state.selectBone('arm');
    state.gridSnap = 5;
    state.visibility.bones = false;
    assert.strictEqual(state.validationIssues(), issues);
    assert.isFalse(state.dirty);
    assert.isFalse(state.dirty);
    state.beginOperation();
    state.endOperation();
    assert.equal(validation.mock.calls.length, 1);
    assert.equal(stringify.mock.calls.filter(([value]) => value === state.workingCopy).length, 0);

    state.editBone('arm', 'x', 12);
    assert.isTrue(state.dirty);
    assert.isTrue(state.dirty);
    state.validationIssues();
    assert.equal(validation.mock.calls.length, 2);
    assert.equal(stringify.mock.calls.filter(([value]) => value === state.workingCopy).length, 1);

    state.undo();
    assert.isFalse(state.dirty);
    state.validationIssues();
    state.redo();
    assert.isTrue(state.dirty);
    state.validationIssues();
    assert.equal(validation.mock.calls.length, 4);
    assert.equal(stringify.mock.calls.filter(([value]) => value === state.workingCopy).length, 1);
  } finally {
    validation.mockRestore();
    stringify.mockRestore();
  }
});

test('cached status follows grouped edits, resets, and asynchronous save baselines', () => {
  const state = new RigEditorState(source);
  state.beginOperation();
  state.editSlot('handVisual', 'y', 12);
  const exportedSnapshot = state.workingSnapshot;
  state.editSprite('arm', 'x', 9);
  state.endOperation();
  state.markSaved(exportedSnapshot);
  assert.isTrue(state.dirty);
  state.undo();
  assert.isTrue(state.dirty);
  state.redo();
  state.markSaved();
  assert.isFalse(state.dirty);
  state.selectBone('arm');
  state.resetSelected();
  assert.equal(state.getBone('arm').sprite?.x, 3);
  assert.isTrue(state.dirty);
  state.resetRig();
  assert.equal(state.getSlot('handVisual').y, 5);
  assert.isTrue(state.dirty);
  state.markSaved();
  assert.isFalse(state.dirty);
});

test('explicit validation refreshes cached status after a direct working-copy mutation', () => {
  const state = new RigEditorState(source);
  assert.isFalse(state.dirty);
  assert.deepEqual(state.validationIssues(), []);
  (state.workingCopy.slots![0] as { bone: string }).bone = 'missing';
  // Export must validate its candidate independently of the status cache.
  assert.throws(() => state.exportJson(false), /unknown bone/);
  state.validate();
  assert.isTrue(state.dirty);
  assert.isTrue(state.validationIssues().some((issue) => issue.severity === 'error'));
  assert.isAbove(state.warnings.length, 0);
});

test('history drops the oldest entries and bounds undo/redo across grouped edits and branches', () => {
  const state = new RigEditorState(source, undefined, { historyLimit: 2 });
  for (const x of [1, 2, 3]) state.editBone('arm', 'x', x);
  assert.equal(state.historyLength, 2);
  assert.isTrue(state.undo());
  assert.equal(state.getBone('arm').x, 2);
  assert.isTrue(state.undo());
  assert.equal(state.getBone('arm').x, 1);
  assert.isFalse(state.undo());
  assert.isTrue(state.redo());
  assert.isTrue(state.redo());
  assert.isFalse(state.redo());
  assert.equal(state.historyLength, 2);
  state.beginOperation();
  for (const x of [4, 5, 6]) state.editBone('arm', 'x', x);
  state.endOperation();
  assert.equal(state.historyLength, 2);
  state.undo();
  assert.equal(state.getBone('arm').x, 3);
  state.editBone('arm', 'x', 9);
  assert.isFalse(state.canRedo);
  state.undo();
  state.undo();
  assert.equal(state.getBone('arm').x, 2);
  assert.isFalse(state.canUndo);
  state.resetRig();
  assert.isFalse(state.dirty);
  state.undo();
  assert.equal(state.getBone('arm').x, 2);
});

test('the default history limit bounds long sessions without losing the saved baseline', () => {
  const state = new RigEditorState(source);
  const baseline = state.workingSnapshot;
  assert.equal(state.historyLimit, 100);
  for (let x = 1; x <= 120; x += 1) state.editBone('arm', 'x', x);
  assert.equal(state.historyLength, 100);
  state.markSaved(baseline);
  assert.isTrue(state.dirty);
  state.resetRig();
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 100);
});

test('zero disables history while grouped edits, saving, and resets still work', () => {
  const state = new RigEditorState(source, undefined, { historyLimit: 0 });
  state.beginOperation();
  state.editBone('arm', 'x', 9);
  state.endOperation();
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.undo());
  assert.isFalse(state.redo());
  state.markSaved();
  assert.isFalse(state.dirty);
  state.resetRig();
  assert.isTrue(state.dirty);
  assert.isFalse(state.canUndo);
});

test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'invalid history limit %s is rejected',
  (historyLimit) => assert.throws(() => new RigEditorState(source, undefined, { historyLimit }), /History limit/),
);
