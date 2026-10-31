import {
  buildProjectPackage,
  importProjectPackage,
  packageHostedCharacter,
} from '../../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../../src/devtools/project/ProjectWorkspace.js';
import { LocalDraftStore } from '../../src/devtools/shared/autosave/LocalDraftStore.js';
import { buildProjectDraft } from '../../src/devtools/shared/autosave/projectDrafts.js';
import { packageJson } from '../../src/devtools/shared/package/characterPackage.js';
import type { AudioAssetDefinition } from '../../src/engine/AudioAsset.js';
import { canonicalJson } from '../../src/engine/authoredSerialization.js';
import { characterManifestSchema } from '../../src/engine/CharacterDefinition.js';
import { CharacterLoader } from '../../src/engine/CharacterLoader.js';
import { decodePackageZip, encodePackageZip } from '../../src/engine/packageZip.js';
import { createEmptyScene } from '../../src/engine/SceneDefinition.js';
import { silentWav } from './trackedAudioBackend.js';

/** Browser IndexedDB, actual shipped artwork and medium authored documents; no renderer timing here. */
export async function profileProject() {
  const metadataStart = performance.now();
  const definition = await CharacterLoader.load(
    new URL('../characters/demo-puppet/character.json', location.href).href,
  );
  const characterMetadataMs = performance.now() - metadataStart;
  const artworkStart = performance.now();
  const source = await packageHostedCharacter(definition);
  const artworkFetchPackageMs = performance.now() - artworkStart;
  const project = new ProjectWorkspace('Medium production profile');
  const audioAssets: AudioAssetDefinition[] = [
    { id: 'music', name: 'Three minute music', category: 'music', path: 'audio/music.wav', durationSeconds: 180 },
    { id: 'ambient', name: 'Ambience', category: 'ambience', path: 'audio/ambient.wav', durationSeconds: 2 },
  ];
  for (const asset of audioAssets) project.addAudio(asset, silentWav(asset.durationSeconds!));
  // Five distinct characters share artwork; add 256 keys to one clip per character.
  for (let index = 0; index < 5; index++) {
    const files = new Map(source);
    const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
    files.set('character.json', new TextEncoder().encode(JSON.stringify({ ...manifest, id: `profile-${index}` })));
    await project.addCharacter(files);
    const snapshot = project.captureCharacter(`profile-${index}`);
    project.character(`profile-${index}`).capture = () => ({
      ...snapshot,
      animations: [
        ...snapshot.animations,
        {
          name: 'profile-motion',
          duration: 5000,
          loop: true,
          tracks: {
            [definition.rig.root]: Array.from({ length: 256 }, (_, key) => ({
              time: (key * 5000) / 255,
              x: Math.sin(key) * 10,
            })),
          },
        },
      ],
    });
  }
  for (let index = 0; index < 3; index++)
    project.addScene({
      ...createEmptyScene({ id: `scene-${index}`, duration: 5000 }),
      actors: project.definition.characters.map(({ id }, actor) => ({
        id,
        character: { manifest: project.characterReference(id) },
        position: { x: actor * 100, y: 0 },
        animation: 'profile-motion',
      })),
      actions: project.definition.characters.map(({ id }, actor) => ({
        id: `move-${actor}`,
        actorId: id,
        type: 'move' as const,
        time: 0,
        duration: 5000,
        destination: { x: actor * 100 + 100, y: 20 },
      })),
      audioAssets,
      audioTracks: [{ id: 'mix', name: 'Mix', category: 'music' }],
      audioClips: [
        {
          id: 'bed',
          assetId: 'music',
          trackId: 'mix',
          time: 0,
          duration: 5000,
          sourceOffset: 10000,
          volume: 0.2,
          loop: false,
          fadeIn: 500,
          fadeOut: 500,
        },
        {
          id: 'ambient',
          assetId: 'ambient',
          trackId: 'mix',
          time: 0,
          duration: 5000,
          sourceOffset: 200,
          volume: 0.1,
          loop: true,
        },
      ],
      dialogue: [{ id: 'opening', actorId: 'profile-0', text: 'Ready.\n森は静かだった。', time: 500, duration: 2000 }],
    });
  const store = new LocalDraftStore();
  const key = `profile:${crypto.randomUUID()}`;
  const owner = crypto.randomUUID();
  const samples = [];
  let fileCount = 0,
    zipBytes = 0;
  try {
    for (let run = 0; run < 3; run++) {
      const exportStart = performance.now();
      const captured = await buildProjectPackage(project);
      const zip = encodePackageZip(captured.files);
      const exportMs = performance.now() - exportStart;
      fileCount = captured.files.size;
      zipBytes = zip.byteLength;
      const openStart = performance.now();
      const opened = await importProjectPackage(decodePackageZip(zip));
      const openProjectMs = performance.now() - openStart;
      if (canonicalJson(opened.definition) !== canonicalJson(project.definition))
        throw new Error('Project metadata changed.');
      for (const { id } of project.definition.characters) {
        const before = project.captureCharacter(id),
          after = opened.captureCharacter(id);
        if (
          canonicalJson([before.rig, before.animations, before.skins]) !==
          canonicalJson([after.rig, after.animations, after.skins])
        )
          throw new Error('Authored character changed.');
      }
      for (const asset of audioAssets) {
        const original = project.audioSource(asset.id)!.bytes;
        const restored = opened.audioSource(asset.id)!.bytes;
        if (original.length !== restored.length || !original.every((byte, i) => byte === restored[i]))
          throw new Error('Audio binary changed.');
      }
      const saveStart = performance.now();
      await store.save(key, owner, project.definition.name, String(run), await buildProjectDraft(project));
      const autosaveMs = performance.now() - saveStart;
      const recoveryStart = performance.now();
      const latest = (await store.list()).find((entry) => entry.key === key)!;
      const recovered = await importProjectPackage(await store.read(latest.id));
      const recoverMs = performance.now() - recoveryStart;
      if (canonicalJson(recovered.scenes.scene('scene-0')) !== canonicalJson(project.scenes.scene('scene-0')))
        throw new Error('Recovered scene changed.');
      samples.push({ exportMs, openProjectMs, autosaveMs, recoverMs });
    }
    return {
      characters: 5,
      scenes: 3,
      actorsPerScene: 5,
      extraKeysPerCharacter: 256,
      audioAssets: audioAssets.length,
      audioClipsPerScene: 2,
      audioEncodedBytes: audioAssets.reduce((sum, asset) => sum + project.audioSource(asset.id)!.bytes.length, 0),
      bonesPerCharacter: definition.rig.bones.length,
      fileCount,
      zipBytes,
      characterMetadataMs,
      artworkFetchPackageMs,
      samples,
    };
  } finally {
    await store.discard(key, owner);
  }
}
