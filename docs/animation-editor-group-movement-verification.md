# v0.5.2.5.3 — Group Keyframe Movement & Workflow Hardening

## Implemented

Group dragging and arrow nudging across bones/properties, exact relative timing, anchor snapping, whole-group boundaries, atomic collision replacement, provisional cancellation, one history transaction, moved selection/primary preservation, and shortcut help. Package version is `0.5.2-5.3`. Existing playback, authoring, selection and clipboard systems are retained.

## Multi-selection architecture

`AnimationEditorSelection` remains the transient owner of immutable selected references, primary context, range anchor and expanded tracks. The existing exact-identity index and shared tolerant authored lookup remain authoritative. A drag on a selected marker retains the group and makes the clicked marker primary; an unselected marker replaces the group. Ctrl/Cmd toggles and Shift ranges retain their existing behavior.

## Clipboard/copy/paste architecture

The internal immutable clipboard still records authored values, bone/property tracks and millisecond offsets from the earliest key. Copy resolves moved references against the current working snapshot. Paste and duplicate reuse the existing batch replacement helpers, select their results, and may extend duration. Duplicate retains the user's clipboard. Their existing tolerant canonical destination policy is unchanged.

## Group movement architecture

`moveBonePropertyKeyframes()` resolves and validates every source, computes one constrained millisecond delta, removes the selected group from collision consideration, then applies all destination edits. It returns one immutable-compatible animation snapshot and destination references. The indexed track replacement helper is shared with paste; group mode removes external conflicts before inserting all translated keys. Track arrays are sorted only by mutation helpers.

The command layer owns a frozen drag record (`originalKeys`, `originalPrimary`, anchor `key`, `previewDelta`, `previewTime`). Pointer moves update only this record, the sole clock, and marker positions. Release and keyboard nudges use the same authored move command. Preview playback/inspector evaluation continues to use the unchanged working clip until commit. Playback pauses at drag start and remains paused.

## Snapping and boundary behavior

Only the anchor is snapped using existing frame semantics, authored stepped FPS, or the 10 FPS fallback. Shift during a drag bypasses snapping. The resulting delta is constrained to `[-earliest, duration - latest]`; no member is independently snapped or clamped. Boundaries take precedence over frame alignment. Movement does not extend duration.

Zero-duration clips are rejected by the existing positive-duration schema; gestures and nudges with no valid clip safely do nothing. A valid group filling duration also cannot move or add history. Finite but unrepresentable destination spacing rejects the entire operation rather than merging selected properties.

## Collision/atomicity policy

Same-bone/same-property external destination matches are replaced under the established shared nanosecond tolerance. Sparse sibling properties retain their times and values. Selected keys' original positions and newly inserted group members never block or replace each other. A group retains its exact translated destination times instead of independently adopting nearby external canonical times, which would distort spacing. A single-key move preserves the established nearest canonical destination behavior.

Missing sources, invalid targets, invalid data and destination precision collisions reject the whole move. Inputs are neither mutated nor frozen by pure helpers. Only `workingAnimation` is installed; source animation, events, playback metadata, interpolation and unmodified tracks remain intact.

## Selection reconciliation

Every committed destination reference remains selected; the moved anchor/primary controls inspector bone/property context and current time. Cancellation restores the original group and primary. Authored changes, Undo/Redo and animation switching retain existing reconciliation: deleted/missing refs drop, surviving refs normalize, and a valid fallback primary is chosen. Undo/Redo restore authored data rather than historical navigation/selection.

## History behavior

A changed drag or nudge installs one snapshot through the existing bounded `SnapshotHistory`. Undo/Redo restores exact authored snapshots, including external collision replacements. Preview, cancellation, no-op gestures, boundary-blocked nudges, selection and marquee create no history/dirty changes and preserve redo. Multi-delete remains one transaction. Undoing to the saved baseline restores clean state.

## Shortcut behavior

Left/Right moves the selection by one frame with frame snapping or 0.01 seconds otherwise; Shift uses ten steps. Without selection, timeline arrows scrub. Escape cancels drag/marquee first, otherwise clears selection. Ctrl/Cmd+C/V/D remains scoped to the timeline; Delete/Backspace and Ctrl/Cmd+Z/Shift+Z retain existing behavior. Inputs (text/numeric), selects, textareas, inherited contenteditable, consumed events, modifiers and IME composition retain their native behavior. A click without pointer movement selects without snapping or authoring.

## Files changed

