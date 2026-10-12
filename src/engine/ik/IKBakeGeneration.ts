import { type AnimationClip, type AnimationPlaybackMode, compileClip, type Keyframe } from '../AnimationClip.js';
import { quantizePlaybackTime, shortestRotationDelta } from '../animationMath.js';
import { evaluateClip } from '../AnimationPose.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip, type ValidationIssue } from '../externalData.js';
import { keyframeTimesMatch, normalizeKeyframeTime } from '../keyframeAuthoring.js';
import { type DeepReadonly, freezeData } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import { createTransform, transformProperties } from '../types.js';
import { getValidatedAnimation } from '../validatedAnimation.js';
import {
  getIKBakeSampleTimes,
  type IKBakeIssueCode,
  type IKBakeSample,
  type IKBakeSampleResult,
} from './IKBakeSampling.js';

export interface IKBakeTolerances {
  /** Euclidean distance in immediate-parent rig units. */
  readonly translation: number;
  /** Shortest angular distance in radians, including equivalent full turns. */
  readonly rotation: number;
  /** Maximum absolute difference of the two unitless scale components. */
  readonly scale: number;
}

export const DEFAULT_IK_BAKE_TOLERANCES: Readonly<IKBakeTolerances> = Object.freeze({
  translation: 1e-6,
  rotation: 1e-6,
  scale: 1e-9,
});

export interface IKBakeGenerationIssue extends ValidationIssue {
  readonly code: IKBakeIssueCode | 'invalid-generation' | 'fidelity-mismatch' | 'between-sample-interpolation';
  readonly boneIds?: readonly string[];
  readonly constraintIds?: readonly string[];
  readonly time?: number;
}

export interface IKBakePoseDifference {
  readonly boneId: string;
  readonly time: number;
  readonly translation: number;
  readonly rotation: number;
  readonly scale: number;
}

export interface IKBakeFidelityResult {
  readonly success: boolean;
  readonly tolerances: Readonly<IKBakeTolerances>;
  readonly differences: readonly IKBakePoseDifference[];
  readonly maximumErrors: Readonly<IKBakeTolerances>;
  readonly issues: readonly IKBakeGenerationIssue[];
}

export interface IKBakeGenerationOptions {
  /** Authored source used for replacement reporting and unchanged-property fidelity checks. */
  readonly animation: DeepReadonly<AnimationClip>;
  /** Defaults to stepped playback at the sample FPS. Interpolation remains ordinary linear. */
  readonly outputMode?: 'stepped' | 'smooth';
  readonly tolerances?: Partial<IKBakeTolerances>;
}

export interface IKBakeAffectedBone {
  readonly boneId: string;
  readonly properties: readonly {
    readonly property: 'rotation';
    readonly generatedKeyCount: number;
    /** Every authored rotation key on this bone would be replaced over the whole duration. */
    readonly existingKeys: readonly { readonly time: number; readonly value: number }[];
    readonly replacedKeyCount: number;
  }[];
}

