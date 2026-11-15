# Architecture candidate 10 — Puppet facade shrink + editor migration off manual pose sync (follow-up to 77663bb)

Continue developing Paper Puppeteer Engine.

Source: code-review skill run on `git diff fa47e20...HEAD` (commit `77663bb`), Spec axis findings 6-8, 10, 11 against `plans/architecture-02-pose-source-seam-behind-puppet.md`. This is the remaining unmet portion of architecture-02 item 3 and its editor-preview acceptance criterion.

## Problem

Commit `77663bb` extracted `PosePipeline` and added `attachPoseSource`/`previewClip`, but the Spec review found:

1. `Puppet` still has ~95 public methods/getters (identical count to `fa47e20`); the spec's item 3 target was ~25. `readonly animationPlayer` is still a public field (`src/engine/Puppet.ts:72`), and `preparePose`/`syncPose`/`syncIK`/`markPoseDirty`/`refreshDebugViews` remain public facade methods (`src/engine/Puppet.ts:902-947`). ~39 player delegates are re-exposed.
2. `AnimationEditorPreview.refresh()` still wraps attach+sample in manual `this.puppet.preparePose()` (`AnimationEditorPreview.ts:114,126`) and `this.puppet.syncPose()` (`:68,164`); the acceptance criterion wants it reduced to build source → attach → sample.
3. `RigEditor.ts` still hand-copies a sampled clip pose into live puppet bones (`Object.assign(this.puppet.getBone(id).pose, transform)` at `:367`, inside `applyRig` between manual `preparePose()`/`syncPose()` at `:346,:392`) — the exact pattern the spec cited (`RigEditor.ts:341-364,408,450,469` at spec time).
4. `PoseSource` gained a `pose` channel beyond the spec'd `{ ikAnimation, meshDeformation }` shape — needs ratifying as intentional (the preview projects sampled poses through it).
5. `previewClip` builds and disposes a new `AnimationPlayer` per call rather than sampling on the pipeline's player — works (isolates runtime clocks, covered by `tests/poseSourcePreview.test.ts`), but heavier than "sample on existing player".

## Goal

Shrink `Puppet`'s public surface to lifecycle/placement/facing/slots (~25 methods) by moving the pose-sync protocol fully into `PosePipeline`, and migrate both editors so no call site manually sequences prepare → sample/copy → sync.

## What to build

1. Make `animationPlayer` private on `Puppet`; route the ~39 player delegates through `PosePipeline` (keep only the methods the public API genuinely needs). Update the ~34 test files and engine internals that currently touch `puppet.animationPlayer` (tests may keep importing engine internals, but should use the narrowed API or `PosePipeline` directly).
2. Move the prepare/sync wrapping into the pipeline: e.g. `attachPoseSource` performs the prepare, and the source-projection path performs the sync, so `AnimationEditorPreview.refresh()` reduces to build source → `attachPoseSource` → sample (no manual `puppet.preparePose()`/`syncPose()` at the call site).
3. Migrate `RigEditor.applyRig`'s clip-preview portion to a pose source (or `previewClip`) where it can be expressed as one; keep the authored rig-bone edits as direct edits (they are not a preview).
4. Ratify the `PoseSource.pose` channel in architecture-02 (or drop it if the preview can project through `ikAnimation` alone), and record the `previewClip` throwaway-player strategy as intentional.
5. Keep `PoseHooks` routing through `Puppet.preparePose`/`syncPose` spies working until the facade shrink removes the need (see architecture-09 item 5).

## Constraints

- Behaviour-preserving; editor preview (IK preview, mesh deformation preview, ghost layer) must stay visually identical.
- Tests may keep importing internals, but production devtools/ui code must go through the barrels (lint override from 77663bb stays).
- `npm run build:lib` (`scripts/check-core.mjs`) stays green; full suite passes.

## Verification

- `npm run check` (format, lint, typecheck)
- `npm run test` (sequential, one worker)
- `npm run build:lib` and `npm run check:demo`

## Acceptance

- `Puppet` exposes ~25 public methods; `animationPlayer` is no longer a public field.
- `AnimationEditorPreview.refresh()` reduces to build source → attach → sample with no manual pose copying or manual prepare/sync calls.
- No public method of `AnimationPlayer` takes per-call pose hooks (already met; keep it true).
- Full test suite passes.
