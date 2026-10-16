import { assert, test } from 'vitest';
import { AnimationEditorDocument } from '../src/devtools/animation-editor/AnimationEditorDocument.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { createCharacterDocuments, createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { parseRigDefinition, validateRigDefinition } from '../src/engine/externalData.js';
import {
  createIKConstraint,
  updateIKConstraint,
  removeIKConstraint,
  ikConstraintDependencies,
  type CreateIKConstraintOptions,
  type IKConstraintPatch,
} from '../src/engine/ik/ikAuthoring.js';
import { Rig } from '../src/engine/Rig.js';
import { createTransform, type RigDefinition } from '../src/engine/types.js';
import { demoCharacter } from './helpers/demoCharacter.js';

const skeleton: RigDefinition = {
  root: 'body',
  bones: [
    { id: 'body', x: 10, y: 20 },
    { id: 'upper', parent: 'body', x: 5, length: 40 },
    { id: 'forearm', parent: 'upper', y: 1, length: 30 },
    { id: 'hand', parent: 'forearm', y: 1 },
    { id: 'thigh', parent: 'body', x: -5 },
    { id: 'shin', parent: 'thigh', y: 50 },
    { id: 'foot', parent: 'shin', y: 45 },
  ],
};
const arm: CreateIKConstraintOptions = {
  name: 'leftHandIK',
  rootBone: 'upper',
  middleBone: 'forearm',
  endBone: 'hand',
};
const leg: CreateIKConstraintOptions = { name: 'leftFootIK', rootBone: 'thigh', middleBone: 'shin', endBone: 'foot' };

function state() {
  return new RigEditorState(new Rig(skeleton));
}

test('creates arm and leg constraints with stable names, effective lengths and rig-local default targets', () => {
  const before = JSON.stringify(skeleton);
  const authored = createIKConstraint(createIKConstraint(skeleton, arm), leg);
  assert.deepEqual(
    authored.ik?.map((entry) => entry.name),
    ['leftHandIK', 'leftFootIK'],
  );
  assert.deepEqual(
    authored.ik?.map((entry) => entry.target),
    [
      { x: 15, y: 90 },
      { x: 5, y: 115 },
    ],
  );
  assert.deepEqual(validateRigDefinition({ version: 1, ...authored }), []);
  assert.equal(JSON.stringify(skeleton), before);
  assert.isUndefined(skeleton.ik);
  const renamed = createIKConstraint(skeleton, { ...arm, name: 'tentacleTipIK' });
  assert.equal(renamed.ik![0]!.name, 'tentacleTipIK');
});

test('initializes the current endpoint including nested rotation, reflection and local end offset', () => {
  const pose = new Map([
    ['body', createTransform({ x: 100, y: 200, rotation: Math.PI / 2, scaleX: -2, scaleY: 3 })],
    ['upper', createTransform({ x: 5, rotation: Math.PI / 2 })],
    ['forearm', createTransform({ y: 40 })],
    ['hand', createTransform({ y: 30, scaleY: 2 })],
  ]);
  const candidate = createIKConstraint(skeleton, { ...arm, endOffset: { x: 0, y: 5 } }, pose);
  assert.approximately(candidate.ik![0]!.target!.x, 100, 1e-10);
  assert.approximately(candidate.ik![0]!.target!.y, 350, 1e-10);
  const explicit = createIKConstraint(skeleton, { ...arm, target: { x: 3, y: 4 } }, pose);
  assert.deepEqual(explicit.ik![0]!.target, { x: 3, y: 4 });
});

test('modifies target, mix, bend, enabled, priority and chain without changing identity or array order', () => {
  const original = createIKConstraint(createIKConstraint(skeleton, arm), leg);
  const before = JSON.stringify(original);
  const changed = updateIKConstraint(original, arm.name, {
    target: { x: 11, y: 12 },
    mix: 0.25,
    bendDirection: -1,
    enabled: false,
    priority: -5,
    endOffset: { x: 2, y: 3 },
  });
  assert.deepInclude(changed.ik![0], { name: arm.name, mix: 0.25, enabled: false, priority: -5, bendDirection: -1 });
  assert.deepEqual(changed.ik![0]!.target, { x: 11, y: 12 });
  assert.strictEqual(changed.ik![1], original.ik![1]);
  assert.equal(JSON.stringify(original), before);
  const enabled = updateIKConstraint(changed, arm.name, { enabled: true });
  assert.isTrue(enabled.ik![0]!.enabled);
  const rewired = updateIKConstraint(enabled, arm.name, {
    rootBone: leg.rootBone,
    middleBone: leg.middleBone,
    endBone: leg.endBone,
  });
  assert.equal(rewired.ik![0]!.name, arm.name);
  assert.equal(rewired.ik![0]!.endBone, 'foot');
  // Shared driven bones are supported by the existing priority-ordered solver.
  assert.equal(rewired.ik!.length, 2);
});

