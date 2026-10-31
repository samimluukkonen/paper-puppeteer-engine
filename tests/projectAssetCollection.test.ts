import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import { buildProjectPackage, packageHostedCharacter } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import { buildCharacterPackage } from '../src/devtools/shared/package/characterPackage.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

const audio = { id: 'tone', name: 'Tone', path: 'audio/tone.wav', category: 'sfx' as const };
const audioBytes = () => new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));
async function characterFiles(id = 'hero') {
  const { definition } = createNewCharacter({ id, name: 'Hero' });
  return buildCharacterPackage({
    definition,
    rig: definition.rigFile!,
    skins: definition.standaloneSkins,
    animations: [],
    replacements: [],
  });
}
function expireMembership(project: ProjectWorkspace) {
  for (let index = 0; index < 105; index++) project.rename(`Film ${index}`);
}

test('removed audio is retained until its last membership snapshot expires, then its ID can be reused', () => {
  const project = new ProjectWorkspace('Film');
  project.addAudio(audio, audioBytes());
  project.removeAudio(audio.id);
  for (let index = 0; index < 99; index++) project.rename(`Film ${index}`);
  expect(() => project.addAudio(audio, audioBytes())).toThrow(/retained by project history/);
  project.rename('History expired');
  expect(project.history.retainedSnapshots.every((snapshot) => !snapshot.audio?.length)).toBe(true);
  expect(() => project.addAudio(audio, audioBytes())).not.toThrow();
  expect(project.audioSource(audio.id)!.bytes).toEqual(audioBytes());
});

test('redo retains owners until a changed edit discards the branch', async () => {
  const project = new ProjectWorkspace('Film');
  const files = await characterFiles();
  await project.addCharacter(files);
  const documents = project.characterDocuments('hero');
  const dispose = vi.spyOn(documents.artwork, 'dispose');
  project.undo();
  project.rename('Film'); // A no-op must preserve redo and its resources.
  await expect(project.addCharacter(files)).rejects.toThrow(/retained by project history/);
  expect(dispose).not.toHaveBeenCalled();
  project.redo();
  expect(project.characterDocuments('hero')).toBe(documents);
  project.undo();
  project.rename('New branch');
  expect(dispose).toHaveBeenCalledTimes(1);
  await expect(project.addCharacter(files)).resolves.toBe('hero');
  expect(project.characterDocuments('hero')).not.toBe(documents);
});

test('shared artwork survives one owner and is released after the final character owner expires', async () => {
  const assets = artworkFixture();
  const definition = await CharacterLoader.load(
    'https://example.test/scenes/characters/hero/character.json',
    assets.fetcher,
  );
  const files = await packageHostedCharacter(definition, assets.fetcher);
  const friend = new Map(files);
  const manifest = JSON.parse(new TextDecoder().decode(files.get('character.json'))) as object;
  friend.set('character.json', new TextEncoder().encode(JSON.stringify({ ...manifest, id: 'friend' })));
  const project = new ProjectWorkspace('Film');
  await project.addCharacter(files);
  await project.addCharacter(friend);
  const bytes = project.character('hero').files.get('images/paper.png');
  const dispose = vi.spyOn(project.characterDocuments('hero').artwork, 'dispose');
  expect(project.character('friend').files.get('images/paper.png')).toBe(bytes);
  project.remove('characters', 'hero');
  expireMembership(project);
  expect(dispose).toHaveBeenCalledTimes(1);
  await project.addCharacter(files);
  expect(project.character('hero').files.get('images/paper.png')).toBe(bytes);
  project.remove('characters', 'hero');
  project.remove('characters', 'friend');
  expireMembership(project);
  await project.addCharacter(files);
  expect(project.character('hero').files.get('images/paper.png')).not.toBe(bytes);
});

test('new characters cannot reuse retained manifest paths and keep unrelated removed owners alive', async () => {
  const project = new ProjectWorkspace('Film');
  const hero = await characterFiles();
  await project.addCharacter(hero);
  const reference = project.characterReference('hero');
  const dispose = vi.spyOn(project.characterDocuments('hero').artwork, 'dispose');
  project.remove('characters', 'hero');
  await project.addCharacter(await characterFiles('friend'));
  expect(project.characterReference('friend')).not.toBe(reference);
  project.createScene({ id: 'scene' });
  expect(project.scenes.addActor(project.characterReference('friend'))).toBe(true);
  expireMembership(project);
  expect(dispose).toHaveBeenCalledOnce();
  await expect(project.addCharacter(hero)).resolves.toBe('hero');
});

test('removed scene owners preserve document history for undo, then release selection and session state', () => {
  const project = new ProjectWorkspace('Film');
  project.createScene({ id: 'scene' });
  project.scenes.updateProperties({ name: 'Edited scene' });
  project.scenes.groundGuide.update({ y: 123 });
  project.remove('scenes', 'scene');
  project.undo();
  expect(project.scenes.scene('scene')!.name).toBe('Edited scene');
  expect(project.scenes.undo()).toBe(true);
  project.redo();
  expireMembership(project);
  expect(project.scenes.scene('scene')).toBeUndefined();
  expect(project.scenes.selectedSceneId).toBeNull();
  expect(project.scenes.groundGuide.getSnapshot().workspaceId).toBeNull();
  expect(project.scenes.groundGuide.getSnapshot().canUndo).toBe(false);
  expect(() => project.createScene({ id: 'scene' })).not.toThrow();
  expect(project.scenes.canUndo).toBe(false);
  expect(project.scenes.groundGuide.getSnapshot().canUndo).toBe(false);
});

