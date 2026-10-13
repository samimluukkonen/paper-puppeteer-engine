import Phaser from 'phaser';
import type { CharacterDefinition } from '../engine/CharacterDefinition.js';
import { CharacterLoader } from '../engine/CharacterLoader.js';
import { getCharacterTextureLimitError } from '../engine/characterTextureLimits.js';
import { validateInputLimit } from '../engine/jsonInput.js';
import type { JsonWorkloadLimitOptions } from '../engine/jsonWorkloadLimits.js';
import {
  type CharacterTextureLoadOptions,
  DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS,
  queueCharacterTextures,
} from '../engine/queueCharacterTextures.js';

export interface SceneCharacterLoadOptions
  extends Omit<CharacterTextureLoadOptions, 'timeoutMs'>, JsonWorkloadLimitOptions {
  /** Deadline for the entire artwork phase, including queueing and image decoding. Defaults to 30 seconds. */
  artworkTimeoutMs?: number;
}

/** Cancel only this session's image files, including XHR, queued files and HTML image decoding. */
function cancelImageFiles(scene: Phaser.Scene, files: ReadonlySet<Phaser.Loader.File>): void {
  for (const file of files) {
    if (
      file.loader !== scene.load ||
      file.state === Phaser.Loader.FILE_COMPLETE ||
      file.state === Phaser.Loader.FILE_PENDING_DESTROY
    )
      continue;
    const xhr = file.xhrLoader;
    if (xhr) {
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onprogress = null;
      xhr.ontimeout = null;
      xhr.abort();
    }
    const data: unknown = file.data;
    if (typeof HTMLImageElement !== 'undefined' && data instanceof HTMLImageElement) {
      data.onload = null;
      data.onerror = null;
      if (data.src.startsWith('blob:')) URL.revokeObjectURL(data.src);
      data.src = '';
    }
    const pending = scene.load.list.has(file) || scene.load.inflight.has(file) || scene.load.queue.has(file);
    scene.load.list.delete(file);
    if (pending && scene.load.isLoading()) {
      // Use Phaser's failure path to update progress and finish the batch without resetting unrelated files.
      file.state = Phaser.Loader.FILE_ERRORED;
      scene.load.nextFile(file, false);
    } else {
      scene.load.inflight.delete(file);
      scene.load.queue.delete(file);
      file.destroy();
    }
  }
}

/** Load metadata and artwork for one scene session. Shutdown cancels without installing a character. */
export function loadSceneCharacter(
  scene: Phaser.Scene,
  url: string,
  options: SceneCharacterLoadOptions = {},
): Promise<CharacterDefinition | undefined> {
  return new Promise((resolve, reject) => {
    const timeoutMs = validateInputLimit(
      options.artworkTimeoutMs ?? DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS,
      'Artwork timeout',
    );
    if (timeoutMs > 2_147_483_647) throw new Error('Artwork timeout must not exceed 2147483647.');
    const controller = new AbortController();
    let settled = false;
    const characterImages = new Map<string, string>();
    const failedImages = new Set<string>();
    let artworkFailure: Error | undefined;
    const remainingImages = new Set<string>();
    const imageFiles = new Set<Phaser.Loader.File>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let definition: CharacterDefinition | undefined;
    let releaseTextures: (() => void) | undefined;
    const cleanup = (): void => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
      scene.load.off(Phaser.Loader.Events.ADD, onAdd);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      scene.load.off(Phaser.Loader.Events.FILE_COMPLETE, onFileComplete);
      scene.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
      try {
        cancelImageFiles(scene, imageFiles);
      } finally {
        imageFiles.clear();
        releaseTextures?.();
      }
    };
    const succeed = (character?: CharacterDefinition): void => {
      if (settled) return;
      cleanup();
      resolve(character);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      controller.abort();
      cleanup();
      reject(error);
    };
    const onShutdown = (): void => {
      controller.abort();
      succeed();
    };
    const onError = (file: Phaser.Loader.File): void => {
      if (file.type === 'image' && characterImages.has(file.key)) {
        failedImages.add(file.key);
        const limitError = getCharacterTextureLimitError(file);
        artworkFailure ??= limitError;
        // Wait for Phaser to finish the failing file callback, then cancel this
        // character's siblings without waiting for unrelated downloads.
        if (limitError) queueMicrotask(() => fail(limitError));
        finishImage(file.key);
      }
    };
    const finishImage = (key: string): void => {
      if (remainingImages.delete(key) && !remainingImages.size)
        // Let Phaser finish its current file callback before settling/canceling this session.
        queueMicrotask(() => {
          if (!settled) onComplete();
        });
    };
    const onFileComplete = (key: string, type: string): void => {
      if (type === 'image') finishImage(key);
    };
    const onAdd = (key: string, type: string, _loader: Phaser.Loader.LoaderPlugin, file: Phaser.Loader.File): void => {
      if (type === 'image' && characterImages.has(key)) imageFiles.add(file);
    };
    const onComplete = (): void => {
      if (!scene.sys.isActive()) succeed();
      else if (failedImages.size)
        fail(
          artworkFailure ??
            new Error(
              `Could not load character images: ${[...failedImages]
                .map((key) => `"${key}" (${characterImages.get(key)})`)
                .join(', ')}.`,
            ),
        );
      else succeed(definition);
    };
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
    const load = async (): Promise<void> => {
      // Scene.create() runs before Phaser marks the scene active; check after fetching instead.
      // Authoring views reload frequently after replacing rig and animation files.
      definition = await CharacterLoader.load(url, (input, init) => fetch(input, { ...init, cache: 'no-store' }), {
        ...options,
        signal: controller.signal,
      });
      if (settled) return;
      if (!scene.sys.isActive()) {
        succeed();
        return;
      }
      for (const key of Object.keys(definition.textures))
        if (!scene.textures.exists(key)) characterImages.set(key, definition.textureUrl(key));
      for (const key of characterImages.keys()) remainingImages.add(key);
      scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      scene.load.on(Phaser.Loader.Events.FILE_COMPLETE, onFileComplete);
      scene.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
      scene.load.on(Phaser.Loader.Events.ADD, onAdd);
      try {
        releaseTextures = queueCharacterTextures(scene, definition, { ...options, timeoutMs });
      } finally {
        scene.load.off(Phaser.Loader.Events.ADD, onAdd);
      }
      // Cached images still need the shared texture-key conflict checks.
      if (!characterImages.size) {
        succeed(definition);
        return;
      }
      timer = setTimeout(
        () => fail(new DOMException(`Character artwork loading timed out: "${url}".`, 'TimeoutError')),
        timeoutMs,
      );
      scene.load.start();
    };
    void load().catch(fail);
  });
}
