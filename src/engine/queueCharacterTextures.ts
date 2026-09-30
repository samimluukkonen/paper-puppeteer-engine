import type Phaser from 'phaser';
import type { CharacterDefinition } from './CharacterDefinition.js';

/** Queue ordinary images through the scene's Phaser loader. Atlas keys may be preloaded by the host. */
export function queueCharacterTextures(scene: Phaser.Scene, definition: CharacterDefinition): void {
  for (const key of Object.keys(definition.textures)) {
    if (!scene.textures.exists(key)) scene.load.image(key, definition.textureUrl(key));
  }
}
