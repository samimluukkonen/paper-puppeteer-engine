# IK bake sampling foundation

[All guides](../README.md#guides)

Milestone v0.5.6.1 adds read-only whole-animation IK sampling. It produces solved transforms for later bone-key generation without changing animation JSON, disabling IK, adding history, moving the editor clock or dispatching events. There is no Bake UI in this phase.

## API and sampling times

Both the browser package and renderer-independent `/core` export `sampleIKBake`, `getIKBakeSampleTimes`, and their result/options/diagnostic types:

```ts
import { sampleIKBake } from 'paper-puppeteer-engine/core';

const result = sampleIKBake(animation, rig, ['rightArmIK', 'rightLegIK']);
if (result.success) {
  for (const sample of result.samples) {
    console.log(sample.time, sample.pose.get('rightUpperArm'));
  }
} else {
  console.log(result.issues);
}
```

All times use runtime **milliseconds**. The default density is the authored stepped playback FPS. Smooth/legacy clips have no authored FPS field, so they use the shared authoring fallback of 10 FPS. `{ fps: 24 }` overrides sample density while retaining authored playback evaluation: a stepped clip can have several requested times with the same solved pose. Each sample exposes both requested `time` and `evaluatedTime`.

The grid contains zero, each interior frame, and the exact duration once. Integer frame indices avoid accumulated interval drift; an off-frame endpoint is never snapped. Looping clips are sampled over one complete authored duration, including their exact endpoint rather than wrapping it to zero. `getIKBakeSampleTimes(duration, fps)` exposes the same grid independently. Invalid/nonpositive rates and durations are rejected; eager grids are limited to 100,000 samples. Source key times and playback metadata remain unchanged. Partial ranges are unavailable.

Baking also preflights the full proposal and commit workload before allocating samples or keys. Admission limits are 25 million estimated bone/constraint work units, 100,000 generated rotation keys and 128 MiB estimated incremental bake memory. For sample count `S`, rig bones `B`, all rig constraints `C`, distinct selected driven bones `D` and selected constraints `K`, the estimates are:

- Work: `10 × S × (B + C × (B + C))`, allowing for repeated sampling, fidelity passes, ancestor traversal and constraint lookup. Unselected and disabled constraints count because the sampler visits them.
- Generated keys: `S × D`.
- Incremental bytes: `1024 × S × D + S × (2048 + 512 × K) + 2048 × (B + C)`, allowing for retained poses/maps, key and fidelity copies, reports, worker reply cloning and transient rig poses. This is a conservative estimate rather than a measured heap limit; the existing authored document is outside this estimate.

Oversized requests return an atomic failure with guidance to lower FPS or select fewer constraints. Engine generation and fidelity entry points recheck budgets independently. The editor checks before worker snapshot cloning, and worker planning checks again before constructing the rig. Each editor planning worker has a 30-second deadline covering sampling, generation and commit verification; expiry terminates computation and returns a timeout error. Success, cancellation and failures release the deadline and worker listeners. Results retain their existing complete, immutable snapshot format; streaming generation would require changes to the fidelity and commit APIs, so admission limits bound retained output here.

## Evaluation and transforms

An isolated renderer-independent context owns fresh `Joint` instances and rig-defined `TwoBoneIKConstraint` instances. The bone pose buffer, IK channel evaluator, playback quantizer, affine math and existing two-bone solver remain authoritative. The inspector sampler now shares this context, retaining its last immutable sample cache. Ghost sampling continues to return authored poses before IK.

Every frame resets all joints to their resolved bind transforms, evaluates authored bone and IK tracks at the same playback time, then applies **all** rig constraints in ascending priority with stable registration-order ties. This preserves ancestor effects and sparse endpoint fallbacks for later chains, including unselected preceding chains. Captured transforms come from the final completed pass.

The returned `pose` is an immutable `ReadonlyMap` containing complete `JointTransform` values for the selected constraints' root and middle bones, the joints whose rotations the solver drives. `x`/`y` are absolute local translations in the immediate parent frame, `rotation` is in radians, and `scaleX`/`scaleY` are unitless. These are local values, not bind-relative deltas or decomposed world matrices. The end bone's own local transform is not solved and is excluded from driven-bone output; its authored transform and endpoint offset still participate in solving. Per-constraint status and resolved puppet-local target are included. Unreachable targets retain the solver's deterministic `clamped` result.

Puppet placement, facing, scene camera, live bone transforms, editor drafts and pose presets are outside this API. It samples one authored clip, not an active player layer stack or crossfade. Runtime layering and blending remain unchanged; supporting those contexts would require explicit deterministic inputs in a later API.

## Validation and supported scope

Failures return `success: false`, structured issues and an empty sample array. No partial result is exposed, including failures on later frames. Diagnostics identify constraint/bone IDs and requested time when available.

- Selection must contain distinct existing rig constraint IDs. Rig construction already validates connected chains and resolves driven bones and logical lengths.
- Existing immutable animation validation checks bone/IK references, metadata, key times, finite target/property values, influence ranges and event data before compilation. Events are then omitted from the evaluation clip.
- An enabled competing rig constraint sharing a selected root/middle bone is rejected, including when both chains are selected. This conservative ownership check applies regardless of priority, missing target channels or zero influence at particular frames. Disabled competitors do not own bones. Nested chains with disjoint driven joints are supported.
- Solver diagnostics for singular parent/root transforms and unsupported nonuniform root scale fail the bake. Arbitrary nonsingular affine ancestors, reflected uniform root scale, middle scale and endpoint offsets retain runtime behavior. Final local/world arithmetic is checked for non-finite results.
- Authored-only calls have no gameplay dependencies. To validate a live context, pass the complete list of live constraints as `runtimeConstraints`. Providers, explicit world targets, explicit mix ownership (even with the same numeric mix), changed enabled/priority/bend/offset/chain settings and extra runtime chains return `external-state`. Providers are never invoked, and live constraints are never modified. The guard does not capture player layers, presets or drafts.

## Verification and deferred work

The bake sampling tests compare arm/leg and nested-chain samples with runtime Puppet evaluation under smooth/stepped playback, endpoint offsets, facing and transformed ancestors. They cover influence, clamping, frame grids, defaults/overrides, stable precedence, unsupported ownership/scales, overflow, immutable outputs and deterministic repeat sampling. Paused/playing/scrubbing editor regressions preserve source/working snapshots, bind/live poses, drafts, time, playback, dirty tracking, notifications and undo/redo; normal event delivery remains active afterward. Existing inspector/runtime tests cover the shared-context refactor.

Required checks are `npm run typecheck`, `npm run test` and `npm run build`; formatting and lint checks also apply. No browser test or browser installation step is added to CI.

[Bone-key generation](ik-bake-generation.md), [atomic commit and clip-local IK deactivation](ik-bake-commit.md), [React Bake controls](react-ik-baking.md) and [production fidelity checks](ik-bake-hardening.md) complete the workflow. Partial ranges, layer-stack baking and gameplay target capture remain deferred. No new IK algorithm is introduced.
