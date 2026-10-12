import { type Affine, composeAffine, localToWorld, transformToAffine } from '../affineMath.js';
import { type AnimationClip, compileClip } from '../AnimationClip.js';
import { shortestRotationDelta } from '../animationMath.js';
import { getBoneTrack } from '../animationTracks.js';
import type { ValidationIssue } from '../externalData.js';
import { type DeepReadonly, freezeData } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import { transformProperties, type JointTransform } from '../types.js';
import { DEFAULT_IK_BAKE_TOLERANCES, type IKBakeTolerances } from './IKBakeGeneration.js';
import { getIKBakeSampleTimes } from './IKBakeSampling.js';
import { IsolatedIKSampler } from './IsolatedIKSampler.js';

export interface IKBakeMotionErrors extends IKBakeTolerances {
  /** Endpoint distance in rig units with identity puppet placement, including endOffset. */
  readonly endEffector: number;
}

export const DEFAULT_IK_BAKE_MOTION_TOLERANCES = freezeData({
  atKeys: { ...DEFAULT_IK_BAKE_TOLERANCES, endEffector: 1e-5 },
  betweenKeys: { translation: 1e-6, rotation: Math.PI / 90, scale: 1e-9, endEffector: 1 },
});

export interface IKBakeMotionFidelity {
  /** False for invalid inputs or sample-time disagreement. Between-key drift is a warning. */
  readonly success: boolean;
  readonly withinBetweenKeyTolerance: boolean;
  readonly tolerances: typeof DEFAULT_IK_BAKE_MOTION_TOLERANCES;
  readonly atKeys: Readonly<IKBakeMotionErrors>;
  readonly betweenKeys: Readonly<IKBakeMotionErrors>;
  readonly probes: readonly {
    readonly time: number;
    readonly phase: 'key' | 'between';
    readonly errors: Readonly<IKBakeMotionErrors>;
  }[];
  readonly issues: readonly ValidationIssue[];
}

function emptyErrors(): IKBakeMotionErrors {
  return { translation: 0, rotation: 0, scale: 0, endEffector: 0 };
}

function endpoint(
  rig: Rig,
  pose: ReadonlyMap<string, Readonly<JointTransform>>,
  boneId: string,
  offset: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const ancestors: string[] = [];
  let id: string | undefined = boneId;
  while (id !== undefined) {
    ancestors.push(id);
    id = rig.getBone(id).parent;
  }
  let matrix: Affine | undefined;
  for (const ancestor of ancestors.reverse())
    matrix = composeAffine(transformToAffine(pose.get(ancestor)!, {} as Affine), matrix, {} as Affine);
  return localToWorld(offset, matrix!);
}

/** Read-only comparison of the actual committed clip, including unselected runtime IK.
 * Probes start, every generated rotation key/grid time, their midpoints, just before end and exact end.
 * Uses two detached solver contexts; never advances a player or dispatches events.
 */
