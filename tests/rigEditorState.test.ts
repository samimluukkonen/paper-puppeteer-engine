import { assert, test, vi } from 'vitest';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import * as externalData from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';
import { rigDefinitionSchema } from '../src/engine/schemas.js';

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

test('restoring a validated rig draft preserves its source and creates one dirty undoable edit', () => {
  const edited = new RigEditorState(source);
  edited.beginOperation();
  edited.editBone('arm', 'x', 99);
  edited.editSprite('hand', 'y', 8, true);
  const draft = edited.recoveryDraft;
  assert.isTrue(edited.validationPending, 'capturing a draft must not end a focused field operation');
  const restored = new RigEditorState(source);
  assert.isTrue(restored.restoreDraft(draft));
  assert.isTrue(restored.dirty);
  assert.equal(restored.historyLength, 1);
  assert.equal(restored.getBone('arm').x, 99);
  assert.equal(restored.getAttachment('hand').y, 8);
  assert.isUndefined(source.getBone('arm').x);
  assert.isTrue(restored.undo());
  assert.isFalse(restored.dirty);
  assert.isUndefined(restored.getBone('arm').x);
  restored.redo();
  assert.equal(restored.getBone('arm').x, 99);
});

test('invalid and incompatible rig drafts leave the working copy and history unchanged', () => {
  const state = new RigEditorState(source);
  const before = state.workingCopy;
  const file = state.recoveryDraft;
  const variants = [
    { ...file, version: 2 },
    { ...file, bones: file.bones.map((bone) => (bone.id === 'arm' ? { ...bone, x: NaN } : bone)) },
    { ...file, bones: file.bones.map((bone) => (bone.id === 'arm' ? { ...bone, parent: 'root' } : bone)) },
    { ...file, slots: [] },
    { ...file, attachments: file.attachments!.map((attachment) => ({ ...attachment, texture: 'other' })) },
  ];
  for (const candidate of variants) {
    assert.isFalse(state.canRestoreDraft(candidate));
    assert.isFalse(state.restoreDraft(candidate));
    assert.strictEqual(state.workingCopy, before);
    assert.equal(state.historyLength, 0);
  }
});

test('recovery retains edited child directions through zero length, undo and redo', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', length: 20 },
      { id: 'child', parent: 'root', x: 20, y: 0 },
    ],
  });
  const edited = new RigEditorState(rig);
  edited.editBoneFields('child', { x: -12, y: 16 });
  edited.editBone('root', 'length', 0);
  const snapshot = edited.recoverySnapshot;
  assert.strictEqual(edited.recoverySnapshot, snapshot);
  const draft = JSON.parse(JSON.stringify(edited.createRecoveryDraft(snapshot))) as unknown;
  edited.editBone('root', 'length', 40);
  const restored = new RigEditorState(rig);
  assert.isTrue(restored.restoreDraft(draft));
  assert.isTrue(restored.undo());
  assert.isFalse(restored.dirty);
  assert.isTrue(restored.redo());
  restored.editBone('root', 'length', 20);
  assert.deepEqual([restored.getBone('child').x, restored.getBone('child').y], [-12, 16]);
  assert.isFalse(Object.hasOwn(restored.exportRig(false), 'directions'));
});

test('legacy rig drafts recover zero-length children using their source directions', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', length: 20 },
      { id: 'child', parent: 'root', x: 20, y: 0 },
    ],
  });
  const edited = new RigEditorState(rig);
  edited.editBone('root', 'length', 0);
  const restored = new RigEditorState(rig);
  assert.isTrue(restored.restoreDraft(edited.recoveryDraft));
  restored.editBone('root', 'length', 20);
  assert.deepEqual([restored.getBone('child').x, restored.getBone('child').y], [20, 0]);
});

test('invalid recovery direction metadata is rejected without mutating the rig or history', () => {
  const state = new RigEditorState(source);
  const draft = state.createRecoveryDraft();
  const before = state.recoverySnapshot;
  for (const directions of [
    [['missing', { x: 1, y: 0 }]],
    [['root', { x: 1, y: 0 }]],
    [['arm', { x: NaN, y: 0 }]],
    [['arm', { x: 0, y: 0 }]],
    [['arm', { x: 2, y: 0 }]],
    [
      ['arm', { x: 1, y: 0 }],
      ['arm', { x: 1, y: 0 }],
    ],
  ]) {
    assert.isFalse(state.canRestoreDraft({ ...draft, directions }));
    assert.isFalse(state.restoreDraft({ ...draft, directions }));
    assert.strictEqual(state.recoverySnapshot, before);
    assert.equal(state.historyLength, 0);
  }
  let reads = 0;
  const accessor = { ...draft };
  Object.defineProperty(accessor, 'directions', {
    enumerable: true,
    get() {
      reads++;
      return [];
    },
  });
  assert.isFalse(state.canRestoreDraft(accessor));
  assert.equal(reads, 0);
});