test.each([
  { mix: -0.1 },
  { mix: 1.1 },
  { mix: NaN },
  { bendDirection: 0 },
  { priority: Infinity },
  { target: { x: NaN, y: 1 } },
  { endOffset: { x: 0, y: Infinity } },
  { enabled: 'yes' },
  { rootBone: 'missing' },
  { middleBone: 'foot' },
  { endBone: 'upper' },
  { rootBone: undefined },
  { name: 'renamed' },
  { unsupported: true },
])('rejects invalid patch atomically: %j', (patch) => {
  const editor = state();
  editor.createIKConstraint(arm);
  const before = editor.workingCopy;
  const history = editor.historyLength;
  // Deliberately invalid external data exercises the runtime authoring boundary.
  assert.throws(() => editor.updateIKConstraint(arm.name, patch as unknown as IKConstraintPatch));
  assert.strictEqual(editor.workingCopy, before);
  assert.equal(editor.historyLength, history);
});

test('rejects duplicates, missing bones, disconnected or cyclic chains, including on creation', () => {
  const editor = state();
  editor.createIKConstraint(arm);
  assert.throws(() => editor.createIKConstraint(arm), /Duplicate/);
  assert.throws(() => editor.createIKConstraint({ ...leg, endBone: 'missing' }), /Unknown IK bone/);
  assert.throws(() => editor.createIKConstraint({ ...leg, middleBone: 'forearm' }), /directly connected/);
  assert.throws(() => editor.createIKConstraint({ ...leg, endBone: 'thigh' }), /directly connected/);
  const cyclic = {
    ...skeleton,
    bones: skeleton.bones.map((bone) => (bone.id === 'upper' ? { ...bone, parent: 'hand' } : bone)),
  };
  assert.throws(() => createIKConstraint(cyclic, arm), /[Cc]ycle|[Cc]yclic/);
  assert.throws(() => updateIKConstraint(editor.workingCopy, 'missing', {}), /Unknown IK constraint/);
  assert.throws(() => removeIKConstraint(editor.workingCopy, 'missing'), /Unknown IK constraint/);
});

test('checks every animation track, empty track, baked metadata and specialized host dependency', () => {
  const rig = createIKConstraint(skeleton, arm);
  const animations: AnimationClip[] = [
    { name: 'reach', duration: 100, loop: false, tracks: {}, ikTracks: { leftHandIK: [{ time: 0, x: 5 }] } },
    { name: 'empty', duration: 100, loop: false, tracks: {}, ikTracks: { leftHandIK: [] } },
    { name: 'baked', duration: 100, loop: false, tracks: {}, disabledIKConstraints: ['leftHandIK'] },
  ];
  const dependencies = { animations, references: () => ['weapon grip', 'foot planting provider'] };
  const references = ikConstraintDependencies(rig, arm.name, dependencies);
  assert.lengthOf(references, 5);
  for (const dependency of ['reach', 'empty', 'baked', 'weapon grip', 'foot planting'])
    assert.isTrue(references.some((entry) => entry.includes(dependency)));
  assert.throws(() => removeIKConstraint(rig, arm.name, dependencies), /Resolve these dependencies explicitly/);
  assert.throws(
    () => updateIKConstraint(rig, arm.name, { endOffset: { x: 2, y: 0 } }, dependencies),
    /baked IK metadata/,
  );
  assert.throws(() =>
    updateIKConstraint(rig, arm.name, { rootBone: 'thigh', middleBone: 'shin', endBone: 'foot' }, dependencies),
  );
  assert.doesNotThrow(() =>
    updateIKConstraint(rig, arm.name, { target: { x: 9, y: 8 }, enabled: false }, dependencies),
  );
  assert.deepEqual(removeIKConstraint(rig, arm.name).ik, []);
  assert.equal(rig.ik!.length, 1);
});

