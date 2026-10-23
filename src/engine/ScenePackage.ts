import { canonicalJson } from './authoredSerialization.js';
import { characterManifestSchema } from './CharacterDefinition.js';
import { CharacterLoader } from './CharacterLoader.js';
import { CharacterTextureBudget } from './characterTextureLimits.js';
import { DEFAULT_MAX_JSON_BYTES } from './jsonInput.js';
import { packagePath, PACKAGE_MAX_FILE_BYTES, validatePackageFiles } from './packageZip.js';
import { resolveSceneDefinition, type ResolvedScene, type SceneAssetOptions } from './SceneAssets.js';
import { parseSceneDefinition, parseSceneJson, serializeSceneDefinition } from './SceneDefinition.js';
import { readSceneResource } from './sceneResource.js';
import { createSceneTextureBudget } from './sceneTextureBudget.js';

export type ScenePackageFiles = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
const packageBase = 'https://scene-package.invalid/scene.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Resolve only files from the archive. No network fallback, redirects, traversal or URL aliases. */
export async function validateScenePackage(files: ScenePackageFiles, signal?: AbortSignal): Promise<ResolvedScene> {
  signal?.throwIfAborted();
  validatePackageFiles(files);
  const bytes = files.get('scene.json');
  if (!bytes) throw new Error('Missing package file "scene.json".');
  if (bytes.length > DEFAULT_MAX_JSON_BYTES) throw new Error('Scene JSON exceeds the size limit.');
  const scene = parseSceneJson(decoder.decode(bytes));
  for (const actor of scene.actors) {
    packagePath(actor.character.manifest);
    if (!/^characters\/[^/]+\/character\.json$/.test(actor.character.manifest))
      throw new Error(
        `Scene package character must use characters/<folder>/character.json: ${actor.character.manifest}`,
      );
  }
  const fetcher: typeof fetch = (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const bytes =
      url.origin === new URL(packageBase).origin && !url.search && !url.hash
        ? files.get(decodeURIComponent(url.pathname.slice(1)))
        : undefined;
    return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
  };
  const resolved = await resolveSceneDefinition(scene, {
    baseUrl: packageBase,
    fetcher,
    ...(signal ? { signal } : {}),
    loadCharacter: (url) =>
      CharacterLoader.load(url, fetcher, {
        ...(signal ? { signal } : {}),
        pathPolicy: (path) => {
          packagePath(path);
        },
        urlPolicy: (resource) =>
          resource.origin === new URL(packageBase).origin &&
          resource.pathname.startsWith(new URL('.', url).pathname) &&
          !resource.search &&
          !resource.hash,
      }),
  });
  const sceneBudget = createSceneTextureBudget();
  for (const [reference, definition] of resolved.characters) {
    const folder = reference.slice(0, reference.lastIndexOf('/') + 1);
    const budget = new CharacterTextureBudget({ allowWebp: true });
    for (const [key, path] of Object.entries(definition.textures)) {
      const image = files.get(`${folder}${path}`);
      if (!image) throw new Error(`Missing scene package image "${folder}${path}".`);
      budget.checkImage(key, image);
      sceneBudget.checkImage(`${reference}:${key}`, image);
    }
    for (const sprite of [
      ...definition.rig.bones.flatMap((bone) => (bone.sprite ? [bone.sprite] : [])),
      ...definition.rig.attachments,
    ])
      if (sprite.frame !== undefined && sprite.frame !== '__BASE')
        throw new Error(`Scene package images are static; unsupported frame "${sprite.frame}".`);
  }
  signal?.throwIfAborted();
  return resolved;
}

/** Capture detached authored data before I/O. Reuse each referenced package once, including
 * image-path aliases. Character file conventions are identical to character ZIP exports. */
export async function buildScenePackage(input: unknown, options: SceneAssetOptions): Promise<ScenePackageFiles> {
  const resolved = await resolveSceneDefinition(input, options);
  const scene = parseSceneDefinition(resolved.definition);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const allocated = new Map<string, string>();
  const references = new Map<string, string>();
  const add = (path: string, bytes: Uint8Array<ArrayBuffer>): void => {
    packagePath(path);
    if (files.has(path)) throw new Error(`Conflicting scene package file "${path}".`);
    files.set(path, bytes);
    validatePackageFiles(files);
  };
  for (const [reference, definition] of resolved.characters) {
    options.signal?.throwIfAborted();
    const url = new URL(reference, options.baseUrl).href;
    const existing = allocated.get(url);
    if (existing) {
      references.set(reference, existing);
      continue;
    }
    const folder = `characters/character-${allocated.size + 1}/`;
    const manifestPath = `${folder}character.json`;
    allocated.set(url, manifestPath);
    references.set(reference, manifestPath);
    const manifest = characterManifestSchema.parse(definition.manifest);
    const sourcePaths = new Map<string, string>();
    const usedPaths = new Set(['character.json']);
    const relocate = (path: string): string => {
      const source = new URL(path, definition.baseUrl ?? url).href;
      const previous = sourcePaths.get(source);
      if (previous) return previous;
      let target = path.startsWith('../') ? `shared/${path.replace(/^(?:\.\.\/)+/, '')}` : path;
      let index = 0;
      while (usedPaths.has(target.toLowerCase())) target = `shared/resource-${++index}/${path.split('/').at(-1)!}`;
      packagePath(target);
      usedPaths.add(target.toLowerCase());
      sourcePaths.set(source, target);
      return target;
    };
    manifest.rig = relocate(manifest.rig);
    manifest.skins = Object.fromEntries(Object.entries(manifest.skins).map(([name, path]) => [name, relocate(path)]));
    manifest.animations = manifest.animations.map(relocate);
    if (manifest.poses) manifest.poses = manifest.poses.map(relocate);
    manifest.textures = Object.fromEntries(
      Object.entries(manifest.textures).map(([key, path]) => [key, relocate(path)]),
    );
    const json = (path: string, data: unknown): void => add(`${folder}${path}`, encoder.encode(canonicalJson(data)));
    json('character.json', manifest);
    json(manifest.rig, definition.rigFile);
    for (const skin of definition.standaloneSkins) json(manifest.skins[skin.name]!, skin);
    for (const [index, clip] of definition.animations.entries())
      json(manifest.animations[index]!, { ...clip, version: 1 });
    for (const [index, path] of (manifest.poses ?? []).entries()) json(path, definition.poses[index]);
    for (const [key, path] of Object.entries(manifest.textures)) {
      if (files.has(`${folder}${path}`)) continue;
      const image = await readSceneResource(
        definition.textureUrl(key),
        options.fetcher ?? fetch,
        PACKAGE_MAX_FILE_BYTES,
        options.signal,
      );
      add(`${folder}${path}`, image);
    }
  }
  for (const actor of scene.actors) actor.character.manifest = references.get(actor.character.manifest)!;
  add('scene.json', encoder.encode(serializeSceneDefinition(scene)));
  await validateScenePackage(files, options.signal);
  return files;
}
