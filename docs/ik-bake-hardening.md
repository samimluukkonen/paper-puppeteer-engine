# IK baking fidelity and production verification

[All guides](../README.md#guides)

Milestone v0.5.6.5 completes whole-animation IK baking. Follow the [artist workflow](react-ik-baking.md) to convert an authored reach into editable shoulder/elbow rotations. Baking preserves duration, events, playback metadata and source assets, and deactivates selected constraints only for the committed animation.

## Architecture and APIs

`sampleIKBake` uses detached joints and the existing solver in runtime priority order. `generateBakedBoneKeys` proposes ordinary local-radian rotation keys with source snapshots and replacement counts. `commitIKBake` revalidates the proposal, replaces selected rotation properties, removes selected IK channels, and unions clip-local `disabledIKConstraints`. It now compares the actual committed clip against the source through two isolated runtime samplers, including unselected IK. No player, events, renderer or editor state participates.

Both package entry points export `compareIKBakeMotion`, `DEFAULT_IK_BAKE_MOTION_TOLERANCES`, `IKBakeMotionErrors` and `IKBakeMotionFidelity`. Successful `IKBakeCommitResult` values include `motionFidelity`. Reports are detached and deeply immutable; they never enter animation JSON.

```ts
const result = commitIKBake(animation, plan, rig);
if (result.success) {
  console.log(result.motionFidelity.atKeys, result.motionFidelity.betweenKeys);
  console.log(result.motionFidelity.withinBetweenKeyTolerance, result.issues);
}

const report = compareIKBakeMotion(animation, bakedAnimation, rig, ['rightArmIK'], 10);
```

React caches the report and candidate alongside the plan. Clock-only updates sample the cached candidate without replanning or rerendering the panel. Options, document/session and runtime ownership changes invalidate them. Unbind/disposal clears reports and subscriptions; panel close/unmount clears preview, and scene shutdown destroys its artwork. `AnimationEditorState.commitIKBake` installs one document/history snapshot. There is no special baked-key type.

## Fidelity and sampling

Probes cover zero, every generated rotation-key and sample-grid time, every adjacent midpoint, just before the end, and the exact endpoint without loop wrapping. The near-end probe is the end minus the smaller of 1 ms and one thousandth of the final sample interval. Both clips use their authored playback quantization.

The report measures complete local transforms of the selected root, middle and end joints, plus end-effector position including `endOffset`. Endpoint positions compose all ancestors, including rotation, reflection and supported nonuniform scale, with identity outer Puppet placement. Distances are **rig units**, not screen pixels; host scale can magnify them. Facing/nonuniform outer scale are also tested through actual Puppet playback.

| Measurement                               | Blocking tolerance at keys | Warning target between keys |
| ----------------------------------------- | -------------------------- | --------------------------- |
| Local translation distance                | `1e-6` parent-frame units  | `1e-6` parent-frame units   |
| Local rotation, shortest angular distance | `1e-6` radians             | `π/90` radians (2°)         |
| Local scale, maximum component difference | `1e-9`                     | `1e-9`                      |
| End-effector world distance               | `1e-5` rig units           | 1 rig unit                  |

Key agreement verifies solved sample reproduction. Between-key targets are practical review thresholds for the shipped rig scale, not an asset-independent guarantee. `success` means key agreement and valid runtime evaluation; `withinBetweenKeyTolerance` separately describes interpolation quality. Excess drift remains visible as a warning with the selected FPS and measured maximum angle/endpoint error. Artists can increase FPS, preview again, or accept the approximation. Key disagreement blocks commit. Invalid references, absent clip suppression, changed duration, non-finite/overflowed transforms and unsupported/singular IK evaluation fail without mutating source or history.

Regressions compare 8/10/12/60 FPS in smooth and stepped playback, retaining an off-grid 1050 ms endpoint. All match keys within blocking tolerances. A fast out-and-back reach hidden between 10 FPS samples exceeds the endpoint warning target; 60 FPS reduces its measured endpoint error by more than tenfold. Higher FPS increases key count without lengthening the clip, but may still miss motion or remain inaccurate.

Version 1 supports only clip-wide **linear** interpolation. Stepped playback quantizes the clock; it is not a separate interpolation type. Use authored stepped FPS or an integer multiple for baking. Incompatible grids that lose key agreement are rejected with an FPS diagnostic. Playback speed changes the clock, not key positions or duration. Finite probes cannot bound every moment between them: scrub visually as well as reviewing numbers. No adaptive sampling or key reduction is performed.

## Constraint and transition behavior

Shared rig data and constraint `enabled` flags stay unchanged. Full clip ownership skips selected IK before calling runtime providers, preventing double solving even with host-owned targets/mix. Other constraints remain procedural. Another clip sharing the rig retains IK; switching directly to it restores solving.

Crossfades/layers retain existing precedence: masks use the constraint's **root bone**, and suppression blends with layer/fade weight. Partial suppression attenuates IK influence; interrupted fades retain ownership snapshots. Blending authored bone poses followed by a partially active solver does not generally equal blending two final solved poses. Exact IK-to-baked transition fidelity, arbitrary runtime layer-stack capture, external gameplay provider capture and fixed-target preview capture are unsupported bake configurations. Preview those transitions separately; full baked ownership or direct switching preserves sampled baked motion. Overlapping driven chains remain blocked.

## Editing, history, saving and events

Generated rotations support ordinary selection, value edits, deletion, movement/group movement, clipboard, duplication and clip interpolation commands. Each edit has normal history; undoing the bake restores the exact original keys, IK tracks and suppression metadata. Redo restores the baked snapshot. Saved-checkpoint dirty tracking, import and source revert retain the existing document lifecycle.

Onion skins evaluate authored pre-IK bone motion, so baked keys appear directly and edits/Undo refresh snapshots. Ghost sampling and bake preview never fire gameplay events or mutate animations. Normal playback retains start, interval, loop and completion semantics and nested payloads. Bone mirroring preserves IK targets and clip suppression, with the existing v0.5.4 transform limitations. Active unselected destination IK can still influence the displayed mirrored bones.

Canonical version-1 export preserves `disabledIKConstraints` over repeated round trips. `CharacterLoader` supplies these clips directly to production Puppet playback without editor state. Diagnostics, preview preferences and bake selection stay outside JSON.

## Regression and performance record

Bake suites cover sampling/generation/commit, deterministic local/world fidelity, constraints/providers, source immutability, editing/history, events, ghosts, mirroring, JSON/loader compatibility, React panel output and lifecycle. The full unit suite also checks existing rig hierarchy/joints, sprite projection, slots/attachments, IK, weapon/foot constraints, blending/layers, skins and timeline/document commands. Browser checks run locally against actual React/Phaser routes in development and production. No browser steps are added to CI, and no human visual review is claimed.

The pipeline is synchronous and scales with sample count, rig size and selected chains. It reuses two solver contexts for comparisons, with extra midpoint probes and ancestor walks for endpoints. It never runs whole-clip diagnostics per playback frame. The existing 10,000-sample grid limit remains; dense long clips can pause the UI during planning.

Local measurements on 12 October 2026 used the built `/core` package in Node 24.19.0, macOS x64, a seven-bone synthetic rig with two independent arm constraints, a rotated/nonuniform parent and endpoint offsets. Timings cover sampling, generation and commit, including commit's repeated validation/sampling and full motion comparison. Each row is the median of 20 runs after three warmups. No browser rendering is included and no timing threshold is imposed.

| Duration | FPS | Generated property keys | Runtime probes | Median pipeline time |
| -------- | --- | ----------------------- | -------------- | -------------------- |
| 1050 ms  | 8   | 40                      | 20             | 10.49 ms             |
| 1050 ms  | 10  | 48                      | 24             | 8.85 ms              |
| 1050 ms  | 12  | 56                      | 28             | 11.85 ms             |
| 1050 ms  | 60  | 256                     | 128            | 27.33 ms             |
| 1050 ms  | 240 | 1012                    | 506            | 110.26 ms            |
| 10000 ms | 60  | 2404                    | 1202           | 261.48 ms            |

In this diagnostic, key-time local errors were zero and endpoint error stayed below `2.1e-13` rig units. At 60 FPS the 1050 ms reach had maximum measured between-key error of about 0.424° and 0.0425 rig units. The separate fast out-and-back example measured 80 rig units of endpoint drift at 10 FPS and 0.972 rig units at 60 FPS, with about 1.734° angular error at 60 FPS. Increasing FPS does not guarantee monotonic measured error: each grid probes different times, especially around solver reach boundaries.

## Implementation and verification report

The new engine implementation is `src/engine/ik/IKBakeMotionFidelity.ts`, exported through `src/engine/core.ts` and the existing browser entry point. `IKBakeCommit.ts` adds runtime comparison and stepped-grid feedback; `IKBakeGeneration.ts` clarifies proposal versus committed-motion checks. `IKBakeController.ts` caches/invalidates reports and `IKBakePanel.tsx` displays them. Package manifests advance to `0.5.6-5` without dependency changes.

`tests/ikBakeHardening.test.ts` adds 25 regression cases. Existing controller/panel/browser bake suites add feedback, report lifecycle and rendered-output assertions. The artist guide adds a reaching-arm example and editing/Undo instructions; the editor, architecture, IK/mirroring guides, README and changelog link the completed workflow and its limits.

Verified commands:

| Command                                                                                 | Result                                                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                     | Passed                                                                                 |
| `npm run test`                                                                          | 1972 passed, 32 existing optional profiling cases skipped; 117 files passed, 3 skipped |
| `npm run build`                                                                         | Passed: demo, library, declarations and plain Node `/core` check                       |
| `npm run check`                                                                         | Passed: formatting, type-aware lint and typecheck                                      |
| `npm run check:version`                                                                 | Passed for `0.5.6-5`                                                                   |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationIKBaking.spec.ts` | 4 passed, hand/leg baking in development and production                                |
| Bone authoring scenario rerun with `--grep 'three-key authoring' --timeout=90000`       | 2 passed, development and production                                                   |

Six additional demo/rig checks passed in development and production using `--grep 'inspector typing keeps focus|demo loads artwork|demo and editor navigation' --timeout=90000` on `tests/browser/demo.spec.ts` and `tests/browser/rigEditor.spec.ts`. They cover rig inspector history, demo playback/facing/skins/IK and route lifecycle. The targeted runs total 12 passing browser checks.

The broad 310-case browser run was interrupted after an existing bone-authoring scenario exceeded its 30-second limit (three preceding/completed cases passed). That scenario passed individually in both environments with a 90-second allowance, completing in 16.0 and 18.5 seconds. The full browser suite is **not** claimed as verified. Browser checks are automated and local-only; human visual/artist verification was not performed.

Partial ranges, adaptive sampling/key reduction, automatic cleanup, new solvers, retargeting, sprite replacement, rig-tweak mode, physics/ragdolls and scene choreography remain deferred.
