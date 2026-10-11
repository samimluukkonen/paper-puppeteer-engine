# React IK timeline and inspector

[All guides](../README.md#guides)

Milestone **v0.5.5.3** (package `0.5.5-3`) adds numeric IK animation authoring to the Animation Editor. The [data model](ik-animation-data.md), [runtime evaluator](ik-animation-runtime.md), solver, editor clock, working copy and document history remain authoritative.

## Timeline and selection

Each existing rig IK definition appears after the bone rows, labeled `IK: <constraint name>`. Expand the row to show the schema's independent `x`, `y`, and `mix` channels. `mix` is solver influence; every current two-bone constraint supports it. Empty channels remain available for authoring. Collapsed constraints show the existing pixel-grouped key summaries, including influence-only keys.

The flat `TimelineTrack` union now includes `ik` and `ik-property` rows. Constraint IDs and key references occupy a distinct namespace from bone IDs, even when names match. Constraint expansion uses its own set in the existing selection controller. IK rows share the ruler, playhead, conversion, scroll/zoom, filters, marker buttons, key-time tolerance, and frame-snap settings with bone rows.

`AnimationEditorState.selectedTarget` distinguishes bone and IK targets. `selectedIKConstraintId`, `selectedIKProperty`, and `selectedIKKeyframe` identify the real rig constraint and independently keyed channel. Selecting an IK constraint clears bone keys, bone drafts and event selection. Selecting a bone or event clears IK selection. These navigation actions never change authored history or dirty state.

Single IK markers support click/keyboard selection, Delete/Backspace, the toolbar's Delete Keys action, and left/right arrow movement. Shift moves ten steps; Frame snapping uses the existing FPS setting. Movement uses the pure IK mutation API, including duration clamping, collision replacement, and sparse sibling preservation. Undo/Redo reconciles marker selection against the resulting working snapshot; it does not restore transient selections.

## Inspector workflow

`IKInspectorPanel` owns the React controls. `IKInspectorController` provides cached `useSyncExternalStore` snapshots, text validation, and session binding/cleanup. Numeric drafts live in the established editor selection state; the adapter only retains field text so blank or partially typed input can be canceled safely. It has no independent animation store, clock, or playback state.

Select an IK row to inspect **absolute puppet-local X/Y coordinates**, before facing, outer placement, and camera projection. These are authored coordinates, never screen positions. The inspector samples the shared compiled clip and playback quantization. Unkeyed X/Y fall back to the evaluated endpoint, including `endOffset` and preceding priority-ordered rig constraints. The cached renderer-independent sampler in `ikInspectorSampling.ts` reuses the existing `TwoBoneIKConstraint` solver with private joint buffers; it never changes the live rig, puppet, source clip, or clock. Unkeyed influence uses the rig mix, defaulting to 1. Disabled constraints retain their authored enabled setting.

1. Focus a numeric field to pause playback at the playhead. Typing creates a temporary draft and no history entries.
2. Enter a finite X/Y value or influence in `[0, 1]`.
3. Choose **Set Key** for that property. It creates or updates only that channel using `setIKPropertyKeyframe` and records one logical history operation. Other drafted channels remain available.
4. Choose **Delete Key** to remove only that property at the current time using `removeIKPropertyKeyframe`. Sparse siblings, other constraints, bone keys and events remain intact. The inspector and puppet immediately evaluate the remaining keys/fallback.
5. Use **Cancel IK edits** or Escape to discard drafts. Scrubbing, playback, selection changes, Undo/Redo, and animation-session changes also discard them.

Committed edits remain paused. The existing preview subscriber samples the working copy and refreshes the existing puppet through its existing solver; the character and rig are never reloaded. As with bone authoring, history and dirty state belong to the document, and original source animations remain immutable. Draft values are prospective; IK poses update when Set Key commits them.

The **IK preview (fixed targets)** checkbox installs an existing procedural provider override. Disable it to inspect authored motion on the canvas. The inspector continues to describe authored channels, independently of that preview preference. Influence-only keys do not create a target position. For onion skins and other preview overlays, existing pre-IK rendering semantics remain unchanged.

## Demo walkthrough and verification

The shipped `demo-puppet` rig includes the enabled `rightArmIK` constraint. Without position keys or a runtime target, it leaves ordinary bone animation unchanged.

1. Open the Animation Editor with `demo-puppet` and select/expand `IK: rightArmIK`.
2. Scrub to 0.0 s; enter X `22`, Y `-42`, and set each key.
3. Scrub to 0.5 s; set X `-8`, Y `-22`.
4. Scrub to 1.0 s; set X `-78`, Y `-32`.
5. Play and observe the arm following the interpolated target. Focus a field during playback and verify that time stops.
6. Key influence at 0, delete that key, and confirm the rig mix returns. Delete X at 1.0 s, Undo, and Redo; Y must remain keyed.
7. Select an X marker and move it using arrows with Frame snapping. Delete it, then Undo.
8. Select `rightUpperArm` and set a rotation key to verify ordinary bone authoring.

`tests/animationEditorIK.test.ts` covers track generation, namespaces and expansion, typed selection, inspector values and fallback, priority-ordered solver sampling, mutable-input freshness, create/update/delete, property independence, working/source isolation, playback safety, history/dirty state, marker reconciliation, snapping, React-adapter synchronization/cleanup, and immediate A/B/C puppet refresh.

Local-only Playwright scenarios cover the rendered React workflow above and existing IK runtime behavior in both development and production. The authoring scenario uses a one-second non-looping empty working clip to isolate the target motion and compares canvas snapshots at A/B/C and after deletion/history operations. Run after building:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationIKAuthoring.spec.ts tests/browser/ikAnimationRuntime.spec.ts
```

Verification on 2026-10-11: the local development/production authoring and runtime walkthroughs passed using installed Chrome. The rendered inspector, expanded IK tracks and A/B/C markers were also visually inspected in the captured screenshot. This is automated browser verification with screenshot review; the numbered steps provide a human manual checklist. Browser checks and browser installation remain outside CI.

Required checks:

```bash
npm run typecheck
npm run test
npm run build
```

| Check               | Result                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | Passed.                                                                                                                                                                                                                          |
| `npm run test`      | 1,752 passed; 32 existing skipped tests.                                                                                                                                                                                         |
| `npm run build`     | Passed for the demo, library declarations and Node `/core` check.                                                                                                                                                                |
| `npm run check`     | Formatting, lint and typecheck passed.                                                                                                                                                                                           |
| Local Chrome        | IK authoring/runtime, bone authoring, track alignment and timeline-update checks passed in development and production. The preview-picking test now locates the rendered joint ring instead of assuming a fixed camera position. |

## Deferred to v0.5.5.5 and later

IK multi-selection, marquee/range selection, pointer dragging of key markers, clipboard/paste/duplicate, and previous/next IK key navigation await generic channel-aware batch operations. Bone commands keep their existing implementation; IK selection disables clipboard buttons and prevents stale bone clipboard contents from being pasted through IK commands. Single-key authoring, deletion and snapped keyboard movement are available now.

Visual IK target handles and pointer dragging are implemented in [v0.5.5.4](visual-ik-targets.md). Mirrored IK authoring, baking, new solvers, target ownership changes, physics and scene choreography remain deferred.

## Changed files and APIs

| Files                                                                                                                                                                         | Responsibility                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `IKInspectorPanel.tsx`, `IKInspectorController.ts`                                                                                                                            | React numeric controls, snapshots, validation, text drafts and subscription lifecycle.                          |
| `ikTimeline.ts`, `timelineTracks.ts`, `ikInspectorSampling.ts`                                                                                                                | Typed constraint/property rows and playback-aware authored IK inspection.                                       |
| `AnimationEditorSelection.ts`, `AnimationEditorState.ts`, `AnimationEditorIKCommands.ts`                                                                                      | IK target/key selection, expansion, numeric drafts, mutation commands and history integration.                  |
| `TimelineTracksController.ts`, `TimelineInputController.ts`, `TimelineKeyboardController.ts`, `TimelineSessionController.ts`, `TimelineController.ts`, `timelineSummaries.ts` | Existing markers, summaries, filtering, pointer selection, keyboard/toolbar actions and rendering invalidation. |
| `editorMarkup.tsx`, `main.tsx`, `BoneInspectorController.ts`, `style.css`                                                                                                     | Panel mounting/binding/cleanup, inspector reveal, selection visibility and row presentation.                    |
| Demo rig, unit/browser tests, package manifests and guides                                                                                                                    | Usable demo constraint, regression coverage and milestone documentation.                                        |

The pure engine mutation APIs and serialized version-1 format are unchanged. The public engine exports are unchanged.
