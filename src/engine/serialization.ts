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
  validateSceneDefinition,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
} from './SceneDefinition.js';
