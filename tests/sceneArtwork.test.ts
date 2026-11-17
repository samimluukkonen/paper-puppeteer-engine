import { assert, expect, test } from 'vitest';
import { sceneDraftSource } from '../src/devtools/project/editorDrafts.js';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
  packageHostedCharacter,
} from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneImageRegistry } from '../src/devtools/scene-editor/SceneImageRegistry.js';
import { importSceneJson } from '../src/devtools/scene-editor/SceneTransfer.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { encodePackageZip, decodePackageZip } from '../src/engine/packageZip.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

function png(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>);
}
async function documentWithImage() {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'forest' });
  const reference = await document.images.add(png(), 'forest.png');
  assert.isTrue(document.addImage(reference));
  return { document, reference };
}

test('background creation, project image selection, immutable Actors and one-step gesture history', async () => {
  const { document, reference } = await documentWithImage();
  document.addActor('../characters/hero/character.json', { x: 12, y: 45 });
  const actors = JSON.stringify(document.workingScene!.actors);
  const original = document.workingScene!.images![0]!;
  assert.isTrue(document.addImage(reference));
  assert.lengthOf(document.images.entries, 1);
  assert.lengthOf(document.workingScene!.images!, 2);
  assert.equal(document.selectedImageId, 'image-2');
  document.beginImageDrag('image-2');
  for (let x = 10; x <= 50; x += 10) document.moveImageDrag({ position: { x, y: 20 }, scale: { x: 2, y: 3 } });
  document.endImageDrag();
  assert.isTrue(document.undo());
  assert.deepEqual(document.workingScene!.images![1]!.position, { x: 0, y: 0 });
  assert.deepEqual(document.workingScene!.images![1]!.scale, { x: 1, y: 1 });
  assert.isTrue(document.redo());
  assert.deepEqual(document.workingScene!.images![1]!.scale, { x: 2, y: 3 });
  document.updateImage('image-2', { visible: false, opacity: 0.5 });
  assert.isFalse(document.workingScene!.images![1]!.visible);
  assert.equal(JSON.stringify(document.workingScene!.actors), actors);
  assert.deepEqual(document.workingScene!.images![0], original);
  document.selectImage('image-1');
  assert.isNull(document.selectedActorId);
  assert.isNull(document.selectedActionId);
});

test('cancelled image gestures preserve redo and scene navigation rolls back the provisional transform', async () => {
  const { document } = await documentWithImage();
  document.updateImage('image-1', { visible: false });
  document.undo();
  const before = document.workingScene;
  document.beginImageDrag('image-1');
  document.moveImageDrag({ position: { x: 100, y: 30 }, scale: { x: 4, y: 2 } });
  assert.isTrue(document.hasOpenOperation);
  document.cancelImageDrag();
  assert.strictEqual(document.workingScene, before);
  assert.isTrue(document.canRedo);
  document.beginImageDrag('image-1');
  document.moveImageDrag({ position: { x: 90, y: 40 }, scale: { x: 1, y: 1 } });
  document.createScene({ id: 'other' });
  assert.strictEqual(document.scene('forest'), before);
});

test('image asset ownership, deduplication, path collisions, header and format checks', async () => {
  const registry = new SceneImageRegistry();
  const bytes = png();
  const reference = await registry.add(bytes, 'first.png');
  assert.equal(await registry.add(bytes, 'same.png'), reference);
  bytes[0] = 0;
  assert.equal(registry.read(reference)[0], 137);
  const detached = registry.read(reference);
  detached[0] = 0;
  assert.equal(registry.read(reference)[0], 137);
  const changed = png();
  changed[changed.length - 1] = 1;
  assert.throws(() => registry.register(reference, changed), /collision/);
  assert.throws(() => registry.register(reference.toUpperCase(), png()), /collision/);
  assert.throws(() => registry.register('../images/wrong.webp', png()), /extension/);
  assert.throws(() => registry.register('../images/empty.png', new Uint8Array()), /header/);
  assert.throws(() => registry.register('../images/a/../bad.png', png()), /stable/);
  const oversized = png();
  new DataView(oversized.buffer).setUint32(16, 9000);
  assert.throws(() => registry.register('../images/huge.png', oversized), /dimension/);
});