export function compareIKBakeMotion(
  source: DeepReadonly<AnimationClip>,
  baked: DeepReadonly<AnimationClip>,
  rig: Rig,
  constraintIds: readonly string[],
  fps: number,
): IKBakeMotionFidelity {
  const atKeys = { ...emptyErrors() };
  const betweenKeys = { ...emptyErrors() };
  const probes: IKBakeMotionFidelity['probes'][number][] = [];
  const issues: ValidationIssue[] = [];
  const tolerances = DEFAULT_IK_BAKE_MOTION_TOLERANCES;
  let withinBetweenKeyTolerance = true;
  try {
    const original = compileClip(source, rig);
    const candidate = compileClip(baked, rig);
    if (original.duration !== candidate.duration) throw new Error('Baking must preserve animation duration.');
    if (!constraintIds.length || new Set(constraintIds).size !== constraintIds.length)
      throw new Error('Motion comparison requires distinct selected constraints.');
    const constraints = constraintIds.map((name) => {
      const definition = rig.ik?.find((entry) => entry.name === name);
      if (!definition) throw new Error(`Unknown IK constraint "${name}".`);
      if (!baked.disabledIKConstraints?.includes(name))
        throw new Error(`Baked IK "${name}" must be deactivated for this animation.`);
      return definition;
    });
    const boneIds = new Set(constraints.flatMap((entry) => [entry.rootBone, entry.middleBone, entry.endBone]));
    const times = new Set(getIKBakeSampleTimes(source.duration, fps));
    for (const constraint of constraints)
      for (const id of [constraint.rootBone, constraint.middleBone])
        for (const key of getBoneTrack(baked, id)) if (key.rotation !== undefined) times.add(key.time);
    const keys = [...times].sort((a, b) => a - b);
    const phases = new Map<number, 'key' | 'between'>(keys.map((time) => [time, 'key']));
    for (let index = 1; index < keys.length; ++index) {
      const midpoint = keys[index - 1]! + (keys[index]! - keys[index - 1]!) / 2;
      if (!phases.has(midpoint)) phases.set(midpoint, 'between');
    }
    const nearEnd = source.duration - Math.min(1, (source.duration - keys[keys.length - 2]!) / 1000);
    if (!phases.has(nearEnd)) phases.set(nearEnd, 'between');
    const expectedSampler = new IsolatedIKSampler(rig);
    const actualSampler = new IsolatedIKSampler(rig);
    for (const [time, phase] of [...phases].sort(([a], [b]) => a - b)) {
      const expected = expectedSampler.sample(original, time);
      const actual = actualSampler.sample(candidate, time);
      for (const sampled of [expected, actual])
        for (const [name, constraint] of sampled.constraints)
          if (constraint.status === 'singular-transform' || constraint.status === 'unsupported-scale')
            throw new Error(`IK "${name}" cannot be evaluated at ${time} ms: ${constraint.status}.`);
      const errors = { ...emptyErrors() };
      for (const id of boneIds) {
        const a = expected.pose.get(id)!;
        const b = actual.pose.get(id)!;
        if (!transformProperties.every((property) => Number.isFinite(a[property]) && Number.isFinite(b[property])))
          throw new Error(`Bone "${id}" has a non-finite transform at ${time} ms.`);
        errors.translation = Math.max(errors.translation, Math.hypot(b.x - a.x, b.y - a.y));
        errors.rotation = Math.max(errors.rotation, Math.abs(shortestRotationDelta(a.rotation, b.rotation)));
        errors.scale = Math.max(errors.scale, Math.abs(b.scaleX - a.scaleX), Math.abs(b.scaleY - a.scaleY));
      }
      for (const constraint of constraints) {
        const offset = constraint.endOffset ?? { x: 0, y: 0 };
        const a = endpoint(rig, expected.pose, constraint.endBone, offset);
        const b = endpoint(rig, actual.pose, constraint.endBone, offset);
        errors.endEffector = Math.max(errors.endEffector, Math.hypot(b.x - a.x, b.y - a.y));
      }
      if (!Object.values(errors).every(Number.isFinite)) throw new Error('Motion comparison arithmetic overflowed.');
      probes.push({ time, phase, errors });
      const maxima = phase === 'key' ? atKeys : betweenKeys;
      for (const property of ['translation', 'rotation', 'scale', 'endEffector'] as const)
        maxima[property] = Math.max(maxima[property], errors[property]);
    }
    const exceeds = (errors: IKBakeMotionErrors, limits: IKBakeMotionErrors): boolean =>
      (Object.keys(errors) as (keyof IKBakeMotionErrors)[]).some((property) => errors[property] > limits[property]);
    if (exceeds(atKeys, tolerances.atKeys))
      issues.push({
        severity: 'error',
        message: 'Committed runtime motion differs at generated keys beyond bake tolerances.',
      });
    withinBetweenKeyTolerance = !exceeds(betweenKeys, tolerances.betweenKeys);
    if (!withinBetweenKeyTolerance)
      issues.push({
        severity: 'warning',
        message: `Sampling at ${fps} FPS exceeds between-key tolerances: maximum joint error ${((betweenKeys.rotation * 180) / Math.PI).toFixed(3)} degrees, endpoint error ${betweenKeys.endEffector.toFixed(3)} rig units. Increase sampling FPS and preview again; authored stepped FPS may need a matching sample grid.`,
      });
  } catch (error) {
    withinBetweenKeyTolerance = false;
    issues.push({ severity: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  return freezeData({
    success: !issues.some((issue) => issue.severity === 'error'),
    withinBetweenKeyTolerance,
    tolerances,
    atKeys,
    betweenKeys,
    probes,
    issues,
  });
}
