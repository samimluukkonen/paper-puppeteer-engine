import { assert, test, vi } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';

const source = () => ({
  ...createEmptyScene({ id: 'opening' }),
  actors: [{ id: 'hero', character: { manifest: '../characters/hero/character.json' }, position: { x: 1, y: 2 } }],
  actions: [
    {
      id: 'face',
      type: 'face' as const,
      actorId: 'hero',
      time: 500,
      target: { type: 'direction' as const, facing: 'left' as const },
    },
  ],
});

test('selection and presentation subscriptions publish only their revisions and unsubscribe independently', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(source()));
  const authored = vi.fn();
  const selection = vi.fn();
  const presentation = vi.fn(() => document.selectActor('hero'));
  const unsubscribeAuthored = document.subscribeAuthored(authored);
  const unsubscribeSelection = document.subscribeSelection(selection);
  const unsubscribePresentation = document.subscribePresentation(presentation);
  document.setFootContactsVisible(true);
  assert.equal(presentation.mock.calls.length, 1, 'reentrant selection does not repeat presentation');
  assert.equal(selection.mock.calls.length, 1);
  assert.equal(authored.mock.calls.length, 0);
  document.updateProperties({ name: 'Authored edit' });
  assert.equal(authored.mock.calls.length, 1);
  assert.equal(presentation.mock.calls.length, 1);
  assert.equal(selection.mock.calls.length, 1);
  document.createScene({ id: 'another' });
  assert.equal(authored.mock.calls.length, 2);
  assert.equal(selection.mock.calls.length, 2, 'scene switches invalidate selection');
  unsubscribeSelection();
  document.selectActor(null);
  assert.equal(selection.mock.calls.length, 2);
  unsubscribePresentation();
  document.setFootContactsVisible(false);
  assert.equal(presentation.mock.calls.length, 1);
  unsubscribeAuthored();
  document.updateProperties({ name: 'Unsubscribed edit' });
  assert.equal(authored.mock.calls.length, 2);
});

test('authored subscriptions ignore selection, diagnostics and checkpoints, including reentrant measurements', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(source()));
  const authored = document.getAuthoredSnapshot();
  const selection = document.getSelectionSnapshot();
  const presentation = document.getPresentationSnapshot();
  const reconcile = vi.fn(() => {
    document.setActorGroundOffsets(new Map([['hero', 12]]));
    document.setActorGroundContacts(new Map([['hero', [{ id: 'foot', name: 'Foot', offset: 12 }]]]));
  });
  const unsubscribe = document.subscribeAuthored(reconcile);
  document.selectActor('hero');
  assert.isAbove(document.getSelectionSnapshot(), selection);
  assert.equal(document.getPresentationSnapshot(), presentation);
  document.setFootContactsVisible(true);
  document.setGroundPreviewing(true);
  document.setCameraPreview(true);
  document.setCameraOverlays(true);
  document.markSaved();
  document.validateScene();
  document.reportError(new Error('diagnostic'));
  assert.isAbove(document.getPresentationSnapshot(), presentation);
  assert.equal(document.getAuthoredSnapshot(), authored);
  assert.equal(reconcile.mock.calls.length, 0);
  document.updateActor('hero', { position: { x: 10, y: 20 } });
  assert.equal(reconcile.mock.calls.length, 1, 'ground measurements do not recursively reconcile');
  assert.equal(document.getAuthoredSnapshot(), authored + 1);
  document.undo();
  document.redo();
  const actorDrag = document.beginDrag({ kind: 'actor', id: 'hero' })!;
  actorDrag.change({ position: { x: 30, y: 40 } });
  actorDrag.cancel();
  assert.equal(reconcile.mock.calls.length, 5, 'undo, redo, drag movement and cancellation each reconcile');
  document.createScene({ id: 'other' });
  document.selectScene('opening');
  assert.equal(reconcile.mock.calls.length, 7);
  document.selectActor('hero');
  document.selectFootContact('foot');
  document.selectScene('opening');
  assert.equal(document.selectedFootContactId, 'foot', 'reselecting a scene retains its measurements and selection');
  unsubscribe();
  document.updateProperties({ name: 'Unsubscribed' });
  assert.equal(reconcile.mock.calls.length, 7);
});

