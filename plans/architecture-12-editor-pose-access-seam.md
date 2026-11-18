# Architecture candidate 12 — Editor pose-access seam (follow-up to architecture-02 / architecture-10)

Continue developing Paper Puppeteer Engine.

Source: review of `plans/architecture-02-pose-source-seam-behind-puppet.md` on 2026-11-17, re-checked against `ef00409` on 2026-11-18 (nothing below is implemented yet). Architecture-02 and architecture-10 moved the pose-sync protocol into `PosePipeline`, but production devtools code still reaches it through the `@internal puppet.posePipeline` field. So the original complaint, "every `@internal` marker is a comment, not a type-level fact", still holds. It has just moved from imports to member access.

## Problem

12 lines in 8 devtools files outside `src/engine` use `puppet.posePipeline` (measured at `ef00409`). They fall into two groups.

**A. Manual pose-sync ordering.** These are the prepare → edit → sync sequences architecture-02 set out to remove:

| Call site | Pattern |
|---|---|
| `src/devtools/animation-editor/AnimationEditorScene.ts:536,559` (`setIKPreview`) | `preparePose()` → mutate IK constraints/providers → `syncPose()` |
| `src/devtools/rig-editor/RigEditor.ts:673,680` (`setIKPreview`) | `preparePose()` → mutate IK constraints → `syncPose()` |
| `src/devtools/rig-editor/RigEditor.ts:184` (`enable`) | mutate IK constraints → `syncPose()` (no prepare) |
| `src/devtools/animation-editor/AnimationEditorPreview.ts:68` | lone `syncPose()` after a placement change in rig mode |
| `src/devtools/rig-editor/RigEditor.ts:351-411` (`applyRig`) | `preparePose()` → rig-bone and slot edits → detach the old preview source → *either* `attachPoseSource({ pose })` *or* `syncPose()` |

**B. Runtime-player access.** These are reads and settings on `posePipeline.player` that the public `Puppet` API doesn't offer:

| Call site | Use |
|---|---|
| `src/devtools/shared/RetargetComparison.tsx:55` | `player.setPreviewMode(true)` |
| `src/devtools/shared/AnimationLibraryPreview.tsx:39` | `player.setPreviewMode(true, { applyRootMotion: true })` |
| `src/devtools/scene-editor/SceneActorPreview.ts:61` | `player.setPreviewMode(true)` |
| `src/devtools/shared/RetargetComparisonPlayback.ts:17` | `player.sampleRootMotion(time)` |
| `src/devtools/scene-editor/ScenePlaybackInspector.tsx:48` | `player.elapsedTime` |

Nothing stops new devtools code from adding more. The barrel lint rule only restricts imports, and `Puppet`'s type (exported through `runtime.ts`) includes `posePipeline`.

**`previewClip` has no production caller.** `Puppet.previewClip` (`src/engine/Puppet.ts:914`, delegating to `PosePipeline.previewClip` at `src/engine/PosePipeline.ts:106`, added in `77663bb`) is used only by `tests/poseSourcePreview.test.ts`. The editor preview needs drafts, IK target drafts and library poses layered over the sampled pose, which `previewClip(clip, time)` can't express. No tag contains `77663bb`, so it has never been released. It is documented, though:

- `docs/animation.md:191` describes `puppet.previewClip(clip, timeMs)`;
- the Unreleased changelog entry at `CHANGELOG.md:31` lists `previewClip` among the APIs the guides now use;
- the `@internal` comment on `Puppet.posePipeline` (`src/engine/Puppet.ts:72`) names `attachPoseSource/previewClip` as the public seam;
- architecture-02 mentions it in item 1, its verification, and the recorded decisions at lines 45 and 52.

(`src/devtools/animation-editor/previewClip.ts` / `getCompiledPreviewClip` and `RigEditor.previewClip(s)` are unrelated editor helpers and stay.)

## Goal

Production code outside `src/engine` never touches `posePipeline`. The ordering of pose edits is owned by one `Puppet` method, and a lint check enforces both rules.

## What to build

