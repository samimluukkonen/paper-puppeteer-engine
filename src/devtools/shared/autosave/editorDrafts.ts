import { canonicalJson } from '../../../engine/authoredSerialization.js';
import { characterManifestSchema } from '../../../engine/CharacterDefinition.js';
import { freezeData, type DeepReadonly } from '../../../engine/readonlyData.js';
import { parseSceneDefinition } from '../../../engine/SceneDefinition.js';
import { buildProjectPackage, packageHostedCharacter } from '../../project/projectPackage.js';
import { ProjectWorkspace } from '../../project/ProjectWorkspace.js';
import type { SceneCharacterRegistry } from '../../scene-editor/SceneCharacterRegistry.js';
import type { SceneEditorDocument } from '../../scene-editor/SceneEditorDocument.js';
import type { SceneImageRegistry } from '../../scene-editor/SceneImageRegistry.js';
import { animationPreviewPreferencesSchema } from '../animationPreviewPreferences.js';
import type { AnimationPreviewPreferences } from '../animationPreviewPreferences.js';
import { draftSource } from '../draftSource.js';
import {
  buildCharacterPackage,
  capturePackage,
  packageJson,
  type PackageFiles,
  type PackageSnapshot,
} from '../package/characterPackage.js';
import { sceneFingerprint } from '../sceneFingerprint.js';

function samePackage(first: PackageFiles, second: PackageFiles): boolean {
  return (
    first.size === second.size &&
    [...first].every(([path, bytes]) => {
      const other = second.get(path);
      return other?.length === bytes.length && bytes.every((byte, index) => byte === other[index]);
    })
  );
}

/** Standalone drafts use the same complete portable project payload as project recovery. */
export async function buildCharacterDraft(
  input: PackageSnapshot,
  id: string,
  signal?: AbortSignal,
  preview?: { preferences: DeepReadonly<AnimationPreviewPreferences>; images: SceneImageRegistry },
) {
  const snapshot = capturePackage(input);
  // Capture metadata and binaries before the asynchronous character package work.
  const preferences = preview && freezeData(animationPreviewPreferencesSchema.parse(preview.preferences));
  const images = preview?.images.entries.map((image) => ({ ...image, bytes: preview.images.read(image.reference) }));
  const workspace = new ProjectWorkspace(snapshot.rig.name ?? snapshot.definition.id, id);
  await workspace.addCharacter(await buildCharacterPackage(snapshot, undefined, signal));
  if (preferences) workspace.setAnimationPreviewPreferences(snapshot.definition.id, preferences);
  for (const image of images ?? []) workspace.scenes.images.register(image.reference, image.bytes, image.name);
  return (await buildProjectPackage(workspace, signal)).files;
}

export function sceneDraftSource(document: SceneEditorDocument, registry: SceneCharacterRegistry, id: string) {
  if (!document.sceneIds.length || document.hasOpenOperation) return undefined;
  const scenes = document.sceneIds.map((id) => document.scene(id)!);
  return {
    name: scenes[0]!.name,
    revision: draftSource(scenes.map(sceneFingerprint)),
    dirty: document.hasUnsavedChanges,
    build: async (signal?: AbortSignal) => {
      // All retained scene snapshots are immutable and captured before dependency reads.
      const workspace = new ProjectWorkspace(scenes[0]!.name, id);
      const referencesToImages = new Set(scenes.flatMap((scene) => scene.images?.map((image) => image.image) ?? []));
      for (const reference of referencesToImages)
        workspace.scenes.images.register(
          reference,
          document.images.read(reference),
          document.images.entries.find((asset) => asset.reference === reference)?.name,
        );
      const audioAliases = new Map<string, { id: string; path: string }>();
      const reservedAudioIds = new Set(
        scenes.flatMap((scene) => (scene.audioAssets ?? []).map((asset) => asset.id.toLowerCase())),
      );
      const usedAudioIds = new Set<string>();
      for (const scene of scenes)
        for (const asset of scene.audioAssets ?? []) {
          if (!scene.audioClips?.some((clip) => clip.assetId === asset.id)) continue;
          const key = JSON.stringify([asset.id, asset.path]);
          if (audioAliases.has(key)) continue;
          let id = asset.id;
          if (usedAudioIds.has(id.toLowerCase())) {
            let index = 2;
            do {
              id = `${asset.id.slice(0, 170)}-recovery-${index++}`;
            } while (reservedAudioIds.has(id.toLowerCase()));
            reservedAudioIds.add(id.toLowerCase());
          }
          usedAudioIds.add(id.toLowerCase());
          const path = `audio/recovery-${audioAliases.size + 1}.${asset.path.split('.').at(-1)!}`;
          workspace.addAudio({ ...asset, id, path }, document.readAudio(asset.path));
          audioAliases.set(key, { id, path: `../${path}` });
        }
      const references = new Map<string, string>();
      const manifests = [...new Set(scenes.flatMap((scene) => scene.actors.map((actor) => actor.character.manifest)))];
      const definitions = new Map<string, Awaited<ReturnType<typeof registry.load>>>();
      for (const reference of manifests) {
        signal?.throwIfAborted();
        definitions.set(reference, await registry.load(reference));
      }
      // Reserve all source IDs before allocating recovery-only aliases, including later packages.
      const reserved = new Set([...definitions.values()].map((definition) => definition.id.toLowerCase()));
      const packages = new Map<string, { files: PackageFiles; reference: string }[]>();
      for (const [reference, definition] of definitions) {
        signal?.throwIfAborted();
        const files = await packageHostedCharacter(definition, undefined, signal);
        const identity = definition.id.toLowerCase();
        const previous = packages.get(identity) ?? [];
        const equivalent = previous.find((entry) => samePackage(entry.files, files));
        if (equivalent) {
          references.set(reference, equivalent.reference);
          continue;
        }
        let owned = files;
        if (previous.length) {
          let index = 2;
          let alias: string;
          do {
            alias = `${definition.id.slice(0, 170)}-recovery-${index++}`;
          } while (reserved.has(alias.toLowerCase()));
          reserved.add(alias.toLowerCase());
          const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
          owned = new Map(files).set(
            'character.json',
            new TextEncoder().encode(canonicalJson({ ...manifest, id: alias })),
          );
        }
        const characterId = await workspace.addCharacter(owned);
        const target = workspace.characterReference(characterId);
        previous.push({ files, reference: target });
        packages.set(identity, previous);
        references.set(reference, target);
      }
      for (const scene of scenes)
        workspace.addScene({
          ...parseSceneDefinition(scene),
          ...(scene.audioAssets
            ? {
                audioAssets: scene.audioAssets
                  .filter((asset) => scene.audioClips?.some((clip) => clip.assetId === asset.id))
                  .map((asset) => ({ ...asset, ...audioAliases.get(JSON.stringify([asset.id, asset.path]))! })),
              }
            : {}),
          ...(scene.audioClips
            ? {
                audioClips: scene.audioClips.map((clip) => {
                  const asset = scene.audioAssets!.find((asset) => asset.id === clip.assetId)!;
                  return { ...clip, assetId: audioAliases.get(JSON.stringify([asset.id, asset.path]))!.id };
                }),
              }
            : {}),
          actors: scene.actors.map((actor) => ({
            ...actor,
            character: { manifest: references.get(actor.character.manifest)! },
          })),
        });
      return (await buildProjectPackage(workspace, signal)).files;
    },
  };
}
