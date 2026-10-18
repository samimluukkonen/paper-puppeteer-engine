import { assert, test, vi } from 'vitest';
import {
  CharacterDraftStore,
  createCharacterDocuments,
  createNewCharacter,
  suggestCharacterId,
} from '../src/devtools/shared/newCharacter.js';
import { buildCharacterPackage, loadPackageDefinition } from '../src/devtools/shared/package/characterPackage.js';
import { PackageController } from '../src/devtools/shared/package/PackageController.js';
import { CharacterDefinition, validateCharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { Puppet } from '../src/engine/Puppet.js';
import { demoCharacter } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

test('creates a root-only independent workspace without any loaded character or artwork', () => {
  const draft = createNewCharacter({ name: ' Forest Guardian ', id: 'forest-guardian' });
  assert.equal(draft.identity.name, 'Forest Guardian');
  assert.equal(draft.definition.id, 'forest-guardian');
  assert.deepEqual(draft.definition.rigFile, {
    version: 1,
    name: 'Forest Guardian',
    root: 'root',
    bones: [{ id: 'root' }],
  });
  assert.deepEqual(draft.definition.textures, {});
  assert.deepEqual(draft.definition.animations, []);
  assert.deepEqual(draft.definition.poses, []);
  assert.deepEqual(draft.definition.rig.attachments, []);
  assert.deepEqual(draft.definition.rig.slots, []);
  assert.deepEqual(draft.definition.standaloneSkins, [{ version: 1, name: 'default', slots: {} }]);
  assert.deepEqual(draft.animation.animationIds, []);
  assert.isNull(draft.animation.workingAnimation);
  assert.isTrue(draft.unsaved);
  assert.isFalse(draft.rig.canUndo);
  assert.isFalse(draft.rig.canRedo);
  assert.deepEqual(draft.rig.validationIssues(), []);
  const puppet = new Puppet(puppetScene(), { definition: draft.definition, autoUpdate: false });
  puppet.setSkin('default');
  puppet.syncPose();
  puppet.destroy();
});

test('new and loaded working documents, histories and immutable sources are isolated', () => {
  const source = demoCharacter;
  const loaded = createCharacterDocuments(source);
  loaded.rig.editBone(source.rig.root, 'x', 99);
  const loadedSnapshot = loaded.rig.workingCopy;
  const before = JSON.stringify(source);
  const a = createNewCharacter({ name: 'One', id: 'one' });
  a.rig.editBone('root', 'x', 12);
  const b = createNewCharacter({ name: 'Two', id: 'two' });
  assert.notStrictEqual(a.rig, b.rig);
  assert.notStrictEqual(a.animation, b.animation);
  assert.notStrictEqual(a.definition.rigFile, b.definition.rigFile);
  assert.isUndefined(b.rig.getBone('root').x);
  assert.isTrue(a.rig.dirty);
  assert.isTrue(a.rig.undo());
  assert.isFalse(a.rig.dirty);
  assert.isTrue(a.rig.redo());
  assert.equal(a.rig.getBone('root').x, 12);
  assert.isUndefined(a.definition.rigFile!.bones[0]!.x);
  assert.equal(JSON.stringify(source), before);
  assert.strictEqual(loaded.rig.workingCopy, loadedSnapshot);
  assert.equal(loaded.rig.getBone(source.rig.root).x, 99);
  assert.isTrue(loaded.rig.canUndo);
});

test('saved pose references protect bone deletion and rename while preserving package export', async () => {
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'posed-character',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: [],
      poses: ['pose.json'],
      textures: {},
    },
    rig: { version: 1, root: 'root', bones: [{ id: 'root' }, { id: 'posed', parent: 'root' }] },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    poses: { 'pose.json': { version: 1, name: 'ready', bones: { posed: { rotation: 1 } } } },
  });
  const { rig, animation } = createCharacterDocuments(definition);
  const before = rig.workingCopy;
  const history = rig.historyLength;
  assert.deepEqual(rig.boneDependencies('posed'), ['pose "ready"']);
  assert.throws(() => rig.removeBone('posed'), /pose "ready"/);
  assert.throws(() => rig.renameBone('posed', 'renamed'), /pose "ready"/);
  assert.strictEqual(rig.workingCopy, before);
  assert.equal(rig.historyLength, history);
  rig.createBone('unreferenced', 'root');
  rig.removeBone('unreferenced');
  const exported = await loadPackageDefinition(
    await buildCharacterPackage({
      definition,
      rig: rig.recoveryDraft,
      skins: rig.standaloneSkins,
      animations: animation.packageAnimations(),
      replacements: [],
    }),
  );
  assert.deepEqual(exported.poses, definition.poses);
});

