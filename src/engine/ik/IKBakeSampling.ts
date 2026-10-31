import { type Affine, composeAffine, transformToAffine } from '../affineMath.js';
import { type AnimationClip, compileValidatedClip } from '../AnimationClip.js';
import { DEFAULT_ANIMATION_FPS } from '../animationMath.js';
import type { ValidationIssue } from '../externalData.js';
import { type DeepReadonly, readonlyMap } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import type { JointTransform } from '../types.js';
import { getValidatedAnimation } from '../validatedAnimation.js';
import { getIKBakeSampleCount, preflightIKBake } from './IKBakeBudget.js';
import { IsolatedIKSampler } from './IsolatedIKSampler.js';
import type { TwoBoneIKConstraint } from './TwoBoneIKConstraint.js';
import type { IKStatus, IKTarget } from './types.js';

export interface IKBakeSamplingOptions {
  /** Sampling density only; authored stepped playback still controls evaluation. */
  readonly fps?: number;
  /** Optional live-context guard. Runtime overrides/providers and extra chains are rejected,
   * never evaluated or copied into the isolated context. Omit for authored-only tooling.
   */
  readonly runtimeConstraints?: readonly TwoBoneIKConstraint[];
}

export interface IKBakeSample {
  /** Requested frame time in milliseconds, including the exact endpoint. */
  readonly time: number;
  /** Runtime playback time; stepped frames can share this value. */
  readonly evaluatedTime: number;
  /** Complete absolute bone-local transforms for the selected root/middle joints.
   * Rotation is radians; translation is in the immediate parent frame. End rotation is not driven by IK.
   */
  readonly pose: ReadonlyMap<string, Readonly<JointTransform>>;
  readonly constraints: ReadonlyMap<string, { readonly status: IKStatus; readonly target?: Readonly<IKTarget> }>;
}

export type IKBakeIssueCode =
  | 'invalid-selection'
  | 'unknown-constraint'
  | 'competing-constraint'
  | 'external-state'
  | 'invalid-animation'
  | 'invalid-sampling'
  | 'singular-transform'
  | 'unsupported-scale'
  | 'non-finite-transform'
  | 'evaluation-failed';

export interface IKBakeIssue extends ValidationIssue {
  readonly code: IKBakeIssueCode;
  readonly constraintIds?: readonly string[];
  readonly boneIds?: readonly string[];
  readonly time?: number;
}

export type IKBakeSampleResult =
  | {
      readonly success: true;
      readonly fps: number;
      readonly constraintIds: readonly string[];
      readonly boneIds: readonly string[];
      readonly samples: readonly IKBakeSample[];
      readonly issues: readonly IKBakeIssue[];
    }
  | { readonly success: false; readonly samples: readonly []; readonly issues: readonly IKBakeIssue[] };

/** Entire-duration frame grid, in milliseconds. Integer frame indices avoid accumulated drift.
 * Invalid/impractical grids throw; sampleIKBake converts this into a structured failure.
 */
export function getIKBakeSampleTimes(duration: number, fps: number): readonly number[] {
  const count = getIKBakeSampleCount(duration, fps);
  const times = [0];
  for (let frame = 1; frame < count - 1; ++frame) {
    const time = (frame / fps) * 1000;
    // Collapse only arithmetic roundoff against the exact endpoint, not an off-frame final interval.
    const tolerance = 4 * Number.EPSILON * Math.max(duration, time);
    if (time >= duration - tolerance) break;
    if (!Number.isFinite(time) || time <= times[times.length - 1]!)
      throw new Error('Sampling FPS cannot represent distinct frame times.');
    times.push(time);
  }
  times.push(duration);
  return Object.freeze(times);
}

