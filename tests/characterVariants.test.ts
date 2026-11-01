import { assert, expect, test, vi } from 'vitest';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  characterFileFetcher,
  importProjectPackage,
} from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { existingAnimationReference } from '../src/devtools/shared/animationLibraryData.js';
import { buildProjectDraft } from '../src/devtools/shared/autosave/projectDrafts.js';
import {
  buildCharacterPackage,
  validatePackage,
  type PackageFiles,
} from '../src/devtools/shared/package/characterPackage.js';
import { Actor } from '../src/engine/Actor.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import type { RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

async function fixture(mesh = false) {
  const { documents } = artworkFixture();
  const base: RigDefinition = {
    root: 'root',
    bones: [{ id: 'root' }],
    slots: [
      { id: 'body', bone: 'root' },
      { id: 'weapon', bone: 'root' },
    ],
  };
  const red = mesh
    ? createRectangleMeshAttachment({ id: 'red', texture: 'paper' }, { width: 1, height: 1 }, base)
    : { id: 'red', texture: 'paper' };
  const blue = mesh
    ? createRectangleMeshAttachment({ id: 'blue', texture: 'paper' }, { width: 1, height: 1 }, base)
    : { id: 'blue', texture: 'paper', scaleX: 0.75 };
  documents['rig.json'] = {
    version: 1,
    ...base,
    attachments: [red, blue, { id: 'sword', texture: 'paper' }],
    skins: [{ version: 1, name: 'blue', slots: { body: 'blue' } }],
  };
  documents['skins/default.json'] = { version: 1, name: 'default', slots: { body: 'red', weapon: 'sword' } };
  if (mesh)
    documents['animations/wave.json'] = {
      ...(documents['animations/wave.json'] as object),
      deformationTracks: {
        red: [
          { time: 0, offsets: {} },
          { time: 500, offsets: { 'top-left': { x: 0.1, y: 0 } } },
        ],
      },
    };
  const files: PackageFiles = new Map(
    Object.entries(documents).map(([path, data]) => [
      path,
      data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(JSON.stringify(data)),
    ]),
  );
  const workspace = new ProjectWorkspace('Samurai');
  await workspace.addCharacter(files, 'Generic Samurai');
  return workspace;
}

test('variants share live rig and animation ownership, preserve skin fallbacks and never mutate the source', async () => {
  const project = await fixture();
  const before = project.captureCharacter('hero');
  project.createCharacterVariant('hero', 'Blue Armor Samurai', 'blue', 'blue');
  project.createCharacterVariant('blue', 'Another Samurai', 'default', 'other');
  assert.equal(project.rigOwner('other'), 'hero', 'variant sources normalize to one independent owner');
  assert.strictEqual(project.character('blue').files, project.character('hero').files);
  assert.isUndefined(project.character('blue').documents);
  assert.throws(() => project.characterDocuments('blue'), /shared owner|shares its rig/);
  const selected = project.characterDraft('blue');
  assert.strictEqual(selected.rig, project.characterDraft('hero').rig);
  assert.strictEqual(selected.animations, project.characterDraft('hero').animations);
  assert.deepEqual(selected.skins.find((skin) => skin.name === 'blue')!.slots, { body: 'blue', weapon: 'sword' });
  const documents = project.characterDocuments('hero');
  documents.rig.editBone('root', 'x', 42);
  assert.equal(project.captureCharacter('blue').rig.bones[0]!.x, 42);
  const clip = project.animationLibrary().find((entry) => entry.character === 'hero')!;
  assert.equal(existingAnimationReference(clip, project.rigOwner('blue')), 'wave');
  documents.animation.createDerivedAnimation({ name: 'sword-cut', duration: 1000, loop: false, tracks: {} });
  assert.isTrue(project.captureCharacter('blue').animations.some((clip) => clip.name === 'sword-cut'));
  project.setVariantSkin('blue', 'default');
  assert.equal(project.captureCharacter('blue').identity?.defaultSkin, 'default');
  project.undo();
  assert.equal(project.captureCharacter('blue').identity?.defaultSkin, 'blue');
  assert.deepEqual(project.captureCharacter('hero').skins, before.skins);
  assert.deepEqual(project.captureCharacter('hero').rig.skins, before.rig.skins);
  assert.throws(() => project.setVariantSkin('blue', 'missing'), /Unknown appearance/);
  const portable = await validatePackage(
    await buildCharacterPackage(
      project.captureCharacter('blue'),
      characterFileFetcher(project.character('blue').files),
    ),
  );
  assert.equal(portable.id, 'blue');
  assert.equal(portable.defaultSkin, 'blue');
  assert.deepEqual(portable.standaloneSkins.find((skin) => skin.name === 'blue')!.slots, {
    body: 'blue',
    weapon: 'sword',
  });
});

