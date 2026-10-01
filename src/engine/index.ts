export type { AnimationClip, AnimationEvent, AnimationPlaybackMode, Interpolation, Keyframe } from './AnimationClip.js';
export type {
  AnimationCompletion,
  FiredAnimationEvent,
  PlayAnimationOptions,
  SampleAnimationOptions,
} from './AnimationPlayer.js';
export { AnimationPlayer } from './AnimationPlayer.js';
export type { AnimationPose } from './AnimationPose.js';
export { blendPose, evaluateClip, lerpProperty } from './AnimationPose.js';
export { Bone } from './Bone.js';
export type { CharacterData, CharacterManifest } from './CharacterDefinition.js';
export {
  CHARACTER_FORMAT_VERSION,
  CharacterDefinition,
  CharacterValidationError,
  characterManifestSchema,
  validateCharacterDefinition,
} from './CharacterDefinition.js';
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
} from './Pose.js';
export type { PuppetOptions } from './Puppet.js';
export { Puppet } from './Puppet.js';
export { queueCharacterTextures } from './queueCharacterTextures.js';
export { Rig } from './Rig.js';
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