test('project export checkpoints retain removed assets until a newer checkpoint replaces them', async () => {
  const project = new ProjectWorkspace('Film');
  const files = await characterFiles();
  await project.addCharacter(files);
  project.addAudio(audio, audioBytes());
  project.createScene({ id: 'scene' });
  const saved = await buildProjectPackage(project);
  project.markExported(saved.metadata, saved.characters, saved.scenes);
  const dispose = vi.spyOn(project.characterDocuments('hero').artwork, 'dispose');
  project.remove('characters', 'hero');
  project.removeAudio(audio.id);
  project.remove('scenes', 'scene');
  expireMembership(project);
  expect(dispose).not.toHaveBeenCalled();
  expect(project.scenes.scene('scene')).toBeDefined();
  await expect(project.addCharacter(files)).rejects.toThrow(/retained by project history/);
  expect(() => project.addAudio(audio, audioBytes())).toThrow(/retained by project history/);
  const next = await buildProjectPackage(project);
  project.markExported(next.metadata, next.characters, next.scenes);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(project.scenes.scene('scene')).toBeUndefined();
  await expect(project.addCharacter(files)).resolves.toBe('hero');
  expect(() => project.addAudio(audio, audioBytes())).not.toThrow();
});

test.each(['source', 'saved', 'undo', 'redo', 'operation'] as const)(
  'scene %s references retain characters and audio after project history expires',
  async (root) => {
    const project = new ProjectWorkspace('Film');
    const files = await characterFiles();
    await project.addCharacter(files);
    project.addAudio(audio, audioBytes());
    project.createScene({ id: 'scene' });
    const empty = project.scenes.workingScene!;
    const referenced = {
      ...empty,
      actors: [{ id: 'actor', character: { manifest: project.characterReference('hero') }, position: { x: 0, y: 0 } }],
      audioAssets: [{ ...audio, path: `../${audio.path}` }],
      audioTracks: [{ id: 'sfx', name: 'Effects', category: 'sfx' }],
      audioClips: [
        {
          id: 'clip',
          assetId: 'tone',
          trackId: 'sfx',
          time: 0,
          duration: 1000,
          sourceOffset: 0,
          volume: 1,
          loop: false,
        },
      ],
    };
    const installed =
      root === 'source'
        ? project.scenes.importJson(JSON.stringify(referenced), { confirmDiscard: () => true })
        : project.scenes.replaceScene(referenced);
    expect(installed, JSON.stringify(project.scenes.validationIssues)).toBe(true);
    if (root === 'saved') project.scenes.markSaved();
    if (root === 'operation') expect(project.scenes.beginActorDrag('actor')).toBe(true);
    if (root === 'redo') expect(project.scenes.undo()).toBe(true);
    else expect(project.scenes.replaceScene(empty)).toBe(true);
    if (root === 'source' || root === 'saved')
      for (let index = 0; index < 105; index++) project.scenes.updateProperties({ name: `Scene ${index}` });
    project.remove('characters', 'hero');
    project.removeAudio(audio.id);
    expireMembership(project);
    await expect(project.addCharacter(files)).rejects.toThrow(/retained by project history/);
    expect(() => project.addAudio(audio, audioBytes())).toThrow(/retained by project history/);
    // Replacing the document drops its source, checkpoint, histories and any active operation.
    expect(project.scenes.importJson(JSON.stringify(empty), { confirmDiscard: () => true })).toBe(true);
    await expect(project.addCharacter(files)).resolves.toBe('hero');
    expect(() => project.addAudio(audio, audioBytes())).not.toThrow();
  },
);

test('scene history expiry releases dependencies without another project membership edit', async () => {
  const project = new ProjectWorkspace('Film');
  const files = await characterFiles();
  await project.addCharacter(files);
  project.addAudio(audio, audioBytes());
  project.createScene({ id: 'scene' });
  project.scenes.addActor(project.characterReference('hero'));
  project.scenes.removeActor(project.scenes.selectedActorId!);
  project.scenes.addAudioTrack('sfx');
  project.scenes.addAudioClip({
    assetId: 'tone',
    trackId: 'sfx-1',
    time: 0,
    duration: 1000,
    sourceOffset: 0,
    volume: 1,
    loop: false,
  });
  project.scenes.removeAudioClip(project.scenes.selectedAudioClip!.id);
  project.remove('characters', 'hero');
  project.removeAudio(audio.id);
  expireMembership(project);
  await expect(project.addCharacter(files)).rejects.toThrow(/retained by project history/);
  expect(() => project.addAudio(audio, audioBytes())).toThrow(/retained by project history/);
  for (let index = 0; index < 105; index++) project.scenes.updateProperties({ name: `Scene ${index}` });
  await expect(project.addCharacter(files)).resolves.toBe('hero');
  expect(() => project.addAudio(audio, audioBytes())).not.toThrow();
});

test('resetting imported membership history collects owners outside the imported baseline', async () => {
  const project = new ProjectWorkspace('Film');
  const files = await characterFiles();
  const baseline = parseProjectDefinition(project.definition);
  await project.addCharacter(files);
  project.addAudio(audio, audioBytes());
  project.createScene({ id: 'scene' });
  project.installImportedMetadata(baseline);
  expect(project.scenes.sceneIds).toEqual([]);
  expect(project.history.canUndo).toBe(false);
  await expect(project.addCharacter(files)).resolves.toBe('hero');
  expect(() => project.addAudio(audio, audioBytes())).not.toThrow();
});
