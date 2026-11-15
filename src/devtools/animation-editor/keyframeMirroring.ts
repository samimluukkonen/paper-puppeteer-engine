import { evaluateClip, AnimationValidationError, type AnimationPose } from '../../engine/core.js';
import type { Rig, TransformProperty } from '../../engine/data.js';
import { validateBoneSymmetryMapping, type BoneSymmetryMapping } from '../shared/boneSymmetry.js';
import { mirrorPose, type MirrorDirection } from '../shared/poseMirroring.js';
import { getEvaluatedAnimationPose } from './animationValues.js';
import { setBonePropertyKeyframes, type PropertyKeyframeEdit, type PropertyKeyframeTarget } from './keyframeEdits.js';
import { findBonePropertyKeyframe, getAuthoredBoneProperties } from './keyframeQueries.js';
import { assertTarget, type AnimationData } from './keyframeTargets.js';
import { getCompiledPreviewClip } from './previewClip.js';
import type { Milliseconds } from './timeUnits.js';
import { getValidatedEditorAnimation } from './validatedAnimation.js';

export interface MirrorCurrentPoseOptions {
  /** Source bones. Omitted means every mapped source bone for the direction. */
  readonly boneIds?: readonly string[];
  /** Omitted means only properties already authored on each source bone, across the clip. */
  readonly properties?: readonly TransformProperty[];
}

export interface KeyframeMirrorResult<Animation extends AnimationData> {
  readonly animation: Animation;
  /** Destination property keys in milliseconds, in source order. */
  readonly keys: readonly PropertyKeyframeTarget[];
}

function sourceTargets(mapping: BoneSymmetryMapping, rig: Rig, direction: MirrorDirection): Map<string, string> {
  const issues = validateBoneSymmetryMapping(rig, mapping);
  // Hierarchy warnings are blocking for mirror math, as in mirrorPose.
  if (issues.length) throw new AnimationValidationError(issues.map((issue) => ({ ...issue, severity: 'error' })));
  if (direction !== 'left-to-right' && direction !== 'right-to-left' && direction !== 'swap')
    throw new Error('Choose left-to-right, right-to-left or swap.');
  const targets = new Map<string, string>();
  for (const { leftBoneId, rightBoneId } of mapping.pairs) {
    if (direction !== 'right-to-left') targets.set(leftBoneId, rightBoneId);
    if (direction !== 'left-to-right') targets.set(rightBoneId, leftBoneId);
  }
  return targets;
}

function destination(targets: ReadonlyMap<string, string>, sourceId: string, direction: MirrorDirection): string {
  const target = targets.get(sourceId);
  if (!target) throw new Error(`Bone "${sourceId}" needs a symmetry pair on the source side of ${direction}.`);
  return target;
}

function reflected(
  pose: AnimationPose,
  rig: Rig,
  mapping: BoneSymmetryMapping,
  direction: MirrorDirection,
  sourceBoneIds: readonly string[],
): AnimationPose {
  const result = mirrorPose(pose, rig, mapping, direction, { sourceBoneIds });
  if (!result.success) throw new AnimationValidationError(result.issues);
  return result.pose;
}

/** Sample and validate mirror values without building or validating an edited animation snapshot. */
export function sampleCurrentPoseMirror(
  animation: AnimationData,
  rig: Rig,
  mapping: BoneSymmetryMapping,
  currentTimeMs: Milliseconds,
  direction: MirrorDirection,
  options: MirrorCurrentPoseOptions = {},
): { pose: AnimationPose; edits: readonly PropertyKeyframeEdit[] } {
  getValidatedEditorAnimation(animation, rig);
  const targets = sourceTargets(mapping, rig, direction);
  const boneIds = [...new Set(options.boneIds ?? targets.keys())];
  const activeSources: string[] = [];
  const keys: PropertyKeyframeTarget[] = [];
  for (const sourceId of boneIds) {
    const boneId = destination(targets, sourceId, direction);
    const properties = [...new Set(options.properties ?? getAuthoredBoneProperties(animation, sourceId))];
    if (properties.length) activeSources.push(sourceId);
    for (const property of properties) {
      const timeMs = assertTarget(animation, rig, boneId, property, currentTimeMs);
      keys.push({ boneId, property, timeMs });
    }
  }
  // Sampling also validates time for an empty sparse operation.
  const pose = getEvaluatedAnimationPose(animation, rig, currentTimeMs);
  if (!keys.length) return { pose, edits: [] };
  // Unanimated pairs contribute no writes. Their transforms must not block an unrelated sparse edit.
  const mirrored = reflected(pose, rig, mapping, direction, activeSources);
  const edits = keys.map((key) => ({ ...key, value: mirrored.get(key.boneId)![key.property]! }));
  return { pose, edits };
}

