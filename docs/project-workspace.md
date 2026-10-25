# Project workspace (v1.0.3)

[All guides](../README.md#guides)

Open **Project Workspace** from the application header, or visit `/project/`. Choose **New Project**, enter a name, and choose **Create Project**. The project starts with no characters, images, animations or scenes. [Local autosave and crash recovery](local-autosave.md) retain complete browser drafts, including imported artwork. Export a project ZIP for a portable disk copy.

## Authoring workflow

Project ZIP imports and exports use the shared package worker so archive copying and CRC validation run outside the UI thread. Transfers have a 60-second deadline and are canceled when the workspace unmounts. Export records the captured revision only after successful archive construction and download startup; edits made during export remain unexported.

- **New Character** creates the existing root-only rig with an empty default skin. Open **Rig Editor** to build it and import artwork, then **Animation Editor** to create clips.
- **Add Existing Character** registers either shipped character without changing its source. **Import Character ZIP** accepts the existing editor's stored ZIP character packages.
- **New Scene** creates an empty scene. In **Scene Editor**, Add Actor lists the registered project characters, including characters whose changes have never been downloaded separately.
- **Import Scene JSON** preserves scene and Actor IDs. For scenes with Actors, explicitly select a registered character for each source reference. Only the detached project copy receives the new references. Dependencies, skins and animation names must validate before registration.
- **← Project** returns to the asset list. Reopening a character retains its rig, animation, artwork, selections and Undo/Redo histories. Changing the project selector also retains open sessions. Importing the same project twice creates independent editing instances, even though their authored project IDs match.
- **Project Settings** changes the project name. **Undo Project** and **Redo Project** cover metadata and registration/removal. The editors retain their own document histories. Removing a character used by a registered scene is rejected. Project history also refuses to orphan dependencies introduced by subsequent scene edits.
- **Export Project** downloads a complete project ZIP. **Import Project** validates all referenced files before installing a separate project instance. Downloads do not overwrite repository files.
- **Validate Project** opens [asset integrity diagnostics](project-asset-integrity.md) for current working characters and scenes, with draft/export contexts, editor navigation and fresh revalidation. Project and scene exports block unresolved required dependencies; shared replacements list their dependents first.
- **Audio** imports WAV, MP3 and OGG supported by the browser decoder. Organize assets as Music, Ambience, Sound effects or Voice; rename, remove, Undo, and audition with Play/Stop and volume. Audio binaries travel with project ZIPs and local recovery. See [Audio assets](audio-assets.md) for limits, runtime loading and lifecycle. Scene audio timeline authoring is deferred to v1.3.2.

Inspector and asset-library disclosures start collapsed. The workspace follows the Animation Editor's desktop theme and controls.

**Feature Guide** uses the same catalog as the editors. Choose **Project Workspace → Importing and Managing Audio** for the local audio tour; it requires an open project and works without any imported assets. For Rig, Animation or Scene guides, select a project asset and choose a guide. Its editor opens and checks the current requirements before starting. Unavailable guides explain what is missing; standalone character-creation instructions are disabled inside a project, where **+ New Character** owns creation.

In **Assets**, expand a character's library to see rig counts and separate **Images**, **Animations**, **Skins** and **Attachments** categories. Each starts collapsed and shows its item count. Image rows include previews; animation rows show duration and looping, and skin rows identify the default skin. This inventory is read-only; use the character's editor to make changes.

## Architecture and ownership

`ProjectDefinition` is a version-1 manifest containing project ID/name and character/scene references. Character entries have the original character ID, a display name and a stable project manifest path. Scene entries have the original scene ID and a separate document path. Registrations reject duplicate IDs case-insensitively. Display names and source filenames are never lookup keys. Generated numbered directories avoid filename collisions without rewriting authored IDs.

`ProjectWorkspace` owns immutable project metadata, membership history, source character package files and one existing `SceneEditorDocument`. `ProjectEditorHosts` owns retained editor contexts, runtime leases, opening cancellation and preview teardown, while `ProjectView` renders their iframes and project controls. Each character opens one retained, same-origin editor host running the existing shared Rig/Animation Editor application. `projectBridge.ts` supplies the definition, package fetcher and working snapshot callback; it does not create a second live rig or animation document. Browser navigation between the two editor views still uses `bindWorkspaceNavigation`.

The retained character editor owns rig/skin state, animation documents and artwork proposals/replacements. Project export captures those owners synchronously before asynchronous file work. The project's scene owner stays alive while disposable scene previews close on return. Closing explicitly unmounts the child React application and stops its Phaser scene, releasing document subscriptions before removing the iframe. Reopening a scene builds fresh character previews from current working snapshots, so character edits appear without replacing scene history. Preview texture keys are namespaced to avoid collisions between unrelated character packages. Blob URLs belong to disposable runtime leases and never enter authored exports. The JSON validator accepts plain objects across these editor realms while continuing to reject class instances and accessor properties.

Project metadata dirty state is independent of document changes. The project also tracks the character and scene snapshots included in its last export; an edit during export remains unexported. Project export does not mark individual rig or animation files saved or clear their histories. A parent unload guard covers every retained project and pending artwork proposals. The standalone editors retain their existing guards and recovery behavior. Their legacy per-character localStorage recovery is not bound inside project sessions, where it could conflate two projects containing the same character ID.

Binary artwork is interned by SHA-256 within each project. Import detaches caller-owned bytes. Separate project instances own separate pools; immutable definitions and source assets are never edited as a side effect of registration.

## Portable format and APIs

The existing stored ZIP encoder/decoder and character/scene validators are reused. The archive contains:

```text
project.json
characters/character-1/character.json
characters/character-1/rig.json
characters/character-1/animations/...
characters/character-1/skins/...
scenes/scene-1.json
assets/image-1.png
```

`project.json` contains `{ project: ProjectDefinition, characters: [{ id, files }] }`. Each `files` record maps an original character-local package path to its physical archive path. Character manifests retain their original paths and authored format; reconstruction through this mapping supplies the existing character package loader. Identical binary images are stored once, including aliases and images shared by different characters. The project archive is consumed through **Import Project**, rather than loading its extracted character directories directly as hosted packages. Individual character ZIP and standalone scene ZIP downloads remain available in the embedded editors when a conventional hosted/runtime package is needed.

Within the project, scene character references resolve through the project registry against the project root. A standalone scene ZIP places `scene.json` at that root and includes the referenced character packages in the established runtime layout.

`buildProjectPackage()` returns files plus the captured metadata/documents; `markExported()` records that captured checkpoint only after download starts. `importProjectPackage()` returns a fully validated independent workspace. `packageHostedCharacter()` normalizes existing sibling artwork through the scene packager. `buildProjectScenePackage()` produces the established standalone scene ZIP format from current character owners. `SceneEditorDocument.scene(id)` reads retained snapshots without changing selection or gestures. `PackageController` accepts an optional fetcher for in-memory project artwork, and `openPackageRuntime()` accepts an optional texture namespace for isolated scene previews.

Archive and logical resource paths pass `packagePath()` and existing case-insensitive/file-directory collision checks. Imports reject missing documents, mismatched IDs, unsupported project versions and invalid scene dependencies. Existing limits remain 256 files, 10 MiB per file and 100 MiB per ZIP, with the existing JSON and decoded-image budgets. The complete expanded project also has a 100 MiB resource budget, counting every character-local alias and project image reference before any imported binaries are copied. Exports enforce the same budget so downloaded projects remain importable. Project export contains authored JSON and image bytes, with no React state, Phaser objects or temporary URLs.

## Implementation and verification

The implementation is in `src/devtools/project/`, the new `project/index.html` route, and small integration changes in the existing editor entry points, shared header, package controller/runtime and scene document/view. `vite.config.ts` includes the route in development and production builds.

`tests/projectWorkspace.test.ts` covers empty projects, registration and lookup, duplicate rejection, independent instances, immutable sources, membership/document history, dependency guards, captured export checkpoints, image sharing, safe import, both shipped characters and standalone scene-package compatibility. `tests/browser/projectWorkspace.spec.ts` exercises actual Rig/Animation/Scene Editor navigation, retained edits, project switching and ZIP download/re-import on desktop. Browser tests remain local-only.

The original workspace milestone was verified locally on 2026-10-22 as recorded below. See the [v1.0.3 integrity guide](project-asset-integrity.md#verification) for the final asset-integrity verification results.

| Command                                                                                           | Result                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                                               | Passed                                                                               |
| `npm run test`                                                                                    | 191 files passed, 5 skipped; 3,333 tests passed, 56 skipped                          |
| `npm run build`                                                                                   | Demo and library builds, declarations and Node core/serialization/data checks passed |
| `npm run lint`                                                                                    | Passed                                                                               |
| `npm run format:check`                                                                            | Passed                                                                               |
| Local project workflows and existing desktop layout checks, development and production            | 10 passed                                                                            |
| Project workflows rerun after explicit scene teardown/reopen coverage, development and production | 4 passed                                                                             |

The demo build emits the existing non-failing Lucide `use client` directive warnings. The browser commands were:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/projectWorkspace.spec.ts tests/browser/sharedWorkspace.spec.ts --grep 'project authoring|shipped artwork|workspace fits desktop'
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/projectWorkspace.spec.ts
```

## Local autosave and recovery

Committed changes autosave locally after a modest debounce. Startup offers explicit recovery, discard or cancellation, with the actual save timestamp. Two complete revisions per draft are retained for at most ten local projects. The local-save status and recovery controls remain visible while a project editor is open. Concurrent tab/session writers are blocked; storage failures preserve previous drafts and prompt an explicit export/retry. See [local autosave](local-autosave.md) for the persistence format, lifecycle, failure handling and verification. Asset inspection and export protection are described in the [v1.0.3 integrity guide](project-asset-integrity.md); automatic repairs remain outside scope.
