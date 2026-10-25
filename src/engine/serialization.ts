/** Versioned JSON validation and pose serialization; no browser, Phaser, or editor state. */
export {
  serializeRigDefinition,
  serializeAnimationDefinition,
  serializeSkinDefinition,
  serializeCharacterManifest,
} from './authoredSerialization.js';
export type {
  AnimationJsonDefinition,
  AnimationJsonEvent,
  JsonValue,
  RigJsonDefinition,
  ValidationIssue,
} from './externalData.js';
export {
  ANIMATION_FORMAT_VERSION,
  AnimationValidationError,
  parseAnimationClip,
  parseRigDefinition,
  RIG_FORMAT_VERSION,
  RigValidationError,
  UnsupportedFormatVersionError,
  validateAnimationDefinition,
  validateRigDefinition,
} from './externalData.js';
export type { CharacterData, CharacterManifest } from './CharacterDefinition.js';
export {
  CHARACTER_FORMAT_VERSION,
  CharacterDefinition,
  CharacterValidationError,
  characterManifestSchema,
  validateCharacterDefinition,
} from './CharacterDefinition.js';
export type { PoseDefinition } from './Pose.js';
export {
  POSE_FORMAT_VERSION,
  PoseValidationError,
  parsePoseDefinition,
  poseDefinitionSchema,
  serializePose,
  validatePoseDefinition,
} from './Pose.js';
export {
  animationClipSchema,
  rigDefinitionSchema,
  footContactMarkerSchema,
  skinDefinitionSchema,
  slotDefinitionSchema,
  spriteAttachmentSchema,
  twoBoneIKDefinitionSchema,
  ikKeyframeSchema,
  ikMixSchema,
} from './schemas.js';
export { DEFAULT_MAX_JSON_BYTES, JsonInputLimitError } from './jsonInput.js';
export { DEFAULT_JSON_WORKLOAD_LIMITS } from './jsonWorkloadLimits.js';
export type { JsonWorkloadLimitOptions } from './jsonWorkloadLimits.js';

export type {
  SceneDefinition,
  SceneActorDefinition,
  SceneImageDefinition,
  SceneLayerDefinition,
  SceneActionDefinition,
  SceneCharacterReference,
  SceneCharacterAssets,
  SceneValidationOptions,
} from './SceneDefinition.js';
export {
  SCENE_FORMAT_VERSION,
  SceneValidationError,
  sceneDefinitionSchema,
  sceneActorDefinitionSchema,
  sceneActionDefinitionSchema,
  sceneCharacterReferenceSchema,
  createEmptyScene,
  sceneActionDuration,
  validateSceneDefinition,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
} from './SceneDefinition.js';

export { resolveSceneDefinition, sceneAssetCatalog } from './SceneAssets.js';
export type { SceneAssetOptions, ResolvedScene } from './SceneAssets.js';
export { buildScenePackage, validateScenePackage } from './ScenePackage.js';
export type { ScenePackageFiles } from './ScenePackage.js';
export { encodePackageZip, decodePackageZip } from './packageZip.js';

export type { CameraProperty, CameraKeyframe, CameraTracks } from './cameraAnimation.js';

export type { SceneAudioClip, SceneAudioTrack } from './sceneAudio.js';
export { sceneAudioClipSchema, sceneAudioTrackSchema, trimSceneAudioClip } from './sceneAudio.js';
