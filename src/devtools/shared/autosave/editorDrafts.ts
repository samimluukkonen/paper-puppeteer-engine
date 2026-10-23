import { canonicalJson } from '../../../engine/authoredSerialization.js';
import { characterManifestSchema } from '../../../engine/CharacterDefinition.js';
import { parseSceneDefinition } from '../../../engine/SceneDefinition.js';
import { buildProjectPackage, packageHostedCharacter } from '../../project/projectPackage.js';
import { ProjectWorkspace } from '../../project/ProjectWorkspace.js';
import type { SceneCharacterRegistry } from '../../scene-editor/SceneCharacterRegistry.js';
import type { SceneEditorDocument } from '../../scene-editor/SceneEditorDocument.js';
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
export async function buildCharacterDraft(input: PackageSnapshot, id: string, signal?: AbortSignal) {
  const snapshot = capturePackage(input);
  const workspace = new ProjectWorkspace(snapshot.rig.name ?? snapshot.definition.id, id);
  await workspace.addCharacter(await buildCharacterPackage(snapshot, undefined, signal));
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
          actors: scene.actors.map((actor) => ({
            ...actor,
            character: { manifest: references.get(actor.character.manifest)! },
          })),
        });
      return (await buildProjectPackage(workspace, signal)).files;
    },
  };
}
