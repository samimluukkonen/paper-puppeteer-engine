import type { AnimationClip, Keyframe } from '../AnimationClip.js';
import { ANIMATION_FORMAT_VERSION, parseAnimationClip, type ValidationIssue } from '../externalData.js';
import { checkJson } from '../jsonData.js';
import { normalizeKeyframeTime } from '../keyframeAuthoring.js';
import { type DeepReadonly, freezeData } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import { transformProperties } from '../types.js';
import { compareIKBakeFidelity, generateBakedBoneKeys, type IKBakePlan } from './IKBakeGeneration.js';
import { compareIKBakeMotion, type IKBakeMotionFidelity } from './IKBakeMotionFidelity.js';
import { sampleIKBake } from './IKBakeSampling.js';

export type IKBakeCommitResult =
  | {
      readonly success: true;
      readonly animation: DeepReadonly<AnimationClip>;
      readonly motionFidelity: IKBakeMotionFidelity;
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

/** JSON inputs have been checked before comparison; object field order is immaterial. */
function equalData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left))
    return Array.isArray(right) && left.length === right.length && left.every((value, i) => equalData(value, right[i]));
  if (Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equalData(a[key], b[key]))
  );
}

/** Pure full-clip transaction. Validate source, plan and final playback before returning any authored change.
 * The editor installs this single immutable result through its ordinary document/history boundary.
 * Preserve authored playback/FPS, even when the proposal used a different preview playback mode.
 */
export function commitIKBake(
  workingAnimation: DeepReadonly<AnimationClip>,
  bakePlan: IKBakePlan,
  rig: Rig,
): IKBakeCommitResult {
  try {
    const issues: ValidationIssue[] = [];
    if (!checkJson(bakePlan, 'bakePlan', issues) || issues.length) return freezeData({ success: false, issues });
    if (!bakePlan.success) return freezeData({ success: false, issues: structuredClone(bakePlan.issues) });
    const source = parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...workingAnimation }, rig);
    if (!equalData(source, bakePlan.sourceAnimation))
      throw new Error('Bake plan is stale; regenerate it for the working animation.');
    // Re-sample authored IK to verify ownership, full-clip coverage, values, counts and reported fidelity.
    // A caller-assembled or modified plan cannot bypass generation validation.
    const samples = sampleIKBake(source, rig, bakePlan.sampling.constraintIds, { fps: bakePlan.sampling.fps });
    const expected = generateBakedBoneKeys(samples, rig, {
      animation: source,
      outputMode: bakePlan.sampling.outputPlayback.mode,
      tolerances: bakePlan.fidelity.tolerances,
    });
    if (!expected.success) return freezeData({ success: false, issues: structuredClone(expected.issues) });
    if (!equalData(expected, bakePlan))
      throw new Error('Bake plan does not match validated whole-animation generation.');

    const tracks = { ...source.tracks };
    for (const affected of expected.affectedBones) {
      const properties = new Set(affected.properties.map((entry) => entry.property));
      const rows = new Map<number, Keyframe>();
      for (const key of source.tracks[affected.boneId] ?? []) {
        const row = { ...key };
        for (const property of properties) delete row[property];
        if (transformProperties.some((property) => row[property] !== undefined)) rows.set(row.time, row);
      }
      for (const key of expected.generatedAnimation.tracks[affected.boneId]!) {
        const time = normalizeKeyframeTime(source.duration, key.time);
        rows.set(time, { ...rows.get(time), ...key, time });
      }
      tracks[affected.boneId] = [...rows.values()].sort((a, b) => a.time - b.time);
    }
    const selected = new Set(expected.sampling.constraintIds);
    const next: AnimationClip = {
      ...source,
      tracks,
      disabledIKConstraints: [...new Set([...(source.disabledIKConstraints ?? []), ...selected])].sort(),
      ...(source.ikTracks === undefined
        ? {}
        : { ikTracks: Object.fromEntries(Object.entries(source.ikTracks).filter(([name]) => !selected.has(name))) }),
    };
    const animation = parseAnimationClip({ version: ANIMATION_FORMAT_VERSION, ...next }, rig);
    if (!samples.success) throw new Error('Bake sampling failed.');
    const fidelity = compareIKBakeFidelity(samples.samples, animation, rig, expected.fidelity.tolerances);
    if (!fidelity.success)
      return freezeData({
        success: false,
        issues: [
          ...structuredClone(fidelity.issues),
          ...(source.playback?.mode === 'stepped'
            ? [
                {
                  severity: 'error' as const,
                  message: `Sampling at ${expected.sampling.fps} FPS does not preserve authored ${source.playback.fps} FPS stepped playback. Use the authored FPS or an integer multiple and preview again.`,
                },
              ]
            : []),
        ],
      });
    const motionFidelity = compareIKBakeMotion(
      source,
      animation,
      rig,
      expected.sampling.constraintIds,
      expected.sampling.fps,
    );
    if (!motionFidelity.success) return freezeData({ success: false, issues: structuredClone(motionFidelity.issues) });
    const warnings: ValidationIssue[] = expected.issues.filter((issue) => issue.severity === 'warning');
    if (
      (source.playback?.mode ?? 'smooth') === 'smooth' &&
      !expected.issues.some((issue) => issue.code === 'between-sample-interpolation')
    )
      warnings.push({
        severity: 'warning',
        message:
          'Smooth playback interpolates between baked samples. Measured midpoint fidelity does not bound error at every time.',
      });
    return freezeData({ success: true, animation, motionFidelity, issues: [...warnings, ...motionFidelity.issues] });
  } catch (error) {
    return freezeData({
      success: false,
      issues: [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
    });
  }
}
