import type Phaser from 'phaser';
import { Actor } from './Actor.js';
import type { AudioBackend } from './AudioAssetLoader.js';
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
import type { SceneDialogueTarget } from './sceneDialogue.js';
import { SceneDialogueOverlay } from './SceneDialogueOverlay.js';
import { SceneImageLayer } from './SceneImageLayer.js';
import type { SceneImageTextureCache } from './SceneImageTextureCache.js';
import { validateScenePackage, type ScenePackageFiles } from './ScenePackage.js';
import { readSceneResource } from './sceneResource.js';
import { SceneRunner, type SceneRunnerOptions } from './SceneRunner.js';
import { createSceneTextureBudget } from './sceneTextureBudget.js';
import { SceneTransitionOverlay } from './SceneTransitionOverlay.js';

export interface SceneLoadOptions {
  /** Optional exclusively owned backend; Web Audio is the default. */
  readonly audioBackend?: AudioBackend;
  /** Decode before returning the runtime, reusing an already-running shared story context. */
  readonly prepareAudio?: boolean;
  readonly fetcher?: typeof fetch;
  /** Share package character leases within one immutable story archive. */
  readonly packageCharacters?: ScenePackageCharacterCache;
  readonly imageTextures?: SceneImageTextureCache;
  readonly signal?: AbortSignal;
  readonly onCue?: SceneRunnerOptions['onCue'];
  /** Omit for default Phaser subtitles; false disables them. Custom targets are
   * host-owned, receive silent-seek render samples and are cleared on cleanup.
   */
  readonly dialoguePresentation?: SceneDialogueTarget | false;
}
export interface PreparedScene {
  /** Construct Actors and presentation only at handoff; preparation never advances time. */
  activate(audioBackend?: AudioBackend): Promise<LoadedScene>;
  dispose(): void;
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
    return loadSession(scene, options, (signal) => preparePackageResources(scene, input, options, signal));
  },
  /** Resolve/validate packages and decode character artwork without creating Actors or overlays. */
  async preparePackage(
    scene: Phaser.Scene,
    input: string | Uint8Array | ScenePackageFiles,
    options: SceneLoadOptions = {},
  ): Promise<PreparedScene> {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const onShutdown = (): void =>
      controller.abort(new DOMException('Scene shut down during preparation.', 'AbortError'));
    scene.events.once('shutdown', onShutdown);
    let prepared: Awaited<ReturnType<typeof preparePackageResources>>;
    try {
      prepared = await preparePackageResources(scene, input, options, signal);
    } catch (error) {
      scene.events.off('shutdown', onShutdown);
      throw error;
    }
    let disposed = false;
    let activated = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      options.signal?.removeEventListener('abort', dispose);
      scene.events.off('shutdown', onShutdown);
      prepared.dispose?.();
    };
    options.signal?.addEventListener('abort', dispose, { once: true });
    try {
      signal.throwIfAborted();
      const sharedBudget = createSceneTextureBudget();
      for (const [reference, definition] of prepared.resolved.characters) {
        if (!(await loadSceneCharacter(scene, reference, { definition, signal, allowWebp: true, sharedBudget })))
          throw new Error('Scene shut down while preparing artwork.');
      }
      signal.throwIfAborted();
      return {
        dispose,
        activate: (audioBackend) => {
          signal.throwIfAborted();
          if (activated) throw new Error('Prepared scene already activated.');
          activated = true;
          return loadSession(
            scene,
            { ...options, ...(audioBackend ? { audioBackend } : {}), prepareAudio: true, signal },
            () => Promise.resolve({ resolved: prepared.resolved, dispose }),
          );
        },
      };
    } catch (error) {
      dispose();
      throw error;
    }
  },
};

async function preparePackageResources(
  scene: Phaser.Scene,
  input: string | Uint8Array | ScenePackageFiles,
  options: SceneLoadOptions,
  signal: AbortSignal,
): Promise<{ resolved: ResolvedScene; dispose?: () => void }> {
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
  const resolved = await validateScenePackage(files, signal, { decodeImages: false });
  if (options.packageCharacters) return options.packageCharacters.acquire(files, resolved, signal);
  return aliasPackageCharacters(scene, files, resolved, signal);
}

