# Animation Editor Rig-Tweak Mode

[All guides](../README.md#guides)

Milestone v0.5.8.3 uses package SemVer `0.5.8-3`.

Choose **Rig Tweak** in the compact **Editor Mode** selector in the existing command toolbar to adjust the character rig at the current animation pose. Playback pauses and the playhead stays in place. The inspector provides Joint Editing, Artwork Offset Editing, Sprite Origin Editing and Slot Transform Editing, with the existing grid and rotation snapping. Rig hierarchy selection, numeric fields, alignment helpers and canvas gestures work as in the Rig Editor. Joint positions are expressed in the animated parent's local coordinates.

The timeline and animation authoring controls become inactive. Animation keyboard shortcuts and IK target gestures are inactive too. Return to **Animation** to scrub, play and author keys again; playback resumes only when you explicitly press Play. Rig status appears in the existing toolbar feedback line; animation dirty status remains beside export. The mode selector and status reserve no additional workspace row. Compact snapping controls stay visible in the timeline toolbar, retaining their accessible names and behavior.

Rig changes affect every animation using this rig. Existing translation keys may override a changed bind position, and new bone lengths can change IK reach and motion. There is no automatic motion preservation or retargeting. Use **Undo rig** and **Redo rig** to compare the paused preview, or **Revert rig tweaks** to restore the session's original rig. Revert is itself undoable. Animation Undo/Redo returns when Animation Mode is active; Ctrl/Cmd+Z follows the active authoring mode outside text fields.

**Download rig JSON** validates and exports rig data, preserving authored filenames and exact artwork offsets/origins. Place the downloaded file in the character folder. Rig file tools also provide copy, log, validation, original reload, exported reload and JSON import. Imports inside Rig Tweak accept the same hierarchy, bone sprite identities and IK definitions; attachment catalogs and embedded skins can change. Both editor views retain the same character hierarchy and default skin. Open another character to work on a different skeleton. See [visual attachment and skin management](visual-attachment-skins.md) for standalone skin exports. A compatible import is a rig history operation and leaves the animation session intact. Rig export never marks the animation saved, and animation export never marks the rig saved.

Unsaved rig tweaks participate in the existing browser navigation/refresh/character-switch confirmation. Rig reload/import actions confirm before discarding dirty rig edits. Browser rig drafts share a character/source-bound namespace between the Animation Editor and Rig Editor, so a browser reload can recover compatible rig edits with the existing restore confirmation. Header editor-tab navigation retains the live document, history and applied images without a restore prompt. Multiple browser tabs retain independent draft envelopes and offer explicit recovery choices instead of overwriting each other's work. Export JSON to save the working rig permanently.

## Architecture and APIs

`AnimationEditorState.editorMode` and `setEditorMode()` define the exclusive authoring mode. Entering Rig Tweak cancels provisional animation gestures and transforms, pauses the sole clock and clears scrub playback intent. Animation mutation commands reject work in Rig Tweak, including the shared animation installation boundary; mode changes do not enter either history.

`AnimationEditorScene.rigEditor.state` is the sole authoritative editable rig for its active character session. Its `RigEditorState` owns immutable working snapshots, rig history, validation and rig saved baselines. `AnimationEditorState.rig` is a validated runtime projection of that working snapshot, including the character's standalone preview skins. Loaded character/source data remains immutable. Compatible rig imports reuse this owner rather than creating another editor or animation document.

The embedded `RigEditor` uses an optional evaluated-context callback after its existing rig projection. Its existing input controller, overlay, coordinate conversion, snapping, artwork proposals and geometry projection remain shared with the standalone Rig Editor. Embedded activation preserves animation context and runtime IK ownership. `RigTweakController` binds the existing hierarchy, inspector and session/file controllers to React hosts in `RigTweakPanel`, and publishes cached mode/dirty snapshots. The shared session controller accepts a preview-stage selector.

`AnimationEditorState.updatePreviewRig()` updates document and selection sampling references without replacing animation snapshots, saved baselines or histories. `AnimationEditorPreview` recompiles when rig identity changes and evaluates through detached joints initialized with the working bind pose, then projects those poses into the existing puppet. The normal runtime IK pass recomputes lengths and endpoints; provisional animation keys are never generated. Rig geometry projects through the existing Rig Editor. Onion sampling also invalidates on rig changes. Scene shutdown disables rig input/overlays and removes mode subscriptions before destroying preview players, ghosts and the puppet; React cleanup disposes panel listeners and flushes draft recovery.

## Verification

`tests/animationEditorRigTweak.test.ts` covers mode/clock and draft cancellation, animation command rejection, source and working-copy ownership, pose/geometry/IK/ghost reevaluation, separate histories/dirty states, export/import/revert, incompatible import rejection and scene/controller cleanup. `tests/browser/animationRigTweak.spec.ts` is a local-only Chrome workflow covering the paused elbow edit, canvas changes, Undo/Redo, continued playback, exact unchanged animation exports, rig download/reload/import and cross-route draft recovery.

Manual verification:

1. Open an animation and scrub to an elbow pose that needs alignment.
2. Enter Rig Tweak and select the elbow joint.
3. Move the joint with canvas dragging or its numeric local fields. Verify the preview updates.
4. Compare with Undo rig/Redo rig; check the separate dirty statuses.
5. Return to Animation, scrub and explicitly play. Check that no new keys appeared.
6. Return to Rig Tweak and download rig JSON. Reload the export and confirm alignment.

Required commands are `npm run typecheck`, `npm run test` and `npm run build`. Run the local browser scenario with `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationRigTweak.spec.ts`; browser checks are never added to CI.

Original milestone implementation verification (see [v0.6.3 verification](react-editor-workflow-verification.md) for the current shared workspace):

| Check                                    | Result                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                      | Passed                                                                                                                                                                      |
| `npm run test`                           | 2,233 passed; 32 existing skipped tests                                                                                                                                     |
| `npm run build`                          | Demo and library passed; built `/core` Node verification passed                                                                                                             |
| `npm run check`                          | Formatting, lint and types passed                                                                                                                                           |
| `npm run check:version`                  | Passed; `0.5.8-3`                                                                                                                                                           |
| Local Chrome, development and production | 10 selected checks passed: elbow workflow, cross-route rig recovery, existing playback, IK handles/lifecycle and inspector focus/history                                    |
| Compact workspace, local Chrome          | Desktop widths 1,000–1,920px add no mode-control toolbar row; mode changes preserve toolbar height; phone layout and snapping behavior passed in development and production |

The manual checklist above was exercised through the automated local Chrome workflow; no separate human manual verification is claimed. Animation exports before and after the rig-tweak/export/reload workflow were identical.

Automatic retargeting, automatic IK baking, sprite asset package export, deformation and scene choreography remain deferred.
