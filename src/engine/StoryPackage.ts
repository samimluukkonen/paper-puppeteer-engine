import { z } from 'zod';
import { canonicalJson } from './authoredSerialization.js';
import { assertJsonInputSize } from './jsonInput.js';
import { packagePath, validatePackageFiles } from './packageZip.js';
import { parseSceneJson, serializeSceneDefinition, type SceneDefinition } from './SceneDefinition.js';
import { validateScenePackage, type ScenePackageFiles } from './ScenePackage.js';
import { parseStoryDefinition, storyDefinitionSchema, type StoryDefinition } from './StoryDefinition.js';

const manifestSchema = z.strictObject({
  version: z.literal(1),
  story: storyDefinitionSchema,
  scenes: z.array(z.strictObject({ id: z.string().min(1), path: z.string().min(1) })).max(4000),
  aliases: z.record(z.string(), z.string()),
});
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export interface StoryPackage {
  readonly definition: StoryDefinition;
  readonly scenes: ReadonlyMap<string, SceneDefinition>;
  /** Logical paths expanded to shared immutable bytes; aliases never copy binary content. */
  readonly files: ScenePackageFiles;
}
export async function packageContentDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Reuse scene export dependency traversal, then merge characters and identical binary content. */
export async function buildStoryPackage(
  input: unknown,
  options: {
    scenes: ReadonlyMap<string, unknown>;
    buildScene: (scene: SceneDefinition) => Promise<ScenePackageFiles>;
    signal?: AbortSignal;
  },
): Promise<ScenePackageFiles> {
  const story = parseStoryDefinition(input, { scenes: options.scenes, requirePlayable: true });
  // Capture every scene before the first asynchronous exporter, so edits cannot mix revisions.
  const sources = new Map(
    [...new Set(story.scenes.map((entry) => entry.sceneAssetId))].map((id) => [
      id,
      parseSceneJson(JSON.stringify(options.scenes.get(id))),
    ]),
  );
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const aliases: Record<string, string> = Object.create(null) as Record<string, string>;
  const binaries = new Map<string, string>();
  const characters = new Map<string, string>();
  const scenes: { id: string; path: string }[] = [];
  const add = async (path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
    packagePath(path);
    if (files.has(path) || Object.hasOwn(aliases, path)) throw new Error(`Conflicting story file "${path}".`);
    if (path.endsWith('.json')) files.set(path, bytes);
    else {
      const digest = await packageContentDigest(bytes);
      let target = binaries.get(digest);
      if (!target) {
        target = `assets/asset-${binaries.size + 1}.${path.split('.').at(-1)!}`;
        binaries.set(digest, target);
        files.set(target, bytes);
      }
      aliases[path] = target;
    }
  };
  for (const [id, source] of sources) {
    options.signal?.throwIfAborted();
    const packed = await options.buildScene(source);
    const resolved = await validateScenePackage(packed, options.signal);
    const scene = parseSceneJson(JSON.stringify(resolved.definition));
    const references = new Map<string, string>();
    for (const reference of resolved.characters.keys()) {
      const folder = reference.slice(0, reference.lastIndexOf('/') + 1);
      const resources = [...packed].filter(([path]) => path.startsWith(folder)).sort(([a], [b]) => a.localeCompare(b));
      const signature = JSON.stringify(
        await Promise.all(
          resources.map(async ([path, bytes]) => [path.slice(folder.length), await packageContentDigest(bytes)]),
        ),
      );
      let target = characters.get(signature);
      if (!target) {
        target = `characters/character-${characters.size + 1}/`;
        characters.set(signature, target);
        for (const [path, bytes] of resources) await add(`${target}${path.slice(folder.length)}`, bytes);
      }
      references.set(reference, `${target}character.json`);
    }
    for (const actor of scene.actors) actor.character.manifest = references.get(actor.character.manifest)!;
    const images = new Map<string, string>();
    for (const image of scene.images ?? []) {
      let target = images.get(image.image);
      if (!target) {
        target = `images/scene-${scenes.length + 1}-image-${images.size + 1}.${image.image.split('.').at(-1)!}`;
        images.set(image.image, target);
        await add(target, packed.get(image.image)!);
      }
      image.image = target;
    }
    for (const [index, asset] of (scene.audioAssets ?? []).entries()) {
      const target = `audio/scene-${scenes.length + 1}-audio-${index + 1}.${asset.path.split('.').at(-1)!}`;
      await add(target, packed.get(asset.path)!);
      asset.path = target;
    }
    const path = `scenes/scene-${scenes.length + 1}.json`;
    files.set(path, encoder.encode(serializeSceneDefinition(scene)));
    scenes.push({ id, path });
  }
  files.set('story.json', encoder.encode(canonicalJson({ version: 1, story, scenes, aliases })));
  await validateStoryPackage(files, options.signal);
  return files;
}

/** Confined, transactional import; all dependencies validate before any renderer is touched. */
export async function validateStoryPackage(files: ScenePackageFiles, signal?: AbortSignal): Promise<StoryPackage> {
  signal?.throwIfAborted();
  validatePackageFiles(files);
  const bytes = files.get('story.json');
  if (!bytes) throw new Error('Missing package file "story.json".');
  const text = decoder.decode(bytes);
  assertJsonInputSize(text);
  const manifest = manifestSchema.parse(JSON.parse(text) as unknown);
  const expanded = new Map(files);
  for (const [logical, physical] of Object.entries(manifest.aliases)) {
    packagePath(logical);
    packagePath(physical);
    if (expanded.has(logical)) throw new Error(`Conflicting story alias "${logical}".`);
    const resource = files.get(physical);
    if (!resource || Object.hasOwn(manifest.aliases, physical))
      throw new Error(`Missing story resource "${physical}".`);
    expanded.set(logical, resource);
  }
  // Bound expanded aliases too; small archives cannot amplify into unbounded scene resources.
  validatePackageFiles(expanded);
  const scenes = new Map<string, SceneDefinition>();
  const paths = new Set<string>();
  for (const entry of manifest.scenes) {
    signal?.throwIfAborted();
    packagePath(entry.path);
    if (scenes.has(entry.id) || paths.has(entry.path)) throw new Error(`Duplicate story scene "${entry.id}".`);
    paths.add(entry.path);
    const source = expanded.get(entry.path);
    if (!source) throw new Error(`Missing story scene "${entry.path}".`);
    const scene = parseSceneJson(decoder.decode(source));
    if (scene.id !== entry.id) throw new Error(`Story scene ID mismatch for "${entry.id}".`);
    await validateScenePackage(new Map([...expanded, ['scene.json', source]]), signal, { decodeImages: false });
    scenes.set(entry.id, scene);
  }
  const definition = parseStoryDefinition(manifest.story, { scenes, requirePlayable: true });
  return { definition, scenes, files: expanded };
}

export function storyScenePackage(story: StoryPackage, id: string): ScenePackageFiles {
  const scene = story.scenes.get(id);
  if (!scene) throw new Error(`Missing story scene "${id}".`);
  return new Map([...story.files, ['scene.json', encoder.encode(serializeSceneDefinition(scene))]]);
}
