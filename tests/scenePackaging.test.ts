import { rejects } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assert, test } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { exportSceneJson, importSceneJson, sceneExportFilename } from '../src/devtools/scene-editor/SceneTransfer.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { resolveSceneDefinition } from '../src/engine/SceneAssets.js';
import { parseSceneDefinition, parseSceneJson, serializeSceneDefinition } from '../src/engine/SceneDefinition.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { requestUrl } from './helpers/requestUrl.js';
import { artworkFixture, assetFixture, sceneFixture } from './helpers/scenePackageFixtures.js';

test('scene transfer uses canonical JSON, deduplicates dependencies and owns isolated working data', async () => {
  const assets = assetFixture();
  const source = sceneFixture();
  const document = new SceneEditorDocument();
  const json = serializeSceneDefinition(source);
  assert.isTrue(await importSceneJson(document, json, assets));
  assert.deepEqual(document.workingScene, source);
  assert.notStrictEqual(document.workingScene, source);
  assert.equal(assets.requests.filter((path) => path.endsWith('character.json')).length, 1);
  assert.equal(await exportSceneJson(document.workingScene!, assets), json);
  source.actors[0]!.position.x = 999;
  assert.equal(document.workingScene!.actors[0]!.position.x, 0);
  document.selectActor('hero');
  document.updateActor('hero', { position: { x: 44, y: 12 } });
  assert.isTrue(document.canUndo);
  assert.isTrue(await importSceneJson(document, json, assets, () => true));
  assert.isNull(document.selectedActorId);
  assert.isNull(document.selectedActionId);
  assert.isFalse(document.canUndo);
  assert.isFalse(document.canRedo);
  assert.isFalse(document.dirty);
  assert.equal(document.exportJson(), json);
});

test('failed dependency preflights preserve working copy, selection, dirty baseline and history', async () => {
  const assets = assetFixture();
  const document = new SceneEditorDocument();
  document.importJson(serializeSceneDefinition(sceneFixture()));
  document.selectAction('walk');
  document.updateProperties({ name: 'Edited' });
  const snapshot = document.workingScene;
  const saved = document.sourceScene;
  const invalid = sceneFixture();
  invalid.actors[0]!.skin = 'missing';
  await rejects(
    importSceneJson(document, JSON.stringify(invalid), assets, () => true),
    /Unknown skin/,
  );
  assert.strictEqual(document.workingScene, snapshot);
  assert.strictEqual(document.sourceScene, saved);
  assert.equal(document.selectedActionId, 'walk');
  assert.isTrue(document.dirty);
  assert.isTrue(document.canUndo);
  assert.isTrue(document.undo());
  assert.equal(document.workingScene!.name, 'Untitled Scene');
});

test('dependency resolution rejects missing characters, clips, skins and unsafe character-owned paths', async () => {
  const source = sceneFixture();
  for (const field of ['animation', 'skin'] as const) {
    const input = structuredClone(source);
    input.actors[0]![field] = 'missing';
    await rejects(resolveSceneDefinition(input, assetFixture()), /Unknown/);
  }
  const missingAction = structuredClone(source);
  missingAction.actions[1] = {
    ...missingAction.actions[1]!,
    type: 'animation',
    animation: 'missing',
    duration: 1000,
    loop: false,
    speed: 1,
  };
  await rejects(resolveSceneDefinition(missingAction, assetFixture()), /Unknown animation/);
  const missing = assetFixture();
  delete missing.documents['rig.json'];
  await rejects(resolveSceneDefinition(source, missing), /could not load/);
  const unsafe = assetFixture();
  unsafe.documents['character.json'] = {
    ...(unsafe.documents['character.json'] as object),
    rig: 'assets/../outside.json',
  };
  await rejects(resolveSceneDefinition(source, unsafe), /Invalid package path/);
  assert.equal(unsafe.requests.length, 1);
});

test.each([
  'a/../hero.json',
  'a/%2e%2e/hero.json',
  'a//hero.json',
  'a/./hero.json',
  '/hero.json',
  'https://user:secret@example.test/hero.json',
  'https://example.test/a/../hero.json',
])('scene parsing rejects unsafe reference %s', (manifest) => {
  const scene = sceneFixture();
  scene.actors[0]!.character.manifest = manifest;
  assert.throws(() => parseSceneDefinition(scene));
});

