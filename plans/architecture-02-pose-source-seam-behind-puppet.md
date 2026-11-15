# Architecture candidate 02 — PoseSource seam behind Puppet + enforced engine barrel

Continue developing Paper Puppeteer Engine.

Source: architecture review 2026-11-14 (candidate 2, rated Strong).

## Problem

The engine's outer seam is unenforced: `src/devtools`, `src/ui` and `src/shared` make 627 imports of engine modules but only 2 go through `src/engine/core.js` — `Rig.js` (54×), `types.js` (44×), `AnimationClip.js` (36×), `readonlyData.js` (35×), `Puppet.js` (18×). Every `@internal` marker is a comment, not a type-level fact. Worse, there is no preview seam: `AnimationEditorPreview.ts:94-151` builds its own `AnimationPlayer` over detached `Joint`s and hand-copies results into the live puppet (`Object.assign(this.puppet.getBone(joint.id).pose, joint.pose)`, `:133-137`) wrapped in manual `preparePose()`/`syncPose()` calls and hot-swapped via `setIKAnimationSource`/`setMeshDeformationSource`. `RigEditor.ts:341-364,408,450,469` does the same. The pose-sync ordering invariant is spread across 5+ call-site statements per editor. Related: `preparePose`/`synchronizePose` callbacks are threaded through 17 `AnimationPlayer` method signatures although the only production caller (`Puppet.ts:89-90`) always passes the same two closures, and `Puppet` itself is a god-facade re-exposing ~39 player methods plus `animationPlayer` as a public readonly field (`Puppet.ts:72`).

## Goal

Make the engine's entry point structural and give `Puppet` a small preview interface that owns the prepare → sample → project ordering internally.

## What to build

1. `PoseSource` seam on `Puppet`: `attachPoseSource(source: { ikAnimation, meshDeformation }): () => void` (replacing `setIKAnimationSource` + `setMeshDeformationSource`, which already have this shape at `Puppet.ts:884-893`) plus `previewClip(clip, timeMs): void` that owns prepare → sample → project internally.
2. Constructor-injected pose hooks on `AnimationPlayer` (`new AnimationPlayer(rig, joints, clips, { rootMotion, poseHooks: { prepare, synchronize } })`, mirroring the existing `rootMotionApplication` injection at `AnimationPlayer.ts:146-150`); remove the per-call `preparePose`/`synchronizePose` params from all 17 methods and enforce the ordering in one private call site.
3. Shrink `Puppet`'s facade: keep lifecycle/placement/facing/slots; move the pose-sync protocol into an internal `PosePipeline` module (absorbing `PuppetPoseController`'s prepare/sync duties and the source-swapping fields). Target ~25 public methods instead of ~60.
4. Enforce the barrel: make `core.ts`/`runtime.ts` the only importable engine entry from outside `src/engine` (lint rule via `.oxlintrc.json` and/or tsconfig `paths`), and update devtools/ui/shared imports accordingly. Single-source `data.ts` re-exports so adding an engine module touches one list, not two.

## Constraints

- Behaviour-preserving refactor; `tests/` currently imports internals heavily (`Rig.js` 129×, `Puppet.js` 86×) — tests may keep importing internals, but production devtools/ui code must go through the barrel.
- Do not break the library build: `npm run build:lib` runs `scripts/check-core.mjs` — keep it green.
- Editor preview behaviour (IK preview, mesh deformation preview, ghost layer) must be visually identical.

## Verification

- `npm run check` (format, lint, typecheck)
- `npm run test` (sequential, one worker — per AGENTS.md do not parallelise)
- `npm run build:lib` and `npm run check:demo`
- New unit tests for `previewClip`/pose-source attach-detach ordering that do not boot Phaser.

## Acceptance

- No production import outside `src/engine` reaches an engine internal module directly.
- `AnimationEditorPreview.refresh()` reduces to: build source → attach → sample (no manual pose copying).
- No public method of `AnimationPlayer` takes per-call pose hooks anymore.
- Full test suite passes.

## Recorded decisions (follow-up: architecture-10, commits 6a06e0e, f7b5f98, 5f548cc)

- `PoseSource.pose` channel ratified as intentional. The spec'd `{ ikAnimation, meshDeformation }` shape grew a `pose` channel because the editor previews project sampled poses through it. Entries are partial transforms merged over the live bone pose (`Object.assign`) on projection — after restore, before presets and IK. A newly attached source projects once; later syncs keep direct bone edits until re-attach or detach (covered by `tests/poseSourcePreview.test.ts`).
- `previewClip` throwaway-player strategy recorded as intentional. It builds and disposes a fresh `AnimationPlayer` per call instead of sampling on the pipeline's player, so previewing never moves runtime clocks, fires events, or applies root motion. Covered by `tests/poseSourcePreview.test.ts`.
- `attachPoseSource` owns the full prepare → attach → project ordering, so editor call sites reduce to build source → sample → attach with no manual `preparePose()`/`syncPose()` (AnimationEditorPreview) and no `Object.assign` copies into live bones (RigEditor clip preview; authored rig edits stay direct edits).
- Facade shrink outcome: `Puppet.animationPlayer` is private (player access routes through `PosePipeline.player`), and the pose-sync protocol (`preparePose`/`syncPose`/`syncIK`/`markPoseDirty`/`refreshDebugViews`) lives on `PosePipeline`, exposed only as `@internal puppet.posePipeline` for engine internals and tests. Puppet's public surface keeps lifecycle/placement/facing/slots/animation-control/pose-preset APIs plus the `attachPoseSource`/`previewClip` preview seam; the per-call pose-hook parameters on `AnimationPlayer` remain removed (constructor-injected `PoseHooks` only).
