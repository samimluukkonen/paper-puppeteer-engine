# Create animation from scratch — plan 0.5.8.7

Implemented in the existing 0.6.3 workspace without changing the package version or any version-1 schema.

## Functionality and UI

**+ New Animation** is available with an empty animation catalog, no selected animation, or existing clips. It is disabled with an explanatory hint until a valid rig is loaded and Animation mode is active. A React modal supplies a shared name/ID field, duration in seconds, FPS and loop preference. Defaults are one second, 12 FPS and loop enabled. Native dialog focus containment, Escape and Cancel retain the existing session.

The actual schema uses `name` as the stable ID and has no separate display name. Creation accepts portable IDs beginning with a letter or number and containing letters, numbers, hyphens or underscores. Existing imported IDs retain their original compatibility. Duplicate IDs never replace documents. Duration uses shared validation; FPS uses the existing editor's finite 1–240 bounds, including fractional rates. The dialog explains that FPS authors stepped playback and that Clip settings can switch to smooth sampling.

## Factory, initial pose and timeline

`createEmptyAnimation(rig, options)` returns an owned, deeply frozen `ReadonlyAnimation`, the editor's existing versioned `AnimationClip`. It converts seconds to milliseconds, creates empty `tracks` and `events`, omits `ikTracks`, and validates through `inspectEditorAnimation`. No source JSON, template, authored bind keys, IK sampling or alternate format is involved.

The timeline retains normal rig and event rows without markers. The evaluator's missing-track fallback supplies the rig bind pose. Bone and IK keys, events, selection, clipboard, mirroring, onion skins, interpolation, scrubbing and playback use ordinary editor paths. Preview-only IK and debug handles remain existing scene preferences.

## Documents, history and registration

`AnimationEditorDocument.createAnimation(options)` validates before changing registration or navigation. It registers the immutable initial source and baseline, retains the previous clip's working snapshot/history, selects the new document and starts empty history. `AnimationEditorState.createAnimation(options)` coordinates a single notification with zero time, paused playback, cleared selections/drafts and reset drag/scrub state. Prior clips retain their playhead/key context under existing navigation conventions.

`isNewAnimation(id?)` exposes session metadata without serializing it. The selector adds **(New)** and status shows **New / Unsaved**. New documents remain unsaved after undoing all authored edits or reverting/discarding to the empty baseline. Creation cannot be undone into another document. A successful individual JSON export checkpoint clears the new flag while retaining ordinary history; failed exports retain unsaved state. Inactive new documents participate in workspace navigation protection and replacement confirmation.

## Manifest and package integration

The existing `packageAnimations()` adapter includes new registered documents and inactive working copies. `buildCharacterPackage()` already allocates portable, collision-safe paths for in-memory clips and builds the exported manifest from those clips. The original character definition/manifest, rig and source animations remain immutable. No exporter or runtime format change was necessary. JSON uses the existing serialization/import boundary, and ZIP reload passes through `CharacterLoader` and ordinary `Puppet` playback. Individual document and character-package checkpoints keep their existing independent semantics.

## Changed files and APIs

- Added `src/devtools/animation-editor/createEmptyAnimation.ts`: `NewAnimationOptions` and the validated factory.
- Added `NewAnimationController.ts` and `NewAnimationDialog.tsx`: the React bridge, modal and explicit subscription teardown.
- Extended `AnimationEditorDocument.ts` and `AnimationEditorState.ts`: creation, registration and new-document metadata.
- Updated `TimelineSessionController.ts`: cached selector option labels and new/unsaved status, preserving clock-only rendering behavior.
- Updated `editorMarkup.tsx`, `main.tsx` and `style.css`: command placement, workspace binding/unbinding/disposal and form layout.
- Added `tests/newAnimation.test.ts` and `tests/browser/newAnimation.spec.ts`; extended `tests/characterPackage.test.ts`.
- Updated existing `animationEditor.spec.ts` and `animationExport.spec.ts` assumptions to the shared workspace's retained clip edits/playhead and external-navigation protection. Updated `animationImport.spec.ts` to recognize the current replacement-confirmation message so its recovery-prompt observer does not also dismiss that confirmation.
- Updated `docs/animation-editor.md` and `docs/artist-workflow.md` with the artist workflow and persistence limits.

