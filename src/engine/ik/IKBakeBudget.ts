import type { RigDefinition } from '../types.js';

/** Conservative admission limits for the whole sampling/generation/commit pipeline.
 * These bound incremental bake allocations, not the caller's existing authored document.
 */
export const IK_BAKE_LIMITS = Object.freeze({
  samples: 100_000,
  work: 25_000_000,
  generatedKeys: 100_000,
  estimatedBytes: 128 * 1024 * 1024,
});

/** Upper bound, before allocating the grid; endpoint roundoff can reduce the actual count by one. */
export function getIKBakeSampleCount(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0)
    throw new Error('Bake duration and sampling FPS must be finite and greater than zero.');
  const count = Math.max(2, Math.ceil((duration / 1000) * fps) + 1);
  if (!Number.isSafeInteger(count) || count > IK_BAKE_LIMITS.samples)
    throw new Error(`A bake may contain at most ${IK_BAKE_LIMITS.samples} samples. Lower the sampling FPS.`);
  return count;
}

/** @internal Shared by engine entry points and the editor before posting a worker snapshot.
 * Include every rig constraint, even unselected/disabled ones: the sampler visits all of them.
 */
export function preflightIKBake(
  sampleCount: number,
  boneCount: number,
  constraintCount: number,
  drivenBoneCount: number,
  selectedConstraintCount: number,
): void {
  if (
    ![sampleCount, boneCount, constraintCount, drivenBoneCount, selectedConstraintCount].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new Error('Bake workload counts must be nonnegative safe integers.');
  // Ten passes cover re-sampling, local fidelity and paired midpoint/end motion probes.
  // Each constraint may traverse the whole ancestor chain and scan the constraint definitions.
  const work = sampleCount * 10 * (boneCount + constraintCount * (boneCount + constraintCount));
  const generatedKeys = sampleCount * drivenBoneCount;
  // Allow for retained samples/maps, multiple key/compiled/fidelity copies, reports,
  // worker reply cloning and transient full-rig poses. This is an estimate, not a heap measurement.
  const estimatedBytes =
    generatedKeys * 1024 + sampleCount * (2048 + selectedConstraintCount * 512) + (boneCount + constraintCount) * 2048;
  let exceeded: string | undefined;
  if (sampleCount > IK_BAKE_LIMITS.samples) exceeded = `${IK_BAKE_LIMITS.samples} samples`;
  else if (work > IK_BAKE_LIMITS.work) exceeded = `${IK_BAKE_LIMITS.work} estimated bone/constraint work units`;
  else if (generatedKeys > IK_BAKE_LIMITS.generatedKeys) exceeded = `${IK_BAKE_LIMITS.generatedKeys} generated keys`;
  else if (estimatedBytes > IK_BAKE_LIMITS.estimatedBytes) exceeded = '128 MiB estimated bake memory';
  if (exceeded) throw new Error(`Bake exceeds ${exceeded}. Lower the sampling FPS or select fewer constraints.`);
}

/** Preflight JSON snapshots before worker cloning or rig construction. */
export function preflightIKBakeSelection(
  duration: number,
  fps: number,
  rig: Pick<RigDefinition, 'bones' | 'ik'>,
  constraintIds: readonly string[],
): void {
  const selected = new Set(constraintIds);
  const bones = new Set<string>();
  for (const definition of rig.ik ?? []) {
    if (!selected.has(definition.name)) continue;
    bones.add(definition.rootBone);
    bones.add(definition.middleBone);
  }
  preflightIKBake(
    getIKBakeSampleCount(duration, fps),
    rig.bones.length,
    rig.ik?.length ?? 0,
    bones.size,
    constraintIds.length,
  );
}