test.each([
  { name: '', id: 'ok' },
  { name: '  ', id: 'ok' },
  { name: 'Bad\u0000name', id: 'ok' },
  { name: 'x'.repeat(101), id: 'ok' },
  { name: 'Okay', id: '' },
  { name: 'Okay', id: 'UPPER' },
  { name: 'Okay', id: '../bad' },
  { name: 'Okay', id: '__proto__' },
  { name: 'Okay', id: '-bad' },
  { name: 'Okay', id: 'two--hyphens' },
  { name: 'Okay', id: 'a'.repeat(65) },
])('rejects invalid creation inputs: %j', (options) => {
  assert.throws(() => createNewCharacter(options));
});

test('rejects catalog and session duplicates and suggests editable collision-free IDs', () => {
  assert.throws(() => createNewCharacter({ name: 'New', id: 'demo-puppet' }), /already exists/);
  assert.throws(() => createNewCharacter({ name: 'New', id: 'random-paperdoll-sketch' }), /already exists/);
  assert.throws(() => createNewCharacter({ name: 'New', id: 'forest' }, ['forest']), /already exists/);
  assert.equal(suggestCharacterId(' Fórest Guardian! '), 'forest-guardian');
  assert.equal(suggestCharacterId('Forest', ['forest', 'forest-2']), 'forest-3');
  assert.equal(suggestCharacterId('🌲'), 'character');
});

test('draft switching reloads independent identities and integrates existing recovery and history', () => {
  const backing = storage();
  const store = new CharacterDraftStore(backing);
  const a = store.create({ name: 'One', id: 'one' });
  a.rig.editBone('root', 'y', 42);
  const recovery = a.rig.createRecoveryDraft();
  store.create({ name: 'Two', id: 'two' });
  assert.deepEqual(
    store.choices().map((entry) => entry.id),
    ['one', 'two'],
  );
  const restored = new CharacterDraftStore(backing).get('one')!;
  assert.isTrue(restored.rig.restoreDraft(recovery));
  assert.isTrue(restored.rig.dirty);
  assert.equal(restored.rig.getBone('root').y, 42);
  assert.isTrue(restored.rig.undo());
  assert.isUndefined(store.get('two')!.rig.getBone('root').y);
  assert.isUndefined(store.get('missing'));
  assert.throws(() => store.create({ name: 'Duplicate', id: 'one' }), /already exists/);
});

test('draft choices parse identities without creating workspaces or changing storage', () => {
  const backing = storage();
  const store = new CharacterDraftStore(backing);
  backing.setItem('paper-puppeteer:new-character:v1:first', JSON.stringify({ id: 'first', name: ' First ' }));
  backing.setItem('paper-puppeteer:new-character:v1:second', JSON.stringify({ id: 'second', name: 'Second' }));
  const construct = vi.spyOn(CharacterDefinition, 'fromData');
  const write = vi.spyOn(backing, 'setItem');
  try {
    const expected = [
      { id: 'first', label: 'First (draft)' },
      { id: 'second', label: 'Second (draft)' },
    ];
    assert.deepEqual(store.choices(), expected);
    assert.deepEqual(store.choices(), expected);
    assert.equal(construct.mock.calls.length, 0);
    assert.equal(write.mock.calls.length, 0);
    assert.equal(backing.length, 2);
    assert.equal(store.get('first')!.identity.name, 'First');
    assert.equal(construct.mock.calls.length, 1, 'opening a draft still creates its workspace');
  } finally {
    construct.mockRestore();
    write.mockRestore();
  }
});

