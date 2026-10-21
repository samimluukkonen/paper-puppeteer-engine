import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { assert, expect, test } from 'vitest';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
  packageHostedCharacter,
} from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { createCharacterDocuments, createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import {
  buildCharacterPackage,
  openPackageRuntime,
  type PackageFiles,
} from '../src/devtools/shared/package/characterPackage.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { checkJson } from '../src/engine/jsonData.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../src/engine/ScenePackage.js';
import type { ValidationIssue } from '../src/engine/validation.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

async function emptyCharacter(id = 'hero'): Promise<PackageFiles> {
  const draft = createNewCharacter({ id, name: 'Hero' });
  return buildCharacterPackage({
    definition: draft.definition,
    rig: draft.definition.rigFile!,
    skins: draft.definition.standaloneSkins,
    animations: [],
    replacements: [],
  });
}

test('plain JSON crosses retained editor realms while classes and accessors remain invalid', () => {
  const foreign: unknown = runInNewContext('({ version: 2, nested: { x: 12 }, array: [{ y: 10 }] })');
  const issues: ValidationIssue[] = [];
  assert.isTrue(checkJson(foreign, '', issues));
  assert.deepEqual(issues, []);
  for (const expression of [
    'new (class Document { x = 1 })()',
    '({ get x() { throw Error("Accessor ran"); } })',
    'new Map()',
  ]) {
    const invalid: unknown = runInNewContext(expression);
    assert.isFalse(checkJson(invalid, '', []));
  }
});

test('new empty projects need no demo, keep independent metadata histories and round trip', async () => {
  const project = new ProjectWorkspace('  Film  ', 'film');
  assert.deepEqual(project.definition, { version: 1, id: 'film', name: 'Film', characters: [], scenes: [] });
  assert.isTrue(project.dirty);
  const exported = await buildProjectPackage(project);
  const other = await importProjectPackage(decodePackageZip(encodePackageZip(exported.files)));
  assert.deepEqual(other.definition, project.definition);
  assert.isFalse(other.dirty);
  assert.isFalse(other.hasUnsavedChanges);
  assert.isFalse(other.history.canUndo);
  assert.isFalse(other.history.canRedo);
  project.rename('Changed');
  assert.equal(other.definition.name, 'Film');
  project.undo();
  assert.equal(project.definition.name, 'Film');
});

test('registration preserves IDs and source bytes, rejects duplicates and supports explicit lookup', async () => {
  const files = await emptyCharacter();
  const original = new Map([...files].map(([path, bytes]) => [path, new Uint8Array(bytes)]));
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(files);
  assert.equal(project.character('hero').definition.id, 'hero');
  assert.equal(project.resolveCharacter(project.characterReference('hero')), 'hero');
  assert.throws(() => project.resolveCharacter('Hero'), /not registered/);
  await expect(project.addCharacter(files)).rejects.toThrow(/Duplicate/);
  assert.equal(project.definition.characters.length, 1);
  assert.deepEqual(files, original);
  files.get('rig.json')!.fill(0);
  assert.notDeepEqual(files.get('rig.json'), project.character('hero').files.get('rig.json'));
  project.undo();
  assert.throws(() => project.character('hero'), /Unknown/);
  project.redo();
  assert.equal(project.character('hero').definition.id, 'hero');
});

test('scene registration validates dependencies without mutating source and protects removal/history', async () => {
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(await emptyCharacter());
  const scene = {
    ...createEmptyScene({ id: 'opening' }),
    actors: [{ id: 'actor', character: { manifest: project.characterReference('hero') }, position: { x: 0, y: 0 } }],
  };
  const source = structuredClone(scene);
  project.addScene(scene);
  project.scenes.updateActor('actor', { position: { x: 30, y: 10 } });
  assert.deepEqual(scene, source);
  assert.throws(() => project.addScene(scene), /Duplicate/);
  assert.throws(() => project.remove('characters', 'hero'), /opening/);
  project.remove('scenes', 'opening');
  project.remove('characters', 'hero');
  project.undo();
  project.undo();
  assert.equal(project.scenes.scene('opening')!.actors[0]!.position.x, 30);
  project.addScene(createEmptyScene({ id: 'other' }));
  assert.isTrue(project.scenes.selectScene('opening'));
  assert.equal(project.scenes.workingScene!.actors[0]!.position.x, 30);
  assert.isTrue(project.scenes.undo());
  assert.equal(project.scenes.workingScene!.actors[0]!.position.x, 0);
  assert.throws(
    () =>
      project.addScene({
        ...scene,
        id: 'bad',
        actors: [{ ...scene.actors[0], character: { manifest: 'missing.json' } }],
      }),
    /not registered/,
  );
});

test('new scene documents start unsaved independently of project metadata', async () => {
  const project = new ProjectWorkspace('Film');
  project.createScene({ id: 'new', name: 'New scene' });
  assert.isTrue(project.scenes.isNewScene);
  assert.isTrue(project.scenes.dirty);
  const captured = await buildProjectPackage(project);
  project.markExported(captured.metadata, captured.characters, captured.scenes);
  assert.isFalse(project.dirty);
  assert.isFalse(project.hasUnsavedChanges);
  assert.isTrue(project.scenes.dirty);
});

test('project undo cannot orphan a character referenced by later scene document edits', async () => {
  const project = new ProjectWorkspace('Film');
  project.addScene(createEmptyScene({ id: 'scene' }));
  await project.addCharacter(await emptyCharacter());
  project.scenes.addActor(project.characterReference('hero'));
  assert.throws(() => project.undo(), /Undo the scene edit first/);
  assert.equal(project.definition.characters.length, 1);
  project.scenes.undo();
  project.undo();
  assert.equal(project.definition.characters.length, 0);
});

test('working owners retain rig and animation edits across project selection, with separate export checkpoints', async () => {
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(await emptyCharacter());
  const entry = project.character('hero');
  const documents = createCharacterDocuments(entry.definition);
  entry.capture = () => ({
    definition: entry.definition,
    rig: documents.rig.recoveryDraft,
    skins: documents.rig.standaloneSkins,
    animations: documents.animation.packageAnimations(),
    replacements: [],
  });
  documents.animation.createAnimation({ name: 'wave' });
  const saved = await buildProjectPackage(project);
  project.markExported(saved.metadata, saved.characters, saved.scenes);
  assert.isFalse(project.hasUnsavedChanges);
  documents.rig.editBone('root', 'x', 45);
  assert.isTrue(project.characterDirty('hero'));
  assert.isFalse(project.dirty);
  let selected = new ProjectWorkspace('Other');
  selected.rename('Other film');
  selected = project;
  assert.equal(selected.captureCharacter('hero').rig.bones[0]!.x, 45);
  const captured = await buildProjectPackage(project);
  documents.rig.editBone('root', 'x', 80);
  project.markExported(captured.metadata, captured.characters, captured.scenes);
  assert.isTrue(project.hasUnsavedChanges);
  documents.rig.undo();
  assert.isFalse(project.hasUnsavedChanges);
  assert.isTrue(documents.rig.dirty); // Project export does not claim the individual rig file was saved.
  const restored = await importProjectPackage(captured.files);
  assert.equal(restored.captureCharacter('hero').rig.bones[0]!.x, 45);
  assert.equal(restored.captureCharacter('hero').animations[0]!.name, 'wave');
});

test('project archives share image bytes, preserve scene links and isolate runtime texture aliases', async () => {
  const assets = artworkFixture();
  const definition = await CharacterLoader.load(
    'https://example.test/scenes/characters/hero/character.json',
    assets.fetcher,
  );
  const first = await packageHostedCharacter(definition, assets.fetcher);
  const second = new Map(first);
  const manifest = JSON.parse(new TextDecoder().decode(second.get('character.json'))) as Record<string, unknown>;
  second.set('character.json', new TextEncoder().encode(JSON.stringify({ ...manifest, id: 'friend' })));
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(first);
  await project.addCharacter(second);
  assert.strictEqual(
    project.character('hero').files.get('images/paper.png'),
    project.character('friend').files.get('images/paper.png'),
  );
  project.addScene({
    ...createEmptyScene({ id: 'scene' }),
    actors: ['hero', 'friend'].map((id) => ({
      id,
      character: { manifest: project.characterReference(id) },
      position: { x: 0, y: 0 },
    })),
  });
  const captured = await buildProjectPackage(project);
  assert.equal([...captured.files.keys()].filter((path) => path.startsWith('assets/')).length, 1);
  assert.notMatch(new TextDecoder().decode(captured.files.get('project.json')), /blob:/);
  const restored = await importProjectPackage(decodePackageZip(encodePackageZip(captured.files)));
  assert.deepEqual(restored.definition, project.definition);
  assert.deepEqual(restored.scenes.workingScene, project.scenes.workingScene);
  const scenePackage = await buildProjectScenePackage(restored, restored.scenes.workingScene!);
  assert.equal((await validateScenePackage(scenePackage)).characters.size, 2);
  const a = await openPackageRuntime(first, new AbortController().signal, 'first');
  const b = await openPackageRuntime(second, new AbortController().signal, 'second');
  assert.notEqual(a.definition.rig.bones[0]!.sprite!.texture, b.definition.rig.bones[0]!.sprite!.texture);
  assert.equal(project.captureCharacter('hero').rig.bones[0]!.sprite!.texture, 'paper');
  a.dispose();
  b.dispose();
});

test('opening editors and pending artwork block package capture without changing checkpoints', async () => {
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(await emptyCharacter());
  const saved = await buildProjectPackage(project);
  project.markExported(saved.metadata, saved.characters, saved.scenes);
  const entry = project.character('hero');
  entry.loading = true;
  await expect(buildProjectPackage(project)).rejects.toThrow(/still opening/);
  entry.loading = false;
  const source = project.captureCharacter('hero');
  entry.capture = () => ({ ...source, pendingArtwork: true });
  await expect(buildProjectPackage(project)).rejects.toThrow(/Apply or cancel/);
  assert.isFalse(project.hasUnsavedChanges);
  delete entry.capture;
  assert.deepEqual((await buildProjectPackage(project)).files, saved.files);
});

test('imported projects with identical IDs retain independent working documents and membership', async () => {
  const original = new ProjectWorkspace('Film', 'film');
  await original.addCharacter(await emptyCharacter());
  original.addScene(createEmptyScene({ id: 'scene' }));
  const archive = await buildProjectPackage(original);
  const a = await importProjectPackage(archive.files);
  const b = await importProjectPackage(archive.files);
  a.scenes.updateProperties({ name: 'A scene' });
  a.remove('characters', 'hero');
  assert.equal(b.scenes.workingScene!.name, 'Untitled Scene');
  assert.equal(b.definition.characters.length, 1);
  assert.isFalse(b.hasUnsavedChanges);
  assert.isTrue(a.hasUnsavedChanges);
});

test('unsafe paths, duplicate references, missing files, wrong IDs and unsupported versions fail import', async () => {
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(await emptyCharacter());
  const captured = await buildProjectPackage(project);
  const rewrite = (
    change: (value: {
      project: { version: number; characters: { id: string; name: string; manifest: string }[] };
      characters: { id: string; files: Record<string, string> }[];
    }) => void,
  ) => {
    const files = new Map(captured.files);
    const value = JSON.parse(new TextDecoder().decode(files.get('project.json'))) as Parameters<typeof change>[0];
    change(value);
    files.set('project.json', new TextEncoder().encode(JSON.stringify(value)));
    return files;
  };
  await expect(
    importProjectPackage(
      rewrite((value) => {
        value.project.version = 2;
      }),
    ),
  ).rejects.toThrow();
  await expect(
    importProjectPackage(
      rewrite((value) => {
        value.characters[0]!.files['rig.json'] = '../private.json';
      }),
    ),
  ).rejects.toThrow(/Invalid package path/);
  await expect(
    importProjectPackage(
      rewrite((value) => {
        value.characters[0]!.files['rig.json'] = 'missing.json';
      }),
    ),
  ).rejects.toThrow(/Missing/);
  await expect(
    importProjectPackage(
      rewrite((value) => {
        value.project.characters[0]!.id = 'other';
      }),
    ),
  ).rejects.toThrow(/Missing character registration/);
  assert.throws(
    () =>
      parseProjectDefinition({
        ...project.definition,
        characters: [project.definition.characters[0], project.definition.characters[0]],
      }),
    /Duplicate/,
  );
  assert.throws(
    () => parseProjectDefinition({ ...project.definition, scenes: [{ id: 'a', path: '../a.json' }] }),
    /Invalid package path/,
  );
  assert.equal(project.definition.characters.length, 1);
});

test.each(['demo-puppet', 'random-paperdoll-sketch'])(
  'existing %s packages retain authored IDs and never mutate source assets',
  async (id) => {
    const fetcher: typeof fetch = (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      try {
        return Promise.resolve(new Response(readFileSync(new URL(`../public${url.pathname}`, import.meta.url))));
      } catch {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
    };
    const definition = await CharacterLoader.load(`https://example.test/characters/${id}/character.json`, fetcher);
    const before = JSON.stringify(definition);
    const files = await packageHostedCharacter(definition, fetcher);
    const project = new ProjectWorkspace('Compatibility');
    await project.addCharacter(files);
    const restored = await importProjectPackage((await buildProjectPackage(project)).files);
    assert.equal(restored.character(id).definition.id, id);
    assert.deepEqual(restored.character(id).definition.rigFile, definition.rigFile);
    assert.deepEqual(restored.character(id).definition.animations, definition.animations);
    assert.equal(JSON.stringify(definition), before);
  },
);
