import { z } from 'zod';
import { validateAudioAssetData } from '../../engine/AudioAsset.js';
import { AudioAssetLoader, type AudioBackend } from '../../engine/AudioAssetLoader.js';
import { canonicalJson } from '../../engine/authoredSerialization.js';
import { characterManifestSchema, type CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { decodeImage } from '../../engine/decodeImage.js';
import { assertJsonInputSize } from '../../engine/jsonInput.js';
import { PACKAGE_MAX_BYTES, packagePath, validatePackageFiles } from '../../engine/packageZip.js';
import { parseSceneJson, serializeSceneDefinition } from '../../engine/SceneDefinition.js';
import { buildScenePackage, validateScenePackage } from '../../engine/ScenePackage.js';
import type { ReadonlyScene } from '../scene-editor/SceneEditorDocument.js';
import {
  buildCharacterPackage,
  packageJson,
  type PackageFiles,
  type PackageSnapshot,
} from '../shared/package/characterPackage.js';
import { parseProjectDefinition, projectDefinitionSchema } from './ProjectDefinition.js';
import { packageExportFailure, requireValidExport } from './projectInspection.js';
import { ProjectWorkspace } from './ProjectWorkspace.js';

const archiveSchema = z.strictObject({
  project: projectDefinitionSchema,
  characters: z.array(z.strictObject({ id: z.string(), files: z.record(z.string(), z.string()) })),
  images: z.record(z.string(), z.string()).exactOptional(),
});
const encoder = new TextEncoder();

/** Resolve aliases and bound the complete expanded project before any owner copies bytes. */
function preflightProjectFiles(
  files: PackageFiles,
  metadata: z.infer<typeof projectDefinitionSchema>,
  records: z.infer<typeof archiveSchema>['characters'],
  images: Record<string, string> = {},
): ReadonlyMap<string, PackageFiles> {
  let expandedBytes = files.get('project.json')?.byteLength ?? 0;
  const count = (bytes: Uint8Array): void => {
    expandedBytes += bytes.byteLength;
    if (expandedBytes > PACKAGE_MAX_BYTES) throw new Error('Expanded project resources exceed 100 MiB.');
  };
  const characters = new Map<string, PackageFiles>();
  const registrations = new Map(records.map((record) => [record.id, record]));
  for (const entry of metadata.characters) {
    const record = registrations.get(entry.id);
    if (!record) throw new Error(`Missing character registration "${entry.id}".`);
    const characterFiles = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const [local, physical] of Object.entries(record.files)) {
      packagePath(local);
      packagePath(physical);
      const bytes = files.get(physical);
      if (!bytes) throw new Error(`Missing project resource "${physical}".`);
      characterFiles.set(local, bytes);
    }
    if (record.files['character.json'] !== entry.manifest) throw new Error('Character manifest path mismatch.');
    validatePackageFiles(characterFiles);
    for (const bytes of characterFiles.values()) count(bytes);
    characters.set(entry.id, characterFiles);
  }
  for (const image of metadata.images ?? []) {
    const bytes = files.get(packagePath(images[image.path] ?? image.path));
    // Missing optional preview images retain the importer's existing repair behavior.
    if (bytes) count(bytes);
  }
  for (const scene of metadata.scenes) {
    const bytes = files.get(scene.path);
    if (bytes) count(bytes);
  }
  for (const audio of metadata.audio ?? []) {
    const bytes = files.get(audio.path);
    if (!bytes) throw new Error(`Missing audio binary "${audio.path}". Reimport the original audio file.`);
    validateAudioAssetData(audio, bytes);
    count(bytes);
  }
  return characters;
}

/** Normalize hosted sibling artwork through the existing scene packager, preserving source IDs. */
export async function packageHostedCharacter(
  definition: CharacterDefinition,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PackageFiles> {
  const files = await buildScenePackage(
    {
      version: 2,
      id: 'transfer',
      name: 'Transfer',
      duration: 1000,
      actors: [{ id: 'actor', character: { manifest: 'character.json' }, position: { x: 0, y: 0 } }],
      actions: [],
    },
    {
      baseUrl: definition.baseUrl ?? 'https://project.invalid/scene.json',
      fetcher,
      loadCharacter: () => Promise.resolve(definition),
      ...(signal ? { signal } : {}),
    },
  );
  const prefix = 'characters/character-1/';
  return new Map(
    [...files].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes]),
  );
}

export function characterFileFetcher(files: PackageFiles): typeof fetch {
  return (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const bytes =
      url.origin === 'https://character-package.invalid' && !url.search && !url.hash
        ? files.get(decodeURIComponent(url.pathname.slice(1)))
        : undefined;
    return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
  };
}

