import type Phaser from 'phaser';
import { Actor } from './Actor.js';
import { CharacterDefinition, characterManifestSchema } from './CharacterDefinition.js';
import { applyCinematicCamera, type CinematicCameraTarget, type CameraViewport } from './cinematicCamera.js';
import type { RigJsonDefinition } from './externalData.js';
import { inspectImageHeader } from './imageHeader.js';
import { DEFAULT_MAX_JSON_BYTES } from './jsonInput.js';
import { loadSceneCharacter } from './loadSceneCharacter.js';
import { decodePackageZip, PACKAGE_MAX_BYTES } from './packageZip.js';
import { Puppet } from './Puppet.js';
import { resolveSceneDefinition, type ResolvedScene, type SceneAssetOptions } from './SceneAssets.js';
import { parseSceneJson } from './SceneDefinition.js';
import { SceneImageLayer } from './SceneImageLayer.js';
import { validateScenePackage, type ScenePackageFiles } from './ScenePackage.js';
import { readSceneResource } from './sceneResource.js';
import { SceneRunner, type SceneRunnerOptions } from './SceneRunner.js';
import { createSceneTextureBudget } from './sceneTextureBudget.js';
import { SceneTransitionOverlay } from './SceneTransitionOverlay.js';

export interface SceneLoadOptions {
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onCue?: SceneRunnerOptions['onCue'];
}
export interface LoadedScene {
  /** The host supplies runner.update(delta) once per Phaser update. */
  readonly runner: SceneRunner;
  /** Opt into authored audience framing on a host-owned centered, unrotated Phaser camera.
   * Reapply with the full viewport after resizing. No camera is changed during load.
   */
  applyCamera(camera: CinematicCameraTarget, viewport?: CameraViewport): CameraViewport;
  /** Releases Actors/listeners and ZIP-owned artwork. Hosted character textures remain shared. */
  dispose(): void;
}
let packageCharacterSerial = 0;

/** Optional adapter. Puppet/Actor and the pure authored format remain independently usable. */
export const SceneLoader = {
  load(scene: Phaser.Scene, url: string, options: SceneLoadOptions = {}): Promise<LoadedScene> {
    const baseUrl = new URL(url, globalThis.location?.href).href;
    return loadSession(scene, options, async (signal) => {
      const bytes = await readSceneResource(baseUrl, options.fetcher ?? fetch, DEFAULT_MAX_JSON_BYTES, signal);
      const input = parseSceneJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return { resolved: await resolveSceneDefinition(input, { ...options, baseUrl, signal }) };
    });
  },
  fromDefinition(
    scene: Phaser.Scene,
    input: unknown,
    options: SceneAssetOptions & SceneLoadOptions,
  ): Promise<LoadedScene> {
    return loadSession(scene, options, async (signal) => ({
      resolved: await resolveSceneDefinition(input, { ...options, signal }),
    }));
  },
  /** Accept an editor ZIP, its file map, or a hosted ZIP URL. No extraction/network fallback. */
  loadPackage(
    scene: Phaser.Scene,
    input: string | Uint8Array | ScenePackageFiles,
    options: SceneLoadOptions = {},
  ): Promise<LoadedScene> {
    return loadSession(scene, options, async (signal) => {
      const source =
        typeof input === 'string'
          ? await readSceneResource(
              new URL(input, globalThis.location?.href).href,
              options.fetcher ?? fetch,
              PACKAGE_MAX_BYTES,
              signal,
            )
          : input;
      const files = source instanceof Uint8Array ? decodePackageZip(source) : source;
      const resolved = await validateScenePackage(files, signal);
      const characters = new Map<string, CharacterDefinition>();
      const urls = new Map<string, string>();
      const textureKeys = new Set<string>();
      const dispose = (): void => {
        try {
          for (const key of textureKeys) if (scene.textures.exists(key)) scene.textures.remove(key);
        } finally {
          textureKeys.clear();
          for (const url of urls.values()) URL.revokeObjectURL(url);
          urls.clear();
        }
      };
      try {
        for (const [reference, character] of resolved.characters) {
          const folder = reference.slice(0, reference.lastIndexOf('/') + 1);
          const manifest = characterManifestSchema.parse({ ...character.manifest!, textures: {} });
          // ZIPs may contain different characters with the same authored texture keys.
          // Keep runtime aliases local to this lease; never rewrite the exported document.
          const prefix = `scene_package_${++packageCharacterSerial}_`;
          const keys = new Map<string, string>();
          for (const [key, path] of Object.entries(character.textures)) {
            const fullPath = `${folder}${path}`;
            let url = urls.get(fullPath);
            if (!url) {
              const bytes = files.get(fullPath)!;
              url = URL.createObjectURL(new Blob([bytes], { type: inspectImageHeader(bytes)!.format }));
              urls.set(fullPath, url);
            }
            const runtimeKey = `${prefix}${keys.size}`;
            keys.set(key, runtimeKey);
            textureKeys.add(runtimeKey);
            manifest.textures[runtimeKey] = url;
          }
          const rig = structuredClone(character.rigFile!) as RigJsonDefinition;
          for (const sprite of [
            ...rig.bones.flatMap((bone) => (bone.sprite ? [bone.sprite] : [])),
            ...(rig.attachments ?? []),
          ])
            sprite.texture = keys.get(sprite.texture)!;
          characters.set(
            reference,
            CharacterDefinition.fromData({
              manifest,
              rig,
              skins: Object.fromEntries(character.standaloneSkins.map((skin) => [manifest.skins[skin.name]!, skin])),
              animations: Object.fromEntries(
                character.animations.map((clip) => [character.animationPaths[clip.name]!, { ...clip, version: 1 }]),
              ),
              poses: Object.fromEntries((manifest.poses ?? []).map((path, index) => [path, character.poses[index]])),
            }),
          );
        }
        signal.throwIfAborted();
        return {
          resolved: {
            definition: resolved.definition,
            characters,
            ...(resolved.images ? { images: resolved.images } : {}),
          },
          dispose,
        };
      } catch (error) {
        dispose();
        throw error;
      }
    });
  },
};

