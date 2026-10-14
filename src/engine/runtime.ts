/** Public Phaser runtime. Requires a browser and a host-owned Phaser scene. */
export { Bone } from './Bone.js';
export * from './core.js';
export type { PuppetOptions, SyncPoseOptions } from './Puppet.js';
export { Puppet } from './Puppet.js';
export {
  type CharacterTextureLoadOptions,
  CharacterTextureLimitError,
  DEFAULT_CHARACTER_TEXTURE_LIMITS,
  DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS,
  queueCharacterTextures,
} from './queueCharacterTextures.js';

export type {
  ArtworkReference,
  ArtworkReplacement,
  ArtworkUsage,
  ArtworkAlignmentPolicy,
} from './artworkReplacement.js';
export { loadSceneCharacter, type SceneCharacterLoadOptions } from './loadSceneCharacter.js';
