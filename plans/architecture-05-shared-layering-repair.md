# Architecture candidate 05 — Restore the shared-below-editors layering

Continue developing Paper Puppeteer Engine.

Source: architecture review 2026-11-14 (candidate 5, rated Strong). Plan revised 2026-11-17 after review.

## Problem

Modules under `src/devtools/shared/` import the editors they sit below. Today (all imports are relative, `../../<editor>/…`):

| Module in `shared/` | Upward imports |
| --- | --- |
| `autosave/editorDrafts.ts` | runtime: `project/ProjectDefinition`, `project/projectPackage`, `project/ProjectWorkspace` (`new ProjectWorkspace(...)` inside `sceneDraftSource`); types: `scene-editor/SceneCharacterRegistry`, `SceneEditorDocument`, `SceneImageRegistry` |
| `autosave/projectDrafts.ts` | runtime: `project/ProjectDefinition`, `project/projectPackage`; types: `project/ProjectWorkspace`, `scene-editor/SceneImageRegistry` |
| `autosave/RecoveryPanel.tsx` | runtime: `project/projectPackage` (`importProjectPackage`); type: `project/ProjectWorkspace` |
| `protectUnsavedChanges.ts` | runtime: `project/projectBridge` (`projectEditorContext`) |
| `guides/sceneGuideHost.ts` | type: `scene-editor/SceneEditorDocument` |
| `guides/workspaceGuideHost.ts` | types: `animation-editor/AnimationEditorState`, `rig-editor/RigEditorState` |

Renaming an editor field breaks modules that are supposed to sit below the editors, and nothing stops new upward imports.

## Goal

Dependencies point down only: `shared/` imports neither editor implementations nor editor types. Code that knows an editor's or the project's document shape lives with that owner. The rule is enforced by lint.

## Design decisions

- **The draft format is the project package format.** All three draft builders (`buildProjectDraft`, `buildCharacterDraft`, `sceneDraftSource`) produce project packages, so `project/` owns them. This adds no new dependency direction: `animation-editor → project` and `scene-editor → project` already exist.
- **Guide hosts are adapters at the existing `GuideLaunchHost` seam, and each has exactly one production caller.** Move each host next to that caller; do not change their logic. Do **not** add `guideCapabilities()` methods to the editor states. `workspaceGuideHost` combines facts from both editors: every capability requires both states, it takes host-only options (`canCreateCharacter`, `getOnionEnabled`, `initialEditor`), it caches the last-inspected clip during playback, and it decides navigation availability. Splitting that across two states would make both states larger and still need a host to merge the results.
- **`shared/` keeps the generic autosave machinery.** `LocalAutosave.ts`, `LocalDraftStore.ts` (with the `AutosaveSource`/`DraftStorage` interfaces) and `RecoveryPanel.tsx` stay in place. Only their upward imports go.
- **`shared/newCharacter.ts` splits (found during implementation).** The lint rule caught a runtime leak the original audit missed (it searched only `../../` depth): `createCharacterDocuments`/`createNewCharacter`/`CharacterDraftStore` construct `AnimationEditorState` and `RigEditorState`. These move to `animation-editor/characterDocuments.ts`, which already owns rig + animation composition. The pure identity rules (`newCharacterSchema`, `assertCharacterIdAvailable`, `suggestCharacterId`) stay in `shared/`. This adds direct `project → animation-editor` and `src/ui → animation-editor` edges. They already existed indirectly through `shared/`, and the user accepted them as an exception to the "no new dependency directions" constraint below.
- **Type-only imports are forbidden too.** After the moves none remain, so the lint rule bans type imports as well (it does not set `allowTypeImports`).

## What to build

1. **Draft builders → `project/`.**
   - Move `shared/autosave/projectDrafts.ts` to `project/projectDrafts.ts` (`buildProjectDraft`, `assembleProjectDraft`, `draftImages`).
   - Move `buildCharacterDraft` and `sceneDraftSource` (with the private `samePackage` helper) from `shared/autosave/editorDrafts.ts` into `project/` too: either into `project/projectDrafts.ts` or a sibling `project/editorDrafts.ts`, whichever reads better. Delete `shared/autosave/editorDrafts.ts`.
   - The `shared/` helpers these depend on (`draftSource`, `sceneFingerprint`, `package/characterPackage`, `animationPreviewPreferences`) stay where they are; `project/` imports them downward.
   - Update the production callers: `project/ProjectView.tsx`, `scene-editor/SceneEditorView.tsx`, `animation-editor/main.tsx`.
   - Move the code without changing it. Serialization output must be byte-identical.

2. **`RecoveryPanel.tsx` loses its project knowledge.**
   - Only `ProjectView` passes `onRecover`; the scene and character editors navigate to `../project/` instead. Change the callback to receive the draft bytes and key: `onRecover?: (files: PackageFiles, key: string) => void | Promise<void>`.
   - `ProjectView` does what the panel does today: `importProjectPackage(files)`, `markRecovered(key)`, `addProject(...)`. Keep the claim/release lease and the error handling exactly where they are, around the awaited callback, so a failed import still releases the lease and shows the same status message.
   - Remove the `importProjectPackage` and `ProjectWorkspace` imports from the panel.