test('editor state reuses the validated source rig and keeps edits in its working copy', () => {
  const parse = vi.spyOn(rigDefinitionSchema, 'parse');
  try {
    const state = new RigEditorState(source);
    assert.strictEqual(state.rig, source);
    assert.equal(parse.mock.calls.length, 0);
    state.editBone('arm', 'x', 12);
    assert.isUndefined(source.getBone('arm').x);
    assert.equal(state.getBone('arm').x, 12);
    state.undo();
    assert.isUndefined(state.getBone('arm').x);
  } finally {
    parse.mockRestore();
  }
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
  state.editSprite('arm', 'x', 99);
  state.editSlot('handVisual', 'y', 88);
  assert.equal(source.getBone('arm').sprite?.x, 3);
  assert.equal(source.slots[0]?.y, 5);
  assert.equal(source.skins[0]?.slots.handVisual, 'hand');
});

test('indexed edits follow replacement objects through resets, undo and redo', () => {
  const state = new RigEditorState(source);
  const edit = () => {
    state.beginOperation();
    state.editBone('root', 'x', 7);
    state.editBone('arm', 'x', 12);
    state.editSlot('handVisual', 'y', 15);
    state.editSprite('hand', 'x', 9, true);
    state.endOperation();
  };
  const check = (edited: boolean) => {
    assert.equal(state.getBone('root').x, edited ? 7 : undefined);
    assert.equal(state.getBone('arm').x, edited ? 12 : undefined);
    assert.equal(state.getSlot('handVisual').y, edited ? 15 : 5);
    assert.equal(state.getAttachment('hand').x, edited ? 9 : undefined);
  };
  edit();
  check(true);
  state.undo();
  check(false);
  state.redo();
  check(true);
  state.selectBone('arm');
  state.resetSelected();
  assert.equal(state.getBone('arm').x, undefined);
  state.selectSlot('handVisual');
  state.resetSelected('hand');
  assert.equal(state.getSlot('handVisual').y, 5);
  assert.equal(state.getAttachment('hand').x, undefined);
  edit();
  check(true);
  state.resetRig();
  check(false);
  edit();
  check(true);
  for (const get of [state.getBone.bind(state), state.getSlot.bind(state), state.getAttachment.bind(state)])
    assert.throws(() => get('missing'), /Unknown/);
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
    assert.equal(stringify.mock.calls.length, 0);

    state.editBone('arm', 'x', 12);
    assert.isTrue(state.dirty);
    assert.isTrue(state.dirty);
    state.validationIssues();
    assert.equal(validation.mock.calls.length, 2);
    assert.equal(stringify.mock.calls.length, 0);
    const exported = state.workingSnapshot;
    assert.strictEqual(state.workingSnapshot, exported);
    assert.strictEqual(exported, state.workingCopy);
    assert.isTrue(Object.isFrozen(exported));
    assert.equal(stringify.mock.calls.length, 0);

    state.undo();
    assert.isFalse(state.dirty);
    state.validationIssues();
    state.redo();
    assert.isTrue(state.dirty);
    state.validationIssues();
    assert.equal(validation.mock.calls.length, 4);
    assert.equal(stringify.mock.calls.length, 0);
  } finally {
    validation.mockRestore();
    stringify.mockRestore();
  }
});

test('undo and redo share immutable entries without serializing or parsing the rig', () => {
  const state = new RigEditorState(source);
  const original = state.workingCopy;
  const stringify = vi.spyOn(JSON, 'stringify');
  const parse = vi.spyOn(JSON, 'parse');
  try {
    state.markSaved();
    state.editBone('root', 'x', 12);
    const edited = state.workingCopy;
    assert.strictEqual(edited.bones[2], original.bones[2]);
    assert.isTrue(state.undo());
    assert.strictEqual(state.workingCopy, original);
    assert.isTrue(state.redo());
    assert.strictEqual(state.workingCopy, edited);
    state.editSprite('arm', 'x', 18);
    assert.equal(edited.bones[2]!.sprite!.x, 3);
    state.undo();
    assert.strictEqual(state.workingCopy, edited);
    state.resetRig();
    assert.strictEqual(state.workingCopy, original);
    assert.isFalse(state.dirty);
    assert.equal(stringify.mock.calls.length, 0);
    assert.equal(parse.mock.calls.length, 0);
  } finally {
    stringify.mockRestore();
    parse.mockRestore();
  }
});