test('cleanup protects working, source, saved, undo, redo and active gesture assets', async () => {
  const { document, reference } = await documentWithImage();
  document.images.register('../images/unused.png', png());
  document.removeImage('image-1');
  assert.equal(document.cleanupImages(), 1);
  assert.isTrue(document.images.has(reference));
  document.undo();
  assert.isTrue(document.images.has(document.workingScene!.images![0]!.image));
  document.undo();
  assert.equal(document.cleanupImages(), 0);
  document.redo();
  assert.isTrue(document.validateScene());
});

test('missing image drafts stay editable and production validation prevents exporting them', () => {
  const document = new SceneEditorDocument();
  const draft = {
    ...createEmptyScene({ id: 'draft' }),
    images: [
      {
        id: 'background',
        image: '../images/missing.png',
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        visible: true,
        order: 0,
      },
    ],
  };
  assert.isTrue(document.importJson(JSON.stringify(draft)));
  assert.isTrue(document.updateImage('background', { position: { x: 20, y: 5 } }));
  assert.isFalse(document.validateScene());
  assert.match(document.validationIssues[0]!.message, /Missing image/);
  assert.isTrue(document.removeImage('background'));
  assert.isTrue(document.validateScene());
});

test.each([
  { position: { x: NaN, y: 0 } },
  { scale: { x: 0, y: 1 } },
  { scale: { x: -1, y: 2 } },
  { scale: { x: Infinity, y: 2 } },
  { id: ' ' },
  { image: 'blob:temporary.png' },
  { image: '../images/a.svg' },
  { image: '../images/%61.png' },
  { order: 300 },
  { opacity: 2 },
])('reject invalid image data %j', async (patch) => {
  const { document } = await documentWithImage();
  const scene = document.workingScene!;
  assert.throws(() => parseSceneDefinition({ ...scene, images: [{ ...scene.images![0], ...patch }] }));
});

test('duplicate element IDs rejected; serialization preserves artwork and leaves older scenes unchanged', async () => {
  const older = createEmptyScene({ id: 'old' });
  assert.notProperty(parseSceneJson(serializeSceneDefinition(older)), 'images');
  const { document } = await documentWithImage();
  const scene = document.workingScene!;
  assert.deepEqual(parseSceneJson(document.exportJson()), scene);
  assert.notMatch(document.exportJson(), /blob:|scene_artwork_/);
  assert.throws(
    () => parseSceneDefinition({ ...scene, images: [scene.images![0], scene.images![0]] }),
    /Duplicate image/,
  );
});

test('project export/import and standalone scene ZIP preserve artwork and binary identity', async () => {
  const workspace = new ProjectWorkspace('Film');
  workspace.createScene({ id: 'forest' });
  const reference = await workspace.scenes.images.add(png(), 'forest.png');
  workspace.scenes.addImage(reference);
  workspace.scenes.updateImage('image-1', { position: { x: -200, y: 80 }, scale: { x: 3, y: 2 }, visible: false });
  const before = workspace.autosaveRevision;
  const captured = await buildProjectPackage(workspace);
  const restored = await importProjectPackage(decodePackageZip(encodePackageZip(captured.files)));
  assert.deepEqual(restored.definition, workspace.definition);
  assert.deepEqual(restored.scenes.workingScene, workspace.scenes.workingScene);
  assert.deepEqual(restored.scenes.images.read(reference), png());
  assert.equal(workspace.autosaveRevision, before);
  const packaged = await buildProjectScenePackage(workspace, workspace.scenes.workingScene!);
  const standalone = await validateScenePackage(packaged);
  assert.equal(standalone.definition.images![0]!.image, 'images/image-1.png');
  assert.deepEqual(standalone.images!.get('images/image-1.png'), png());
  assert.equal(workspace.scenes.workingScene!.images![0]!.image, reference);
  workspace.markExported(captured.metadata, captured.characters, captured.scenes);
  assert.isFalse(workspace.hasUnsavedChanges);
  workspace.scenes.updateImage('image-1', { visible: true });
  assert.isTrue(workspace.hasUnsavedChanges);
  assert.notEqual(workspace.autosaveRevision, before);
});