/** Capture all authored domains synchronously before the first image read. */
export async function buildProjectPackage(workspace: ProjectWorkspace, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const report = workspace.inspect('export', true);
  requireValidExport(report);
  const metadata = parseProjectDefinition(workspace.definition);
  const characters = new Map(metadata.characters.map(({ id }) => [id, workspace.captureCharacter(id)]));
  const imageAssets = new Map(
    workspace.scenes.images.entries.map((image) => [image.reference, workspace.scenes.images.read(image.reference)]),
  );
  const audioAssets = new Map(
    (metadata.audio ?? []).map((entry) => [entry.path, workspace.audioSource(entry.id)!.bytes]),
  );
  const sources = new Map(
    metadata.characters.map(({ id }) => [id, characterFileFetcher(workspace.character(id).files)]),
  );
  const scenes = metadata.scenes.map(({ id }) => workspace.validateScene(workspace.scenes.scene(id)));
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const sharedImages = new Map<string, string>();
  const records: z.infer<typeof archiveSchema>['characters'] = [];
  const add = (path: string, bytes: Uint8Array<ArrayBuffer>, shared = false): void => {
    if (files.has(path) && !shared) throw new Error(`Project file collision at "${path}".`);
    files.set(path, bytes);
  };
  const json = (path: string, data: unknown): void => {
    add(path, encoder.encode(canonicalJson(data)));
  };
  for (const entry of metadata.characters) {
    signal?.throwIfAborted();
    const captured = characters.get(entry.id)!;
    const packaged = await buildCharacterPackage(captured, sources.get(entry.id), signal).catch((error: unknown) => {
      throw packageExportFailure(report, { kind: 'character', owner: entry.id, id: entry.id }, error);
    });
    const textures = new Set(Object.values(captured.definition.manifest!.textures));
    // New artwork can add new paths; inspect the exported manifest, not just its source.
    const exportedManifest = archiveCharacterManifest(packaged);
    for (const path of Object.values(exportedManifest.textures)) textures.add(path);
    const mapping: Record<string, string> = Object.create(null) as Record<string, string>;
    const prefix = entry.manifest.slice(0, entry.manifest.lastIndexOf('/') + 1);
    for (const [path, bytes] of packaged) {
      let target = path === 'character.json' ? entry.manifest : `${prefix}${path}`;
      let shared = false;
      if (textures.has(path)) {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        const previous = sharedImages.get(digest);
        shared = previous !== undefined;
        target =
          previous ?? `assets/image-${sharedImages.size + 1}.${path.toLowerCase().endsWith('.webp') ? 'webp' : 'png'}`;
        sharedImages.set(digest, target);
      }
      add(target, bytes, shared);
      mapping[path] = target;
    }
    records.push({ id: entry.id, files: mapping });
  }
  const imageMapping: Record<string, string> = {};
  for (const image of metadata.images ?? []) {
    const bytes = imageAssets.get(`../${image.path}`);
    if (!bytes) throw new Error(`Missing project image "${image.path}".`);
    if (typeof Image !== 'undefined') {
      const decoded = await decodeImage(bytes, signal ?? new AbortController().signal);
      decoded.dispose();
    }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const physical = sharedImages.get(digest) ?? image.path;
    add(physical, bytes, sharedImages.has(digest));
    sharedImages.set(digest, physical);
    imageMapping[image.path] = physical;
  }
  metadata.scenes.forEach((entry, index) => {
    add(entry.path, encoder.encode(serializeSceneDefinition(scenes[index]!)));
  });
  for (const [path, bytes] of audioAssets) add(path, bytes);
  json('project.json', {
    project: metadata,
    characters: records,
    ...(Object.keys(imageMapping).length ? { images: imageMapping } : {}),
  });
  try {
    validatePackageFiles(files);
    preflightProjectFiles(files, metadata, records, imageMapping);
  } catch (error) {
    throw packageExportFailure(report, { kind: 'project', owner: metadata.id, id: metadata.id }, error);
  }
  return { files, metadata, characters, scenes };
}

function archiveCharacterManifest(files: PackageFiles) {
  // Keep validation at the established character boundary.
  return characterManifestSchema.parse(packageJson(files, 'character.json'));
}

