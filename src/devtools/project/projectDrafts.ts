import { canonicalJson, validatePackageFiles, serializeSceneDefinition } from '../../engine/core.js';
import type { SceneImageRegistry } from '../scene-editor/SceneImageRegistry.js';
import { CharacterDraftSerializer, type PackageFiles } from '../shared/package/characterPackage.js';
import { sceneFingerprint } from '../shared/sceneFingerprint.js';
import { parseProjectDefinition, type ProjectDefinition } from './ProjectDefinition.js';
import { characterFileFetcher } from './projectPackage.js';
import type { ProjectCharacter, ProjectWorkspace } from './ProjectWorkspace.js';

const encoder = new TextEncoder();
const images = new WeakMap<SceneImageRegistry, { revision: number; files: PackageFiles }>();

/** Registries own immutable bytes; take detached copies only when asset membership changes. */
export function draftImages(registry: SceneImageRegistry): PackageFiles {
  const revision = registry.getSnapshot();
  const previous = images.get(registry);
  if (previous?.revision === revision) return previous.files;
  const files = new Map(registry.entries.map(({ reference }) => [reference, registry.read(reference)]));
  images.set(registry, { revision, files });
  return files;
}

/** Recovery uses the portable archive layout without export preparation or asset decoding. */
export function assembleProjectDraft(
  metadata: ProjectDefinition,
  characters: ReadonlyMap<string, PackageFiles>,
  resources: PackageFiles,
): PackageFiles {
  const files = new Map(resources);
  const add = (path: string, bytes: Uint8Array<ArrayBuffer>): void => {
    if (files.has(path)) throw new Error(`Project file collision at "${path}".`);
    files.set(path, bytes);
  };
  const records = metadata.characters.map((entry) => {
    const mapping: Record<string, string> = Object.create(null) as Record<string, string>;
    const prefix = entry.manifest.slice(0, entry.manifest.lastIndexOf('/') + 1);
    for (const [path, bytes] of characters.get(entry.id)!) {
      const target = path === 'character.json' ? entry.manifest : `${prefix}${path}`;
      add(target, bytes);
      mapping[path] = target;
    }
    return { id: entry.id, files: mapping };
  });
  add('project.json', encoder.encode(canonicalJson({ project: metadata, characters: records })));
  validatePackageFiles(files);
  return files;
}

class ProjectDraftSerializer {
  private readonly characters = new WeakMap<ProjectCharacter, CharacterDraftSerializer>();
  private readonly scenes = new Map<string, { revision: string; bytes: Uint8Array<ArrayBuffer> }>();
  private readonly audio = new Map<string, Uint8Array<ArrayBuffer>>();

  async build(workspace: ProjectWorkspace, signal?: AbortSignal): Promise<PackageFiles> {
    signal?.throwIfAborted();
    if (workspace.autosaveRevision === undefined) throw new Error('Finish pending edits before saving a draft.');
    const report = workspace.inspect('draft');
    if (report.counts.error)
      throw new Error(
        `Local draft validation failed: ${report.issues
          .filter(({ severity }) => severity === 'error')
          .map(({ message }) => message)
          .join('\n')}`,
      );
    const metadata = parseProjectDefinition(workspace.definition);
    const resources = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const [reference, bytes] of draftImages(workspace.scenes.images)) resources.set(reference.slice(3), bytes);
    for (const { id, path } of metadata.scenes) {
      const scene = workspace.scenes.scene(id)!;
      const revision = sceneFingerprint(scene);
      let cached = this.scenes.get(id);
      if (cached?.revision !== revision) {
        cached = { revision, bytes: encoder.encode(serializeSceneDefinition(scene)) };
        this.scenes.set(id, cached);
      }
      resources.set(path, cached.bytes);
    }
    for (const { id, path } of metadata.audio ?? []) {
      let bytes = this.audio.get(id);
      if (!bytes) {
        bytes = workspace.audioSource(id)!.bytes;
        this.audio.set(id, bytes);
      }
      resources.set(path, bytes);
    }
    // Every character build detaches mutable input synchronously, before any await.
    const pending = metadata.characters.map(({ id }) => {
      const entry = workspace.character(id);
      let serializer = this.characters.get(entry);
      if (!serializer) this.characters.set(entry, (serializer = new CharacterDraftSerializer(entry)));
      return serializer.build(workspace.characterDraft(id), characterFileFetcher(entry.files), signal, {
        metadataValidated: true, // The revision-cached project inspection above checked these authored domains.
      });
    });
    const packaged = await Promise.all(pending);
    signal?.throwIfAborted();
    return assembleProjectDraft(
      metadata,
      new Map(metadata.characters.map(({ id }, index) => [id, packaged[index]!])),
      resources,
    );
  }
}

const projects = new WeakMap<ProjectWorkspace, ProjectDraftSerializer>();

export function buildProjectDraft(workspace: ProjectWorkspace, signal?: AbortSignal): Promise<PackageFiles> {
  let serializer = projects.get(workspace);
  if (!serializer) projects.set(workspace, (serializer = new ProjectDraftSerializer()));
  return serializer.build(workspace, signal);
}
