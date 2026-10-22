# Project asset integrity (v1.0.3)

[All guides](../README.md#guides) · [Project Workspace](project-workspace.md)

Choose **Validate Project** in Project Workspace to inspect the current working characters and scenes. The panel shows actual errors and warnings, the affected references, instructions, and **Open Affected Asset** buttons. **Revalidate** performs a fresh inspection. No unused-animation notices or automatic repairs are generated.

**Editing draft** allows missing image files and unresolved atlas frames as warnings. **Production export** makes these blocking errors. A root-only character with no artwork references is valid in both contexts; an image becomes required when it is registered in the package or referenced by authored artwork. Structural errors remain visible in draft checks without preventing normal editing. Pending artwork proposals must be applied or cancelled before export.

Project exports inspect all registered characters/scenes. Scene JSON and ZIP exports from a project inspect that scene and its referenced characters; unrelated broken assets do not block the scene. Package builders retain their existing final checks, including image decoding, image budgets, static frames and replacement targets. A failed export produces no download or saved checkpoint. Final character/scene package failures also carry a validation report for the panel.

**Open Affected Asset** opens the owning character's Rig or Animation Editor, or the owning Scene Editor. Existing character hosts and their document histories are retained; editor view changes continue through the existing unsaved/pending-change guards. Scene previews can be recreated while the authored scene owner and history remain. An unavailable image can prevent a fresh runtime preview from opening; the diagnostic and repair instructions remain available. Issue field paths identify the relevant reference without claiming that every individual inspector field can be focused automatically.

## Dependencies and destructive operations

`AssetReference` identifies a kind, owner and local ID. Character-local names and scene-local Actor/action IDs stay in their own scopes. `AssetDependency` records a directed use with an artist-facing label. The graph includes project membership, rigs, bone parents, IK chains, slots, skin/attachment mappings, images, animation bone/IK tracks, poses, foot markers, scene Actors, initial appearance, animation actions and facing targets. Missing targets retain incoming edges so their dependents can still be inspected.

Removing a character lists its dependent scene Actors and refuses the operation until those references are resolved. Shared animation imports/reloads/reverts and shared image Apply/source restoration list their dependents before replacement, including scene clips and artwork uses. Cancelling retains the authored data and any preview proposal. Referenced embedded skins cannot be renamed until scene initial-skin selections are changed. Existing bone, IK, slot and attachment deletion guards remain authoritative. Animation deletion has no editor command in the current formats/UI; its dependents are available through the same inspection API.

Ordinary authoring and Undo/Redo retain their existing histories. There are no automated repair commands, retargeting operations or implicit scene-clip deletions.

## Validators and APIs

| Boundary                                                                          | Existing authority reused                                                           |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Project metadata, versions, duplicate IDs/paths                                   | `parseProjectDefinition()`                                                          |
| Character manifest, rig, bones, IK, skins, attachment references, clips and poses | `validateCharacterDefinition()` and its existing rig/animation/skin/pose validators |
| Scene versions, Actors/actions, ownership, character/animation/skin references    | `validateSceneDefinition()` with the working project catalog                        |
| Portable paths, ZIP/file limits and collisions                                    | `packagePath()` and `validatePackageFiles()`                                        |
| Image headers and allocation budgets                                              | `inspectSpriteHeader()` and `CharacterTextureBudget`                                |
| Final binary/replacement validation                                               | Existing `buildCharacterPackage()` and `validateScenePackage()`                     |

`src/devtools/project/projectInspection.ts` is an editor service, independent of React and Phaser. It adds no replacement schema. Character checks assemble the same working rig/skin/animation domains used by the exporter; original metadata paths are checked for package safety, and synthetic inspection paths keep newly created/duplicate clips visible before generated export filenames exist. Legal embedded/standalone skin precedence remains unchanged.

- `ProjectInspector.inspect(input, context, fresh)` returns diagnostics, counts, dependency edges and the numbers of character/scene semantic checks performed.
- `ProjectWorkspace.inspect(context, fresh, scene?)` captures the current owners without installing or mutating snapshots; a supplied scene limits the dependency closure.
- `ProjectWorkspace.dependents(reference)` and `assetDependents(report, reference)` return direct incoming uses with scene/Actor/clip labels.
- `requireValidExport(report)` throws `ProjectValidationError` for blocking errors. `packageExportFailure()` retains final exporter failures in the same report shape.
- `buildProjectPackage()` and `buildProjectScenePackage()` enforce production preflight before their existing exporters.
- `projectBridge.ts` supplies shared-replacement confirmation and skin-reference lookup to the existing editor owners.

Explicit checks and production export clear the semantic caches. Once the panel is open, committed workspace revisions schedule checks after 250 ms without further edits. Character fingerprints reuse unchanged validation results; scenes cache against their own document and the animation/skin catalogs of their referenced characters. Changes to an unrelated catalog do not revalidate a scene. Image availability and headers are always checked afresh. Playback ticks, selection and preview-only movement do not initiate whole-project validation; authored gestures settle before the debounced panel refresh. Caches belong to one workspace and release removed registrations.

## Verification

`tests/projectInspection.test.ts` covers healthy data, missing images, invalid bone/IK/skin/Actor references, missing characters/animations, duplicates, versions, unsafe paths, draft/export severity, source immutability, three dependent scene clips, replacement guards, production export blocking, scoped scene export, final exporter/archive budget failures, valid source-path collisions, panel content and a 120-character/120-scene cache/performance regression. `tests/artworkReplacement.test.ts` covers cancellation and acceptance of shared image Apply/source restoration. Local `tests/browser/projectWorkspace.spec.ts` covers real project navigation, validation findings, blocked downloads, opening the affected scene and automatic refresh after Undo. Browser checks stay local-only.

Final verification on 2026-10-22:

| Command                                                                                | Result                                                                           |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                    | Passed                                                                           |
| `npm run test`                                                                         | 193 files passed, 5 skipped; 3,379 tests passed, 56 skipped; no failures         |
| `npm run build`                                                                        | Demo/library builds, declarations and Node core/serialization/data checks passed |
| `npm run lint`                                                                         | Passed                                                                           |
| `npm run format:check`                                                                 | Passed                                                                           |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/projectWorkspace.spec.ts` | 6 passed across development and production                                       |
| `git diff --check`                                                                     | Passed                                                                           |

The build retains the existing non-failing Lucide `use client` directive warnings. The first browser attempt could not bind localhost inside the sandbox; the permitted local run exercised both servers. One intermediate development case was interrupted by a source reload during final editing; the complete final run passed against stable source.