test('independent copies and template instances have new identities, private rigs and shared binary bytes', async () => {
  const project = await fixture();
  project.setCharacterTemplate('hero', true);
  project.createCharacterVariant('hero', 'Blue', 'blue', 'blue');
  const original = project.captureCharacter('hero');
  await project.copyCharacter('blue', 'Private Blue', 'private');
  await project.createCharacterFromTemplate('hero', 'Soldier', 'soldier');
  assert.equal(project.rigOwner('private'), 'private');
  assert.equal(project.rigOwner('soldier'), 'soldier');
  assert.equal(project.character('private').definition.defaultSkin, 'blue');
  assert.strictEqual(
    project.character('private').files.get('images/paper.png'),
    project.character('hero').files.get('images/paper.png'),
  );
  project.characterDocuments('private').rig.editBone('root', 'x', 90);
  project.characterDocuments('hero').rig.editBone('root', 'x', 20);
  assert.equal(project.captureCharacter('soldier').rig.bones[0]!.x ?? 0, 0);
  assert.equal(project.captureCharacter('private').rig.bones[0]!.x, 90);
  assert.deepEqual(project.character('hero').definition.rigFile, original.definition.rigFile);
  const saved = await buildProjectPackage(project);
  assert.lengthOf(
    [...saved.files.keys()].filter((path) => path.startsWith('assets/')),
    1,
  );
  assert.throws(() => project.setCharacterTemplate('blue', true), /independent/);
  await expect(project.createCharacterFromTemplate('private', 'Invalid')).rejects.toThrow(/template/);
  project.remove('characters', 'blue');
  project.remove('characters', 'hero');
  assert.equal(
    project.captureCharacter('soldier').definition.id,
    'soldier',
    'template removal leaves snapshots intact',
  );
});

test('dependency guards protect shared owners and referenced skins across rename, Undo and reset', async () => {
  const project = await fixture();
  const rig = project.characterDocuments('hero').rig;
  rig.createSkin('green');
  project.createCharacterVariant('hero', 'Green', 'green', 'green');
  assert.throws(() => project.remove('characters', 'hero'), /shared-rig variants.*Green/);
  assert.throws(() => rig.renameSkin('green', 'renamed'), /Green/);
  assert.throws(() => rig.undo(), /Skin.*Green/);
  assert.throws(() => rig.resetRig(), /Skin.*Green/);
  assert.isTrue(rig.skins.some((skin) => skin.name === 'green'));
  assert.isTrue(rig.canUndo);
  const revision = project.autosaveRevision;
  project.character('hero').loading = true;
  assert.isUndefined(project.autosaveRevision);
  assert.doesNotThrow(() => project.characterDirty('green'), 'dirty feedback is available while opening the owner');
  assert.throws(() => project.captureCharacter('green'), /opening/);
  project.character('hero').loading = false;
  assert.equal(project.autosaveRevision, revision);
  project.remove('characters', 'green');
  assert.isTrue(rig.undo());
  // Undo of membership removal must not revive a now missing skin.
  assert.throws(() => project.undo(), /skin/i);
});

test('mesh variants preserve attachment topology, weights and corrections without remapping shapes', async () => {
  const project = await fixture(true);
  const source = project.captureCharacter('hero');
  project.createCharacterVariant('hero', 'Blue mesh', 'blue', 'blue');
  assert.lengthOf(project.appearanceWarnings('blue', 'blue'), 2);
  const variant = project.captureCharacter('blue');
  assert.deepEqual(variant.rig.attachments, source.rig.attachments);
  assert.deepEqual(variant.animations[0]!.deformationTracks, source.animations[0]!.deformationTracks);
  assert.isUndefined(variant.animations[0]!.deformationTracks?.blue);
  const rig = project.characterDocuments('hero').rig;
  rig.selectSlot('body');
  rig.selectedMeshVertexId = 'top-left';
  assert.throws(() => rig.deleteSelectedMeshVertex(), /animation|vertex|triangle/i);
  assert.deepEqual(project.captureCharacter('blue').rig.attachments, source.rig.attachments);
  assert.equal(project.inspect('export', true).counts.error, 0);
});

