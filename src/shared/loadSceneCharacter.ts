import Phaser from 'phaser';
import type { CharacterDefinition } from '../engine/CharacterDefinition.js';
import { CharacterLoader } from '../engine/CharacterLoader.js';
import { queueCharacterTextures } from '../engine/queueCharacterTextures.js';

/** Load metadata and artwork for one scene session. Shutdown cancels without installing a character. */
export function loadSceneCharacter(scene: Phaser.Scene, url: string): Promise<CharacterDefinition | undefined> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let failed = false;
    let definition: CharacterDefinition | undefined;
    let releaseTextures: (() => void) | undefined;
    const cleanup = (): void => {
      settled = true;
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      scene.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
      releaseTextures?.();
    };
    const succeed = (character?: CharacterDefinition): void => {
      if (settled) return;
      cleanup();
      resolve(character);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    const onShutdown = (): void => {
      controller.abort();
      succeed();
    };
    const onError = (): void => {
      failed = true;
    };
    const onComplete = (): void => {
      if (!scene.sys.isActive()) succeed();
      else if (failed) fail(new Error('One or more character images could not be loaded.'));
      else succeed(definition);
    };
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
    const load = async (): Promise<void> => {
      // Scene.create() runs before Phaser marks the scene active; check after fetching instead.
      definition = await CharacterLoader.load(url, (input, init) =>
        fetch(input, { ...init, signal: controller.signal }),
      );
      if (settled) return;
      if (!scene.sys.isActive()) {
        succeed();
        return;
      }
      scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      scene.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
      releaseTextures = queueCharacterTextures(scene, definition);
      scene.load.start();
    };
    void load().catch(fail);
  });
}