test('create/edit/delete each form one undo entry, preserve immutable snapshots and round-trip JSON', () => {
  const editor = state();
  const source = JSON.stringify(editor.source);
  const initial = editor.workingCopy;
  editor.createIKConstraint(arm);
  assert.equal(editor.historyLength, 1);
  assert.equal(editor.selectedIKConstraintId, arm.name);
  const created = editor.workingCopy;
  editor.updateIKConstraint(arm.name, { target: { x: 20, y: 70 }, mix: 0.5, bendDirection: -1, enabled: false });
  assert.equal(editor.historyLength, 2);
  const updated = editor.workingCopy;
  editor.removeIKConstraint(arm.name);
  assert.equal(editor.historyLength, 3);
  assert.isNull(editor.selectedIKConstraintId);
  assert.isTrue(editor.undo());
  assert.deepEqual(editor.workingCopy, updated);
  assert.isTrue(editor.undo());
  assert.deepEqual(editor.workingCopy, created);
  assert.isTrue(editor.undo());
  assert.deepEqual(editor.workingCopy, initial);
  assert.isFalse(editor.dirty);
  assert.isTrue(editor.redo());
  assert.isTrue(editor.redo());
  const json = editor.exportJson(false);
  const parsed = parseRigDefinition(JSON.parse(json));
  assert.deepEqual(parsed.ik, updated.ik);
  assert.deepEqual(new Rig(parsed).ik, updated.ik);
  assert.equal(JSON.stringify(editor.source), source);
  assert.isUndefined(initial.ik);
  assert.deepEqual(created.ik![0]!.target, { x: 15, y: 90 });
  assert.isTrue(Object.isFrozen(editor.getIKConstraint(arm.name).target));
});

test('guards deletion, chain edits, history, reset and recovery against live references added later', () => {
  let references: string[] = [];
  const editor = new RigEditorState(new Rig(skeleton), undefined, { ikReferences: () => references });
  const initialDraft = editor.createRecoveryDraft();
  editor.createIKConstraint(arm);
  references = ['animation "late reach" IK track'];
  const before = editor.workingCopy;
  assert.throws(() => editor.removeIKConstraint(arm.name), /late reach/);
  assert.throws(() => editor.updateIKConstraint(arm.name, { endOffset: { x: 1, y: 0 } }), /late reach/);
  assert.throws(() => editor.undo(), /late reach/);
  assert.throws(() => editor.resetRig(), /late reach/);
  assert.isFalse(editor.restoreDraft(initialDraft));
  assert.strictEqual(editor.workingCopy, before);
  assert.equal(editor.historyLength, 1);
  assert.isFalse(editor.canRedo);
  editor.updateIKConstraint(arm.name, { mix: 0.3, enabled: false });
  assert.isTrue(editor.undo());
  references = [];
  assert.isTrue(editor.undo());
  assert.isUndefined(editor.workingCopy.ik);
  assert.isTrue(editor.redo());
  editor.removeIKConstraint(arm.name);
});

test('current recovery envelopes preserve authored IK while legacy raw drafts retain compatibility checks', () => {
  const editor = state();
  editor.createIKConstraint(arm);
  editor.updateIKConstraint(arm.name, { target: { x: 25, y: 80 } });
  const restored = state();
  assert.isTrue(restored.restoreDraft(editor.createRecoveryDraft()));
  assert.equal(restored.historyLength, 1);
  assert.deepEqual(restored.workingCopy.ik, editor.workingCopy.ik);
  assert.isTrue(restored.undo());
  assert.isUndefined(restored.workingCopy.ik);
  assert.isFalse(state().restoreDraft(editor.recoveryDraft));
});

function character() {
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'test-ik',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skins/default.json' },
      animations: ['reach.json'],
      textures: {},
    },
    rig: { version: 1, ...createIKConstraint(skeleton, arm) },
    skins: { 'skins/default.json': { version: 1, name: 'default', slots: {} } },
    animations: {
      'reach.json': {
        version: 1,
        name: 'reach',
        duration: 100,
        loop: false,
        tracks: {},
        ikTracks: { leftHandIK: [{ time: 0, x: 20 }] },
      },
    },
  });
}