test('export/import and recovery preserve variants, templates and independent scene Actor playback', async () => {
  const project = await fixture();
  project.setCharacterTemplate('hero', true);
  project.createCharacterVariant('hero', 'Blue', 'blue', 'blue');
  project.addScene({
    ...createEmptyScene({ id: 'duel', duration: 1000 }),
    actors: ['hero', 'blue'].map((id, index) => ({
      id,
      character: { manifest: project.characterReference(id) },
      position: { x: index * 100, y: 0 },
      animation: 'wave',
    })),
  });
  for (const files of [(await buildProjectPackage(project)).files, await buildProjectDraft(project)]) {
    const restored = await importProjectPackage(decodePackageZip(encodePackageZip(files)));
    assert.deepEqual(restored.definition, project.definition);
    assert.equal(restored.rigOwner('blue'), 'hero');
    assert.isFalse(restored.hasUnsavedChanges);
    restored.characterDocuments('hero').rig.editBone('root', 'y', 30);
    assert.equal(restored.captureCharacter('blue').rig.bones[0]!.y, 30);
    assert.isTrue(restored.characterDirty('blue'));
    const packaged = await buildProjectScenePackage(restored, restored.scenes.workingScene!);
    const validated = await validateScenePackage(packaged);
    const definitions = validated.characters;
    const runner = new SceneRunner(validated.definition, {
      createActor(data) {
        const definition = definitions.get(data.character.manifest)!;
        return new Actor({
          id: data.id,
          puppet: new Puppet(puppetScene(), { definition, autoUpdate: false }),
          puppetOwnership: 'owned',
        });
      },
    });
    try {
      runner.seek(500);
      const source = runner.actors.get('hero')!.puppet;
      const blue = runner.actors.get('blue')!.puppet;
      assert.notStrictEqual(source, blue);
      assert.equal(source.getBone('root').pose.x, blue.getBone('root').pose.x);
      assert.equal(source.getAttachment('body'), 'red');
      assert.equal(blue.getAttachment('body'), 'blue');
      assert.equal(blue.getAttachment('weapon'), 'sword');
    } finally {
      runner.dispose();
    }
  }
});

test('invalid shared references, nesting and duplicate identities are rejected transactionally', async () => {
  const project = await fixture();
  const before = project.definition;
  assert.throws(() => project.createCharacterVariant('hero', 'Bad', 'missing', 'bad'), /appearance/);
  assert.throws(() => project.createCharacterVariant('hero', 'Duplicate', 'blue', 'hero'), /Duplicate/);
  assert.throws(() => project.createCharacterVariant('hero', 'Reserved', 'blue', '__proto__'), /reserved/);
  assert.deepEqual(project.definition, before);
  project.createCharacterVariant('hero', 'Blue', 'blue', 'blue');
  for (const owner of ['missing', 'blue'])
    assert.throws(
      () =>
        parseProjectDefinition({
          ...project.definition,
          characters: project.definition.characters.map((entry) =>
            entry.id === 'blue' ? { ...entry, variant: { rig: owner, skin: 'blue' } } : entry,
          ),
        }),
      /independent shared rig owner/,
    );
});

test('missing shared animations block scene export and altered materialized rigs cannot silently replace ownership', async () => {
  const project = await fixture();
  project.createCharacterVariant('hero', 'Blue', 'blue', 'blue');
  project.addScene({
    ...createEmptyScene({ id: 'solo' }),
    actors: [
      {
        id: 'blue-actor',
        character: { manifest: project.characterReference('blue') },
        position: { x: 0, y: 0 },
        animation: 'wave',
        skin: 'blue',
      },
    ],
  });
  const source = project.character('hero');
  const snapshot = project.captureCharacter('hero');
  source.capture = () => ({ ...snapshot, animations: [] });
  assert.isTrue(project.inspect('export').issues.some((issue) => /Unknown animation "wave"/.test(issue.message)));
  await expect(buildProjectPackage(project)).rejects.toThrow(/wave/);
  delete source.capture;
  const files = new Map((await buildProjectPackage(project)).files);
  const rigPath = project.characterReference('blue').replace('character.json', 'rig.json');
  const rig = JSON.parse(new TextDecoder().decode(files.get(rigPath))) as { bones: { x?: number }[] };
  rig.bones[0]!.x = 20;
  files.set(rigPath, new TextEncoder().encode(JSON.stringify(rig)));
  await expect(importProjectPackage(files)).rejects.toThrow(/diverged from its shared rig/);
  assert.equal(project.captureCharacter('blue').rig.bones[0]!.x ?? 0, 0);
});

test('mesh variant packages reject incompatible texture dimensions and invalid bone weights', async () => {
  const project = await fixture(true);
  project.createCharacterVariant('hero', 'Blue', 'blue', 'blue');
  const snapshot = project.captureCharacter('blue');
  const files = new Map(await buildCharacterPackage(snapshot, characterFileFetcher(project.character('blue').files)));
  const image = new Uint8Array(files.get('images/paper.png')!);
  new DataView(image.buffer).setUint32(16, 2); // A different-width image cannot fit the existing mesh.
  files.set('images/paper.png', image);
  await expect(validatePackage(files)).rejects.toThrow(/image|dimensions/i);
  const mesh = snapshot.rig.attachments!.find((attachment) => attachment.type === 'mesh')!;
  assert.equal(mesh.type, 'mesh');
  if (mesh.type !== 'mesh') throw new Error('Missing fixture mesh.');
  mesh.vertices[0]!.influences = [{ boneId: 'missing', weight: 1 }];
  await expect(buildCharacterPackage(snapshot, characterFileFetcher(project.character('blue').files))).rejects.toThrow(
    /bone|weight/i,
  );
  assert.equal(
    project.inspect('export', true).counts.error,
    0,
    'invalid detached snapshots do not change shared documents',
  );
});