test('scene artwork shares character image binaries in project ZIPs without changing rig attachments', async () => {
  const assets = artworkFixture();
  const definition = await CharacterLoader.load(
    new URL('characters/hero/character.json', assets.baseUrl).href,
    assets.fetcher,
  );
  const workspace = new ProjectWorkspace('Film');
  await workspace.addCharacter(await packageHostedCharacter(definition, assets.fetcher));
  const rig = JSON.stringify(workspace.captureCharacter('hero').rig);
  workspace.createScene({ id: 'forest' });
  workspace.scenes.addActor(workspace.characterReference('hero'));
  const reference = await workspace.scenes.images.add(png(), 'existing paper');
  workspace.scenes.addImage(reference);
  const { files } = await buildProjectPackage(workspace);
  assert.equal([...files.values()].filter((bytes) => bytes.length === png().length).length, 1);
  assert.equal(JSON.stringify(workspace.captureCharacter('hero').rig), rig);
  const restored = await importProjectPackage(files);
  assert.deepEqual(restored.scenes.images.read(reference), png());
});

test('standalone scene packaging, import and autosave recovery preserve background assets', async () => {
  const { document, reference } = await documentWithImage();
  const options = { baseUrl: 'https://example.test/scenes/scene.json', loadImage: () => Promise.resolve(png()) };
  const files = await buildScenePackage(document.workingScene, options);
  const resolved = await validateScenePackage(files);
  assert.lengthOf([...resolved.images!], 1);
  const imported = new SceneEditorDocument();
  assert.isTrue(await importSceneJson(imported, document.exportJson(), options));
  assert.deepEqual(imported.images.read(reference), png());
  const registry = new SceneCharacterRegistry();
  const draft = sceneDraftSource(document, registry, 'draft')!;
  const restored = await importProjectPackage(await draft.build());
  assert.deepEqual(restored.scenes.workingScene, document.workingScene);
  assert.deepEqual(restored.scenes.images.read(reference), png());
  registry.dispose();
  const missing = new Map(files);
  missing.delete('images/image-1.png');
  await expect(validateScenePackage(missing)).rejects.toThrow();
});

test('project validation reports missing artwork and duplicate image registrations', async () => {
  const { document } = await documentWithImage();
  const workspace = new ProjectWorkspace('Film');
  workspace.createScene({ id: 'forest' });
  workspace.scenes.replaceScene(document.workingScene);
  assert.isAbove(workspace.inspect('export', true).counts.error, 0);
  await expect(buildProjectPackage(workspace)).rejects.toThrow(/Missing image/);
  const image = { id: 'one', name: 'Forest', path: 'images/forest.png' };
  assert.throws(() => parseProjectDefinition({ ...workspace.definition, images: [image, image] }), /Duplicate/);
});

test.each(['images/hosted.png', 'https://art.example.test/forest.png'])(
  'hosted artwork reference %s becomes portable on JSON import and autosave',
  async (reference) => {
    const { document } = await documentWithImage();
    const input = parseSceneDefinition(document.workingScene);
    input.images![0]!.image = reference;
    const imported = new SceneEditorDocument();
    assert.isTrue(
      await importSceneJson(imported, serializeSceneDefinition(input), {
        baseUrl: 'https://example.test/scenes/scene.json',
        loadImage: () => Promise.resolve(png()),
      }),
    );
    assert.match(imported.workingScene!.images![0]!.image, /^\.\.\/images\/[a-f0-9]+\.png$/);
    const registry = new SceneCharacterRegistry();
    const draft = sceneDraftSource(imported, registry, 'hosted-recovery')!;
    const restored = await importProjectPackage(await draft.build());
    assert.deepEqual(restored.scenes.workingScene, imported.workingScene);
    registry.dispose();
  },
);
