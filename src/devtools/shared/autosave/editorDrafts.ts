import { canonicalJson } from '../../../engine/authoredSerialization.js';
import { parseSceneDefinition } from '../../../engine/SceneDefinition.js';
import { buildProjectPackage, packageHostedCharacter } from '../../project/projectPackage.js';
import { ProjectWorkspace } from '../../project/ProjectWorkspace.js';
import type { SceneCharacterRegistry } from '../../scene-editor/SceneCharacterRegistry.js';
import type { SceneEditorDocument } from '../../scene-editor/SceneEditorDocument.js';
import { buildCharacterPackage, capturePackage, type PackageSnapshot } from '../package/characterPackage.js';

/** Standalone drafts use the same complete portable project payload as project recovery. */
export async function buildCharacterDraft(input: PackageSnapshot, id: string) {
  const snapshot = capturePackage(input);
  const workspace = new ProjectWorkspace(snapshot.rig.name ?? snapshot.definition.id, id);
  await workspace.addCharacter(await buildCharacterPackage(snapshot));
  return (await buildProjectPackage(workspace)).files;
}

export function sceneDraftSource(document: SceneEditorDocument, registry: SceneCharacterRegistry, id: string) {
  if (!document.sceneIds.length || document.hasOpenOperation) return undefined;
  const scenes = document.sceneIds.map((id) => document.scene(id)!);
  return {
    name: scenes[0]!.name,
    revision: canonicalJson(scenes),
    dirty: document.hasUnsavedChanges,
    build: async () => {
      // All retained scene snapshots are immutable and captured before dependency reads.
      const workspace = new ProjectWorkspace(scenes[0]!.name, id);
      const references = new Map<string, string>();
      for (const scene of scenes)
        for (const actor of scene.actors) {
          const reference = actor.character.manifest;
          if (references.has(reference)) continue;
          const definition = await registry.load(reference);
          const characterId = await workspace.addCharacter(await packageHostedCharacter(definition));
          references.set(reference, workspace.characterReference(characterId));
        }
      for (const scene of scenes)
        workspace.addScene({
          ...parseSceneDefinition(scene),
          actors: scene.actors.map((actor) => ({
            ...actor,
            character: { manifest: references.get(actor.character.manifest)! },
          })),
        });
      return (await buildProjectPackage(workspace)).files;
    },
  };
}
