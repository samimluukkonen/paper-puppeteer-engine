# Reusable Animation Library

For an in-app walkthrough, choose **Feature Guide → Project Workspace → Finding and Reusing Animations** or **Feature Guide → Animation Editor → Using Animation Library**. Both tours reveal controls without opening asset dialogs, playing motion, creating clips or changing authored data. The project tour also works before any character or animation exists.

Open **Animation Library** in Project Workspace to browse all character animations. Search by stable name/ID, display name or optional tags. Choose a character and enable **Compatible rig only** to narrow the list. Rows show the source character, animation ID, duration, looping and compatibility. Libraries and metadata disclosures start collapsed.

**Preview animation** opens a detached runtime preview in Project Workspace and Scene Editor. Play/Pause, Stop/Restart and Loop preview are view controls. The preview uses the same `CharacterLoader`, artwork loading, editor game configuration and ordinary `Puppet` evaluator as package previews, including skeletal animation, IK, root translation and mesh deformation. Authored events are suppressed. Closing the preview cancels loading and destroys its game, textures and package URL lease. Playback never creates keys or changes the source clip.

In Animation Editor, **Animation Library** opens the same browser for the current character. Preview selects the existing clip, retains other clips' edits and histories, and plays it on the editor canvas. The existing transport and Environment Preview remain available. **Library metadata** edits the current clip's display name, description and tags through ordinary Undo/Redo. Display names can contain spaces; the stable animation ID remains unchanged. Categories and tags are optional.

## Ownership and reuse

An animation still belongs to one character package. Its version-1 `name` is its stable runtime ID; the pair of source character identity and clip name identifies a library asset. Library rows borrow current document snapshots. They contain no independent keyframe index or animation documents. Source character/rig identity, duration and references are derived from the owning package.

**Use Existing Animation** selects that source document in Project Workspace or Animation Editor. In Scene Editor it sets the selected Actor's initial animation, changes an action's animation draft, or adds an animation action through the existing timeline. Apply action properties to commit an action draft. Existing action start, duration, speed, looping and root-motion ownership remain intact when changing a reference. Normal scene validation still rejects invalid dependencies or movement conflicts.

Multiple Actors and actions referencing the same source ID share that asset. Editing the source may change every reference; the browser communicates this before reuse. **Locate Original Asset** opens its original animation document in project sessions. Animation Editor's library locates the current character's original document on its own canvas.

