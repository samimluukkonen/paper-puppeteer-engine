import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { ValidationIssue } from '../../engine/externalData.js';
import { commitIKBake } from '../../engine/ik/IKBakeCommit.js';
import { generateBakedBoneKeys, type IKBakePlan } from '../../engine/ik/IKBakeGeneration.js';
import type { IKBakeMotionFidelity } from '../../engine/ik/IKBakeMotionFidelity.js';
import { sampleIKBake } from '../../engine/ik/IKBakeSampling.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import { Rig } from '../../engine/Rig.js';
import type { RigDefinition } from '../../engine/types.js';

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
 * Artwork does not participate in the detached solver.
 */
export function bakeRigSnapshot(rig: Rig): RigDefinition {
  let snapshot = rigSnapshots.get(rig);
  if (!snapshot) {
    snapshot = {
      root: rig.root,
      bones: rig.bones.map(({ length: _length, sprite: _sprite, ...bone }) => bone),
      ...(rig.ik === undefined ? {} : { ik: rig.ik }),
    };
    rigSnapshots.set(rig, snapshot);
  }
  return snapshot;
}

/** Entire expensive proposal/verification phase runs in the worker; never installs authored data. */
export function planIKBake(request: IKBakePlanningRequest): IKBakePlanningResult {
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