3. **`protectUnsavedChanges.ts` takes the host fact from its callers.**
   - Its callers are `scene-editor/SceneEditorView.tsx` and `animation-editor/main.tsx`. Change the signature to `protectUnsavedChanges(hasUnsavedChanges, options?: { hostGuarded?: boolean })`, or have callers skip the call when `projectEditorContext()` is set. Pick one and apply it at both call sites.
   - Behaviour is unchanged: no `beforeunload` guard while the project host owns the documents.

4. **Guide hosts move next to their callers, unchanged.**
   - `shared/guides/workspaceGuideHost.ts` → `animation-editor/workspaceGuideHost.ts` (caller: `animation-editor/main.tsx`).
   - `shared/guides/sceneGuideHost.ts` → `scene-editor/sceneGuideHost.ts` (caller: `scene-editor/main.tsx`).
   - `shared/guides/projectGuideHost.ts` → `project/projectGuideHost.ts` (caller: `project/ProjectFeatureGuide.tsx`). It has no upward import, but co-locating it keeps the three adapters consistent and leaves `shared/guides` holding only the seam (`GuideLauncher`, `types`) and the controller/registry/definitions.
   - Re-export nothing from `shared/guides/index.ts` that would recreate the upward edge.

5. **Lint rule in `.oxlintrc.json`.**
   - Add an override for `src/devtools/shared/**/*` *after* the existing `src/devtools/**/*` override. Oxlint overrides replace a rule's options rather than merging them, so the new override must **repeat the existing engine-barrel pattern group** and add:
     ```json
     {
       "group": ["**/project/**", "**/scene-editor/**", "**/rig-editor/**", "**/animation-editor/**"],
       "message": "src/devtools/shared sits below the editors: move editor-aware code next to its owner and depend on interfaces here."
     }
     ```
   - Do not set `allowTypeImports`.
   - Confirm that the rule fires by temporarily adding an upward import (runtime and `import type`) and running `npm run check`, then remove it.
   - Check that the globs don't catch legitimate `shared/` paths, e.g. a `shared/` subfolder named `project`. Today there is none.

6. **Tests.** Update the import paths in every test that imports a moved module. Today that is about 25 files under `tests/` plus `tests/browser/projectProfileHarness.ts`; find them with `grep -rn "shared/autosave/\(editorDrafts\|projectDrafts\)\|shared/guides/\(workspace\|scene\|project\)GuideHost" tests`. Add tests only where behaviour moved across a seam:
   - The `RecoveryPanel` → `ProjectView` recovery path: the callback receives the draft bytes and key; a throwing callback still releases the lease and reports a status.
   - `protectUnsavedChanges` with the host guard set installs no listener.

## Constraints

- Behaviour-preserving: draft save/recovery bytes, the recovery panel, unsaved-changes protection and all three guide hosts work identically.
- `GuideController`, `GuideRegistry`, `GuideLaunchHost` and the `GuideCapability` union are untouched.
- No new dependency directions between editors, except the accepted `newCharacter` split above; only `shared → editor` edges are removed.
- `npm run check:fix` for style.

## Verification

- `npm run typecheck`, `npm run check` (lint includes the new override; confirm the engine-barrel restriction still applies to `shared/`), `npm run test` (sequential, one worker, per AGENTS.md).
- Pay particular attention to: `localAutosave`, `attachLocalAutosave`, `draftSerialization`, `draftRecovery`, `animationDraftRecoveryController`, `rigEditorNavigation`, `guideLauncher`, `guidePractice`, `guideRegistry`, `animationGuides`, `rigGuides`, `sceneGuides`, `projectGuides`, and the scene/project tests that build drafts (`sceneAudio`, `sceneArtwork`, `sceneTransitions`, `cameraAnimation`, `sceneDialogue`, `projectStories`, `storyAuthoring`, `characterVariants`, `sceneReuse`, `reusableAssetsIntegration`, `poseLibrary`, `animationPreviewPersistence`).
- Optional local manual check: recover a draft from the scene editor and from the character editor (both navigate to the project view), and from the project view directly.

## Acceptance

- `grep -rnE "from '(\.\./)+(project|scene-editor|rig-editor|animation-editor)/" src/devtools/shared` returns nothing, runtime or type imports alike.
- `npm run check` fails when an upward import is added under `src/devtools/shared/` and passes on the finished tree.
- All draft builders live in `project/`. Each guide host lives next to its single caller.
- `shared/autosave` contains only `LocalAutosave.ts`, `LocalDraftStore.ts` and `RecoveryPanel.tsx`.
- Full suite passes; draft bytes, recovery and guide hosts are unchanged from the user's perspective.
