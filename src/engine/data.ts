/** Shared authored data contracts. Type-only imports require neither Phaser nor React. */
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
