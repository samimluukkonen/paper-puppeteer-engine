import { z } from 'zod';
import { canonicalJson } from '../../engine/authoredSerialization.js';
import { characterManifestSchema, type CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { assertJsonInputSize } from '../../engine/jsonInput.js';
import { packagePath, validatePackageFiles } from '../../engine/packageZip.js';
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
});
const encoder = new TextEncoder();

/** Normalize hosted sibling artwork through the existing scene packager, preserving source IDs. */
export async function packageHostedCharacter(
  definition: CharacterDefinition,
  fetcher: typeof fetch = fetch,
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
export async function buildProjectPackage(workspace: ProjectWorkspace) {
  const report = workspace.inspect('export', true);
  requireValidExport(report);
  const metadata = parseProjectDefinition(workspace.definition);
  const characters = new Map(metadata.characters.map(({ id }) => [id, workspace.captureCharacter(id)]));
  const sources = new Map(
    metadata.characters.map(({ id }) => [id, characterFileFetcher(workspace.character(id).files)]),
  );
  const scenes = metadata.scenes.map(({ id }) => workspace.validateScene(workspace.scenes.scene(id)));
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const sharedImages = new Map<string, string>();
  const records: z.infer<typeof archiveSchema>['characters'] = [];
  const json = (path: string, data: unknown): void => {
    files.set(path, encoder.encode(canonicalJson(data)));
  };
  for (const entry of metadata.characters) {
    const captured = characters.get(entry.id)!;
    const packaged = await buildCharacterPackage(captured, sources.get(entry.id)).catch((error: unknown) => {
      throw packageExportFailure(report, { kind: 'character', owner: entry.id, id: entry.id }, error);
    });
    const textures = new Set(Object.values(captured.definition.manifest!.textures));
    // New artwork can add new paths; inspect the exported manifest, not just its source.
    const exportedManifest = archiveCharacterManifest(packaged);
    for (const path of Object.values(exportedManifest.textures)) textures.add(path);
    const mapping: Record<string, string> = Object.create(null) as Record<string, string>;
    const prefix = entry.manifest.slice(0, entry.manifest.lastIndexOf('/') + 1);
    for (const [path, bytes] of packaged) {
      let target = `${prefix}${path}`;
      if (textures.has(path)) {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        target =
          sharedImages.get(digest) ??
          `assets/image-${sharedImages.size + 1}.${path.toLowerCase().endsWith('.webp') ? 'webp' : 'png'}`;
        sharedImages.set(digest, target);
      }
      if (files.has(target) && !textures.has(path)) throw new Error(`Project file collision at "${target}".`);
      files.set(target, bytes);
      mapping[path] = target;
    }
    records.push({ id: entry.id, files: mapping });
  }
  metadata.scenes.forEach((entry, index) => {
    files.set(entry.path, encoder.encode(serializeSceneDefinition(scenes[index]!)));
  });
  json('project.json', { project: metadata, characters: records });
  try {
    validatePackageFiles(files);
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
export async function importProjectPackage(files: PackageFiles): Promise<ProjectWorkspace> {
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
  const workspace = new ProjectWorkspace(metadata.name, metadata.id);
  for (const entry of metadata.characters) {
    const record = archive.characters.find(({ id }) => id === entry.id);
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
    const id = await workspace.addCharacter(characterFiles, entry.name);
    if (id !== entry.id) throw new Error(`Character ID mismatch for "${entry.id}".`);
  }
  // Install the original reference paths before resolving scene dependencies.
  workspace.installImportedMetadata({ ...metadata, scenes: [] });
  for (const entry of metadata.scenes) {
    const bytes = files.get(entry.path);
    if (!bytes) throw new Error(`Missing scene "${entry.path}".`);
    const scene = parseSceneJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (scene.id !== entry.id) throw new Error(`Scene ID mismatch for "${entry.id}".`);
    workspace.addScene(scene);
  }
  workspace.installImportedMetadata(metadata);
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
  for (const [id, snapshot] of captures) {
    const packaged = await buildCharacterPackage(snapshot, characterFileFetcher(workspace.character(id).files)).catch(
      (error: unknown) => {
        throw packageExportFailure(report, { kind: 'character', owner: id, id }, error);
      },
    );
    const reference = workspace.characterReference(id);
    const prefix = reference.slice(0, reference.lastIndexOf('/') + 1);
    for (const [path, bytes] of packaged) files.set(`${prefix}${path}`, bytes);
  }
  files.set('scene.json', encoder.encode(serializeSceneDefinition(scene)));
  await validateScenePackage(files).catch((error: unknown) => {
    throw packageExportFailure(report, { kind: 'scene', owner: scene.id, id: scene.id }, error);
  });
  return files;
}