/** Explicit authored commit proposal; sparse source properties stay sparse unless requested. */
export function mirrorCurrentPoseToKeys<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  mapping: BoneSymmetryMapping,
  currentTimeMs: Milliseconds,
  direction: MirrorDirection,
  options: MirrorCurrentPoseOptions = {},
): KeyframeMirrorResult<Animation> {
  const { edits } = sampleCurrentPoseMirror(animation, rig, mapping, currentTimeMs, direction, options);
  return {
    animation: setBonePropertyKeyframes(animation, rig, edits, { preserveTiming: true }),
    keys: edits.map(({ boneId, property, timeMs }) => ({ boneId, property, timeMs })),
  };
}

/** Resolve and reflect selected keys at their exact authored times without constructing edited tracks. */
export function sampleSelectedKeyframeMirror(
  animation: AnimationData,
  rig: Rig,
  mapping: BoneSymmetryMapping,
  selectedKeys: readonly PropertyKeyframeTarget[],
  direction: MirrorDirection,
): readonly PropertyKeyframeEdit[] {
  getValidatedEditorAnimation(animation, rig);
  const targets = sourceTargets(mapping, rig, direction);
  const sources = new Map<string, PropertyKeyframeTarget>();
  for (const ref of selectedKeys) {
    const timeMs = assertTarget(animation, rig, ref.boneId, ref.property, ref.timeMs);
    destination(targets, ref.boneId, direction);
    const key = findBonePropertyKeyframe(animation, ref.boneId, ref.property, timeMs);
    if (!key)
      throw new Error(`Missing source key ${ref.boneId}.${ref.property} at ${timeMs} ms. Refresh the selection.`);
    const source = { ...ref, timeMs: key.time };
    sources.set(JSON.stringify([ref.boneId, ref.property, key.time]), source);
  }
  if (!sources.size) return [];
  const groups = new Map<Milliseconds, Set<string>>();
  for (const source of sources.values()) {
    const bones = groups.get(source.timeMs) ?? new Set<string>();
    bones.add(source.boneId);
    groups.set(source.timeMs, bones);
  }
  const clip = getCompiledPreviewClip(animation, rig);
  const poses = new Map<Milliseconds, AnimationPose>();
  for (const [timeMs, bones] of groups)
    poses.set(timeMs, reflected(evaluateClip(clip, timeMs), rig, mapping, direction, [...bones]));
  const edits: PropertyKeyframeEdit[] = [...sources.values()].map((source) => {
    const boneId = destination(targets, source.boneId, direction);
    return {
      boneId,
      property: source.property,
      timeMs: source.timeMs,
      value: poses.get(source.timeMs)!.get(boneId)![source.property]!,
      curve: findBonePropertyKeyframe(animation, source.boneId, source.property, source.timeMs)!.curve ?? null,
    };
  });
  return edits;
}

/** Project selected values in one validated batch with existing group collision replacement. */
export function mirrorSelectedKeyframes<Animation extends AnimationData>(
  animation: Animation,
  rig: Rig,
  mapping: BoneSymmetryMapping,
  selectedKeys: readonly PropertyKeyframeTarget[],
  direction: MirrorDirection,
): KeyframeMirrorResult<Animation> {
  const edits = sampleSelectedKeyframeMirror(animation, rig, mapping, selectedKeys, direction);
  return {
    animation: setBonePropertyKeyframes(animation, rig, edits, { preserveTiming: true }),
    keys: edits.map(({ boneId, property, timeMs }) => ({ boneId, property, timeMs })),
  };
}
