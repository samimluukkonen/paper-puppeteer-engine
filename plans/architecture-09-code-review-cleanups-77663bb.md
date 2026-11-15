# Architecture candidate 09 — Code-review cleanups for the PoseSource seam + barrel (commit 77663bb)

Continue developing Paper Puppeteer Engine.

Source: code-review skill run on `git diff fa47e20...HEAD` (commit `77663bb`, "Add PoseSource seam behind Puppet and enforce the engine barrel"), Standards axis judgement calls plus one Spec-axis decision. All items are small, local, behaviour-preserving edits.

## Problem

The Standards review found 0 hard violations but 5 judgement calls, and the Spec review flagged one whitelist decision, in the diff of `77663bb`:

1. Dead branch: `src/engine/PosePipeline.ts:269` — `if (source instanceof AnimationPlayer) return source.getMeshDeformationForRendering();` has no remaining caller (the only `attachPoseSource` caller, `AnimationEditorPreview.ts:138-160`, passes a plain object with getters). Leftover from the removed `setMeshDeformationSource(this.player)` path.
2. Redundant argument: `src/engine/Puppet.ts:188` passes `poseHooks: { prepare: () => this.preparePose(), synchronize: () => this.syncPose() }`, byte-identical in shape to `PosePipeline`'s own default — but the explicit wiring routes through `Puppet`'s spied methods, which tests (e.g. `tests/choreographySequence.test.ts`) rely on.
3. Weak sentinel type: `src/engine/PosePipeline.ts:56` — `private projectedPose: unknown;` is used only as an identity sentinel (`:85`, `:186`).
4. Stale doc comment: `src/engine/data.ts:1` still says "Shared authored data contracts" although the file is now `export type * from './core.js'` (all core types).
5. Whitelist decision: the `.oxlintrc.json` `no-restricted-imports` override also permits `engine/index.js` and `engine/serialization.js`, broader than the spec's "core.ts/runtime.ts only".

## Goal

Remove the dead branch and weak types, fix the stale comment, and ratify (or tighten) the barrel whitelist — without changing any behaviour.

## What to build

1. Delete the `instanceof AnimationPlayer` branch in `PosePipeline.getMeshDeformationForRendering` (`src/engine/PosePipeline.ts:269`), unless a live-channel caller is reintroduced. Re-run the pose-source tests to confirm nothing depended on it.
2. `projectedPose`: give it an honest type, e.g. `ReadonlyMap<string, Readonly<JointTransform>> | undefined`, in `src/engine/PosePipeline.ts:56`.
3. `data.ts` doc comment: reword to describe single-sourcing from the core barrel (e.g. "All engine data contracts, single-sourced from the core barrel via `export type *`").
4. Decide the whitelist: either tighten the `.oxlintrc.json` patterns group to only `core.js`/`runtime.js`/`data.js` (spec-literal reading), or keep `index.js`/`serialization.js` and record them as intentional public entries in the plan. Default: keep them (they are the published package entries) and document that choice.
5. `poseHooks` in `Puppet.ts:188`: keep the explicit wiring (tests spy on `puppet.preparePose`/`puppet.syncPose`), but if the facade shrink (architecture-10) makes `PosePipeline` own those hooks directly, drop the redundant argument there.

## Constraints

- Behaviour-preserving: no public API change except the deleted dead branch.
- `npm run build:lib` (`scripts/check-core.mjs`) must stay green; `/core` stays Node-safe (value-import classification of Phaser must not change).

## Verification

- `npm run check` (format, lint, typecheck)
- `npm run test` (sequential, one worker)
- `npm run build:lib` and `npm run check:demo`

## Acceptance

- No dead `instanceof AnimationPlayer` branch in `PosePipeline`. (Outcome: the branch proved live — see Recorded decisions — so it stays with an explanatory comment.)
- `projectedPose` has a concrete type; `data.ts` comment matches its contents.
- Whitelist decision recorded in this plan and reflected in `.oxlintrc.json`.
- Full test suite passes.

## Recorded decisions

- Dead branch (Problem 1 / What to build 1): kept the `instanceof AnimationPlayer` branch. The review's premise of "no remaining caller" did not hold: `tests/meshDeformation.test.ts` ("runtime and editor-source rendering consume live channels without creating public snapshots") attaches an `AnimationPlayer` directly via `puppet.attachPoseSource(source)` and asserts that rendering reads `getMeshDeformationForRendering()` live channels without touching the public `meshDeformation` snapshot getter. Deleting the branch fails that test and would make per-frame rendering consume the frozen public snapshot, so the branch is live, not dead. A comment now states why it exists.
- Whitelist (Problem 5 / What to build 4): kept `engine/index.js` and `engine/serialization.js` in the `no-restricted-imports` override. They are intentional public entries — `exports["."]` and `exports["./serialization"]` in `package.json` — alongside the `core.js`/`runtime.js`/`data.js` barrels. The lint message in `.oxlintrc.json` now names them as the published entries instead of implying core/runtime/data only.
- `poseHooks` (Problem 2 / What to build 5): kept the explicit wiring in `Puppet.ts`. Tests (e.g. `tests/choreographySequence.test.ts`) spy on `puppet.preparePose`/`puppet.syncPose`, so the explicit argument routes through the spied methods even though it is shape-identical to the `PosePipeline` default. Revisit when architecture-10 makes `PosePipeline` own those hooks directly.
