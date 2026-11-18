# Architecture candidate 17 — Small cleanups: `safeFilename` fallback, re-export shims, test isolation trial

Continue developing Paper Puppeteer Engine.

Source: codebase-design scan of the whole repo on 2026-11-17 (measured at `64f7e6e`). These are three independent, small items. Each can land as its own commit.

## Problem

1. **`safeFilename` always falls back to `animation.json`.** `src/engine/assetFilename.ts:2-10` returns the hard-coded `'animation.json'` when sanitizing leaves nothing (the name is empty or made only of dots and spaces). Verified: `safeFilename('...') === 'animation.json'`. Because it never returns an empty string, callers' own fallbacks never run:
   - `ProjectWorkspace.ts:613`: in `safeFilename(stem).slice(0, 100) || 'audio'`, the `|| 'audio'` never applies. An imported file named `..mp3` is stored as `audio/animation.json.mp3`.
   - `StorySequencePanel.tsx:113`: `${safeFilename(story.id)}.story.zip` would become `animation.json.story.zip` for an id that sanitizes to nothing.
   - `characterPackage.ts:46` and `SceneTransfer.ts:76` guard against this themselves before calling, so they're unaffected.

   `safeFilename` is public API (exported from `src/engine/core.ts:450` through the `/core` entry), so its signature must stay backward compatible.
2. **Two re-export shims serve no purpose.** `src/devtools/shared/assetFilename.ts` and `src/devtools/shared/sourceDigest.ts` are one-line re-exports of `engine/core.js`. Their only importers are `AnimationEditorScene.ts`, `AnimationEditorDocument.ts`, `tests/assetFilename.test.ts` and `tests/sourceDigest.test.ts`.
3. **Test imports dominate the run time.** On `npm run test` (one worker, `fileParallelism: false`), 45% of the 183 s run was module import: 747 modules evaluated 1301 times. Vitest estimates `isolate: false` would save about 26 s while still using one worker, which is within the sequential-tests preference.

## What to build

1. **`safeFilename(name: string, fallback = 'animation.json')`.** Return `fallback` when the sanitized result is empty, and sanitize `fallback` itself (non-recursively) so a caller can't introduce an unsafe name. The default keeps today's behaviour for library users. Update the callers:
   - `ProjectWorkspace.ts:613`: `safeFilename(…, 'audio').slice(0, 100)`, and drop the dead `|| 'audio'`;
   - `StorySequencePanel.tsx:113`: `safeFilename(story.id, 'story')`;
   - `assetFilename` already passes its own fallback through `safeFilename(fallback)`, so keep that.
2. **Delete the two shims.** Point the four importers at `../../engine/core.js` directly.
3. **Trial `isolate: false`** in `vitest.config.ts`, keeping `maxWorkers: 1` and `fileParallelism: false`. Run the full suite twice. Keep the change only if both runs are green and noticeably faster. If tests leak module state between files (spies, `vi.mock`, module-level registries), revert and record which tests leaked under "Recorded decisions" rather than patching them in this plan.

## Constraints

- `safeFilename`'s existing single-argument behaviour is unchanged. Update `docs/` wherever it's documented, if anywhere.
- Don't raise test parallelism (repo preference).
- Changelog entry goes under Unreleased: "Fixed" for item 1, nothing user-visible for items 2 and 3.

## Verification

- `npm run check`, `npm run test` (sequential, one worker), `npm run build:lib` (`scripts/check-core.mjs`)
- Unit tests for item 1:
  - `safeFilename('...')` still returns `'animation.json'`;
  - `safeFilename('...', 'audio')` returns `'audio'`;
  - `safeFilename('...', '...')` doesn't return an empty or unsafe name;
  - a project audio import of `..mp3` is stored at `audio/audio.mp3`.
- For item 3: record the before and after `Duration` lines from two runs here.

## Acceptance

- No caller fallback after `safeFilename(…)` is dead code.
- `src/devtools/shared/assetFilename.ts` and `src/devtools/shared/sourceDigest.ts` are gone.
- The `isolate` decision is recorded with timings.
- Full test suite passes.

## Recorded decisions

- `src/shared/loadSceneCharacter.ts` (also a one-line re-export of `engine/runtime.js`) is **kept**. Five editor tests use it as a `vi.mock` target (`animationEditorScene`, `animationEditorSceneLifecycle`, `animationEditorRigTweak`, `rigWorkspaceController`, `ikAuthoringIntegration`), so it is a real seam with two adapters, not a pass-through.
- **Shim importers.** The plan listed four importers, but `src/devtools/shared/draftSource.ts`, `shared/artwork/ArtworkController.ts` and `shared/package/characterPackage.ts` also imported the shims by relative path. All seven now import from `engine/core.js`. The `docs/animation-editor-production-verification.md` file table now points at `engine/assetFilename.ts`.
- **`isolate: false` is rejected.** Measured at `92b397d`, `npm run test`, `maxWorkers: 1`, `fileParallelism: false`:

  | Config | Run | Result | Duration line |
  | --- | --- | --- | --- |
  | `isolate` default (`true`) | 1 | 273 files passed, 9 skipped | `182.19s (tests 50%, import 44%, transform 3%, setup 1%, worker 1%)` |
  | `isolate` default (`true`) | 2 | 273 files passed, 9 skipped | `178.46s (tests 51%, import 45%, transform 2%, setup 1%, worker 1%)` |
  | `isolate: false` | 1 | 23 files / 179 tests failed | `266.89s (tests 96%, transform 3%, import 1%)` |
  | `isolate: false` | 2 | 98 files / 938 tests failed | `120.32s (tests 97%, transform 1%, import 2%)` |

  Neither run was green and the first was slower (timeouts), so the config change was reverted. The failures are module state leaking between files: 111 test files `vi.mock('phaser')` with different shapes, and editor tests mock overlays and `src/shared/loadSceneCharacter.ts`, so with a shared module cache a file gets another file's mock or the real module (`Cannot read properties of undefined (reading 'Events')`, `… (reading 'Vector2')`, `this.overlay.pick is not a function`, `getOverlay(...).getIKTargets is not a function`, 5 s timeouts). Which files fail depends on run order. In run 1 they were:
  - `tests/animationEditorExport.test.ts`
  - `tests/animationEditorIKHandles.test.ts`
  - `tests/animationEditorRigTweak.test.ts`
  - `tests/animationEditorScene.test.ts`
  - `tests/animationEditorSceneLifecycle.test.ts`
  - `tests/characterPackage.test.ts`
  - `tests/choreographyProduction.test.ts`
  - `tests/footContactMarkerEditor.test.ts`
  - `tests/guideSpotlightLifecycle.test.ts`
  - `tests/ikAuthoringIntegration.test.ts`
  - `tests/loadSceneCharacter.test.ts`
  - `tests/mirrorPanelLifecycle.test.ts`
  - `tests/rigEditorActivation.test.ts`
  - `tests/rigEditorBatch.test.ts`
  - `tests/rigEditorOverlay.test.ts`
  - `tests/rigIKEditor.test.ts`
  - `tests/rigWorkspaceController.test.ts`
  - `tests/runtimePublicApi.test.ts`
  - `tests/sceneLoader.test.ts`
  - `tests/sceneTransitions.test.ts`
  - `tests/storyImageCache.test.ts`
  - `tests/storyPackageRuntime.test.ts`
  - `tests/storyPreviewLifecycle.test.ts`

  Run 2 failed 98 files, 20 of them shared with run 1. Revisit only with per-file `vi.resetModules()`/mock cleanup or by moving the Phaser mock into one shared setup file.