function failure(issues: readonly IKBakeIssue[]): IKBakeSampleResult {
  return { success: false, samples: [], issues };
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** @internal Read runtime ownership without evaluating providers or sampling the animation. */
export function getIKBakeRuntimeIssues(rig: Rig, runtimeConstraints: readonly TwoBoneIKConstraint[]): IKBakeIssue[] {
  const issues: IKBakeIssue[] = [];
  for (const runtime of runtimeConstraints) {
    const definition = rig.ik?.find((entry) => entry.name === runtime.name);
    if (
      !definition ||
      runtime.targetOwnership !== 'animation' ||
      runtime.rootBone !== definition.rootBone ||
      runtime.middleBone !== definition.middleBone ||
      runtime.endBone !== definition.endBone ||
      runtime.enabled !== (definition.enabled ?? true) ||
      runtime.priority !== (definition.priority ?? 0) ||
      runtime.mix !== (definition.mix ?? 1) ||
      runtime.hasMixOverride ||
      runtime.bendDirection !== (definition.bendDirection ?? 1) ||
      runtime.endOffset.x !== (definition.endOffset?.x ?? 0) ||
      runtime.endOffset.y !== (definition.endOffset?.y ?? 0)
    )
      issues.push({
        code: 'external-state',
        severity: 'error',
        constraintIds: [runtime.name],
        message: `IK "${runtime.name}" depends on runtime state. Bake authored animation with rig-defined constraints.`,
      });
  }
  return issues;
}

/** Read-only single-clip IK bake foundation. All rig constraints execute in runtime priority order,
 * but only selected driven joints are captured. No layers, gameplay providers, presets or drafts are consumed.
 * Every failure is atomic: no partial samples escape and no authored/editor/runtime state is changed.
 */
export function sampleIKBake(
  animation: DeepReadonly<AnimationClip>,
  rig: Rig,
  constraintIds: readonly string[],
  options: IKBakeSamplingOptions = {},
): IKBakeSampleResult {
  const definitions = new Map((rig.ik ?? []).map((definition) => [definition.name, definition]));
  const issues: IKBakeIssue[] = [];
  if (!constraintIds.length || new Set(constraintIds).size !== constraintIds.length)
    issues.push({ code: 'invalid-selection', severity: 'error', message: 'Select distinct IK constraint IDs.' });
  const boneIds = new Set<string>();
  for (const id of constraintIds) {
    const definition = definitions.get(id);
    if (!definition) {
      issues.push({
        code: 'unknown-constraint',
        severity: 'error',
        message: `Unknown IK constraint "${id}".`,
        constraintIds: [id],
      });
      continue;
    }
    boneIds.add(definition.rootBone);
    boneIds.add(definition.middleBone);
  }
  let validated: DeepReadonly<AnimationClip>;
  try {
    validated = getValidatedAnimation(animation, rig);
  } catch (error) {
    return failure([{ code: 'invalid-animation', severity: 'error', message: messageFor(error) }]);
  }
  const fps = options.fps ?? (validated.playback?.mode === 'stepped' ? validated.playback.fps : DEFAULT_ANIMATION_FPS);
  try {
    preflightIKBake(
      getIKBakeSampleCount(validated.duration, fps),
      rig.bones.length,
      definitions.size,
      boneIds.size,
      constraintIds.length,
    );
  } catch (error) {
    return failure([{ code: 'invalid-sampling', severity: 'error', message: messageFor(error) }]);
  }
  for (const [id, definition] of definitions) {
    if (definition.enabled === false || validated.disabledIKConstraints?.includes(id)) continue;
    for (const selectedId of constraintIds) {
      const selected = definitions.get(selectedId);
      if (!selected || selected.name === id) continue;
      const shared = [definition.rootBone, definition.middleBone].filter(
        (bone) => bone === selected.rootBone || bone === selected.middleBone,
      );
      if (shared.length)
        issues.push({
          code: 'competing-constraint',
          severity: 'error',
          message: `IK "${id}" also drives bones selected through "${selectedId}". Shared driven bones are unsupported.`,
          constraintIds: [selectedId, id],
          boneIds: shared,
        });
    }
  }
  issues.push(...getIKBakeRuntimeIssues(rig, options.runtimeConstraints ?? []));
  if (issues.length) return failure(issues);

  let times: readonly number[];
  try {
    times = getIKBakeSampleTimes(validated.duration, fps);
  } catch (error) {
    return failure([{ code: 'invalid-sampling', severity: 'error', message: messageFor(error) }]);
  }
  // Existing validated compilation and property evaluators; events are validated above but never consumed.
  const clip = compileValidatedClip({ ...validated, loop: false, events: [] });
  const sampler = new IsolatedIKSampler(rig);
  const samples: IKBakeSample[] = [];
  for (const time of times) {
    try {
      const solved = sampler.sample(clip, time);
      for (const [id, state] of solved.constraints) {
        if (state.status === 'singular-transform' || state.status === 'unsupported-scale')
          issues.push({
            code: state.status,
            severity: 'error',
            message: `IK "${id}" cannot be evaluated: ${state.status}.`,
            constraintIds: [id],
            time,
          });
      }
      // Validate final local/world arithmetic too: finite inputs can overflow when composed or solved.
      const matrices = new Map<string, Affine>();
      for (const bone of rig.bones) {
        const pose = solved.pose.get(bone.id)!;
        const matrix = composeAffine(
          transformToAffine(pose, {} as Affine),
          bone.parent === undefined ? undefined : matrices.get(bone.parent),
          {} as Affine,
        );
        matrices.set(bone.id, matrix);
        if (
          ![
            pose.x,
            pose.y,
            pose.rotation,
            pose.scaleX,
            pose.scaleY,
            matrix.a,
            matrix.b,
            matrix.c,
            matrix.d,
            matrix.tx,
            matrix.ty,
          ].every(Number.isFinite)
        )
          issues.push({
            code: 'non-finite-transform',
            severity: 'error',
            message: `Bone "${bone.id}" has a non-finite transform.`,
            boneIds: [bone.id],
            time,
          });
      }
      if (issues.length) return failure(issues);
      samples.push(
        Object.freeze({
          time,
          evaluatedTime: solved.time,
          pose: readonlyMap([...boneIds].map((id) => [id, solved.pose.get(id)!])),
          constraints: readonlyMap(constraintIds.map((id) => [id, solved.constraints.get(id)!])),
        }),
      );
    } catch (error) {
      return failure([{ code: 'evaluation-failed', severity: 'error', message: messageFor(error), time }]);
    }
  }
  return Object.freeze({
    success: true,
    fps,
    constraintIds: Object.freeze([...constraintIds]),
    boneIds: Object.freeze([...boneIds]),
    samples: Object.freeze(samples),
    issues: Object.freeze([]),
  });
}
