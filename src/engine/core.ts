export { sampleMeshDeformation, evaluateMeshDeformation, meshDeformationIssues } from './meshDeformation.js';
export { meshDeformationKeySchema, meshDeformationTracksSchema } from './schemas.js';
export type {
  VertexOffset,
  MeshDeformationKey,
  MeshDeformationTracks,
  MeshVertexOffsets,
  MeshDeformationPose,
} from './meshDeformation.js';
/** Public renderer-independent APIs. Existing pure authoring and bake exports remain supported. */
export { MAX_BONE_INFLUENCES, normalizeBoneInfluences, createMeshSkinBinding, deformMesh } from './meshSkinning.js';
export type { MeshSkinBinding } from './meshSkinning.js';
export { MeshWeightStroke, setBoneWeight, boneWeightColor } from './meshWeightPainting.js';
export type { WeightBrushOptions } from './meshWeightPainting.js';
export {
  AUDIO_CATEGORIES,
  AUDIO_MAX_FILE_BYTES,
  audioAssetDefinitionSchema,
  inspectAudioData,
  validateAudioAssetData,
} from './AudioAsset.js';
export type { AudioAssetDefinition, AudioCategory, AudioFormat } from './AudioAsset.js';
export { DEFAULT_SCENE_WORKLOAD_LIMITS } from './sceneWorkloadLimits.js';
export type {
  AnimationClip,
  AnimationLibraryMetadata,
  AnimationEvent,
  AnimationPlaybackMode,
  CompiledClip,
  CompiledIKTrack,
  CompiledTrack,
  Interpolation,
  Keyframe,
  PropertyKeyframe,
} from './AnimationClip.js';
export { compileClip, sampleProperty } from './AnimationClip.js';
export type { CurveHandle, PropertyCurve, PropertyCurves } from './animationCurves.js';
export type {
  RootMotionDefinition,
  RootMotionKey,
  RootMotionOffset,
  RootMotionProperty,
  RootMotionPolicy,
  RootMotionPlaybackOptions,
  RootMotionApplication,
} from './rootMotion.js';
export {
  ROOT_MOTION_PROPERTIES,
  sampleRootMotion,
  evaluateRootMotion,
  evaluateRootMotionAtTime,
  evaluateRootMotionAtElapsedTime,
  getRootMotionDelta,
} from './rootMotion.js';
export { rootMotionDefinitionSchema, rootMotionKeySchema } from './schemas.js';
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
  footContactMarkerSchema,
  skinDefinitionSchema,
  slotDefinitionSchema,
  spriteAttachmentSchema,
  attachmentSchema,
  meshAttachmentSchema,
  meshVertexSchema,
  meshBindPoseSchema,
  twoBoneIKDefinitionSchema,
} from './schemas.js';
export type {
  AttachmentDefinition,
  AttachmentDefinitionBase,
  MeshVertex,
  BoneInfluence,
  MeshBindPose,
  MeshAttachmentDefinition,
  AttachmentOptions,
  BoneDefinition,
  Facing,
  FootContactMarker,
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

export { createFootContactMarker, getFootContactWorldPosition } from './footContactMarkers.js';
export type { CreateFootContactMarkerOptions } from './footContactMarkers.js';

export type { CinematicCameraState, CameraViewport, CinematicCameraTarget } from './cinematicCamera.js';
export {
  DEFAULT_CINEMATIC_CAMERA,
  SCENE_OUTPUT_VIEWPORT,
  CINEMATIC_CAMERA_MIN_ZOOM,
  CINEMATIC_CAMERA_MAX_ZOOM,
  cinematicCameraSchema,
  cinematicFrame,
  cameraForBounds,
  applyCinematicCamera,
} from './cinematicCamera.js';

export type { CameraProperty, CameraKeyframe, CameraTracks } from './cameraAnimation.js';
export {
  CAMERA_PROPERTIES,
  evaluateCameraAtTime,
  cameraKeyframeSchema,
  cameraTracksSchema,
} from './cameraAnimation.js';
export { evaluateTransitionAtTime, sceneTransitionSchema, CLEAR_SCENE_TRANSITION } from './sceneTransitions.js';
export type { SceneTransition, SceneTransitionState, SceneTransitionTarget } from './sceneTransitions.js';

export type { SceneAudioClip, SceneAudioTrack } from './sceneAudio.js';
export {
  sceneAudioClipSchema,
  sceneAudioTrackSchema,
  trimSceneAudioClip,
  getActiveAudioClipsAtTime,
} from './sceneAudio.js';

export type { ActiveSceneAudioClip } from './sceneAudio.js';

export type { SceneDialogueLine, ActiveSceneDialogue, SceneDialogueTarget } from './sceneDialogue.js';
export { sceneDialogueLineSchema, getDialogueLineAtTime, getDialogueAtTime, dialogueSpeaker } from './sceneDialogue.js';

export {
  MESH_LIMITS,
  MESH_AREA_EPSILON,
  triangleSignedArea2,
  validateMeshTopology,
  meshBounds,
  getMeshVertex,
  imagePixelToUV,
  uvToImagePixel,
  imagePixelToAttachmentLocal,
  attachmentLocalToImagePixel,
} from './meshGeometry.js';
export {
  createMeshBindPose,
  validateMeshBindPose,
  createRectangleMeshAttachment,
  replaceMeshGeometry,
  meshAttachmentToBindPose,
  bindPoseToMeshAttachment,
  meshBindPoseToBoneLocal,
} from './meshAttachments.js';

export { meshEdges, subdivideMeshEdge, deleteMeshVertex } from './meshEditing.js';

export { inspectMeshDeformation } from './meshDiagnostics.js';
export type { MeshTriangleDiagnostic } from './meshDiagnostics.js';