**Create Independent Copy** calls the existing Animation Variations command with an available ID such as `sword-cut-variation` or `sword-cut-variation-2`. It deeply copies bone curves, IK keys and suppression, root motion, deformation, playback settings, metadata and event payloads. The new document has its own edit history. Editing the variation leaves the original unchanged. Use **Create Variation** when choosing a custom ID or time scale; see [Animation Variations](animation-editor.md#create-an-animation-variation).

## Compatibility

Direct reuse requires the same explicit rig identity. [Project character variants](character-variants.md) share their independent owner's rig and animations, so source and variant Actors can reuse the same clips directly. Independent copies have separate identities; matching bone names or topology do not establish compatibility. The library explains mismatched or unavailable rigs and disables reuse/copy for incompatible targets. Other characters can still be previewed and located. The separate [animation retargeting API](animation-retargeting.md) can create target-compatible FK clips using a reviewed explicit map; choose **Retarget to Another Character** in Project Workspace for synchronized comparison and independent target creation.

After opening a character from a scene library to create a variation, reopen the scene from Project Workspace to load its new runtime definition. The scene document and history remain retained while its old preview is released. If a retained runtime is missing a newly created clip, selection explains how to refresh it.

## Persistence

Optional `library: { displayName?, description?, tags? }` metadata lives on the existing animation JSON. Old version-1 files still load without metadata; files containing the extension require this application version or a consumer that accepts the extension. The generated animation JSON schema includes its bounds. Stable names and character manifests remain unchanged.

Existing authored serialization, character package export, project ZIPs and local drafts retain the metadata. Metadata edits affect authored revision fingerprints and enter normal autosave. Repeated references do not create additional clip files. Original manifest animation paths are retained where available; variations receive ordinary allocated animation paths. Project dependency validation and character-removal warnings continue to protect referenced assets. Individual clip deletion is not introduced by this milestone.

## Desktop acceptance

1. Open a project containing multiple characters and animations.
2. Open Animation Library, search for an animation and inspect its source ID.
3. Preview it, pause, loop and restart; close the preview.
4. Check another character's compatibility, then use the source asset.
5. Create an independent copy and edit its metadata or motion. Undo/Redo the edit and verify the original remains unchanged.
6. Place the variation through the Scene Editor timeline library and inspect its action timing and movement source.
7. Export/reload the project and confirm references and metadata. Local recovery uses the same project-package path.

Regression coverage lives in `tests/animationLibrary.test.ts`, the library host lifecycle tests and the local-only `tests/browser/animationLibrary.spec.ts`. The existing variation, deformation, project, draft and scene suites cover their shared document and runtime boundaries. Run browser tests locally with one worker; see [development checks](development.md#checks-and-profiling).

## Implementation and APIs

| Files / APIs                                                                                                                                                                       | Responsibility                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/AnimationClip.ts`, `schemas.ts`, `core.ts`, `data.ts`, `schemas/animation.schema.json`                                                                                 | Optional public `AnimationLibraryMetadata` contract and validated version-1 file extension. Compiled motion and runtime IDs stay unchanged. |
| `src/devtools/shared/animationLibraryData.ts`, `AnimationLibrary.tsx`, `animationLibrary.css`                                                                                      | Derived `AnimationLibraryEntry` rows, stable asset references, search, compatibility guards, counted browser and reuse commands.            |
| `src/devtools/shared/AnimationLibraryPreview.tsx`, `AnimationLibraryPreviewDialog.tsx`                                                                                             | Lazy runtime loading, isolated Puppet playback and cancellable game/URL ownership.                                                          |
| `src/devtools/animation-editor/AnimationLibraryController.ts`, `AnimationLibraryPanel.tsx`, `AnimationEditorState.ts`, `animationSerialization.ts`, `main.tsx`, `editorMarkup.tsx` | Existing-document selection/preview/copy, `setLibraryMetadata`, authored history, metadata export and editor binding.                       |
| `src/devtools/project/ProjectWorkspace.ts`, `ProjectAnimationLibrary.tsx`, `ProjectEditorHosts.ts`, `projectBridge.ts`, `ProjectView.tsx`, `style.css`                             | `animationLibrary()` inventory, package preview leases and queued source selection/copy in retained editor hosts.                           |
| `src/devtools/scene-editor/SceneAnimationLibrary.tsx`, `SceneActorsPanel.tsx`, `SceneActionInspector.tsx`, `SceneTimeline.tsx`                                                     | Source-aware browsing within existing Actor, action-draft and timeline commands.                                                            |

## v1.5.1 verification

All test runners ran sequentially with one worker.

| Command                                                                                            | Result                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                    | Passed formatting, lint and TypeScript checks.                                                                                                                   |
| `npm test`                                                                                         | 231 files passed, 8 skipped; 3,987 tests passed, 59 skipped.                                                                                                     |
| `npm run build`                                                                                    | Application and library builds, declarations and Node entry-point checks passed. Vite reports the existing third-party `lucide-react` module-directive warnings. |
| `npm run check:version`                                                                            | Package, lockfile and changelog agree on valid SemVer `1.5.1`.                                                                                                   |
| `npm run test:package`                                                                             | Isolated packed consumer passed documentation, Node entry points, public declarations, runtime sample and browser bundling checks.                               |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationLibrary.spec.ts --workers=1` | 4 passed: editor and project/scene workflows against both local development and production builds. Used installed Chrome; no browser installation or CI changes. |

The browser workflows verify metadata edits, preview, independent copying, Undo/Redo, unchanged source exports, compatibility rejection, scene placement and project ZIP reload. Runtime unit coverage verifies root translation, IK, deformation, event suppression, pause/restart, looping and replay after completion. Project autosave coverage reloads the exact stored package and verifies stable references and a single asset per clip.

Guide follow-up verification: `npm run check` and `npm run build:demo` passed. The project/animation guide, registry, launcher, text and target suites passed all 46 tests with one worker. `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationLibraryGuide.spec.ts --workers=1` passed all 4 local development/production scenarios, verifying real spotlight targets, missing-project gating, Back/Next/Finish navigation, unchanged exports/history/selection and no automatic asset dialogs, playback or downloads.