- `src/devtools/animation-editor/keyframeEdits.ts`: pure group move, shared constraint and indexed replacement mode.
- `src/devtools/animation-editor/AnimationEditorKeyframeCommands.ts`: group drag/preview/cancel/move/nudge and cancellation before property edits.
- `src/devtools/animation-editor/TimelineTracksController.ts`: preview every moving marker using the common delta.
- `src/devtools/animation-editor/TimelineInputController.ts`: commit no-movement clicks without cancelling the clicked primary.
- `src/devtools/animation-editor/editorMarkup.ts`: group movement shortcut/help text.
- `tests/animationEditorGroupMovement.test.ts`: new core/session group tests.
- `tests/animationEditorMultiSelection.test.ts`: replace deferred movement expectations with group behavior.
- `tests/browser/animationGroupMovement.spec.ts`: new browser workflow scenarios.
- `tests/browser/animationMultiSelection.spec.ts`: enable group nudge regression expectations.
- `README.md`, `docs/animation-editor.md`, this report: behavior, architecture and verification documentation.
- `package.json`, `package-lock.json`: milestone version.

The supplied plan remains unchanged.

## APIs/types changed

Editor-only additions: `moveBonePropertyKeyframes(animation, rig, targets, deltaMs)`, `PropertyKeyframeMove<Animation>`, `constrainKeyframeMoveDelta(times, delta, duration)`. `KeyframeDrag` adds `originalKeys`, `originalPrimary`, and `previewDelta`. Existing `moveSelectedKeyframe(seconds)` and `nudgeSelectedKeyframe(direction, large?)` now move the selection as a group. Runtime exports, JSON schemas and dependencies are unchanged.

## Tests

Nineteen new unit cases cover deltas in both directions, eight keys across multiple bones/properties, identical times on different tracks, whole-group bounds, groups filling duration, zero-duration rejection, off-frame anchor snapping, self-collisions, simultaneous external collisions, tolerant collisions, distinct nearby selected times, atomic rejection, source immutability, primary/selection, keyboard steps, exact Undo/Redo, cancel/redo preservation, clipboard/duplicate/delete/marquee and animation mutation/switching.

Four new browser scenarios run against development and production: marquee group preview/commit/collisions/playback; snapping/boundaries/Escape; nudge/copy/paste/duplicate/delete; and resize/scroll/cancel/native keyboard editing. Existing movement, selection, clipboard, authoring, playback, preview, rig, export and character scenarios provide the broader regression pass.

## Manual verification

No separate human-operated manual session has been performed. Browser automation exercises the pointer/keyboard workflows and captures the moved-group timeline screenshot, which was visually inspected. For an additional human pass:

- [ ] Marquee a group across multiple bones/properties; drag left and right, preserving spacing.
- [ ] Reach both group boundaries with snapping off/on; verify intact spacing and anchor-following playhead.
- [ ] Drag a secondary selected marker; verify its primary inspector context; Escape restores the original primary/group.
- [ ] Move onto unselected properties on several tracks; verify replacement and retained sparse siblings.
- [ ] Undo/Redo each drag or nudge in one action; copy/paste/duplicate the moved selection and delete it.
- [ ] Resize/scroll during a gesture, cancel via Escape/lost capture/blur, and edit native typing controls.
- [ ] Play resulting smooth/stepped clips; check looping, speed, scrubbing, facing and IK preview.
- [ ] Open the Rig Editor, edit/export a rig, and switch characters after saving/discarding edits.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 69 files passed, 3 skipped; 1,150 tests passed, 28 skipped (1,178 total). The 19 new group movement tests all passed.
- `npm run build`: passed, exit 0; demo and library built, declaration output generated, and the Node `/core` smoke check passed for character loading, validation, animation and IK.
- `npm run lint`: passed, exit 0.
- `npm run check:version`: passed, exit 0.

Browser regression: all 166 scenarios verified across development and production. `PLAYWRIGHT_CHANNEL=chrome npx playwright test --workers=2 --reporter=dot` initially returned exit 1 with 164 passing scenarios and two failures in the new narrow marquee fixture (one per build): its start point hit a marker button rather than an empty lane. After moving the start into the empty bone lane, `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGroupMovement.spec.ts --workers=2 --reporter=dot` passed all eight group scenarios, exit 0. No authored implementation changes were needed for that fixture correction.

Localhost servers require execution outside the filesystem/network sandbox. The bundled Playwright browser is absent, so these runs use installed Chrome. An earlier broad run was interrupted by a development reload during shortcut-help edits and was restarted after those edits were finished. A unit run concurrent with browser tests hit three existing CPU-heavy sketch-test timeouts; the final unit result above is from the isolated rerun.

## Deferred to v0.5.2.6+

Interpolation/easing and per-key stepped/smooth editing UI, tangent/curve editing, events/event markers, onion skinning, ghost poses, mirrored pose/keyframe operations, IK target animation authoring and baking, transform drag handles, time stretching, and the final production animation import/export workflow beyond the existing JSON download remain deferred.