/** Transactional import: no active project is touched until every document/dependency validates. */
export async function importProjectPackage(
  files: PackageFiles,
  options: { audioBackend?: AudioBackend; signal?: AbortSignal } = {},
): Promise<ProjectWorkspace> {
  options.signal?.throwIfAborted();
  validatePackageFiles(files);
  const manifestBytes = files.get('project.json');
  if (!manifestBytes) throw new Error('Missing project.json.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  assertJsonInputSize(text);
  const archive = archiveSchema.parse(JSON.parse(text) as unknown);
  const metadata = parseProjectDefinition(archive.project);
  if (
    archive.characters.length !== metadata.characters.length ||
    new Set(archive.characters.map(({ id }) => id)).size !== archive.characters.length
  )
    throw new Error('Project character registrations do not match the manifest.');
  const characters = preflightProjectFiles(files, metadata, archive.characters, archive.images);
  const workspace = new ProjectWorkspace(metadata.name, metadata.id);
  // Headless callers can inject a decoder; browser imports always check actual codec support.
  const audioLoader =
    options.audioBackend || typeof AudioContext !== 'undefined'
      ? new AudioAssetLoader(() => undefined, options.audioBackend)
      : undefined;
  const audioDurations = new Map<string, number>();
  try {
    for (const entry of metadata.audio ?? []) {
      options.signal?.throwIfAborted();
      const bytes = files.get(entry.path)!; // Complete binary presence was preflighted before allocating copies.
      if (audioLoader) {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        let duration = audioDurations.get(digest);
        if (duration === undefined) {
          const decoded = await audioLoader.prepare(bytes, options.signal ?? AbortSignal.timeout(60_000));
          duration = decoded.durationSeconds;
          audioDurations.set(digest, duration);
          audioLoader.clear();
        }
        // The decoder owns duration; an archive cannot override it with stale metadata.
        options.signal?.throwIfAborted();
        workspace.addAudio({ ...entry, durationSeconds: duration }, bytes);
      } else workspace.addAudio(entry, bytes);
    }
  } finally {
    audioLoader?.dispose();
  }
  for (const entry of metadata.characters) {
    options.signal?.throwIfAborted();
    const id = await workspace.addCharacter(characters.get(entry.id)!, entry.name);
    if (id !== entry.id) throw new Error(`Character ID mismatch for "${entry.id}".`);
  }
  const previewImages = new Set(
    Object.values(metadata.editorPreferences?.animationPreview ?? {}).map(
      (preferences) => preferences.environment.image,
    ),
  );
  for (const image of metadata.images ?? []) {
    options.signal?.throwIfAborted();
    const physical = packagePath(archive.images?.[image.path] ?? image.path);
    const bytes = files.get(physical);
    if (!bytes) {
      // An optional preview reference may be repaired in the editor; scene dependencies still validate below.
      if (previewImages.has(`../${image.path}`)) continue;
      throw new Error(`Missing project image "${image.path}".`);
    }
    workspace.scenes.images.register(`../${image.path}`, bytes, image.name);
    if (typeof Image !== 'undefined') {
      const decoded = await decodeImage(bytes, options.signal ?? new AbortController().signal);
      decoded.dispose();
    }
  }
  // Install the original reference paths before resolving scene dependencies.
  const importedMetadata = parseProjectDefinition({
    ...metadata,
    ...(metadata.audio ? { audio: workspace.definition.audio! } : {}),
  });
  workspace.installImportedMetadata({ ...importedMetadata, scenes: [] });
  for (const entry of metadata.scenes) {
    options.signal?.throwIfAborted();
    const bytes = files.get(entry.path);
    if (!bytes) throw new Error(`Missing scene "${entry.path}".`);
    const scene = parseSceneJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (scene.id !== entry.id) throw new Error(`Scene ID mismatch for "${entry.id}".`);
    workspace.addScene(scene);
  }
  workspace.installImportedMetadata(importedMetadata);
  options.signal?.throwIfAborted();
  return workspace;
}

export type ProjectExport = { readonly characters: ReadonlyMap<string, PackageSnapshot> };

/** Standalone scene packages use the established scene ZIP layout and validator. */
export async function buildProjectScenePackage(
  workspace: ProjectWorkspace,
  input: ReadonlyScene,
): Promise<PackageFiles> {
  const report = workspace.inspect('export', true, parseSceneJson(JSON.stringify(input)));
  requireValidExport(report);
  const scene = workspace.validateScene(input);
  const captures = new Map(
    [...new Set(scene.actors.map((actor) => workspace.resolveCharacter(actor.character.manifest)))].map((id) => [
      id,
      workspace.captureCharacter(id),
    ]),
  );
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const references = new Map<string, string>();
  for (const [id, snapshot] of captures) {
    const packaged = await buildCharacterPackage(snapshot, characterFileFetcher(workspace.character(id).files)).catch(
      (error: unknown) => {
        throw packageExportFailure(report, { kind: 'character', owner: id, id }, error);
      },
    );
    const reference = workspace.characterReference(id);
    // A project may register custom manifest paths. Standalone scene ZIPs have
    // their own confined character.json layout, independent of project storage.
    const prefix = `characters/character-${references.size + 1}/`;
    references.set(reference, `${prefix}character.json`);
    for (const [path, bytes] of packaged) files.set(`${prefix}${path}`, bytes);
  }
  const images = new Map<string, string>();
  for (const image of scene.images ?? []) {
    let path = images.get(image.image);
    if (!path) {
      path = `images/image-${images.size + 1}.${image.image.toLowerCase().endsWith('.webp') ? 'webp' : 'png'}`;
      images.set(image.image, path);
      files.set(path, workspace.scenes.images.read(image.image));
    }
    image.image = path;
  }
  for (const actor of scene.actors) actor.character.manifest = references.get(actor.character.manifest)!;
  files.set('scene.json', encoder.encode(serializeSceneDefinition(scene)));
  await validateScenePackage(files).catch((error: unknown) => {
    throw packageExportFailure(report, { kind: 'scene', owner: scene.id, id: scene.id }, error);
  });
  return files;
}