test('loaded workspace checks unselected clips and newly authored animation tracks with shared rig history', () => {
  const workspace = createCharacterDocuments(character());
  assert.throws(() => workspace.rig.removeIKConstraint(arm.name), /animation "reach" IK track/);
  workspace.rig.createIKConstraint(leg);
  workspace.animation.updatePreviewRig(new Rig(workspace.rig.workingCopy));
  workspace.animation.selectAnimation('reach');
  assert.isTrue(workspace.animation.setIKPropertyKeyframe(leg.name, 'x', 10, 0));
  assert.throws(() => workspace.rig.undo(), /animation "reach" IK track/);
  workspace.animation.removeIKPropertyKeyframe(leg.name, 'x', 0);
  workspace.rig.removeIKConstraint(leg.name);
});

test('animation undo and source revert cannot restore IK references deleted through the rig document', () => {
  const definition = character();
  const document = new AnimationEditorDocument(definition.rig, definition.animations);
  document.selectAnimation('reach');
  document.install({ ...document.workingAnimation!, ikTracks: {} });
  const withoutIK = new Rig(removeIKConstraint(definition.rig, arm.name));
  document.rig = withoutIK;
  const snapshot = document.workingAnimation;
  assert.isFalse(document.undo());
  assert.strictEqual(document.workingAnimation, snapshot);
  assert.isTrue(document.canUndo);
  assert.isFalse(document.revertAnimation({ discardChanges: true }));
  document.rig = definition.rig;
  assert.isTrue(document.undo());
  assert.property(document.workingAnimation!.ikTracks, arm.name);
});

test('supports authored chains on new characters and retains shipped existing character definitions', () => {
  const draft = createNewCharacter({ name: 'Tendril', id: 'tendril-ik-test' });
  draft.rig.createBone('segmentA', 'root');
  draft.rig.createBone('tip', 'segmentA');
  draft.rig.createIKConstraint({ name: 'tailIK', rootBone: 'root', middleBone: 'segmentA', endBone: 'tip' });
  assert.equal(parseRigDefinition(JSON.parse(draft.rig.exportJson(false))).ik![0]!.name, 'tailIK');
  assert.isUndefined(draft.definition.rig.ik);
  const existing = createCharacterDocuments(demoCharacter);
  const before = JSON.stringify(demoCharacter.rig.ik);
  assert.deepEqual(parseRigDefinition(JSON.parse(existing.rig.exportJson(false))).ik, demoCharacter.rig.ik);
  assert.equal(JSON.stringify(demoCharacter.rig.ik), before);
});

test('preserves exact authored IK numbers through serialization after edits and array shifts', () => {
  const editor = state();
  editor.createIKConstraint(arm);
  editor.createIKConstraint(leg);
  const target = { x: 0.123456789012345, y: -88.9876543210987 };
  editor.updateIKConstraint(leg.name, {
    target,
    endOffset: { x: 1.23456789012345, y: 0.0000001234567 },
    priority: 0.00000004,
    mix: 0.123456789,
  });
  editor.removeIKConstraint(arm.name);
  assert.deepEqual(parseRigDefinition(JSON.parse(editor.exportJson(false))).ik, editor.workingCopy.ik);
});

test('one IK command ends a prior field operation and no-op changes consume no history', () => {
  const editor = state();
  editor.beginOperation();
  editor.editBone('body', 'x', 25);
  editor.createIKConstraint(arm);
  assert.equal(editor.historyLength, 2);
  editor.updateIKConstraint(arm.name, { mix: 1 });
  const history = editor.historyLength;
  editor.updateIKConstraint(arm.name, { mix: 1 });
  assert.equal(editor.historyLength, history);
  editor.undo();
  editor.undo();
  assert.isUndefined(editor.workingCopy.ik);
  assert.equal(editor.getBone('body').x, 25);
  editor.undo();
  assert.equal(editor.getBone('body').x, 10);
});

test('external host IDs are reserved and deleting an unused selected IK clears animation navigation', () => {
  const reserved = new RigEditorState(new Rig(skeleton), undefined, {
    ikReferences: (id) => (id === arm.name ? ['foot controller'] : []),
  });
  assert.throws(() => reserved.createIKConstraint(arm), /reserved/);
  assert.equal(reserved.historyLength, 0);
  const workspace = createCharacterDocuments(character());
  workspace.rig.createIKConstraint(leg);
  workspace.animation.updatePreviewRig(new Rig(workspace.rig.workingCopy));
  workspace.animation.selectAnimation('reach');
  assert.isTrue(workspace.animation.selectIKConstraint(leg.name));
  workspace.rig.removeIKConstraint(leg.name);
  workspace.animation.updatePreviewRig(new Rig(workspace.rig.workingCopy));
  assert.isNull(workspace.animation.selectedIKConstraintId);
});