1. **`Puppet.editPose(edit?: () => void, options?: SyncPoseOptions): void`.**
   - Implementation: throw `Error('Puppet has been destroyed.')` if destroyed (same message as `PosePipeline.attachPoseSource`), then `preparePose()`, then `try { edit?.() } finally { syncPose(options) }`. If `edit` throws, the sync still runs and the original error propagates. `syncPose` already marks the pose dirty if its own projection fails, so a failed sync gets retried.
   - Add a JSDoc line: "Restore the pre-IK pose, apply `edit`, then re-project and solve IK. With no `edit`, it re-syncs the pose."
   - `Puppet`'s own prepare → mutate → sync methods (`setBoneRotation`, `applyPose`, `clearPose`, `Puppet.ts:343-375`) may switch to `editPose`, but don't have to.

2. **Migrate group A.**
   - `AnimationEditorScene.setIKPreview` and `RigEditor.setIKPreview`: wrap the constraint loop in `puppet.editPose(() => { … })`.
   - `RigEditor.enable` (`:178-186`): `this.puppet.editPose(() => { …constraint loop… })`. Adding the prepare is intended: it matches the other IK-toggle path. `rigEditorActivation.test.ts` must stay green.
   - `AnimationEditorPreview.ts:68`: `if (force) this.puppet.editPose();`.
   - `RigEditor.applyRig`: the prepare must still come before the rig-bone edits, because `preparePose` restores the IK-solved bones. Restructure the method like this:
     1. Call `this.detachPreviewPoseSource?.()` and set it to `undefined` **before** the edit, so the sync doesn't run with the old source attached.
     2. `this.puppet.editPose(() => { … })` wraps everything the method does now between the prepare and the detach: rig-bone edits, building `previewPose`, slot edits and `updateRenderOrder(rig)`. Declare `previewPose` outside the callback and fill it inside. That keeps the weight-preview read of `bone.pose.rotation` after the prepare, as it is today.
     3. If `previewPose.size`, set `this.detachPreviewPoseSource = this.puppet.attachPoseSource({ pose: previewPose })`.

     Moving the detach earlier is safe, because nothing between the old detach position and the edits reads the pose source. When a preview is active, the restructure adds one sync and IK solve before the attach. The end pose is the same, because `attachPoseSource` prepares again, projects the new pose and re-solves IK. `syncPose` only re-projects a newly attached source, so the extra sync can't apply a stale clip pose. Only optimise this away if a rig-editor profile shows the extra solve.
   - Update the fake puppets in `tests/rigArtworkAlignment.test.ts`, `rigEditorActivation.test.ts`, `rigEditorBatch.test.ts` and `rigEditorPreview.test.ts` (and `puppetRenderer.test.ts` if it fakes the editor path) so they provide `editPose: (edit) => edit?.()` alongside, or instead of, their `posePipeline` mocks. Assertions on `preparePose`/`syncPose` call order become assertions on `editPose`.

