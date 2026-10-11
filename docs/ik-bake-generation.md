# IK bone-key generation

[All guides](../README.md#guides)

Milestone v0.5.6.2 converts [whole-animation IK samples](ik-bake-sampling.md) into an inspectable `IKBakePlan`. Generation is pure: it does not install an animation, change source tracks or IK settings, move editor time, dispatch events, or add history. Both the browser package and renderer-independent `/core` export these APIs and their types.

## Generate a proposal

```ts
import { generateBakedBoneKeys, sampleIKBake } from 'paper-puppeteer-engine/core';

const samples = sampleIKBake(animation, rig, ['rightArmIK', 'rightLegIK']);
const plan = generateBakedBoneKeys(samples, rig, {
  animation,
  outputMode: 'stepped', // Default; 'smooth' is also available.
});

if (plan.success) {
  console.log(plan.generatedAnimation.tracks);
  console.log(plan.affectedBones, plan.generatedKeyCount, plan.replacedKeyCount);
  console.log(plan.sampling, plan.fidelity.maximumErrors, plan.issues);
} else {
  console.log(plan.issues);
}
```

Use the same authored animation and rig that produced the samples. The generator consumes an `IKBakeSampleResult`, including failed sampling results, whose diagnostics are preserved. It does not resample or introduce a new solver. Invalid generation returns `success: false` without a partial generated animation; a failed fidelity check also exposes its measurement report.

`generatedAnimation` uses the existing `AnimationClip` / version-1 `AnimationJsonDefinition` shape: `tracks[boneId]` contains ordinary sparse `{ time, rotation }` rows. It carries source name, duration and loop metadata, explicit `interpolation: 'linear'`, and output playback settings. It contains only generated bone tracks, with no copied IK tracks or events. Existing `compileClip`, bone evaluation, playback and version-1 serialization can consume it. Supply `version: 1` when exporting it as animation JSON. This sparse proposal is not a complete replacement for the source animation.

Each `affectedBones` entry lists its generated properties, property-key count, replacement count and the exact authored `{ time, value }` rotation keys that would be replaced. Whole-duration replacement includes off-grid authored rotation keys. Sparse sibling translation/scale properties and unrelated tracks are preserved in the private fidelity candidate, and are never modified in the source. Output and report data are detached and deeply frozen; mutable caller data is not frozen.

## Coordinates and ownership

The existing two-bone solver changes only the root and middle joints' rotations. Consequently, generation keys only those local `rotation` properties, including sampled authored rotations when influence is zero or the constraint is inactive. The end bone and unrelated skeleton bones receive no generated keys. Translation and scale tracks remain authored data.

The sampler has already adapted targets through existing parent-frame affine utilities and solved into `Joint.pose`. Its rotations are absolute local **radians**, matching ordinary bone animation, rather than degrees or bind-relative deltas. The generator copies those values directly; it never decomposes a world matrix or consumes screen/camera coordinates. Reflected/scaled/rotated ancestors and endpoint offsets retain the sampler's coordinate conventions.

Multiple selected constraints are supported when driven bone sets are disjoint. Existing sampler precedence remains authoritative, including nested chains. Generation rechecks selected ownership against the rig: overlapping selected sets and enabled unselected competitors fail regardless of priority. Disabled unselected competitors are harmless. Invalid solver states and incomplete, foreign or non-finite local samples fail before keys are exposed.

## Times and interpolation

All times are **milliseconds**. Sampling settings report FPS, duration, requested times, evaluated source times, selected constraints, source playback and output playback. Generation retains the sampler's ordered whole-animation grid and exact endpoint once, using existing key-time normalization and matching tolerance rather than FPS snapping. A one-second clip at 10 FPS has keys at `0, 100, 200, ... 1000`. Off-frame endpoints such as `1050` remain exact. Missing, unordered or incompatible grids fail.

The default output uses existing stepped playback at the **sampling FPS**, with ordinary linear segments evaluated at quantized times. `{ outputMode: 'smooth' }` uses continuous linear interpolation, including the existing shortest-angle rotation rule. Every smooth proposal includes a warning that interpolation between sampled transforms may differ from continuous IK solving. Fidelity is verified only at the supplied sample instants. Looping source clips are compared over one complete duration, including the endpoint without wrapping.

Sampling density can differ from authored stepped FPS; repeated source evaluated times retain repeated solved rotations at distinct requested times. If changing playback timing makes preserved translation or scale properties differ at a sample instant, generation rejects the candidate as inaccurate. It does not compensate by inventing unrelated property keys. Future application must consider the proposed clip-level playback settings and preserve ungenerated source properties.

## Measure fidelity

`compareIKBakeFidelity(samples, candidateAnimation, rig, tolerances?)` compares sampled complete local poses with ordinary bone animation evaluated through `compileClip`, `evaluateClip`, bind defaults and existing playback quantization. IK is intentionally unapplied during this comparison, even if the supplied candidate retains IK channels. It does not evaluate an active player, render context or layer stack.

Generation privately constructs a candidate with all source bone tracks and generated rotations replacing only affected rotation properties, then runs the helper. To independently compare a generated sparse animation, include unchanged authored properties in your candidate when they differ from bind defaults. Omitting them is measured as a real mismatch.

The report contains a difference for each sampled bone/time pair, maximum errors, effective tolerances, validation issues and `success`. Default tolerances, exported as `DEFAULT_IK_BAKE_TOLERANCES`, are:

| Measurement | Default tolerance | Convention                                                      |
| ----------- | ----------------- | --------------------------------------------------------------- |
| Translation | `1e-6`            | Euclidean distance in immediate-parent rig units                |
| Rotation    | `1e-6`            | Shortest angular distance in radians; full turns are equivalent |
| Scale       | `1e-9`            | Maximum absolute difference of the two unitless components      |

Pass finite nonnegative overrides such as `{ translation: 1e-5, rotation: 1e-5 }` when a different asset tolerance is appropriate. Non-finite inputs, arithmetic overflow, invalid animation data, missing bones, empty poses or invalid tolerances always fail. These are local-transform tolerances, not a guarantee of world-space endpoint error or between-sample accuracy.

## Verification and deferred work

Generation tests cover arm and leg chains, multiple driven bones, sorted times, exact/off-frame endpoints, radian units, transformed ancestors and endpoint offsets, stepped/smooth runtime playback, version-1 serialization, unchanged authored sibling properties, unrelated-bone exclusion, sample fidelity, structured failures, ownership and input/editor immutability.

Required verification is `npm run typecheck`, `npm run test` and `npm run build`, with repository formatting and lint checks. Browser smoke tests remain local-only.

Installing keys into `workingAnimation`, removing/disabling IK, React Bake UI, Bake Undo/Redo, partial ranges, key simplification, adaptive sampling and runtime layer-stack baking remain deferred.
