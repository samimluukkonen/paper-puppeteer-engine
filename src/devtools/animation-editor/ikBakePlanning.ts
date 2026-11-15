import {
  preflightIKBakeSelection,
  commitIKBake,
  generateBakedBoneKeys,
  sampleIKBake,
  Rig,
  type IKBakePlan,
} from '../../engine/core.js';
import type {
  AnimationClip,
  ValidationIssue,
  IKBakeMotionFidelity,
  DeepReadonly,
  RigDefinition,
} from '../../engine/data.js';

export interface IKBakePlanningRequest {
  readonly rig: RigDefinition;
  readonly animation: DeepReadonly<AnimationClip>;
  readonly constraintIds: readonly string[];
  readonly fps: number;
}

export type IKBakePlanningResult =
  | { readonly success: false; readonly issues: readonly ValidationIssue[] }
  | {
      readonly success: true;
      readonly plan: Extract<IKBakePlan, { success: true }>;
      readonly animation: DeepReadonly<AnimationClip>;
      readonly motionFidelity: IKBakeMotionFidelity;
      readonly issues: readonly ValidationIssue[];
    };

const rigSnapshots = new WeakMap<Rig, RigDefinition>();

/** Transfer logical joint positions exactly. Rig already resolved explicit lengths;
 * omitting lengths avoids a second normalization and preserves floating-point identity.
 * Mesh attachments and slots remain available for deformation-track validation.
 */
export function bakeRigSnapshot(rig: Rig): RigDefinition {
  let snapshot = rigSnapshots.get(rig);
  if (!snapshot) {
    snapshot = {
      root: rig.root,
      bones: rig.bones.map(({ length: _length, sprite: _sprite, ...bone }) => bone),
      slots: rig.slots,
      attachments: rig.attachments,
      ...(rig.ik === undefined ? {} : { ik: rig.ik }),
    };
    rigSnapshots.set(rig, snapshot);
  }
  return snapshot;
}

/** Entire expensive proposal/verification phase runs in the worker; never installs authored data. */
export function planIKBake(request: IKBakePlanningRequest): IKBakePlanningResult {
  try {
    preflightIKBakeSelection(request.animation.duration, request.fps, request.rig, request.constraintIds);
  } catch (error) {
    return {
      success: false,
      issues: [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
    };
  }
  const rig = new Rig(request.rig);
  const plan = generateBakedBoneKeys(
    sampleIKBake(request.animation, rig, request.constraintIds, { fps: request.fps }),
    rig,
    { animation: request.animation, outputMode: request.animation.playback?.mode ?? 'smooth' },
  );
  if (!plan.success) return { success: false, issues: plan.issues };
  const result = commitIKBake(request.animation, plan, rig);
  if (!result.success) return result;
  return { ...result, plan };
}
