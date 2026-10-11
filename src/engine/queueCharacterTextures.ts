import type Phaser from 'phaser';
import type { CharacterDefinition } from './CharacterDefinition.js';
import { validateInputLimit } from './jsonInput.js';

export const DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS = 30_000;

export interface CharacterTextureLoadOptions {
  /** Timeout for each image XHR request. Defaults to 30 seconds. */
  timeoutMs?: number;
}

interface TextureReservation {
  url: string;
  pending: number;
}

// Phaser shares its texture manager across scenes. Host-preloaded keys have no reservation.
const characterTextures = new WeakMap<Phaser.Textures.TextureManager, Map<string, TextureReservation>>();

/** Queue images, rejecting conflicting character keys. Returns reservation cleanup for a canceled load. */
export function queueCharacterTextures(
  scene: Phaser.Scene,
  definition: CharacterDefinition,
  options: CharacterTextureLoadOptions = {},
): () => void {
  const timeout = validateInputLimit(options.timeoutMs ?? DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS, 'Texture timeout');
  if (timeout > 2_147_483_647) throw new Error('Texture timeout must not exceed 2147483647.');
  let registered = characterTextures.get(scene.textures);
  if (!registered) {
    registered = new Map();
    characterTextures.set(scene.textures, registered);
  }
  const resources = Object.keys(definition.textures).map((key) => ({ key, url: definition.textureUrl(key) }));
  // Check the complete character before queueing any images or acquiring reservations.
  for (const { key, url } of resources) {
    // Phaser stores textures in an ordinary object and calls its hasOwnProperty method.
    if (key === 'hasOwnProperty' || key === '__proto__')
      throw new Error(`Texture key "${key}" is reserved by Phaser. Use a different texture key.`);
    const previous = registered.get(key);
    if (previous && (previous.pending > 0 || scene.textures.exists(key)) && previous.url !== url)
      throw new Error(
        `Texture key "${key}" is already assigned to "${previous.url}"; character "${definition.id}" requests "${url}". Use unique texture keys for different images.`,
      );
  }
  const pending = new Map<string, TextureReservation>();
  let settled = false;
  const release = (): void => {
    if (settled) return;
    settled = true;
    scene.load.off('complete', release);
    scene.events.off('shutdown', release);
    for (const [key, reservation] of pending) {
      reservation.pending -= 1;
      if (reservation.pending === 0 && !scene.textures.exists(key) && registered.get(key) === reservation)
        registered.delete(key);
    }
    pending.clear();
  };
  try {
    for (const { key, url } of resources) {
      if (scene.textures.exists(key)) continue;
      const previous = registered.get(key);
      const reservation = previous?.url === url ? previous : { url, pending: 0 };
      registered.set(key, reservation);
      reservation.pending += 1;
      pending.set(key, reservation);
      scene.load.image(key, url, { responseType: 'blob', timeout });
    }
    if (pending.size) {
      scene.load.once('complete', release);
      scene.events.once('shutdown', release);
    }
  } catch (error) {
    release();
    throw error;
  }
  return release;
}