test('ZIP round trips resolve rebased packages, preserve the source and avoid duplicate Actor artwork', async () => {
  const source = sceneFixture();
  const json = serializeSceneDefinition(source);
  const assets = assetFixture();
  const files = await buildScenePackage(source, assets);
  const decoded = decodePackageZip(encodePackageZip(files));
  assert.deepEqual([...decoded.keys()], [...files.keys()]);
  const packaged = await validateScenePackage(decoded);
  assert.equal(packaged.characters.size, 1);
  assert.equal([...files.keys()].filter((path) => path.endsWith('/character.json')).length, 1);
  assert.deepEqual(
    packaged.definition.actors.map((actor) => actor.character.manifest),
    ['characters/character-1/character.json', 'characters/character-1/character.json'],
  );
  assert.deepEqual(packaged.definition.actions, source.actions);
  assert.equal(serializeSceneDefinition(source), json);
  const second = await buildScenePackage(source, assets);
  assert.deepEqual(encodePackageZip(second), encodePackageZip(files));
  const missing = new Map(decoded);
  missing.delete('characters/character-1/animations/wave.json');
  await rejects(validateScenePackage(missing), /could not load/);
  const escaped = new Map(decoded);
  const scene = parseSceneJson(new TextDecoder().decode(escaped.get('scene.json')));
  scene.actors[0]!.character.manifest = '../characters/hero/character.json';
  escaped.set('scene.json', new TextEncoder().encode(serializeSceneDefinition(scene)));
  await rejects(validateScenePackage(escaped), /Invalid package path/);
});

test('package validation rejects unsupported versions and duplicate Actors before resolving dependencies', async () => {
  const files = new Map([['scene.json', new TextEncoder().encode(JSON.stringify({ ...sceneFixture(), version: 99 }))]]);
  await rejects(validateScenePackage(files), /version/i);
  const scene = sceneFixture();
  scene.actors.push(scene.actors[0]!);
  files.set('scene.json', new TextEncoder().encode(JSON.stringify(scene)));
  await rejects(validateScenePackage(files), /Duplicate actor ID/);
});

test('scene filenames remain portable and bounded without changing scene identity', () => {
  assert.equal(sceneExportFilename('CON', 'json'), '_CON.scene.json');
  assert.equal(sceneExportFilename('../../a:b', 'zip'), '.._.._a_b.scene.zip');
  assert.isBelow(sceneExportFilename('x'.repeat(500), 'json').length, 140);
});

test('packages include aliased artwork once and reject missing/corrupt images and traversal before loading', async () => {
  const assets = artworkFixture();
  const files = await buildScenePackage(sceneFixture(), assets);
  const images = [...files.keys()].filter((path) => path.endsWith('.png'));
  assert.equal(images.length, 1);
  assert.equal(assets.requests.filter((path) => path.endsWith('.png')).length, 1);
  const missing = new Map(files);
  missing.delete(images[0]!);
  await rejects(validateScenePackage(missing), /Missing scene package image/);
  const corrupt = new Map(files);
  corrupt.set(images[0]!, new Uint8Array([1, 2, 3]));
  await rejects(validateScenePackage(corrupt), /PNG/);
  const traversal = new Map(files);
  traversal.set('characters/character-1/../outside.json', new Uint8Array([1]));
  await rejects(validateScenePackage(traversal), /Invalid package path/);
});

test('the shipped encounter and sketch shared assets rebase into standalone character packages', async () => {
  const publicRoot = new URL('../public/', import.meta.url);
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(requestUrl(input)).pathname.slice(1);
    return new Response(new Uint8Array(await readFile(new URL(path, publicRoot))));
  };
  const encounter = parseSceneJson(await readFile(new URL('scenes/encounter.scene.json', publicRoot), 'utf8'));
  for (const input of [
    encounter,
    {
      ...sceneFixture(),
      actors: sceneFixture().actors.map((actor) => ({
        ...actor,
        character: { manifest: '../characters/random-paperdoll-sketch/character.json' },
        animation: 'idle',
        skin: 'default',
      })),
      actions: [],
    },
  ]) {
    const files = await buildScenePackage(input, { baseUrl: 'https://assets.test/scene-editor/', fetcher });
    const resolved = await validateScenePackage(decodePackageZip(encodePackageZip(files)));
    assert.equal(resolved.definition.actors.length, 2);
    assert.isTrue([...files.keys()].some((path) => path.includes('/shared/')));
    assert.isFalse([...files.keys()].some((path) => path.includes('../')));
  }
});

test('scene packages resolve portable Unicode metadata filenames without permitting encoded authored aliases', async () => {
  const assets = assetFixture();
  assets.documents['rig-ä.json'] = assets.documents['rig.json'];
  assets.documents['character.json'] = { ...(assets.documents['character.json'] as object), rig: 'rig-ä.json' };
  const files = await buildScenePackage(sceneFixture(), assets);
  assert.isTrue(files.has('characters/character-1/rig-ä.json'));
  const resolved = await validateScenePackage(decodePackageZip(encodePackageZip(files)));
  assert.equal(resolved.characters.size, 1);
});