function aliasPackageCharacters(
  scene: Phaser.Scene,
  files: ScenePackageFiles,
  resolved: ResolvedScene,
  signal: AbortSignal,
) {
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
        ...(resolved.audio ? { audio: resolved.audio } : {}),
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Reference-counted package artwork. Consumers are disposed before the last texture lease. */
export class ScenePackageCharacterCache {
  private readonly entries = new Map<string, { definition: CharacterDefinition; count: number; dispose: () => void }>();
  private closed = false;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly files: ScenePackageFiles,
  ) {}
  acquire(files: ScenePackageFiles, resolved: ResolvedScene, signal: AbortSignal) {
    if (this.closed) throw new Error('Package character cache disposed.');
    const characters = new Map<string, CharacterDefinition>();
    const leases: string[] = [];
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      for (const reference of leases) {
        const entry = this.entries.get(reference);
        if (entry && --entry.count === 0) {
          this.entries.delete(reference);
          entry.dispose();
        }
      }
    };
    try {
      for (const [reference, character] of resolved.characters) {
        const folder = reference.slice(0, reference.lastIndexOf('/') + 1);
        for (const [path, bytes] of files)
          if (path.startsWith(folder) && this.files.get(path) !== bytes)
            throw new Error(`Character cache requires immutable package files: "${path}".`);
        let entry = this.entries.get(reference);
        if (!entry) {
          const aliased = aliasPackageCharacters(
            this.scene,
            files,
            { ...resolved, characters: new Map([[reference, character]]) },
            signal,
          );
          entry = { definition: aliased.resolved.characters.get(reference)!, count: 0, dispose: aliased.dispose };
          this.entries.set(reference, entry);
        }
        entry.count++;
        leases.push(reference);
        characters.set(reference, entry.definition);
      }
      return { resolved: { ...resolved, characters }, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values()) entry.dispose();
    this.entries.clear();
  }
}

async function loadSession(
  scene: Phaser.Scene,
  options: SceneLoadOptions,
  prepare: (signal: AbortSignal) => Promise<{ resolved: ResolvedScene; dispose?: () => void }>,
): Promise<LoadedScene> {
  const controller = new AbortController();
  let runner: SceneRunner | undefined;
  let artwork: SceneImageLayer | undefined;
  let transitions: SceneTransitionOverlay | undefined;
  let dialogue: SceneDialogueOverlay | undefined;
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
          try {
            transitions?.dispose();
          } finally {
            dialogue?.dispose();
          }
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
    artwork = new SceneImageLayer(
      scene,
      (reference) => {
        const bytes = images.get(reference);
        if (!bytes) return Promise.reject(new Error(`Missing scene image "${reference}".`));
        return Promise.resolve(bytes);
      },
      undefined,
      sharedBudget,
      options.imageTextures,
    );
    artwork.sync(prepared.resolved.definition.images, prepared.resolved.definition.layers);
    await artwork.ready();
    controller.signal.throwIfAborted();
    if (prepared.resolved.definition.transitions?.length) transitions = new SceneTransitionOverlay(scene);
    if (options.dialoguePresentation === undefined && prepared.resolved.definition.dialogue?.length)
      dialogue = new SceneDialogueOverlay(scene);
    const dialoguePresentation = options.dialoguePresentation ?? dialogue;
    runner = new SceneRunner(prepared.resolved.definition, {
      ...(dialoguePresentation ? { dialoguePresentation } : {}),
      audio: {
        ...(options.audioBackend ? { backend: options.audioBackend } : {}),
        resolve: (id) => {
          const asset = prepared.resolved.definition.audioAssets?.find((entry) => entry.id === id);
          const bytes = prepared.resolved.audio?.get(id);
          return asset && bytes
            ? { definition: { ...asset, path: asset.path.replace(/^(?:\.\.\/)+/, '') }, bytes }
            : undefined;
        },
      },
      ...(transitions ? { transitionOverlay: transitions } : {}),
      onCamera: (state) => {
        transitions?.setCamera(state);
        dialogue?.setCamera(state);
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
    if (options.prepareAudio) await runner.audio?.prepare();
    controller.signal.throwIfAborted();
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
