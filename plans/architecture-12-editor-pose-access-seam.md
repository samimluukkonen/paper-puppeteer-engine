# Architecture candidate 12 — Editor pose-access seam (follow-up to architecture-02 / architecture-10)

Continue developing Paper Puppeteer Engine.

Source: review of `plans/architecture-02-pose-source-seam-behind-puppet.md` on 2026-11-17. Architecture-02 and architecture-10 moved the pose-sync protocol into `PosePipeline`, but production devtools code still reaches it through the `@internal puppet.posePipeline` field. So the original complaint, "every `@internal` marker is a comment, not a type-level fact", still holds. It has just moved from imports to member access.

## Problem

11 member accesses in 8 devtools files go through `puppet.posePipeline` (measured at `bb6762b`). They fall into two groups:

**A. Manual pose-sync ordering (6).** These are the prepare → edit → sync sequences architecture-02 set out to remove:

| Call site | Pattern |
|---|---|
| `src/devtools/animation-editor/AnimationEditorScene.ts:535,558` (`setIKPreview`) | `preparePose()` → mutate IK constraints/providers → `syncPose()` |
| `src/devtools/rig-editor/RigEditor.ts:671,678` (`setIKPreview`) | `preparePose()` → mutate IK constraints → `syncPose()` |
| `src/devtools/rig-editor/RigEditor.ts:182` | mutate IK constraints → `syncPose()` (no prepare) |
| `src/devtools/animation-editor/AnimationEditorPreview.ts:68` | lone `syncPose()` after a placement change in rig mode |

`RigEditor.applyRig` (`:350-410`) also calls `pipeline.preparePose()` / `pipeline.syncPose()` around its direct rig-bone edits.

**B. Runtime-player access (5).** These are reads and settings on `posePipeline.player` that the public `Puppet` API doesn't offer:

| Call site | Use |
|---|---|
| `src/devtools/shared/RetargetComparison.tsx:55` | `player.setPreviewMode(true)` |
| `src/devtools/shared/AnimationLibraryPreview.tsx:39` | `player.setPreviewMode(true, { applyRootMotion: true })` |
| `src/devtools/scene-editor/SceneActorPreview.ts:67` | `player.setPreviewMode(true)` |
| `src/devtools/shared/RetargetComparisonPlayback.ts:17` | `player.sampleRootMotion(time)` |
| `src/devtools/scene-editor/ScenePlaybackInspector.tsx:48` | `player.elapsedTime` |

Nothing stops new devtools code from adding more. The barrel lint rule only restricts imports, and `Puppet`'s type (exported through `runtime.ts`) includes `posePipeline`.

Also, `Puppet.previewClip` (added in `77663bb`) has no production caller. The editor preview needs drafts, IK target drafts and library poses layered over the sampled pose, which `previewClip(clip, time)` can't express. Its only callers are `tests/poseSourcePreview.test.ts`. It hasn't shipped yet: no changelog entry, and no tag contains `77663bb`.

## Goal

Production code outside `src/engine` never touches `posePipeline`. The ordering of pose edits is owned by one `Puppet` method, and a check enforces both rules.

## What to build

1. **`Puppet.editPose(edit?: () => void, options?: SyncPoseOptions): void`.** It runs prepare → `edit()` → sync in one place, using `try/finally` so the sync still happens if `edit` throws, matching `PosePipeline.syncPose`'s retry-on-error semantics. With no `edit`, it is a plain re-sync. Migrate every group A call site to it:
   - `AnimationEditorScene.setIKPreview` and `RigEditor.setIKPreview`: wrap the constraint loop in `puppet.editPose(() => { … })`.
   - `RigEditor.ts:182`: `this.puppet.editPose(() => { …constraint loop… })`. Adding the prepare there is intended: it matches the other IK-toggle path. Confirm it with the existing rig-editor tests.
   - `AnimationEditorPreview.ts:68`: `this.puppet.editPose()`.
   - `RigEditor.applyRig`: wrap the direct rig-bone and slot edits in `editPose(() => { … })`. Keep the `attachPoseSource({ pose })` branch as it is, since `attachPoseSource` already owns its own prepare → project.
2. **Public player settings on `Puppet` for group B.** Add delegates for exactly these three: `setPreviewMode(enabled, options?)`, `sampleRootMotion(timeMs)` and `get elapsedTime`. Each needs a JSDoc line, and they are listed in `tests/runtimePublicApi.test.ts`. These are legitimate runtime capabilities; scene preview and the inspector are real consumers. Engine-internal users (`Actor.ts`, `ActorMovement.ts`, `SceneRunner.ts`) may switch to them too, but don't have to.
3. **Enforce it.** Add `scripts/check-engine-internals.mjs` and run it from `npm run lint`. It fails if any file under `src/` outside `src/engine/` contains `.posePipeline` (comments ignored), and its error message points to `editPose` and the item 2 delegates. Use a native oxlint rule instead if oxlint supports a restricted-member/property rule. Tests are exempt: they may keep using `puppet.posePipeline` (303 uses in 58 files) as an engine internal.
4. **Delete `Puppet.previewClip` and `PosePipeline.previewClip`.** It is unreleased and unused in production. Remove its three tests from `tests/poseSourcePreview.test.ts`, keeping the attach/detach tests, and drop the throwaway-player note from architecture-02's recorded decisions. If you'd rather keep it, say so in a recorded decision instead.

## Out of scope (recorded as intentional in architecture-02)

- Shrinking `Puppet` to about 25 public methods. Dropped: its surface is the runtime API games use.
- Narrowing what `core.ts` re-exports. That is library API design, separate from the pose seam.
- Replacing the animation editor's own preview `AnimationPlayer` over detached joints. It is kept, because the editor layers overlays that a clip-only preview can't express.

## Constraints

- Behaviour-preserving. IK preview, mesh deformation preview, the ghost layer, retarget comparison and scene actor preview must look identical.
- `npm run build:lib` (`scripts/check-core.mjs`) stays green. The new `Puppet` members must work in the Node core check.
- Changelog entry goes under Unreleased.

## Verification

- `npm run check` (format, lint including the new internals check, typecheck)
- `npm run test` (sequential, one worker)
- `npm run build:lib` and `npm run check:demo`
- New Phaser-free unit tests for `editPose`:
  - prepare runs before `edit`, and sync runs after it (an IK target provider sees the restored pre-IK pose);
  - sync still runs when `edit` throws, and the error propagates;
  - `editPose()` with no argument re-syncs a dirty pose;
  - it throws or no-ops consistently after `destroy()` (follow `attachPoseSource`'s "destroyed" error).
- A test that the internals check fails on a fixture file outside `src/engine` that uses `.posePipeline`, and passes on the real tree.

## Acceptance

- `grep -rn "\.posePipeline" src --exclude-dir=engine` finds nothing, and the lint step enforces it.
- No production call site outside `src/engine` calls `preparePose`/`syncPose` directly. Every pose edit goes through `editPose` or `attachPoseSource`.
- `previewClip` is gone, or kept with a recorded reason.
- Full test suite passes.
