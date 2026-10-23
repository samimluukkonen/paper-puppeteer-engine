import type { CharacterDefinition } from './CharacterDefinition.js';
import { CharacterLoader } from './CharacterLoader.js';
import { packagePath } from './packageZip.js';
import { freezeData, type DeepReadonly } from './readonlyData.js';
import { parseSceneDefinition, type SceneDefinition, type SceneCharacterAssets } from './SceneDefinition.js';
import { assertSceneInstanceBudget } from './sceneWorkloadLimits.js';

export interface SceneAssetOptions {
  /** URL of scene.json; relative character references resolve against this URL. */
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Optional host cache. Must return a complete immutable CharacterDefinition. */
  readonly loadCharacter?: (manifestUrl: string, reference: string) => Promise<CharacterDefinition>;
}

export interface ResolvedScene {
  readonly definition: DeepReadonly<SceneDefinition>;
  /** Keys are the exact stable references in the scene, rather than character/Actor IDs. */
  readonly characters: ReadonlyMap<string, CharacterDefinition>;
}

export function sceneAssetCatalog(
  characters: ReadonlyMap<string, CharacterDefinition>,
): ReadonlyMap<string, SceneCharacterAssets> {
  return new Map(
    [...characters].map(([reference, character]) => [
      reference,
      {
        animations: character.animations.map((clip) => clip.name),
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
  return {
    definition: freezeData(parseSceneDefinition(definition, { characters: sceneAssetCatalog(characters) })),
    characters,
  };
}