3. **Public player delegates on `Puppet` for group B.** Add exactly these three, each with a JSDoc line:
   - `setPreviewMode(enabled: boolean, options?: { applyRootMotion?: boolean }): this`
   - `sampleRootMotion(timeMs: number): { x: number; y: number }` (match `AnimationPlayer.sampleRootMotion`'s return type)
   - `get elapsedTime(): number`

   Migrate the five group B call sites to them. `tests/runtimePublicApi.test.ts` has no `Puppet` member list today. Add a test there that builds a puppet through the public runtime entry, calls each delegate, and checks it matches `puppet.posePipeline.player`. Engine-internal users (`Actor.ts`, `ActorMovement.ts`, `SceneRunner.ts`) may switch, but don't have to.

4. **Enforce it.** Add `scripts/check-engine-internals.mjs` and append it to the `lint` script in `package.json`, after `check-project-context.mjs`. Model it on `scripts/check-subscribers.mjs`:
   - Scan every `.ts`/`.tsx` file under `src/` except `src/engine/`.
   - Strip `//` and `/* */` comments, then fail on any match of `/\.posePipeline\b/`. Report `file:line`.
   - The error message says to use `puppet.editPose(…)` for pose edits, `puppet.attachPoseSource(…)` for external pose/IK/deformation channels, and `puppet.setPreviewMode` / `sampleRootMotion` / `elapsedTime` for player access.
   - Export the scan as a function (for example `findEngineInternalUses(root)`) so a test can run it against a fixture directory.
   - Tests are exempt: `tests/` may keep using `puppet.posePipeline` as an engine internal (304 uses in 58 files).

   oxlint has no rule that restricts property access by name, so use the script.

5. **Delete `previewClip`.**
   - Remove `Puppet.previewClip` and `PosePipeline.previewClip`, plus any imports that become unused (`compileClip`, `AnimationPlayer`, `assertFinite` in `PosePipeline.ts` if nothing else uses them).
   - `tests/poseSourcePreview.test.ts`: delete the three `previewClip` tests (`:42`, `:63`, `:85`). Rename the destroy test at `:188` to "attachPoseSource and editPose reject use after destroy" and replace its `previewClip` assertion with `editPose`. Keep the attach/detach tests.
   - Update `@internal` comment on `Puppet.posePipeline` (`Puppet.ts:72`) to name `editPose`/`attachPoseSource` as the public seam.
   - `docs/animation.md:191`: replace the `previewClip` sentence with one sentence on `puppet.editPose(edit)`. Keep the `attachPoseSource` sentence.
   - `CHANGELOG.md:31`: replace `previewClip` with `editPose` in the list of APIs the guides use.
   - `plans/architecture-02-pose-source-seam-behind-puppet.md`: replace the throwaway-player decision (line 45) with "`previewClip` removed in architecture-12 (unreleased, no production caller)". In line 52, replace `attachPoseSource`/`previewClip` with `attachPoseSource`/`editPose`.

## Out of scope (recorded as intentional in architecture-02)

- Shrinking `Puppet` to about 25 public methods. Dropped: its surface is the runtime API games use.
- Narrowing what `core.ts` re-exports. That is library API design, separate from the pose seam.
- Replacing the animation editor's own preview `AnimationPlayer` over detached joints. It is kept, because the editor layers overlays that a clip-only preview can't express.

## Constraints

- Behaviour-preserving. IK preview, mesh deformation preview, the ghost layer, retarget comparison, scene actor preview and the rig editor's clip and weight-paint previews must look identical.
- `npm run build:lib` (`scripts/check-core.mjs`) stays green. The new `Puppet` members must work in the Node core check, so add one `editPose` call there.
- Changelog entry goes under Unreleased (this plan has no version number). It covers `editPose`, the three player delegates, the internals check, and the removal of `previewClip`.

## Verification

- `npm run check` (format, lint including the new internals check, typecheck)
- `npm run test` (sequential, one worker)
- `npm run build:lib` and `npm run check:demo`
- New Phaser-free unit tests for `editPose`, in `tests/poseSourcePreview.test.ts`:
  - prepare runs before `edit`, and sync runs after it (an IK target provider sees the restored pre-IK pose);
  - sync still runs when `edit` throws, and the error propagates;
  - `editPose()` with no argument re-syncs a dirty pose;
  - it throws `/destroyed/` after `destroy()`.
- A rig-editor test: with a clip preview active, calling `applyRig` again leaves bones at the same transforms as before the change. That covers moving the detach and the extra sync.
- A test for the internals check: `findEngineInternalUses` reports a fixture file outside `src/engine` that uses `.posePipeline`, ignores an occurrence inside a comment, and returns nothing for the real `src/` tree.

## Acceptance

- `grep -rn "\.posePipeline" src --exclude-dir=engine` finds nothing, and `npm run lint` fails if one is added.
- No production file outside `src/engine` calls `preparePose`/`syncPose`. Every pose edit goes through `editPose` or `attachPoseSource`.
- `grep -rn "previewClip(" src/engine docs CHANGELOG.md` finds nothing.
- Full test suite passes.

## Implementation notes (2026-11-18)

- The internals check takes the directory to scan as an optional argument (default `src`), and `tests/checkEngineInternals.test.ts` runs it as a child process, following `tests/checkDemoPages.test.ts`. It doesn't export a `findEngineInternalUses` function.
- The check also rejects the quoted key `'posePipeline'`. `AnimationEditorPreview` had narrowed its puppet with `Pick<Puppet, … | 'posePipeline'>`, which plain member access matching misses. It now picks `'editPose'`.
- `scripts/check-core.mjs` imports only the Phaser-free `/core` entry, which doesn't include `Puppet`. The new members are type-checked in the packed consumer in `scripts/check-package.mjs` instead.
- `applyRig` detaches the previous preview source before `editPose`, builds the preview pose inside the edit (after the rig-bone edits), and attaches afterwards. `tests/rigEditorPreview.test.ts` covers that order and the weight-preview bend over an edited bone.
