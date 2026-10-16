# React editor production workflow — v0.6.3

[All guides](../README.md#guides) · [Artist workflow](artist-workflow.md)

The header editor tabs now retain the live character session. Rig Editor, Animation Editor and Rig Tweak use one rig document, artwork controller and skin catalog. Clip navigation keeps each clip's authored snapshot, saved baseline, Undo/Redo history, playhead and key selection. Package exports include pending edits in inactive clips.

## Ownership and navigation

Both HTML entry routes mount the shared character workspace through the animation entry module. One `AnimationEditorScene` owns the puppet, `RigEditorState`, `RigEditor` and `AnimationEditorState`. `RigWorkspaceController` adapts the existing full rig inspector, hierarchy, controls and session actions to that owner; `RigTweakController` adapts the same rig to the paused animation pose. The full rig view previews the bind pose or current authored clips. There is no second rig scene on editor-tab navigation.

React keeps the static controller hosts mounted and hides/inerts the inactive shell. Reactive artwork, attachment and package panels mount in the active view and subscribe to shared controllers. Rig-tweak hosts have separate IDs from the full rig hosts; only one header character selector has the active ID. A single canvas moves between preview hosts, with Phaser FIT bounds refreshed after the React layout commit. Source definitions remain immutable.

`WorkspaceNavigation` intercepts ordinary same-character editor-tab clicks and handles browser Back/Forward between editor routes. Modified clicks and navigation to the demo or another character retain normal browser behavior. Leaving/reloading a dirty workspace uses `beforeunload` where supported. Uncommitted animation previews offer discard/cancel before mode navigation; committed clips, rig data and image proposals remain owned by the workspace. Canceling history navigation restores the held editor URL.

Opening another browser tab or typing a route URL creates a separate session. Compatible rig/animation JSON drafts can recover after reload, with confirmation; images and artwork history remain session-only. Rig recovery has one controller with feedback/download controls in both views. Animation recovery keys normalize both entry routes to the animation route. Returning to a visited clip skips recovery prompts and reuses its owned draft envelope, so repeated navigation does not accumulate duplicate backups.

## Dirty state and recoverable errors

Package status is visible in the collapsed panel summary and separately tracks Rig, Animations, Assets and Skins. Pending artwork proposals block export while committed domain status continues updating. Rig's document indicator excludes embedded/standalone skin changes; the existing aggregate rig dirty state still protects those edits during replacement and navigation. Each animation retains its own JSON checkpoint; inactive pending clips also protect leaving the workspace. Artwork never installs an animation snapshot.

Downloads record only the established document/package checkpoints. Save downloaded files and extract/place them in the served character folder manually; no repository files are overwritten. Package checkpoints do not confirm that downloaded bytes were retained on disk.

Invalid JSON, missing assets, unsupported images/ZIPs, broken references and invalid edits continue through the existing inspector, artwork, animation and package feedback. Compatible rig imports retain clip sessions, images and the character default skin. Rig JSON export checkpoints can be reloaded from either rig view; successful-export ordering is shared so an older clipboard request cannot overwrite a newer checkpoint from the other view. Missing image assets, private texture keys, invalid frames, and incompatible hierarchy, bone artwork identity or IK-definition imports fail before replacing the working rig. Import/reload generation checks prevent an asynchronous clipboard export from saving an obsolete rig after a replacement in the same owner. Failed package export keeps its prior checkpoint and all authored documents. Package ZIP import/reload remains an isolated runtime preview.

## Lifecycle and performance

Artwork replacement previews refresh rig inspector dimensions, alignment controls and overlays before releasing displaced textures. Mode changes cancel gestures, pause playback, gate animation authoring, disable IK dragging outside animation mode and hide onion/mirror/bake layers. Full Rig Editor detaches animation IK channels and gates constraints through its own IK Preview control while evaluating the bind-pose context; Rig Tweak evaluates the paused animation context. One rig input controller is active at a time. Scene shutdown disposes handles, overlays, ghosts, previews, puppet resources and state subscriptions; workspace teardown also releases route handlers, observers, panel subscriptions and games.

The scene regression cycles full rig, Rig Tweak and animation modes twelve times, checks stable document identity, bind/animated poses, pointer-listener and state-subscriber counts, then checks shutdown cleanup. Browser checks retain the exact canvas element across repeated editor changes and history navigation, detect duplicate DOM IDs, and exercise repeated package-preview disposal.

The local dense-workflow profile covers 32 bones, 12,288 bone-property keys, 768 IK-property keys, 128 events, 64 additive selections, filtering, scrubbing, group drag, normal/onion playback, skins and a 256×256 artwork replacement. Measurements include synchronous layout or browser scheduling as described in [profiling](profiling.md); they are observations without CI thresholds. Dirty-domain comparisons reuse immutable rig snapshots. No new animation solver or speculative rendering optimization was introduced.

## Artist verification

The automated local browser artist scenario opens a character, changes a joint, aligns attachment artwork, imports/previews/applies a sprite, changes editor tabs, authors a key, switches clips, uses Rig Tweak, changes skins, performs rig/animation Undo/Redo, repeatedly changes views, checks browser Back/Forward, exports a ZIP, and reloads/reimports it into the runtime preview. Existing package scenarios also download individual rig/animation JSON and verify exact image bytes and runtime playback. Invalid-import and draft-recovery suites cover rejected replacement and reopen behavior.

This is automated browser verification. A human drawing/authoring session has not been performed. Follow [the artist guide](artist-workflow.md) for a human manual pass and manual file placement after export.

## Changed files and checks

Implementation changes are in the editor entry/view modules, `AnimationEditorDocument`, `AnimationEditorState`, scene/preview/ghost mode handling, rig/session controllers, shared navigation and recovery controls, artwork/package status, header selection delegation, and related styles. Tests add `characterWorkspace.test.ts` and local `browser/characterWorkspace.spec.ts`, extend rig scene/clipboard/package coverage, and update clip-navigation and rig-tweak browser expectations. The local workflow profile now measures skins and artwork too. Package metadata and artist/editor guides describe v0.6.3. No CI browser installation, smoke-test or scheduled-audit steps were added.

The following required commands completed successfully on the final application code:

| Command                                                            | Exit | Result                                                                                 |
| ------------------------------------------------------------------ | ---: | -------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                |    0 | TypeScript strict checks passed.                                                       |
| `npm run test`                                                     |    0 | 142 test files passed, 3 skipped; 2,396 tests passed, 32 skipped (2,428 total).        |
| `npm run build`                                                    |    0 | Demo, library, declarations and Node `/core`, `/serialization`, `/data` checks passed. |
| `npm run lint`                                                     |    0 | No lint errors.                                                                        |
| `npm run check:version`                                            |    0 | Package `0.6.3` is valid SemVer.                                                       |
| `npm run format:check`                                             |    0 | Formatting passed.                                                                     |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline -- --workflow` |    0 | Three local Chrome pages completed every workload.                                     |

The demo build emitted the existing two nonfatal `lucide-react` module-level `use client` directive warnings. No browser installation or CI changes were required. The first sandboxed browser launch could not bind localhost; local runs succeeded with the execution sandbox's localhost/Chrome permission.

The following local browser command exited **0**, with **48 passed** across development and the production base path:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/characterWorkspace.spec.ts tests/browser/animationRigTweak.spec.ts tests/browser/characterPackage.spec.ts tests/browser/sharedWorkspace.spec.ts tests/browser/characterSelection.spec.ts tests/browser/animationProductionWorkflow.spec.ts tests/browser/rigArtworkAlignment.spec.ts
```

This included desktop/narrow layouts and focus, both characters, unsaved character-switch protection, smooth/stepped exports, the complete artist workflow, PNG/WebP packages, repeated preview disposal, alignment dragging and exact canvas appearance after rig export/reload. The alignment regression was updated to choose its required replacement pivot policy and now checks refreshed image dimensions. Earlier implementation failures were corrected before these passing runs.

The final asynchronous cross-view export-ordering and rig-import asset-reference guards have unit regressions. After rebuilding the final code, the following focused browser command exited **0**, with **6 passed** across development and production:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/characterWorkspace.spec.ts tests/browser/animationRigTweak.spec.ts
```

Local profile medians, in milliseconds:

| Operation                                    | Median |
| -------------------------------------------- | -----: |
| Expand root (384 property markers)           |   19.4 |
| Add 64 keys to selection, total              |   98.2 |
| Search rotation properties                   |  266.9 |
| Zoom one step                                |   40.2 |
| Ruler scrub, per change                      |    2.7 |
| Pointer move to next frame                   |    8.1 |
| Playback frame interval                      |   24.5 |
| Playback frame interval with onion skins     |   24.9 |
| Skin change, including synchronous layout    |     11 |
| Artwork decode, including browser scheduling |   50.9 |
| Artwork preview and apply after decoding     |    5.4 |

Normal and onion playback each produced **zero timeline-track DOM mutations** in all three samples. Filtering still opens many groups and has a visible one-time cost on this dense fixture. No optimization was added for an unmeasured workload. Raw samples and fixture counts are in `docs/research/react-editor-workflow/measurements.json`.

### File inventory

- `CHANGELOG.md`
- `README.md`
- `docs/animation-editor.md`
- `docs/animation-rig-tweak.md`
- `docs/artist-workflow.md`
- `docs/development.md`
- `docs/profiling.md`
- `docs/react-editor-workflow-verification.md`
- `docs/research/react-editor-workflow/measurements.json`
- `docs/rig-editor.md`
- `docs/sprite-replacement.md`
- `package-lock.json`
- `package.json`
- `scripts/profile-editor-workflow.mjs`
- `src/devtools/animation-editor/AnimationDraftRecoveryController.ts`
- `src/devtools/animation-editor/AnimationEditorDocument.ts`
- `src/devtools/animation-editor/AnimationEditorGhostLayer.ts`
- `src/devtools/animation-editor/AnimationEditorPreview.ts`
- `src/devtools/animation-editor/AnimationEditorScene.ts`
- `src/devtools/animation-editor/AnimationEditorState.ts`
- `src/devtools/animation-editor/AnimationFileController.ts`
- `src/devtools/animation-editor/RigTweakController.ts`
- `src/devtools/animation-editor/RigTweakPanel.tsx`
- `src/devtools/animation-editor/TimelineController.ts`
- `src/devtools/animation-editor/TimelineSessionController.ts`
- `src/devtools/animation-editor/editorMarkup.tsx`
- `src/devtools/animation-editor/main.tsx`
- `src/devtools/animation-editor/style.css`
- `src/devtools/rig-editor/ControlsController.ts`
- `src/devtools/rig-editor/RigEditor.ts`
- `src/devtools/rig-editor/RigEditorState.ts`
- `src/devtools/rig-editor/RigWorkspaceController.ts`
- `src/devtools/rig-editor/SessionController.ts`
- `src/devtools/rig-editor/editorMarkup.tsx`
- `src/devtools/rig-editor/main.tsx`
- `src/devtools/rig-editor/rigDraftRecovery.ts`
- `src/devtools/shared/DraftRecovery.ts`
- `src/devtools/shared/DraftRecoveryControls.ts`
- `src/devtools/shared/WorkspaceNavigation.ts`
- `src/devtools/shared/artwork/ArtworkController.ts`
- `src/devtools/shared/artwork/ArtworkPanel.tsx`
- `src/devtools/shared/package/PackagePanel.tsx`
- `src/devtools/shared/package/characterPackage.ts`
- `src/ui/characterSelection.ts`
- `src/ui/viewShell.tsx`
- `src/ui/workspace.css`
- `tests/animationDraftRecoveryController.test.ts`
- `tests/animationEditorProductionSession.test.ts`
- `tests/animationEditorRigTweak.test.ts`
- `tests/browser/animationProductionWorkflow.spec.ts`
- `tests/browser/animationRigTweak.spec.ts`
- `tests/browser/characterPackage.spec.ts`
- `tests/browser/characterWorkspace.spec.ts`
- `tests/browser/rigArtworkAlignment.spec.ts`
- `tests/browser/sharedWorkspace.spec.ts`
- `tests/characterPackage.test.ts`
- `tests/characterWorkspace.test.ts`
- `tests/draftRecovery.test.ts`
- `tests/rigEditorClipboard.test.ts`

## Remaining work for v0.6.4

Durable image/project-session storage, cross-tab session coordination and ZIP import directly into an authored workspace remain future work. A general skeleton/topology replacement flow needs explicit animation/reference reconciliation before it can preserve this workspace safely. Dense search/fully expanded timelines remain candidates for further measurement; no virtualization is included. Human artist feedback should guide any additional control/layout changes.