test('new scenes are independent unsaved drafts, including after undo or revert to their initial source', () => {
  const document = new SceneEditorDocument();
  assert.isNull(document.workingScene);
  assert.isFalse(document.hasUnsavedChanges);
  assert.isTrue(document.createScene({ id: 'first' }));
  const original = document.sourceScene!;
  assert.isTrue(document.dirty);
  assert.isTrue(document.isNewScene);
  assert.isFalse(document.canUndo);
  assert.isTrue(Object.isFrozen(original));
  assert.isTrue(Object.isFrozen(original.actors));
  assert.isTrue(document.updateProperties({ name: 'Edited', duration: 2000 }));
  assert.equal(original.name, 'Untitled Scene');
  assert.equal(document.workingScene!.name, 'Edited');
  assert.isTrue(document.undo());
  assert.deepEqual(document.workingScene, original);
  assert.isTrue(document.dirty);
  assert.isTrue(document.redo());
  assert.isFalse(document.revertScene());
  assert.isTrue(document.revertScene({ discardChanges: true }));
  assert.isTrue(document.dirty);
  assert.equal(document.workingScene!.name, original.name);
  assert.isTrue(document.undo(), 'revert itself is undoable');
  assert.equal(document.workingScene!.name, 'Edited');
});

test('switching scenes retains independent history, saved baseline, dirty state and actor IDs', () => {
  const document = new SceneEditorDocument();
  assert.isTrue(document.importJson(JSON.stringify(source())));
  document.updateProperties({ name: 'Scene one edited' });
  const first = document.workingScene;
  assert.isTrue(document.createScene({ id: 'second' }));
  assert.isTrue(document.markSaved());
  document.updateProperties({ name: 'Scene two edited' });
  document.undo();
  assert.isTrue(document.canRedo);
  assert.isTrue(document.hasUnsavedChanges);
  assert.isFalse(document.dirty);
  assert.isTrue(document.selectScene('opening'));
  assert.strictEqual(document.workingScene, first);
  assert.isTrue(document.canUndo);
  assert.equal(document.workingScene!.actors[0]!.id, 'hero');
  document.undo();
  assert.isFalse(document.dirty);
  document.selectScene('second');
  assert.isTrue(document.canRedo);
  document.redo();
  assert.equal(document.workingScene!.name, 'Scene two edited');
  assert.deepEqual(document.sceneIds, ['opening', 'second']);
  assert.isFalse(document.selectScene('missing'));
  assert.equal(document.selectedSceneId, 'second');
});

test('saved checkpoints and source revert remain distinct after download and further edits', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(source()));
  document.updateProperties({ name: 'Downloaded version' });
  const saved = document.workingScene!;
  document.markSaved(saved);
  assert.isFalse(document.dirty);
  document.updateProperties({ name: 'Later edit' });
  assert.isTrue(document.dirty);
  document.undo();
  assert.isFalse(document.dirty);
  document.undo();
  assert.isTrue(document.dirty, 'source differs from the downloaded checkpoint');
  document.redo();
  document.revertScene({ discardChanges: true });
  assert.equal(document.workingScene!.name, document.sourceScene!.name);
  assert.isTrue(document.dirty, 'reverting source does not falsely mark the different download saved');
});

