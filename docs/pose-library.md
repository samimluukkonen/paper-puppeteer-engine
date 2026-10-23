# Advanced Pose Library — v1.1.1

[All guides](../README.md#guides)

In Animation Editor, open **Tools → Pose Library…**. The compact panel starts closed and uses the existing animator controls and shared header. **Feature Guide → Animation Editor → Pose Library** offers a seven-step tour of capture, browsing, preview/cancel, Apply, organizing, separate histories and persistence. The tour reveals the real controls and does not author poses or keys.

1. Select an animation and move its playhead to the desired pose. Commit any inspector or IK drafts first.
2. Enter a pose name. Choose **Full character** or **Selected bones**. Selected timeline keys supply multiple bone IDs; otherwise the selected inspector bone supplies one. Click **Save Current Pose**.
3. Browse the counted rows or use **Search poses**. Select a row, then **Preview** to see it at the current playhead. **Cancel preview**, Escape, closing the panel, changing clips/modes/rigs, or starting an authored edit restores the animation. Preview pauses playback and never changes keys, source files, dirty state or history.
4. Switch to another animation, choose a time, select the saved pose and preview it again. Click **Apply Pose** to create/update its keys at that precise playhead time. Continue editing normally. Animation **Undo/Redo** treats this batch as one operation.
5. **Rename** and confirmed **Delete** edit the reusable library. **Undo library edit / Redo library edit** use a separate bounded document history. Deleting a pose leaves previously applied keys intact. If a later rig edit removed a referenced bone, library history asks you to undo that rig edit before restoring the pose.
6. Download a character or project ZIP to keep the complete library. Animation JSON alone contains the resulting keys. Local character/project autosave also includes saved poses; previews never enter the stored payload. Project asset libraries show a collapsed, counted **Poses** group.

## FK and IK behavior

Capture reuses the editor's authored FK evaluator at the playhead, including smooth/stepped playback and the exact animation endpoint. It records complete absolute local transforms for each included bone, including values equal to bind pose. Rotation is radians; keyframe times remain milliseconds. A partial pose only writes its stored bones/properties and preserves unrelated bone tracks, events and IK tracks.

Final IK-solved rotations, runtime presets, facing, temporary inspector values and animated IK targets are excluded from capture. Preview overlays the saved FK values before the existing single IK solve; Apply writes those same values through the existing batched keyframe-authoring API. The destination animation retains its own IK targets, mixes and baked-constraint suppression. Consequently the final IK appearance can differ across clips with different targets. After Apply, the existing mirror tools work on the resulting authored FK keys. There is no retargeting or new IK solver.

## Storage and compatibility

Poses extend the existing version-1 `PoseDefinition`, stored as JSON files in the character manifest's existing `poses` array. New poses use UUIDs; renaming retains the ID. Example:

```json
{
  "version": 1,
  "name": "Sword ready",
  "bones": {
    "hand": { "x": 0, "y": 40, "rotation": 0.6, "scaleX": 1, "scaleY": 1 }
  },
  "library": {
    "id": "6f950c57-4b76-489f-a4b6-fec480e72164",
    "characterId": "hero",
    "rigSignature": "<canonical rig compatibility JSON>",
    "space": "fk-local"
  }
}
```

`library` is optional provenance, validated by the existing pose schema and retained by CharacterLoader. Its signature is deterministic canonical JSON of root identity, bone IDs, parents, bind transforms and authored IK configuration. Bone array order and artwork/texture aliases do not affect it. Compatibility requires the same character ID and signature, even for partial poses. Missing bones and changed hierarchy, bind transforms or IK configuration show a reason and block Preview/Apply without authoring keys. Display names never establish compatibility. Restore the compatible rig or save a new pose after rig changes.

Legacy presets without metadata remain valid, sparse and unchanged in exported JSON until explicitly renamed. Their current character/source rig establishes session compatibility; their editor identity derives from the unique preset name. An explicit rename persists that identity and provenance. Existing manifest paths are retained for edited presets. New files use collision-safe `poses/<id>.json` paths. No selection, history, preview object, compiled animation, renderer state or temporary URL enters pose JSON. The source CharacterDefinition and source bytes remain immutable.

## Verification

Unit regressions cover full/partial capture, stepped sampling/endpoints, temporary-edit rejection, preview/cancel and invalidation, exact-time key overwrite, sparse legacy properties, multiple clips, animation/library history, missing bones, foreign characters, hierarchy/bind/IK rejection, serialization, actual Puppet IK, stable IDs, character/project ZIPs, autosave payloads, dependency inspection and checkpoint fingerprints.

The local desktop browser workflow authors a sword-ready pose and a partial head pose, searches/renames/confirms deletion, cancels previews with both Cancel and Escape, applies at 375 ms in a second animation, verifies exported keys, undoes/redoes, exports character/project ZIPs, reloads and checks the retained library. Browser checks remain local-only. This automation does not claim a human artist acceptance session.

## Implementation files

| Area                             | Files changed                                                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pose format and validation       | `src/engine/schemas.ts`, `src/engine/CharacterDefinition.ts`, `schemas/pose.schema.json`                                                                                                                                                                         |
| Library document and UI          | `src/devtools/animation-editor/PoseLibrary.ts`, `PoseLibraryController.ts`, `PoseLibraryPanel.tsx`, `AnimationEditorState.ts`, `AnimationEditorDocument.ts`, `AnimationEditorPreview.ts`, `AnimationEditorScene.ts`, `editorMarkup.tsx`, `main.tsx`, `style.css` |
| Character persistence and status | `src/devtools/shared/newCharacter.ts`, `src/devtools/shared/package/characterPackage.ts`, `PackageFingerprints.ts`, `PackageController.ts`, `PackagePanel.tsx`                                                                                                   |
| Desktop layout follow-up         | `src/devtools/rig-editor/RigWorkspaceLayoutController.ts` clears the cached portrait fit on Reset after a narrow preview drag; the existing divider regression retains its initial-size assertion.                                                               |
| Project inventory and validation | `src/devtools/project/ProjectAssetLibrary.tsx`, `projectInspection.ts`                                                                                                                                                                                           |
| Tests                            | `tests/poseLibrary.test.ts`, `tests/packageFingerprints.test.ts`, `tests/browser/poseLibrary.spec.ts`, `tests/browser/animationEditor.spec.ts`, `tests/browser/newAnimation.spec.ts`, `tests/browser/sharedWorkspace.spec.ts`                                    |
| Guides and version               | `README.md`, `CHANGELOG.md` under `1.1.1`, this guide, `docs/animation-editor.md`, `docs/schema-compatibility.md`, `docs/runtime-integration.md`, root and standalone package manifests/lockfiles                                                                |

The original plan files are unchanged. No browser test/install step or scheduled audit was added to CI.

## Command results

Verified locally on 2026-10-23 with Node 24.19.0 and installed desktop Chrome. The final code passed:

| Exact command                                                                             | Result                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run schemas:generate`                                                                | Exit 0; generated pose JSON Schema matches Zod.                                                                                    |
| `npm run check`                                                                           | Exit 0; formatting, lint and TypeScript pass.                                                                                      |
| `npm run typecheck`                                                                       | Exit 0.                                                                                                                            |
| `npm run test`                                                                            | Exit 0; 3,443 passed, 56 skipped; 198 files passed, 5 skipped.                                                                     |
| `npm run build`                                                                           | Exit 0; demo and library builds, declarations and Node core checks pass. Two existing Lucide `use client` bundler warnings remain. |
| `npm run check:version`                                                                   | Exit 0; root/standalone manifests, lockfiles and changelog agree on 1.1.1.                                                         |
| `npm run test:package`                                                                    | Exit 0; isolated packed consumer, public declarations, docs links, standalone build and all 3 standalone runtime tests pass.       |
| `PLAYWRIGHT_CHANNEL=chrome npm exec playwright -- test tests/browser/poseLibrary.spec.ts` | Exit 0; development and production artist workflow both pass.                                                                      |

The twelve-step manual checklist in the plan is exercised by the automated desktop workflow, including full and partial saves, animation switching, visual preview/cancel, key application, Undo/Redo and project export/reload. The assistant also inspected the desktop popover screenshot. No human manual artist session is claimed. Scope remains exact compatible-rig FK reuse; IK target capture, cross-rig retargeting and pose blending are excluded.

The optional broad command `PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- --workers=2` was started, then interrupted with exit 130 after 47 passing cases and two failures. One failure was an existing stale exact expectation for the animation-free editor message; both affected assertions now match the existing creation/import guidance. The other was an existing canvas screenshot timing comparison. Both scenarios subsequently passed in development and production with the default single worker; the playback implementation and its assertions were unchanged. The complete 522-case browser suite was not completed.

The isolation command passed all four cases:

```bash
PLAYWRIGHT_CHANNEL=chrome npm exec playwright -- test tests/browser/animationEditor.spec.ts --grep 'no animations and no selection|play, pause, resume'
```

The affected desktop suite uses the existing single-worker configuration:

```bash
PLAYWRIGHT_CHANNEL=chrome npm exec playwright -- test tests/browser/animationMirroring.spec.ts tests/browser/animationIKAuthoring.spec.ts tests/browser/characterPackage.spec.ts tests/browser/projectWorkspace.spec.ts tests/browser/sharedWorkspace.spec.ts tests/browser/localAutosave.spec.ts tests/browser/poseLibrary.spec.ts
```

The affected suite's first pass exited 1 with **48 passed, 1 skipped and 5 failed**. The failures were the existing local-save-unaware desktop geometry/reset expectations (four development/production cases) and one existing mirror screenshot timing comparison. Updating the geometry readiness/anchor and fixing the cached rig portrait reset resolved the layout cases. The mirror case passed unchanged in isolation. `PLAYWRIGHT_CHANNEL=chrome npm exec playwright -- test --last-failed` first produced 3 passed / 2 failed (exit 1), then **2 passed** (exit 0) after the reset correction. All **53 executed affected scenarios** therefore passed after corrections/reruns; one existing scenario remained skipped. These counts do not claim completion of the full 522-case suite.

The final build also passed all four new-animation / pose-library browser workflows (exit 0, 4 passed):

```bash
PLAYWRIGHT_CHANNEL=chrome npm exec playwright -- test tests/browser/newAnimation.spec.ts tests/browser/poseLibrary.spec.ts --grep 'rig with no animation files|artist saves full'
```

The single skipped affected case is the production copy of the direct IndexedDB module harness, which explicitly runs only against the development source server; its development case passed. The final `npm run check`, `npm run test` and `npm run build` all passed again after the divider reset correction and final UI feedback update.

## Feature Guide follow-up

The shared catalog now includes **Feature Guide → Animation Editor → Pose Library**, also available through Project Workspace's guide picker. Seven Explain steps reveal the actual save/scope, search, preview/cancel, Apply, rename/delete, library history and package controls. No saved pose is required to start; a loaded valid rig and selected animation are required. Starting or navigating the tour never saves, selects, previews, applies, renames or deletes a pose.

Verification: the five targeted unit modules (`animationGuides`, `guideRegistry`, `guideLauncher`, `guideTargets`, `poseLibrary`) passed all 43 tests. The local desktop command `PLAYWRIGHT_CHANNEL=chrome npm exec playwright -- test tests/browser/poseLibrary.spec.ts --grep 'Pose Library Feature Guide'` passed all four empty/populated-library workflows across development and production. These checks cover real spotlight positions, Back/Finish/Escape, focus restoration, unchanged animation time/dirty/history, unchanged library history, no tour downloads and identical exported character package bytes.

The follow-up also passed `npm run check`, `npm run build`, and a standalone `npm run test` rerun with **3,444 passed / 56 skipped**. An earlier full unit run performed concurrently with the browser walks hit the existing 5-second large-scene autosave test timeout; it passed unchanged when the full suite ran after the browsers stopped.