export type IKBakePlan =
  | {
      readonly success: true;
      /** Ordinary sparse bone keys only; not installed or merged into the authored source. */
      readonly generatedAnimation: DeepReadonly<AnimationClip>;
      /** Detached authored snapshot used to reject stale commits. */
      readonly sourceAnimation: DeepReadonly<AnimationClip>;
      readonly affectedBones: readonly IKBakeAffectedBone[];
      /** Property-key count, rather than the number of combined sparse rows. */
      readonly generatedKeyCount: number;
      readonly replacedKeyCount: number;
      readonly sampling: {
        readonly fps: number;
        readonly duration: number;
        readonly times: readonly number[];
        readonly evaluatedTimes: readonly number[];
        readonly constraintIds: readonly string[];
        readonly sourcePlayback: Readonly<AnimationPlaybackMode>;
        readonly outputPlayback: Readonly<AnimationPlaybackMode>;
      };
      readonly fidelity: IKBakeFidelityResult;
      readonly issues: readonly IKBakeGenerationIssue[];
    }
  | {
      readonly success: false;
      readonly issues: readonly IKBakeGenerationIssue[];
      readonly fidelity?: IKBakeFidelityResult;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function copyIssue(issue: IKBakeGenerationIssue): IKBakeGenerationIssue {
  return {
    ...issue,
    ...(issue.boneIds ? { boneIds: [...issue.boneIds] } : {}),
    ...(issue.constraintIds ? { constraintIds: [...issue.constraintIds] } : {}),
  };
}

function tolerancesFor(overrides: Partial<IKBakeTolerances>): IKBakeTolerances {
  const tolerances = { ...DEFAULT_IK_BAKE_TOLERANCES, ...overrides };
  if (!Object.values(tolerances).every((value) => Number.isFinite(value) && value >= 0))
    throw new Error('Bake tolerances must be finite and nonnegative.');
  return tolerances;
}

/** Compare complete selected bone-local poses against ordinary bone animation, with IK unapplied.
 * Uses existing bind defaults, interpolation and playback quantization, retaining the exact endpoint
 * without loop wrapping. Invalid input returns failure, never a passing NaN comparison.
 */
export function compareIKBakeFidelity(
  samples: readonly IKBakeSample[],
  animation: DeepReadonly<AnimationClip>,
  rig: Rig,
  overrides: Partial<IKBakeTolerances> = {},
): IKBakeFidelityResult {
  let tolerances: IKBakeTolerances = { ...DEFAULT_IK_BAKE_TOLERANCES };
  const differences: IKBakePoseDifference[] = [];
  const maximumErrors = { translation: 0, rotation: 0, scale: 0 };
  const issues: IKBakeGenerationIssue[] = [];
  try {
    tolerances = tolerancesFor(overrides);
    const clip = compileClip(animation, rig);
    if (!samples.length) throw new Error('Fidelity comparison needs at least one sample.');
    for (const sample of samples) {
      if (!Number.isFinite(sample.time) || sample.time < 0 || sample.time > clip.duration || !sample.pose.size)
        throw new Error('Fidelity samples need finite in-range times and nonempty bone-local poses.');
      const time =
        sample.time === clip.duration
          ? sample.time
          : quantizePlaybackTime(sample.time, clip.playback ?? { mode: 'smooth' });
      const evaluated = evaluateClip(clip, time);
      for (const [boneId, expected] of sample.pose) {
        const actual = { ...createTransform(rig.getBone(boneId)), ...evaluated.get(boneId) };
        if (
          !transformProperties.every(
            (property) => Number.isFinite(expected[property]) && Number.isFinite(actual[property]),
          )
        ) {
          issues.push({
            code: 'non-finite-transform',
            severity: 'error',
            message: `Bone "${boneId}" has an invalid local transform in the fidelity comparison.`,
            boneIds: [boneId],
            time: sample.time,
          });
          continue;
        }
        const difference: IKBakePoseDifference = {
          boneId,
          time: sample.time,
          translation: Math.hypot(actual.x - expected.x, actual.y - expected.y),
          rotation: Math.abs(shortestRotationDelta(expected.rotation, actual.rotation)),
          scale: Math.max(Math.abs(actual.scaleX - expected.scaleX), Math.abs(actual.scaleY - expected.scaleY)),
        };
        differences.push(difference);
        for (const property of ['translation', 'rotation', 'scale'] as const)
          maximumErrors[property] = Math.max(maximumErrors[property], difference[property]);
        if (![difference.translation, difference.rotation, difference.scale].every(Number.isFinite))
          issues.push({
            code: 'non-finite-transform',
            severity: 'error',
            message: 'Fidelity arithmetic overflowed.',
            boneIds: [boneId],
            time: sample.time,
          });
        else if (
          difference.translation > tolerances.translation ||
          difference.rotation > tolerances.rotation ||
          difference.scale > tolerances.scale
        )
          issues.push({
            code: 'fidelity-mismatch',
            severity: 'error',
            message: `Bone "${boneId}" differs from the solved sample beyond bake tolerances.`,
            boneIds: [boneId],
            time: sample.time,
          });
      }
    }
  } catch (error) {
    issues.push({ code: 'invalid-generation', severity: 'error', message: errorMessage(error) });
  }
  return freezeData({ success: !issues.length, tolerances, differences, maximumErrors, issues });
}

/** Pure whole-animation key proposal. The existing solver changes only root/middle local rotations;
 * sampled radians already use the authored local convention, so no world decomposition is needed.
 * Source tracks, IK, events, editor history and live poses are never changed.
 */
export function generateBakedBoneKeys(
  result: IKBakeSampleResult,
  rig: Rig,
  options: IKBakeGenerationOptions,
): IKBakePlan {
  if (!result.success) return freezeData({ success: false, issues: result.issues.map(copyIssue) });
  try {
    const source = getValidatedAnimation(options.animation, rig);
    tolerancesFor(options.tolerances ?? {});
    if (options.outputMode !== undefined && options.outputMode !== 'smooth' && options.outputMode !== 'stepped')
      throw new Error('Bake output mode must be smooth or stepped.');
    if (!result.constraintIds.length || new Set(result.constraintIds).size !== result.constraintIds.length)
      throw new Error('Bake generation requires distinct selected constraints.');
    const selected = new Set(result.constraintIds);
    const driven = new Set<string>();
    for (const id of selected) {
      const definition = rig.ik?.find((constraint) => constraint.name === id);
      if (!definition) throw new Error(`Unknown selected IK constraint "${id}".`);
      for (const boneId of [definition.rootBone, definition.middleBone]) {
        if (driven.has(boneId))
          return freezeData({
            success: false,
            issues: [
              {
                code: 'competing-constraint',
                severity: 'error',
                message: `Selected constraints share driven bone "${boneId}".`,
                constraintIds: [...selected],
                boneIds: [boneId],
              },
            ],
          });
        driven.add(boneId);
      }
    }
    for (const definition of rig.ik ?? []) {
      if (
        selected.has(definition.name) ||
        definition.enabled === false ||
        source.disabledIKConstraints?.includes(definition.name)
      )
        continue;
      const shared = [definition.rootBone, definition.middleBone].filter((id) => driven.has(id));
      if (shared.length)
        return freezeData({
          success: false,
          issues: [
            {
              code: 'competing-constraint',
              severity: 'error',
              message: `Enabled IK "${definition.name}" competes for selected driven bones.`,
              constraintIds: [...selected, definition.name],
              boneIds: shared,
            },
          ],
        });
    }
    if (
      result.boneIds.length !== driven.size ||
      new Set(result.boneIds).size !== driven.size ||
      result.boneIds.some((id) => !driven.has(id))
    )
      throw new Error('Sampled bone ownership does not match the selected rig constraints.');
    if (result.issues.some((issue) => issue.severity === 'error'))
      throw new Error('Sample result contains validation errors.');
    const times = getIKBakeSampleTimes(source.duration, result.fps);
    if (times.length !== result.samples.length) throw new Error('Samples must cover the entire animation frame grid.');
    for (const [index, sample] of result.samples.entries()) {
      // Keep the sampler sequence and exact key times. Tolerance is for matching, never FPS snapping.
      const time = normalizeKeyframeTime(source.duration, sample.time);
      if (!keyframeTimesMatch(time, times[index]!) || (index > 0 && time <= result.samples[index - 1]!.time))
        throw new Error('Samples must preserve the sorted whole-animation frame grid.');
      if ((index === 0 && sample.time !== 0) || (index === times.length - 1 && sample.time !== source.duration))
        throw new Error('Samples must retain exact zero and end times.');
      const evaluatedTime =
        sample.time === source.duration
          ? sample.time
          : quantizePlaybackTime(sample.time, source.playback ?? { mode: 'smooth' });
      if (!keyframeTimesMatch(sample.evaluatedTime, evaluatedTime))
        throw new Error('Sample evaluation times do not match authored playback.');
      if (sample.pose.size !== driven.size || [...sample.pose.keys()].some((id) => !driven.has(id)))
        throw new Error('Sample poses must contain exactly the selected driven bones.');
      for (const id of selected) {
        const state = sample.constraints.get(id);
        if (!state || !['inactive', 'solved', 'clamped'].includes(state.status))
          throw new Error(`Sample IK "${id}" has an invalid solver status.`);
        if (state.target && (!Number.isFinite(state.target.x) || !Number.isFinite(state.target.y)))
          throw new Error(`Sample IK "${id}" has a non-finite target.`);
      }
      for (const [boneId, pose] of sample.pose)
        if (!transformProperties.every((property) => Number.isFinite(pose[property])))
          return freezeData({
            success: false,
            issues: [
              {
                code: 'non-finite-transform',
                severity: 'error',
                message: `Sample bone "${boneId}" has an invalid local transform.`,
                boneIds: [boneId],
                time: sample.time,
              },
            ],
          });
    }

    const playback: AnimationPlaybackMode =
      options.outputMode === 'smooth' ? { mode: 'smooth' } : { mode: 'stepped', fps: result.fps };
    const tracks = new Map<string, Keyframe[]>();
    const affectedBones: IKBakeAffectedBone[] = [];
    // A private candidate retains all ungenerated authored properties for full local-pose validation.
    // It is evaluated before IK; no constraints or authored IK tracks are deleted or disabled.
    const candidateTracks = new Map<string, readonly Keyframe[]>(Object.entries(source.tracks));
    for (const boneId of result.boneIds) {
      const keys = result.samples.map((sample) => ({
        time: normalizeKeyframeTime(source.duration, sample.time),
        rotation: sample.pose.get(boneId)!.rotation,
      }));
      tracks.set(boneId, keys);
      const existingKeys = (source.tracks[boneId] ?? []).flatMap((key) =>
        key.rotation === undefined ? [] : [{ time: key.time, value: key.rotation }],
      );
      affectedBones.push({
        boneId,
        properties: [
          { property: 'rotation', generatedKeyCount: keys.length, existingKeys, replacedKeyCount: existingKeys.length },
        ],
      });
      const byTime = new Map<number, Keyframe>();
      for (const key of source.tracks[boneId] ?? []) {
        const { rotation: _rotation, ...siblings } = key;
        if (['x', 'y', 'scaleX', 'scaleY'].some((property) => Object.hasOwn(siblings, property)))
          byTime.set(key.time, siblings);
      }
      for (const key of keys) byTime.set(key.time, { ...byTime.get(key.time), ...key });
      candidateTracks.set(
        boneId,
        [...byTime.values()].sort((a, b) => a.time - b.time),
      );
    }
    const generatedAnimation: AnimationClip = {
      name: source.name,
      duration: source.duration,
      loop: source.loop,
      interpolation: 'linear',
      playback,
      tracks: Object.fromEntries(tracks),
    };
    compileClip(generatedAnimation, rig);
    const fidelity = compareIKBakeFidelity(
      result.samples,
      { ...source, tracks: Object.fromEntries(candidateTracks), playback },
      rig,
      options.tolerances,
    );
    if (!fidelity.success) return freezeData({ success: false, issues: [...fidelity.issues], fidelity });
    const issues: IKBakeGenerationIssue[] = result.issues.map(copyIssue);
    if (playback.mode === 'smooth')
      issues.push({
        code: 'between-sample-interpolation',
        severity: 'warning',
        message:
          'Linear bone interpolation between sampled poses may differ from continuous IK solving. Generation checks sample times; commit also measures midpoint and near-end motion.',
      });
    return freezeData({
      success: true,
      generatedAnimation,
      sourceAnimation: parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...source }, rig),
      affectedBones,
      generatedKeyCount: result.samples.length * driven.size,
      replacedKeyCount: affectedBones.reduce((count, bone) => count + bone.properties[0]!.replacedKeyCount, 0),
      sampling: {
        fps: result.fps,
        duration: source.duration,
        times: result.samples.map((sample) => sample.time),
        evaluatedTimes: result.samples.map((sample) => sample.evaluatedTime),
        constraintIds: [...result.constraintIds],
        sourcePlayback: { ...(source.playback ?? { mode: 'smooth' }) },
        outputPlayback: { ...playback },
      },
      fidelity,
      issues,
    });
  } catch (error) {
    return freezeData({
      success: false,
      issues: [{ code: 'invalid-generation', severity: 'error', message: errorMessage(error) }],
    });
  }
}