test('no-op groups preserve redo and clean status when optional fields change insertion order', () => {
  const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root', x: 1, y: 2 }] }));
  state.editBone('root', 'y', 3);
  state.undo();
  state.beginOperation();
  state.editBone('root', 'x', undefined);
  state.editBone('root', 'x', 1);
  state.endOperation();
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.isTrue(state.canRedo);
  state.redo();
  assert.equal(state.getBone('root').y, 3);
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

test('a grouped edit validates a large rig once on completion while scalar checks stay immediate', () => {
  const state = new RigEditorState(
    new Rig({
      root: 'root',
      bones: [{ id: 'root' }, ...Array.from({ length: 500 }, (_, i) => ({ id: `bone${i}`, parent: 'root' }))],
    }),
  );
  const validation = vi.spyOn(externalData, 'validateRigDefinition');
  try {
    const originalIssues = state.validationIssues();
    state.beginOperation();
    for (let x = 1; x <= 100; x += 1) {
      state.editBone('bone499', 'x', x);
      assert.strictEqual(state.validationIssues(), originalIssues);
      assert.isTrue(state.validationPending);
    }
    assert.equal(validation.mock.calls.length, 1);
    assert.throws(() => state.editBone('bone499', 'length', -1), /negative/);
    assert.throws(() => state.editBone('bone499', 'x', Number.NaN), /finite/);
    assert.equal(state.getBone('bone499').x, 100);
    state.endOperation();
    assert.equal(validation.mock.calls.length, 2);
    assert.isFalse(state.validationPending);
    assert.deepEqual(state.validationIssues(), []);
    assert.equal(state.historyLength, 1);
  } finally {
    validation.mockRestore();
  }
});

test('explicit validation and export check the current data before a grouped edit finishes', () => {
  const state = new RigEditorState(source);
  const validation = vi.spyOn(externalData, 'validateRigDefinition');
  try {
    state.beginOperation();
    state.editSlot('handVisual', 'y', 12);
    state.validate();
    assert.isFalse(state.validationPending);
    assert.equal((validation.mock.calls.at(-1)![0] as externalData.RigJsonDefinition).slots![0]!.y, 12);
    state.editSlot('handVisual', 'y', 15);
    assert.isTrue(state.validationPending);
    assert.equal(externalData.parseRigDefinition(JSON.parse(state.exportJson(false))).slots[0]!.y, 15);
    assert.isFalse(state.validationPending);
    assert.equal((validation.mock.calls.at(-1)![0] as externalData.RigJsonDefinition).slots![0]!.y, 15);
  } finally {
    validation.mockRestore();
  }
});

test('readonly views reject direct mutations without corrupting cached status or history', () => {
  const state = new RigEditorState(source);
  const original = state.workingCopy;
  const issues = state.validationIssues();
  const mutations = [
    () => {
      (state.getBone('root') as { x: number }).x = 10;
    },
    () => {
      (state.getBone('arm').sprite as { x: number }).x = 99;
    },
    () => {
      (state.getSlot('handVisual') as { bone: string }).bone = 'missing';
    },
    () => {
      (state.getAttachment('hand') as { texture: string }).texture = 'other';
    },
    () => {
      (state.workingCopy.bones as unknown[]).pop();
    },
    () => {
      (state.workingCopy.skins![0]!.slots as Record<string, string>).handVisual = 'other';
    },
  ];
  for (const mutate of mutations) assert.throws(mutate, TypeError);
  assert.strictEqual(state.workingCopy, original);
  assert.strictEqual(state.validationIssues(), issues);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.deepEqual(state.exportRig(false).bones, original.bones);
  state.editBone('root', 'x', 10);
  assert.isTrue(state.dirty);
  assert.isTrue(state.canUndo);
  assert.isUndefined(original.bones[0]!.x);
  assert.strictEqual(state.workingCopy.bones[2], original.bones[2]);
  state.undo();
  assert.isUndefined(state.getBone('root').x);
  assert.isFalse(state.dirty);
  state.redo();
  assert.equal(state.getBone('root').x, 10);
  assert.isTrue(Object.isFrozen(state.getBone('root')));
  const clone = structuredClone(state.workingCopy);
  (clone.bones[0] as { x: number }).x = 20;
  assert.equal(state.getBone('root').x, 10);
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
