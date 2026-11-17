# Architecture candidate 14 — Split `ProjectEditorContext` into a character/scene union and pass it in

Continue developing Paper Puppeteer Engine.

Source: codebase-design scan of the whole repo on 2026-11-17 (measured at `64f7e6e`).

## Problem

`ProjectEditorContext` (`src/devtools/project/projectBridge.ts:19-59`) is the single interface between the project workspace and the editors it embeds. It has about 45 members, and roughly 20 of them are optional. Two problems:

1. **It is a union typed as one shape.** `ProjectEditorHosts.open()` (`src/devtools/project/ProjectEditorHosts.ts:331-560`) builds it with conditional spreads on `kind`:
   - `characterId`, `definition`, `sourceDefinition` and `fetcher` are only set for characters;
   - `scenes` is only set for scenes;
   - `animationPreviewPreferences` and `saveAnimationPreviewPreferences` are only set for characters.

   Meanwhile, members that make sense for only one kind are always set: `bindScene`, `validateScene`, `buildScenePackage`, `createSceneCopy` and `sceneReuse` on a character host, and `bindCharacter`, `bindAnimationSelection`, `bindAnimationCreation` and `characterLoadFailed` on a scene host. The type can't tell an editor which members it can rely on, so editors fall back to `?.` and `??` defaults, such as `projectEditorContext()?.loadProjectImages?.()` in `SceneArtworkPanel.tsx:61` and `project?.scenes ?? new SceneEditorDocument(…)` in `scene-editor/main.tsx:18`.
2. **Components look up a global instead of receiving a dependency.** `projectEditorContext()` reads `window.parent.paperProjectEditor` and `location.search` every time it's called. It is called 14 times in 12 files, including from inside React render functions and effects:
   - `SceneActorsPanel.tsx:145,300`, `SceneAnimationLibrary.tsx:21`, `SceneArtworkPanel.tsx:61`, `SceneEditorView.tsx:53`, `SceneReusePanel.tsx:64`, `SceneStage.tsx:729`;
   - `ui/FeatureGuide.tsx:64` and `ui/viewShell.tsx:63,186`;
   - `animation-editor/RigTweakController.ts:137` and `animation-editor/main.tsx`.

   Tests have to fake `window.parent` to reach those paths, and nothing guarantees that every call in one editor sees the same context.

## Goal

Each editor kind gets a context type whose members are all required for that kind. The context is looked up once, in each editor's `main.tsx`, and passed down. No component or controller calls `projectEditorContext()` itself.

## What to build

1. **Types in `projectBridge.ts`:**
   ```ts
   interface ProjectHostContext { /* shared members: projectName, assetName, subscribe, bindRenderer, bindGuide,
                                      autosave, projectId, changed, navigate, loadCharacter, choices,
                                      confirmReplacement, assetReferences */ }
   interface CharacterEditorContext extends ProjectHostContext {
     kind: 'character'; characterId; definition; sourceDefinition; fetcher; characterDocuments;
     sharedRigNotice; animationPreviewPreferences; saveAnimationPreviewPreferences;
     bindCharacter; bindAnimationSelection; bindAnimationCreation; characterLoadFailed;
   }
   interface SceneEditorContext extends ProjectHostContext {
     kind: 'scene'; scenes; imageAssets; bindScene; sceneReuse; saveSceneReuse; createSceneCopy;
     validateScene; buildScenePackage; loadProjectImages; animationLibrary; animationLibraryRevision;
     loadAnimationPreview; openAnimation;
   }
   type ProjectEditorContext = CharacterEditorContext | SceneEditorContext;
   ```
   Decide which kind each member belongs to by what its editor actually reads, not by the guesses above. Run `grep` over `src/devtools/{scene-editor,animation-editor,rig-editor}` and `src/ui`. A member both kinds read belongs in `ProjectHostContext`. Within its kind, a member is optional only if the host genuinely sometimes lacks it (for example `characterDocuments`), and then the reason goes in a comment.
2. **Build the context per kind in `ProjectEditorHosts`.** Replace the one object literal full of conditional spreads with a shared base builder plus `characterContext(…)` and `sceneContext(…)`, so each returns its own interface with no spreads.
3. **Pass the context in.** Add `projectCharacterContext()` and `projectSceneContext()` lookups that narrow on `kind` and return `undefined` for the wrong kind. Call them only from each editor's `main.tsx`. Then pass the result down:
   - in the scene editor and the shared `ui/` shell, through a React context (`ProjectContextProvider` plus a `useProjectContext()` hook in `src/ui/`, which `devtools/shared` may import);
   - in the animation editor, through constructor or `bind` arguments to `RigTweakController`.

   Remove every other call to `projectEditorContext()`.
4. **Enforce it.** Add a lint rule (oxlint `no-restricted-imports` for `projectBridge.js`'s lookup functions, or a `scripts/` check) that allows the lookup only in `*/main.tsx` and `src/devtools/project/**`.

## Constraints

- No user-visible behaviour change. Standalone editors (no project) and project-embedded editors must behave exactly as before.
- The same-origin check in `projectEditorContext()` (`projectBridge.ts:73-77`) stays the single gate for trusting the parent window.
- Follow the shared-layering rule from architecture-05: `src/ui` and `src/devtools/shared` must not import the editors.
- Changelog entry goes under Unreleased.

## Verification

- `npm run check` and `npm run test` (sequential, one worker)
- `npm run test:browser` locally (Playwright, local-only): project → character → animation → back, and project → scene → open animation → back.
- Type-level checks:
  - the scene editor no longer compiles if it reads `definition`;
  - the animation editor no longer compiles if it reads `scenes`.
- At least one scene-panel test (for example `SceneReusePanel` or `SceneAnimationLibrary`) renders with a fake `SceneEditorContext` passed through the provider, with no `window.parent` stub.

## Acceptance

- `grep -rn "projectEditorContext()" src` finds only the editors' `main.tsx` files and `src/devtools/project`, and lint enforces it.
- No conditional `...(kind === …)` spreads remain in `ProjectEditorHosts.open()`'s context construction.
- No `context?.member?.()` double-optional calls on project members in editor code.
- Full test suite passes.
