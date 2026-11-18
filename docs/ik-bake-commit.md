# Atomic IK bake commit

[All guides](../README.md#guides)

Milestone v0.5.6.3 adds a complete authored bake transaction after [sampling](ik-bake-sampling.md) and [key generation](ik-bake-generation.md). It replaces selected bone rotations over the entire clip and deactivates selected constraints for that animation. Rig definitions and other animations retain IK. The [React panel](react-ik-baking.md) and [production motion fidelity checks](ik-bake-hardening.md) complete this workflow.

## Commit API

Both package entry points export `commitIKBake` and `IKBakeCommitResult`:

```ts
import { commitIKBake, generateBakedBoneKeys, sampleIKBake } from 'paper-puppeteer-engine/core';

const samples = sampleIKBake(animation, rig, ['rightArmIK']);
const plan = generateBakedBoneKeys(samples, rig, { animation });
const result = commitIKBake(animation, plan, rig);
if (result.success) {
  const bakedAnimation = result.animation; // Complete immutable clip; source is unchanged.
  console.log(bakedAnimation.disabledIKConstraints, result.issues);
} else {
  console.log(result.issues);
}
```

A successful plan includes a detached `sourceAnimation` snapshot. Commit validates JSON and the working animation, rejects stale snapshots, and repeats isolated sampling/generation to verify the plan against the supplied rig. Constraint ownership, complete frame coverage, generated values, counts and fidelity reports must agree. Modified plans and changes to the rig that affect the bake fail. Nothing is installed on failure.

Commit builds the complete output privately, validates it, and checks sample-time fidelity with actual playback settings. It also returns `motionFidelity`, comparing runtime poses/endpoints at keys, midpoints and near/exact end. Key disagreement blocks commit; between-key drift produces warnings. Source duration, loop, interpolation declaration, playback mode and FPS are preserved. The generation proposal's playback describes proposal evaluation, without changing committed metadata. Prefer authored FPS for stepped clips; incompatible grids fail atomically with an FPS diagnostic. Finite probes cannot bound every interpolation error.

## Key replacement and constraint deactivation

Only properties listed by the validated plan are replaced. The current solver produces root/middle local `rotation` keys. All old rotations on those bones are removed, including off-grid keys; unrelated translation/scale properties keep their exact authored times and values. Generated keys combine with sibling properties only at identical times and use ordinary sorting/time normalization. Close but distinct sibling times remain distinct. Unaffected bones, events and other metadata are preserved.

Version-1 animation JSON adds optional `disabledIKConstraints: string[]`. Each name must identify a rig constraint and appear once. Absence or an empty list keeps existing animation behavior; no format-version migration is required. Bakes union selected names with existing deactivations and remove only the selected authored `ikTracks`. Unrelated IK tracks remain intact. The original IK keys remain in the editor's Undo snapshot.

Compilation, owned compiled clips, parsing, deterministic serialization and the generated JSON schema retain the list. Runtime evaluation emits a suppression channel through the existing IK layer evaluator. Full suppression skips the constraint before reading runtime targets or invoking providers, even when a host owns its mix. It does not modify `constraint.enabled`, rig data or solver algorithms. This prevents double IK during ordinary playback, direct sampling and repeated `PosePipeline.syncIK()` calls. Independent samplers honor the same data.

Layer masks use the constraint's root bone, as existing target tracks do. Suppression blends by layer/fade ownership and survives interrupted fades. Partial suppression attenuates solver influence; a fully owned baked constraint is inactive. Sparse layers inherit underlying suppression when they do not own it. Switching the base clip directly to an animation without deactivation restores normal IK. This operation bakes one authored clip; it does not capture an arbitrary runtime layer stack.

## Editor history and dirty state

`AnimationEditorState.commitIKBake(plan)` calls the pure API, validates a versioned editor snapshot, and installs it through the existing document/history boundary. One bake produces one history entry and one grouped state notification. Successful installation cancels gestures, clears drafts and reconciles selection. Failed validation changes diagnostics only, retaining working data, drafts, clock, dirty state, history and redo.

Undo restores the exact original snapshot, including replaced bone keys, authored IK tracks and absence/presence of deactivation metadata. Redo restores the exact baked snapshot. Dirty tracking uses existing saved-checkpoint comparison: Undo to an original clean baseline is clean, while Undo away from an exported baked checkpoint is dirty. Sampling and generation remain read-only. Baked constraints report an editor manipulation-disabled reason and cannot start target dragging.

## Verification and deferred work

`tests/ikBakeCommit.test.ts` exercises property replacement, metadata/source preservation, atomic failures, saved checkpoints, exact Undo/Redo, independent and Puppet runtime playback, provider/runtime ownership, unrelated constraints and animations, export/import, compiled ownership, multiple selections, masks, weights and interrupted fades. Existing sampling, generation, validation and runtime suites remain applicable.

Required checks are `npm run typecheck`, `npm run test` and `npm run build`, plus repository formatting/lint checks. Browser smoke tests remain local-only.

Deferred work includes partial ranges, key reduction, adaptive sampling, runtime layer-stack capture, rig-constraint editing, new solvers and physics. Smooth motion can differ from continuous IK; measured probes do not guarantee endpoint accuracy at every instant.
