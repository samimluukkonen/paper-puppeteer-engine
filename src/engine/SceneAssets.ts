import { validateAudioAssetData } from './AudioAsset.js';
import type { CharacterDefinition } from './CharacterDefinition.js';
import { CharacterLoader } from './CharacterLoader.js';
import { inspectImageHeader } from './imageHeader.js';
import { packagePath, PACKAGE_MAX_FILE_BYTES } from './packageZip.js';
import { freezeData, type DeepReadonly } from './readonlyData.js';
import { parseSceneDefinition, type SceneDefinition, type SceneCharacterAssets } from './SceneDefinition.js';
import { readSceneResource } from './sceneResource.js';
import { createSceneTextureBudget } from './sceneTextureBudget.js';
import { assertSceneInstanceBudget, DEFAULT_SCENE_WORKLOAD_LIMITS } from './sceneWorkloadLimits.js';

export interface SceneAssetOptions {
  /** URL of scene.json; relative character references resolve against this URL. */
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
  readonly loadAudio?: (reference: string) => Promise<Uint8Array<ArrayBuffer>>;
  readonly loadImage?: (reference: string) => Promise<Uint8Array<ArrayBuffer>>;
  readonly signal?: AbortSignal;
  /** Optional host cache. Must return a complete immutable CharacterDefinition. */
  readonly loadCharacter?: (manifestUrl: string, reference: string) => Promise<CharacterDefinition>;
}

export interface ResolvedScene {
  readonly definition: DeepReadonly<SceneDefinition>;
  /** Keys are the exact stable references in the scene, rather than character/Actor IDs. */
  readonly characters: ReadonlyMap<string, CharacterDefinition>;
  readonly audio?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  readonly images?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

export function sceneAssetCatalog(
  characters: ReadonlyMap<string, CharacterDefinition>,
): ReadonlyMap<string, SceneCharacterAssets> {
  return new Map(
    [...characters].map(([reference, character]) => [
      reference,
      {
        animations: character.animations.map((clip) => clip.name),
        rootMotionAnimations: character.animations
          .filter((clip) => clip.rootMotion?.translationKeys.length)
          .map((clip) => clip.name),
        skins: character.rig.skins.map((skin) => skin.name),
      },
    ]),
  );
}

/** Existing hosted characters may explicitly share sibling assets. Only leading parent
 * segments are supported; ZIPs rebase these to confined paths before being written. */
export function sceneCharacterAssetPath(path: string): void {
  packagePath(path.replace(/^(?:\.\.\/)+/, ''));
}

export function validateSceneCharacterPaths(character: CharacterDefinition): void {
  const manifest = character.manifest;
  if (!manifest) throw new Error(`Character "${character.id}" has no package manifest.`);
  for (const path of [
    manifest.rig,
    ...Object.values(manifest.skins),
    ...manifest.animations,
    ...(manifest.poses ?? []),
    ...Object.values(manifest.textures),
  ])
    sceneCharacterAssetPath(path);
}

/** Renderer-independent preflight. A failure never constructs Actors or installs editor data.
 * Load serially to bound requests/memory and deduplicate shared character packages. */
export async function resolveSceneDefinition(input: unknown, options: SceneAssetOptions): Promise<ResolvedScene> {
  const definition = parseSceneDefinition(input);
  const references = [...new Set(definition.actors.map((actor) => actor.character.manifest))];
  if (references.length > 64) throw new Error('Scene exceeds the 64-character package limit.');
  const characters = new Map<string, CharacterDefinition>();
  for (const reference of references) {
    options.signal?.throwIfAborted();
    const url = new URL(reference, options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Scene character URLs must use HTTP(S).');
    try {
      const character = await (options.loadCharacter?.(url.href, reference) ??
        CharacterLoader.load(url.href, options.fetcher ?? fetch, {
          ...(options.signal ? { signal: options.signal } : {}),
          pathPolicy: (path) => {
            sceneCharacterAssetPath(path);
          },
          urlPolicy: (resource) => resource.origin === url.origin && !resource.search && !resource.hash,
        }));
      options.signal?.throwIfAborted();
      validateSceneCharacterPaths(character);
      characters.set(reference, character);
      assertSceneInstanceBudget(definition, characters);
    } catch (error) {
      throw new Error(
        `Character "${reference}" could not load: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  const images = new Map<string, Uint8Array<ArrayBuffer>>();
  const budget = createSceneTextureBudget();
  for (const reference of new Set(definition.images?.map((image) => image.image))) {
    options.signal?.throwIfAborted();
    const url = new URL(reference, options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Scene images must use HTTP(S).');
    const bytes = await (options.loadImage?.(reference) ??
      readSceneResource(url.href, options.fetcher ?? fetch, PACKAGE_MAX_FILE_BYTES, options.signal));
    budget.checkImage(reference, bytes);
    const header = inspectImageHeader(bytes)!;
    if (!reference.toLowerCase().endsWith(header.format === 'image/png' ? '.png' : '.webp'))
      throw new Error(`Image format does not match path "${reference}".`);
    images.set(reference, bytes);
  }
  const audio = new Map<string, Uint8Array<ArrayBuffer>>();
  const audioIds = new Set(definition.audioClips?.map((clip) => clip.assetId));
  let audioBytes = 0;
  const audioLimitError = (): Error =>
    new Error(`Scene audio exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalAudioBytes}-byte total limit.`);
  const countAudioBytes = (bytes: number): void => {
    audioBytes += bytes;
    if (audioBytes > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalAudioBytes) throw audioLimitError();
  };
  for (const asset of definition.audioAssets ?? []) {
    if (!audioIds.has(asset.id)) continue;
    options.signal?.throwIfAborted();
    if (audioBytes === DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalAudioBytes) throw audioLimitError();
    const url = new URL(asset.path, options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Scene audio must use HTTP(S).');
    const bytes = await (options.loadAudio?.(asset.path) ??
      readSceneResource(url.href, options.fetcher ?? fetch, PACKAGE_MAX_FILE_BYTES, options.signal, countAudioBytes));
    // Host caches bypass the streaming reader, but retain the same scene-wide budget.
    if (options.loadAudio) countAudioBytes(bytes.byteLength);
    // AudioAssetDefinition's package validation expects confined paths; scene references may lead with ../.
    validateAudioAssetData({ ...asset, path: asset.path.replace(/^(?:\.\.\/)+/, '') }, bytes);
    audio.set(asset.id, bytes);
  }
  options.signal?.throwIfAborted();
  return {
    audio,
    images,
    definition: freezeData(parseSceneDefinition(definition, { characters: sceneAssetCatalog(characters) })),
    characters,
  };
}
