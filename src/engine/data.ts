/** Shared authored data contracts. Type-only imports require neither Phaser nor React. */
export type { AudioAssetDefinition, AudioCategory, AudioFormat } from './AudioAsset.js';
export type {
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
export type { AnimationClip, AnimationEvent, AnimationPlaybackMode, Interpolation, Keyframe } from './AnimationClip.js';
export type { CurveHandle, PropertyCurve, PropertyCurves } from './animationCurves.js';
export type { RootMotionDefinition, RootMotionKey, RootMotionOffset, RootMotionProperty } from './rootMotion.js';
export type { CharacterData, CharacterManifest } from './CharacterDefinition.js';
export type {
  AnimationJsonDefinition,
  AnimationJsonEvent,
  JsonValue,
  RigJsonDefinition,
  ValidationIssue,
} from './externalData.js';
export type { PoseDefinition } from './Pose.js';
export type { DeepReadonly } from './readonlyData.js';
export type { BendDirection, IKTarget, IKTargetProvider, TwoBoneIKDefinition } from './ik/types.js';
export type { IKAnimationProperty, IKAnimationTrack, IKKeyframe } from './ik/animationKeyframes.js';

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

export type { CreateFootContactMarkerOptions } from './footContactMarkers.js';

export type { CinematicCameraState, CameraViewport, CinematicCameraTarget } from './cinematicCamera.js';

export type { CameraProperty, CameraKeyframe, CameraTracks } from './cameraAnimation.js';
export type { SceneTransition, SceneTransitionState, SceneTransitionTarget } from './sceneTransitions.js';

export type { SceneAudioClip, SceneAudioTrack } from './sceneAudio.js';

export type { ActiveSceneAudioClip } from './sceneAudio.js';

export type { SceneDialogueLine, ActiveSceneDialogue, SceneDialogueTarget } from './sceneDialogue.js';
