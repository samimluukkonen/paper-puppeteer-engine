/** Public Phaser runtime. Requires a browser and a host-owned Phaser scene. */
export {
  AudioAssetLoader,
  WebAudioBackend,
  AUDIO_MAX_DECODED_BYTES,
  AUDIO_LOAD_TIMEOUT_MS,
} from './AudioAssetLoader.js';
export type { AudioBackend, AudioPlayback, DecodedAudioResource, AudioAssetSource } from './AudioAssetLoader.js';
export { Actor, type ActorOptions, type ActorPosition, type ActorPuppetOwnership } from './Actor.js';
export type {
  ActorLocomotion,
  ActorMoveOptions,
  ActorWalkOptions,
  ActorMovementOutcome,
  ActorMovementResult,
  ActorMovementSnapshot,
  ActorMovementStatus,
} from './ActorMovement.js';
export { Bone } from './Bone.js';
export { Choreography, type ChoreographyPlan, type ChoreographyCoordinationResult } from './Choreography.js';
export { ChoreographyConflictError } from './choreographyOwnership.js';
export {
  ChoreographySequence,
  type ChoreographyStep,
  type ChoreographyMoveOptions,
  type ChoreographyWalkOptions,
  type ChoreographyOutcome,
  type ChoreographyResult,
  type ChoreographyActionResult,
} from './ChoreographySequence.js';
export * from './core.js';
export type { PuppetOptions, SyncPoseOptions } from './Puppet.js';
export { Puppet } from './Puppet.js';
export { SceneRunner, type SceneRunnerStatus, type SceneRunnerOptions, type SceneCue } from './SceneRunner.js';
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

export { SceneLoader, type SceneLoadOptions, type LoadedScene } from './SceneLoader.js';
export { SceneTransitionOverlay } from './SceneTransitionOverlay.js';