## Automated coverage

Unit coverage includes rig-only creation, empty and populated catalogs, multiple new documents, default/custom options, input rejection, duplicate rejection, failure atomicity, immutable rig/source data, bind-pose preview/playback, first bone/IK keys, events, Undo/Redo, selection/time/playback reset, draft/key/event/IK drag and scrub cleanup, inactive unsaved documents, replacement cancellation, JSON round trips, ZIP manifest registration, case-folded path collisions, runtime loading/playback and controller subscription teardown.

The new local browser workflow exercises the plan's rig-with-zero-animation-files scenario: it confirms no animation files were requested, creates `idle`, compares the rendered bind pose with debug overlays hidden, authors head rotation at 0/0.5/1 seconds, uses Undo/Redo and playback, authors the supported linear interpolation declaration, downloads/reimports identical JSON, creates a second clip, downloads the complete ZIP and reloads its runtime preview. Another scenario covers duplicates, Cancel, multiple new documents and navigation protection while a loaded clip is selected.

## Exact command results

| Command                                     | Result                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                         | Exit 0.                                                                                                                                                                                     |
| `npm run test`                              | Exit 0; 143 test files passed, 3 skipped; 2,420 tests passed, 32 skipped.                                                                                                                   |
| `npm run build`                             | Exit 0; demo and library built, declarations generated, Node core/serialization/data verification passed.                                                                                   |
| `npm run check`                             | Exit 0; formatting, lint and typecheck passed.                                                                                                                                              |
| `npm run test:package`                      | Exit 0; isolated consumer verified documentation, Node entry points, public declarations, runtime example, compatibility and browser isolation.                                             |
| `npx vitest run tests/newAnimation.test.ts` | Exit 0; 23 creation/session tests passed after the final assertion updates.                                                                                                                 |
| Initial browser command below               | Exit 1; 71 passed, 11 failed. Ten failures came from five outdated workspace assertions in both environments; one development startup/navigation test exceeded its 30-second total timeout. |
| Final browser command below                 | Exit 0; all 16 selected cases passed in development and production, including every initially failing case and both new-animation workflows.                                                |
| `git diff --check`                          | Exit 0.                                                                                                                                                                                     |

The initial browser regression selection:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/newAnimation.spec.ts tests/browser/animationImport.spec.ts tests/browser/animationExport.spec.ts tests/browser/animationEditor.spec.ts tests/browser/sharedWorkspace.spec.ts
```

After updating the stale assertions, the final browser rerun used a 60-second local timeout:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/newAnimation.spec.ts tests/browser/animationEditor.spec.ts tests/browser/animationExport.spec.ts tests/browser/animationImport.spec.ts --grep 'rig with no animation files|existing clips: cancellation|editor routes|unsaved animation settings|authored mode and FPS|repeated animation switches|a failed download|reimporting a clip' --timeout=60000
```

Together these runs provide passing verification for all 82 cases in the selected browser suites. The complete repository-wide browser suite was not run. Chrome was used because the bundled Playwright Chromium executable was absent; no browser installation was required.

## Manual verification and limitations

No human manual pass was performed. The scenario above is exercised through automated browser interactions. Browser checks remain local-only; no CI configuration or browser installation steps were added.

The format supports one name/ID and clip-level linear interpolation. Renaming/deleting animations and automatically rediscovering new document IDs after page reload remain outside the existing workflow. Save JSON or a character ZIP before accepting an unsaved-navigation prompt. Downloads do not write repository files. Package export records its independent package checkpoint and does not clear individual document flags. The existing build emits non-failing Lucide `use client` directive warnings.
