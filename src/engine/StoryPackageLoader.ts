import type Phaser from 'phaser';
import { AudioAssetLoader, type AudioBackend } from './AudioAssetLoader.js';
import { decodePackageZip, PACKAGE_MAX_BYTES } from './packageZip.js';
import { SceneImageTextureCache } from './SceneImageTextureCache.js';
import { SceneLoader, ScenePackageCharacterCache, type LoadedScene, type SceneLoadOptions } from './SceneLoader.js';
import type { ScenePackageFiles } from './ScenePackage.js';
import { readSceneResource } from './sceneResource.js';
import { SceneTransitionOverlay } from './SceneTransitionOverlay.js';
import type { StandaloneStorySource } from './StandaloneStoryPlayer.js';
import { StoryAudioPool } from './StoryAudioPool.js';
import { storyScenePackage, validateStoryPackage } from './StoryPackage.js';

/** Portable runtime boundary. The archive validates in full, while only current/next
 * character textures and audio are prepared. No editor or React imports. */
export const StoryPackageLoader = {
  async load(
    scene: Phaser.Scene,
    input: string | Uint8Array | ScenePackageFiles,
    options: Omit<SceneLoadOptions, 'audioBackend' | 'packageCharacters'> & { audioBackend?: AudioBackend } = {},
  ): Promise<StandaloneStorySource> {
    const loading = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, loading.signal]) : loading.signal;
    const onShutdown = (): void =>
      loading.abort(new DOMException('Scene shut down during story loading.', 'AbortError'));
    scene.events.once('shutdown', onShutdown);
    let archive: Awaited<ReturnType<typeof validateStoryPackage>>;
    try {
      signal.throwIfAborted();
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
      archive = await validateStoryPackage(files, signal);
      signal.throwIfAborted();
    } finally {
      scene.events.off('shutdown', onShutdown);
    }
    const characters = new ScenePackageCharacterCache(scene, archive.files);
    const images = new SceneImageTextureCache(scene);
    const audio = new StoryAudioPool(options.audioBackend);
    const overlay = new SceneTransitionOverlay(scene, 8800);
    // Story overlay follows the actual output camera during handoffs and scene camera changes.
    const renderOverlay = (): void => overlay.setOutputCamera(scene.cameras.main);
    scene.events.on('prerender', renderOverlay);
    const sessions = new Set<() => void>();
    let closed = false;
    const dispose = (): void => {
      if (closed) return;
      closed = true;
      scene.events.off('shutdown', dispose);
      scene.events.off('prerender', renderOverlay);
      options.signal?.removeEventListener('abort', dispose);
      for (const release of sessions) release();
      try {
        overlay.dispose();
      } finally {
        try {
          characters.dispose();
        } finally {
          try {
            images.dispose();
          } finally {
            audio.dispose();
          }
        }
      }
    };
    scene.events.once('shutdown', dispose);
    options.signal?.addEventListener('abort', dispose, { once: true });
    const prepareScene: NonNullable<StandaloneStorySource['prepareScene']> = async (_definition, context) => {
      if (closed) throw new Error('Story package source disposed.');
      const signal = options.signal ? AbortSignal.any([options.signal, context.signal]) : context.signal;
      const sceneFiles = storyScenePackage(archive, context.entry.sceneAssetId);
      const preparedAudio = new AudioAssetLoader(() => undefined, audio.lease());
      const imageLeases: { dispose(): void }[] = [];
      let prepared: Awaited<ReturnType<typeof SceneLoader.preparePackage>> | undefined;
      const release = (): void => {
        sessions.delete(release);
        signal.removeEventListener('abort', release);
        try {
          prepared?.dispose();
        } finally {
          try {
            for (const image of imageLeases.splice(0)) image.dispose();
          } finally {
            preparedAudio.dispose();
          }
        }
      };
      sessions.add(release);
      signal.addEventListener('abort', release, { once: true });
      try {
        prepared = await SceneLoader.preparePackage(scene, sceneFiles, {
          ...options,
          signal,
          packageCharacters: characters,
          imageTextures: images,
        });
        for (const image of new Set(
          archive.scenes.get(context.entry.sceneAssetId)!.images?.map((entry) => entry.image),
        ))
          imageLeases.push(await images.acquire(archive.files.get(image)!, signal));
        for (const clip of new Set(
          archive.scenes.get(context.entry.sceneAssetId)!.audioClips?.map((entry) => entry.assetId),
        )) {
          const definition = archive.scenes
            .get(context.entry.sceneAssetId)!
            .audioAssets!.find((entry) => entry.id === clip)!;
          await preparedAudio.prepare(archive.files.get(definition.path)!, signal);
        }
        signal.throwIfAborted();
        const ready = prepared;
        return {
          dispose: release,
          activate: async () => {
            // The preparation lease keeps shared decoded samples alive while runtime acquires its own.
            const loaded: LoadedScene = await ready.activate(audio.lease());
            return loaded;
          },
        };
      } catch (error) {
        release();
        throw error;
      }
    };
    return {
      definition: archive.definition,
      scenes: archive.scenes,
      transitionOverlay: overlay,
      prepareScene,
      loadScene: async (definition, context) => {
        const prepared = await prepareScene(definition, context);
        try {
          const loaded = await prepared.activate();
          return {
            ...loaded,
            dispose: () => {
              try {
                loaded.dispose();
              } finally {
                prepared.dispose();
              }
            },
          };
        } catch (error) {
          prepared.dispose();
          throw error;
        }
      },
      dispose,
    };
  },
};
