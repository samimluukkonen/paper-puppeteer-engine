export type {
  AnimationClip,
  AnimationEvent,
  AnimationPlaybackMode,
  CompiledClip,
  CompiledIKTrack,
  CompiledTrack,
  Interpolation,
  Keyframe,
  PropertyKeyframe,
} from './AnimationClip.js';
export { compileClip } from './AnimationClip.js';
export type {
  AnimationCompletion,
  FiredAnimationEvent,
  PlayAnimationOptions,
  SampleAnimationOptions,
} from './AnimationPlayer.js';
export { AnimationPlayer } from './AnimationPlayer.js';
export type { AnimationPose } from './AnimationPose.js';
export { blendPose, evaluateClip, lerpProperty } from './AnimationPose.js';
export type { CharacterData, CharacterManifest } from './CharacterDefinition.js';
export {
  CHARACTER_FORMAT_VERSION,
  CharacterDefinition,
  CharacterValidationError,
  characterManifestSchema,
  validateCharacterDefinition,
} from './CharacterDefinition.js';
export type { CharacterLoadOptions } from './CharacterLoader.js';
export { CharacterLoader } from './CharacterLoader.js';
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
export type { TwoBoneIKInput, TwoBoneIKResult } from './ik/solveTwoBoneIK.js';
export { blendIKRotation, solveTwoBoneIK } from './ik/solveTwoBoneIK.js';
export { TwoBoneIKConstraint } from './ik/TwoBoneIKConstraint.js';
export type {
  BendDirection,
  IKStatus,
  IKTarget,
  IKTargetProvider,
  IKTransformContext,
  TwoBoneIKDefinition,
} from './ik/types.js';
export { Joint } from './Joint.js';
export type { PoseDefinition } from './Pose.js';
export {
  applyPoseToJoints,
  POSE_FORMAT_VERSION,
  PoseValidationError,
  parsePoseDefinition,
  poseDefinitionSchema,
  serializePose,
  validatePoseDefinition,
} from './Pose.js';
export { Rig } from './Rig.js';
export type { DeepReadonly } from './readonlyData.js';
export { SlotState } from './SlotState.js';
export {
  animationClipSchema,
  rigDefinitionSchema,
  skinDefinitionSchema,
  slotDefinitionSchema,
  spriteAttachmentSchema,
  twoBoneIKDefinitionSchema,
} from './schemas.js';
export type {
  AttachmentOptions,
  BoneDefinition,
  Facing,
  JointTransform,
  RigDefinition,
  SkinDefinition,
  SlotDefinition,
  SpriteAttachmentDefinition,
  SpriteDefinition,
  TransformProperty,
} from './types.js';

export type { IKKeyframe, IKAnimationTrack, IKAnimationProperty } from './ik/animationKeyframes.js';
export {
  createIKAnimationTrack,
  setIKPropertyKeyframe,
  removeIKPropertyKeyframe,
  moveIKPropertyKeyframe,
  getIKPropertyKeyframes,
  findIKPropertyKeyframe,
  getIKKeyedPropertiesAtTime,
  ikAnimationProperties,
} from './ik/animationKeyframes.js';
export { ikKeyframeSchema, ikMixSchema } from './schemas.js';

export type { IKAnimationChannel, IKAnimationValues, IKAnimationPose } from './ik/AnimationIKPose.js';
export { evaluateIKClip } from './ik/AnimationIKPose.js';
