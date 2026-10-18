import { assert, test } from 'vitest';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import { buildCharacterPackage, packageJson } from '../src/devtools/shared/package/characterPackage.js';
import type { RigJsonDefinition } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';

function file(name?: string): RigJsonDefinition {
  return { version: 1, ...(name === undefined ? {} : { name }), root: 'root', bones: [{ id: 'root' }] };
}
function fixture(name?: string) {
  const original = file(name);
  const source = new Rig(original);
  return { original, source, state: new RigEditorState(source, original) };
}

test.each([
  ['Original', 'Imported'],
  ['Original', undefined],
  [undefined, 'Imported'],
])('compatible imports preserve name changes from %s to %s through history and reset', (originalName, importedName) => {
  const { original, source, state } = fixture(originalName);
  const imported = file(importedName);
  assert.isTrue(state.canRestoreDraft(imported));
  state.assertCanRestoreDraft(imported);
  assert.isTrue(state.restoreDraft(imported));
  assert.equal(state.name, importedName);
  assert.equal(state.exportRig(false).name, importedName);
  assert.equal(Object.hasOwn(state.exportRig(false), 'name'), importedName !== undefined);
  assert.isTrue(state.dirty);
  assert.isTrue(state.rigDirty);
  assert.isFalse(state.skinsDirty);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.undo());
  assert.equal(state.name, originalName);
  assert.isFalse(state.dirty);
  assert.isTrue(state.redo());
  assert.equal(state.name, importedName);
  state.exportJson();
  assert.isFalse(state.dirty);
  state.resetRig();
  assert.equal(state.name, originalName);
  assert.isTrue(state.dirty);
  state.undo();
  assert.equal(state.name, importedName);
  assert.isFalse(state.dirty);
  assert.deepEqual(original, file(originalName));
  assert.isFalse(Object.hasOwn(source, 'name'), 'authored metadata stays outside the runtime rig');
});

test.each([1, 2])('version %s browser drafts restore imported names and retain undo', (version) => {
  const { state } = fixture('Original');
  const draft = { version, rig: file('Recovered'), directions: [] };
  assert.isTrue(state.restoreDraft(draft));
  assert.equal(state.name, 'Recovered');
  assert.equal(state.recoveryDraft.name, 'Recovered');
  assert.equal(state.createRecoveryDraft().rig.name, 'Recovered');
  state.undo();
  assert.equal(state.name, 'Original');
  state.redo();
  assert.equal(state.name, 'Recovered');
});

test('captured recovery and export snapshots retain their own names after later imports', () => {
  const { state } = fixture('Original');
  state.restoreDraft(file('First'));
  const exported = state.workingSnapshot;
  const recovery = state.recoverySnapshot;
  state.restoreDraft(file('Second'));
  state.markSaved(exported);
  assert.equal(state.name, 'Second');
  assert.isTrue(state.dirty);
  assert.isTrue(state.rigDirty);
  const draft = state.createRecoveryDraft(recovery);
  assert.equal(draft.rig.name, 'First');
  const restored = fixture('Original').state;
  assert.isTrue(restored.restoreDraft(JSON.parse(JSON.stringify(draft)) as unknown));
  assert.equal(restored.name, 'First');
  state.undo();
  assert.equal(state.name, 'First');
  assert.isFalse(state.dirty);
  state.redo();
  assert.equal(state.name, 'Second');
  assert.isTrue(state.dirty);
});

test('identical names do not consume history and invalid metadata cannot replace a working name', () => {
  const { state } = fixture('Original');
  assert.isTrue(state.restoreDraft(file('Original')));
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  const before = state.workingSnapshot;
  for (const name of ['', null, 123]) {
    const invalid = { ...file(), name };
    assert.isFalse(state.restoreDraft(invalid));
    assert.equal(state.name, 'Original');
    assert.strictEqual(state.workingSnapshot, before);
    assert.equal(state.historyLength, 0);
  }
});

test('skeleton and IK authoring retain imported metadata through their shared history boundary', () => {
  const { state } = fixture('Original');
  state.restoreDraft(file('Imported'));
  state.createBone('middle', 'root');
  state.createBone('end', 'middle');
  state.createIKConstraint({ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' });
  state.updateIKConstraint('chain', { mix: 0.5 });
  assert.equal(state.exportRig(false).name, 'Imported');
  for (let index = 0; index < 4; ++index) {
    state.undo();
    assert.equal(state.name, 'Imported');
  }
  for (let index = 0; index < 4; ++index) {
    state.redo();
    assert.equal(state.name, 'Imported');
  }
});

test('character ZIP export uses the imported rig name', async () => {
  const workspace = createNewCharacter({ id: 'metadata-test', name: 'Original' });
  assert.isTrue(workspace.rig.restoreDraft({ ...workspace.rig.recoveryDraft, name: 'Imported' }));
  const files = await buildCharacterPackage({
    definition: workspace.definition,
    rig: workspace.rig.recoveryDraft,
    skins: workspace.rig.standaloneSkins,
    animations: [],
    replacements: [],
  });
  assert.equal((packageJson(files, 'rig.json') as RigJsonDefinition).name, 'Imported');
});
