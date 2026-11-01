import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { buildScenePackage } from '../src/engine/ScenePackage.js';
import { buildStoryPackage, validateStoryPackage } from '../src/engine/StoryPackage.js';
import { artworkFixture, sceneFixture } from './helpers/scenePackageFixtures.js';

async function fixture() {
  const assets = artworkFixture();
  const a = sceneFixture();
  const b = { ...sceneFixture(), id: 'second' };
  const audio = new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));
  for (const scene of [a, b]) {
    scene.audioAssets = [{ id: 'tone', name: 'Tone', path: 'audio/tone.wav', category: 'music' }];
    scene.audioTracks = [{ id: 'music', name: 'Music', category: 'music' }];
    scene.audioClips = [
      {
        id: 'music',
        assetId: 'tone',
        trackId: 'music',
        time: 0,
        duration: 100,
        sourceOffset: 0,
        volume: 1,
        loop: false,
      },
    ];
  }
  const scenes = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const story = {
    version: 1,
    id: 'film',
    name: 'Film',
    scenes: [
      { id: 'one', sceneAssetId: a.id },
      { id: 'two', sceneAssetId: b.id, transition: { type: 'fade', duration: 400, color: '#123456' } },
      { id: 'three', sceneAssetId: a.id },
    ],
  };
  const files = await buildStoryPackage(story, {
    scenes,
    buildScene: (scene) => buildScenePackage(scene, { ...assets, loadAudio: () => Promise.resolve(audio) }),
  });
  return { files, story };
}

test('story ZIP round trip retains ordered repeated scenes, shared character/animation and audio once', async () => {
  const { files, story } = await fixture();
  const imported = await validateStoryPackage(decodePackageZip(encodePackageZip(files)));
  expect(imported.definition).toEqual(story);
  expect(imported.scenes.size).toBe(2);
  const [a, b] = [...imported.scenes.values()];
  expect(a!.actors[0]!.character.manifest).toBe(b!.actors[0]!.character.manifest);
  expect([...files.keys()].filter((path) => path.endsWith('/character.json'))).toHaveLength(1);
  expect([...files.keys()].filter((path) => path.startsWith('assets/'))).toHaveLength(2); // PNG + WAV, aliases share bytes.
  expect([...imported.files.keys()].some((path) => path.endsWith('animations/wave.json'))).toBe(true);
  expect(imported.files.get(a!.audioAssets![0]!.path)).toBe(imported.files.get(b!.audioAssets![0]!.path));
});

test.each(['scene', 'character', 'animation', 'texture', 'audio', 'unsupportedAudio', 'transition', 'alias'] as const)(
  'rejects broken story %s before activation',
  async (kind) => {
    const { files } = await fixture();
    const broken = new Map(files);
    const manifest = JSON.parse(new TextDecoder().decode(broken.get('story.json'))) as {
      story: { scenes: { transition?: unknown }[] };
      scenes: { path: string }[];
      aliases: Record<string, string>;
    };
    if (kind === 'scene') broken.delete(manifest.scenes[0]!.path);
    if (kind === 'character') broken.delete([...broken.keys()].find((path) => path.endsWith('/character.json'))!);
    if (kind === 'unsupportedAudio')
      broken.set(
        [...broken.keys()].find((path) => path.endsWith('.wav'))!,
        new Uint8Array([1, 2, 3]),
      );
    if (kind === 'animation') broken.delete([...broken.keys()].find((path) => path.endsWith('animations/wave.json'))!);
    if (kind === 'texture' || kind === 'audio') {
      const key = Object.keys(manifest.aliases).find((path) =>
        kind === 'texture' ? path.endsWith('.png') : path.endsWith('.wav'),
      )!;
      broken.delete(manifest.aliases[key]!);
    }
    if (kind === 'transition') manifest.story.scenes[1]!.transition = { type: 'fade', duration: -1, color: 'black' };
    if (kind === 'alias') manifest.aliases['../escape.png'] = 'assets/missing.png';
    broken.set('story.json', new TextEncoder().encode(JSON.stringify(manifest)));
    await expect(validateStoryPackage(broken)).rejects.toThrow();
  },
);

test('missing character, unsupported image/audio formats and mismatched scene IDs fail validation', async () => {
  const { files } = await fixture();
  for (const path of [
    [...files.keys()].find((path) => path.endsWith('/character.json'))!,
    [...files.keys()].find((path) => path.startsWith('assets/') && path.endsWith('.png'))!,
  ]) {
    const broken = new Map(files);
    broken.set(path, new TextEncoder().encode('{}'));
    await expect(validateStoryPackage(broken)).rejects.toThrow();
  }
  const scene = createEmptyScene({ id: 'wrong' });
  const broken = new Map(files);
  broken.set('scenes/scene-1.json', new TextEncoder().encode(JSON.stringify(scene)));
  await expect(validateStoryPackage(broken)).rejects.toThrow(/ID mismatch/);
});