test('imports and edits own deeply detached data and never mutate existing character data', () => {
  const character = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'default.json' },
      animations: ['idle.json'],
      textures: {},
    },
    rig: { version: 1, root: 'root', bones: [{ id: 'root', x: 12 }] },
    skins: { 'default.json': { version: 1, name: 'default', slots: {} } },
    animations: { 'idle.json': { version: 1, name: 'idle', duration: 100, loop: true, tracks: {} } },
  });
  const before = JSON.stringify(character);
  const input = source();
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(input));
  const original = document.sourceScene!;
  document.replaceScene({ ...input, actors: [{ ...input.actors[0], position: { x: 10, y: 20 } }] });
  input.actors[0]!.position.x = 999;
  assert.equal(document.workingScene!.actors[0]!.position.x, 10);
  assert.equal(original.actors[0]!.position.x, 1);
  assert.isTrue(Object.isFrozen(document.workingScene!.actors[0]!.position));
  document.updateProperties({ duration: 3000 });
  assert.deepEqual(document.workingScene!.actions, original.actions);
  assert.equal(JSON.stringify(character), before);
});

test('duplicate creation, invalid edits/imports and canceled replacements preserve the active draft and history', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(source()));
  document.updateProperties({ name: 'Keep this' });
  const draft = document.workingScene;
  assert.isFalse(document.createScene({ id: 'opening' }));
  assert.isFalse(document.importJson('{'));
  assert.isFalse(document.importJson(JSON.stringify({ ...source(), duration: 0 })));
  assert.isFalse(document.updateProperties({ duration: 100 }), 'existing action exceeds duration');
  assert.isFalse(document.replaceScene({ ...draft, id: 'renamed' }));
  const confirm = vi.fn(() => false);
  assert.isFalse(document.importJson(JSON.stringify(source()), { confirmDiscard: confirm }));
  assert.equal(confirm.mock.calls.length, 1);
  assert.isFalse(document.importJson(JSON.stringify(source())), 'destructive replacement requires explicit consent');
  assert.strictEqual(document.workingScene, draft);
  assert.isTrue(document.canUndo);
  assert.isTrue(document.importJson(JSON.stringify(source()), { confirmDiscard: () => true }));
  assert.isFalse(document.dirty);
  assert.isFalse(document.canUndo);
});

test('opening another document keeps dirty scenes and protects replacing an inactive dirty scene', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'first' });
  const first = document.workingScene;
  document.importJson(JSON.stringify(source()));
  assert.isFalse(document.dirty);
  assert.isTrue(document.hasUnsavedChanges);
  assert.isFalse(document.importJson(JSON.stringify(createEmptyScene({ id: 'first' }))));
  assert.equal(document.selectedSceneId, 'opening');
  document.selectScene('first');
  assert.strictEqual(document.workingScene, first);
});

test('captured download checkpoints the captured document without marking later edits or another scene saved', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'first' });
  const captured = document.workingScene!;
  document.updateProperties({ name: 'Later' });
  document.createScene({ id: 'second' });
  document.markSaved(captured);
  assert.isTrue(document.dirty);
  document.selectScene('first');
  assert.isTrue(document.dirty);
  document.undo();
  assert.isFalse(document.dirty);
});

test('subscriptions refresh on authored changes, navigation and diagnostics and can be released', () => {
  const document = new SceneEditorDocument();
  const listener = vi.fn();
  const release = document.subscribe(listener);
  const initial = document.getSnapshot();
  document.createScene({ id: 'first' });
  document.updateProperties({ name: 'Edited' });
  document.undo();
  document.redo();
  document.markSaved();
  document.selectScene('first');
  document.updateProperties({ duration: -1 });
  assert.equal(listener.mock.calls.length, 7);
  assert.equal(document.getSnapshot(), initial + 7);
  release();
  document.selectScene('first');
  assert.equal(listener.mock.calls.length, 7);
});

test('new documents that exceed the shared JSON size limit cannot replace an existing session', () => {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'keep' });
  const before = document.workingScene;
  assert.isFalse(document.createScene({ id: 'large', name: 'x'.repeat(10 * 1024 * 1024) }));
  assert.strictEqual(document.workingScene, before);
  assert.deepEqual(document.sceneIds, ['keep']);
  assert.match(document.validationIssues[0]!.message, /size limit/);
});