async function loadSession(
  scene: Phaser.Scene,
  options: SceneLoadOptions,
  prepare: (signal: AbortSignal) => Promise<{ resolved: ResolvedScene; dispose?: () => void }>,
): Promise<LoadedScene> {
  const controller = new AbortController();
  let runner: SceneRunner | undefined;
  let artwork: SceneImageLayer | undefined;
  let transitions: SceneTransitionOverlay | undefined;
  let release: (() => void) | undefined;
  let disposed = false;
  let audience: { camera: CinematicCameraTarget; viewport: CameraViewport } | undefined;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    controller.abort(new DOMException('Scene load disposed.', 'AbortError'));
    scene.events.off('shutdown', dispose);
    options.signal?.removeEventListener('abort', dispose);
    try {
      try {
        runner?.dispose();
      } finally {
        try {
          artwork?.dispose();
        } finally {
          transitions?.dispose();
        }
      }
    } finally {
      release?.();
    }
  };
  scene.events.once('shutdown', dispose);
  options.signal?.addEventListener('abort', dispose, { once: true });
  try {
    options.signal?.throwIfAborted();
    const prepared = await prepare(controller.signal);
    release = prepared.dispose;
    controller.signal.throwIfAborted();
    // Serialize artwork sessions because Phaser texture keys are shared by all Actors.
    const sharedBudget = createSceneTextureBudget();
    for (const [reference, definition] of prepared.resolved.characters) {
      const ready = await loadSceneCharacter(scene, reference, {
        definition,
        signal: controller.signal,
        allowWebp: true,
        sharedBudget,
      });
      controller.signal.throwIfAborted();
      if (!ready) throw new Error('Scene shut down while loading character artwork.');
    }
    const images = prepared.resolved.images ?? new Map<string, Uint8Array<ArrayBuffer>>();
    for (const [reference, bytes] of images) sharedBudget.checkImage(`image:${reference}`, bytes);
    artwork = new SceneImageLayer(scene, (reference) => {
      const bytes = images.get(reference);
      if (!bytes) return Promise.reject(new Error(`Missing scene image "${reference}".`));
      return Promise.resolve(bytes);
    });
    artwork.sync(prepared.resolved.definition.images, prepared.resolved.definition.layers);
    await artwork.ready();
    controller.signal.throwIfAborted();
    if (prepared.resolved.definition.transitions?.length) transitions = new SceneTransitionOverlay(scene);
    runner = new SceneRunner(prepared.resolved.definition, {
      ...(transitions ? { transitionOverlay: transitions } : {}),
      onCamera: (state) => {
        transitions?.setCamera(state);
        if (!audience || disposed) return;
        applyCinematicCamera(audience.camera, state, audience.viewport);
        const definition = prepared.resolved.definition;
        artwork!.sync(definition.images, definition.layers, state);
      },
      ...(options.onCue ? { onCue: options.onCue } : {}),
      createActor: (data, depth) => {
        const definition = prepared.resolved.characters.get(data.character.manifest)!;
        const puppet = new Puppet(scene, { definition, autoUpdate: false });
        try {
          puppet.container.setDepth(depth);
          return new Actor({ id: data.id, puppet, puppetOwnership: 'owned' });
        } catch (error) {
          puppet.destroy();
          throw error;
        }
      },
    });
    return {
      runner,
      dispose,
      applyCamera(camera, viewport) {
        if (disposed) throw new Error('Scene load disposed.');
        const definition = prepared.resolved.definition;
        const state = runner!.cinematicCamera;
        audience = { camera, viewport: viewport ?? { x: 0, y: 0, width: camera.width, height: camera.height } };
        const result = applyCinematicCamera(camera, state, audience.viewport);
        // Center-relative compensation matches the editor at every viewport size and zoom.
        artwork!.sync(definition.images, definition.layers, state);
        return result;
      },
    };
  } catch (error) {
    // Preparation may complete after a shutdown already ran dispose(). Release its URLs too.
    if (disposed) release?.();
    else dispose();
    throw error;
  }
}
