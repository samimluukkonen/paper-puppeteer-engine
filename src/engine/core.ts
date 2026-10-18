/** Public renderer-independent APIs. Existing pure authoring and bake exports remain supported. */
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
  PlayAndWaitOptions,
  SampleAnimationOptions,
  WaitForPlaybackOptions,
} from './AnimationPlayer.js';
export { AnimationPlayer } from './AnimationPlayer.js';
export type { AnimationQueueRequest, QueueAnimationOptions } from './AnimationQueue.js';
export { AnimationStateController } from './AnimationStateController.js';
export type {
  AnimationStateHost,
  AnimationStateDefinition,
  AnimationStateControllerOptions,
  SetAnimationStateOptions,
  AnimationActionOptions,
} from './AnimationStateController.js';
export type {
  PlaybackInstanceId,
  PlaybackOutcome,
  PlaybackWaitResult,
  PlaybackState,
  PlaybackStatus,
  PlaybackLifecycleEvent,
  PlaybackLifecycleOptions,
} from './PlaybackLifecycle.js';
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
export { CharacterLoader, DEFAULT_CHARACTER_LOAD_LIMITS } from './CharacterLoader.js';
export { DEFAULT_MAX_JSON_BYTES, JsonInputLimitError } from './jsonInput.js';
export { DEFAULT_JSON_WORKLOAD_LIMITS } from './jsonWorkloadLimits.js';
export type { JsonWorkloadLimitOptions } from './jsonWorkloadLimits.js';
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
export type {
  IKBakeIssue,
  IKBakeIssueCode,
  IKBakeSample,
  IKBakeSampleResult,
  IKBakeSamplingOptions,
} from './ik/IKBakeSampling.js';
export { getIKBakeSampleTimes, sampleIKBake } from './ik/IKBakeSampling.js';
export type {
  IKBakeAffectedBone,
  IKBakeFidelityResult,
  IKBakeGenerationIssue,
  IKBakeGenerationOptions,
  IKBakePlan,
  IKBakePoseDifference,
  IKBakeTolerances,
} from './ik/IKBakeGeneration.js';
export { compareIKBakeFidelity, DEFAULT_IK_BAKE_TOLERANCES, generateBakedBoneKeys } from './ik/IKBakeGeneration.js';

export { commitIKBake } from './ik/IKBakeCommit.js';
export type { IKBakeCommitResult } from './ik/IKBakeCommit.js';
export { compareIKBakeMotion, DEFAULT_IK_BAKE_MOTION_TOLERANCES } from './ik/IKBakeMotionFidelity.js';
export type { IKBakeMotionErrors, IKBakeMotionFidelity } from './ik/IKBakeMotionFidelity.js';
export {
  serializeRigDefinition,
  serializeAnimationDefinition,
  serializeSkinDefinition,
  serializeCharacterManifest,
} from './authoredSerialization.js';

export {
  createIKConstraint,
  updateIKConstraint,
  removeIKConstraint,
  getIKConstraint,
  ikConstraintDependencies,
} from './ik/ikAuthoring.js';
export type { CreateIKConstraintOptions, IKConstraintPatch, IKConstraintDependencies } from './ik/ikAuthoring.js';

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