test('failed validation and storage writes leave the current workspace and registry unchanged', () => {
  const backing = storage();
  const store = new CharacterDraftStore(backing);
  const current = store.create({ name: 'Current', id: 'current' });
  current.rig.editBone('root', 'x', 7);
  const snapshot = current.rig.workingCopy;
  assert.throws(() => store.create({ name: '', id: 'bad' }));
  const failure = vi.spyOn(backing, 'setItem').mockImplementation(() => {
    throw new Error('Quota exceeded');
  });
  assert.throws(() => store.create({ name: 'New', id: 'new' }), /Quota exceeded/);
  assert.equal(backing.length, 1);
  assert.strictEqual(current.rig.workingCopy, snapshot);
  assert.equal(current.rig.getBone('root').x, 7);
  assert.isTrue(current.rig.canUndo);
  failure.mockRestore();
});

test('malformed drafts are isolated and retained without blocking valid drafts or new characters', () => {
  const backing = storage();
  const store = new CharacterDraftStore(backing);
  store.create({ name: 'First', id: 'first' });
  const invalid = new Map([
    ['broken-json', '{'],
    ['invalid-schema', JSON.stringify({ id: 'invalid-schema', name: '' })],
    ['wrong-identity', JSON.stringify({ id: 'another-id', name: 'Mismatch' })],
    ['demo-puppet', JSON.stringify({ id: 'demo-puppet', name: 'Catalog collision' })],
  ]);
  for (const [id, json] of invalid) backing.setItem(`paper-puppeteer:new-character:v1:${id}`, json);
  store.create({ name: 'Last', id: 'last' });
  assert.deepEqual(store.choices(), [
    { id: 'first', label: 'First (draft)' },
    { id: 'last', label: 'Last (draft)' },
  ]);
  assert.equal(store.get('first')!.identity.id, 'first');
  for (const [id, json] of invalid) {
    assert.throws(() => store.get(id));
    assert.throws(() => store.create({ id, name: 'Replacement' }), /already exists/);
    assert.equal(backing.getItem(`paper-puppeteer:new-character:v1:${id}`), json);
  }
});

test('editing completeness is distinct from schema validity; empty drafts export without dummy assets or fetches', async () => {
  const draft = createNewCharacter({ name: 'Empty', id: 'empty' });
  assert.deepEqual(
    validateCharacterDefinition({
      manifest: draft.definition.manifest,
      rig: draft.definition.rigFile,
      skins: { 'skins/default.json': draft.definition.standaloneSkins[0] },
    }),
    [],
  );
  const fetcher = vi.fn<typeof fetch>();
  const files = await buildCharacterPackage(
    {
      definition: draft.definition,
      rig: draft.rig.recoveryDraft,
      skins: draft.rig.standaloneSkins,
      animations: draft.animation.packageAnimations(),
      replacements: [],
    },
    fetcher,
  );
  assert.deepEqual([...files.keys()].sort(), ['character.json', 'rig.json', 'skins/default.json']);
  assert.equal(fetcher.mock.calls.length, 0);
  const loaded = await loadPackageDefinition(files);
  assert.equal(loaded.id, 'empty');
  assert.deepEqual(loaded.animations, []);
  assert.deepEqual(loaded.textures, {});
  const packages = new PackageController();
  packages.bind(
    () => ({
      definition: draft.definition,
      rig: draft.rig.recoveryDraft,
      skins: draft.rig.standaloneSkins,
      animations: [],
      replacements: [],
    }),
    true,
  );
  assert.isTrue(packages.hasUnsavedCharacter);
  assert.isTrue(packages.hasUnsavedChanges);
  draft.rig.exportJson();
  assert.isTrue(packages.hasUnsavedCharacter, 'a rig-only export does not save the new character');
  packages.dispose();
});
