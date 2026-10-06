# v0.5.2.5.1 — Multi-key selection foundation

Verification date: October 7, 2026. Package version: `0.5.2-5.1`. All three required commands passed.

## Implemented

The existing editor now supports multiple key references, primary selection, Ctrl/Cmd toggles, Shift ranges, a cross-track marquee, selected/primary marker visuals, inspector synchronization, Escape clearing, animation-switch clearing, mutation reconciliation and one-transaction multi-delete. Runtime preview, immutable source ownership, validation, snapping, single-key movement and existing snapshot history remain in use. No dependencies or authored JSON fields were added.

## Selection model

`KeyframeSelectionState` contains an immutable `selectedKeys` array and `primaryKey`. Each reference has `boneId`, `property` and canonical time in editor seconds; marker values and DOM identity are excluded. The array is deduplicated and frozen, as are its references. The primary always belongs to the array, or is null when it is empty. Primary context controls the existing bone/property inspector while the timeline may retain keys across unrelated tracks. `selectedKeyframe` remains a compatibility getter for the primary.

Selection, expansion and gestures remain transient. They do not change authored data, dirty state, history or serialization. Bone/property navigation and successful animation switching clear the set; failed switching preserves it. Collapse retains hidden selection.

## Modifier behavior

- Normal click replaces selection, makes the clicked key primary and seeks its canonical time. A normal drag selects and moves only that clicked key.
- Ctrl or Cmd toggles the clicked key. The existing primary survives where possible; removing it chooses the first survivor in selection order. Adding to an empty set makes that key primary. All additive/toggle operations leave currentTime held, including fallback primary changes.
- Shift selects every key in the inclusive same-property-track range from the retained anchor. Repeated Shift-clicks retain the anchor while it survives. On another track, Shift adds the clicked key. Shift makes the clicked key primary and seeks once. Ctrl/Cmd+Shift unions the range with the existing set.
- Empty-lane click clears keys and seeks while retaining bone/property context; Ctrl/Cmd-empty click preserves keys and time. Escape cancels an active drag/rectangle first, otherwise clears keys. Typing and IME guards remain intact.

Key selection and marquee start pause playback without automatic resume. Ruler dragging retains the existing scrub/resume behavior. Multi-key arrow nudging is disabled; explicit `moveSelectedKeyframe()` moves only the primary and preserves surviving secondary references.

## Marquee selection

Dragging empty bone/property lanes creates a transient rectangle. Selection commits on release, using marker centers within inclusive time and visible-row bounds. Normal marquee replaces selection; Ctrl/Cmd marquee unions it. A surviving primary is retained. Otherwise replacement picks the first included key in visible track/key order and seeks once. Additive marquee never seeks. Collapsed property rows have no visible markers and are excluded.

The start time uses `timelineXToTime()` and is converted back with `timeToTimelineX()` as the width changes. Vertical coordinates are relative to the timeline content; fresh timeline/lane rectangles account for horizontal and vertical scrolling. Resize and scroll events update the rectangle. There is no timeline zoom control in this project; the same measured-width conversion is reused rather than introducing another time scale.

Escape, pointer cancellation, lost capture, window blur, hidden document, animation/session switching, layout changes and authored mutations discard the rectangle and release capture. Cancellation preserves the previous selection. No authored mutation occurs during the gesture.

## Selection reconciliation

`reconcileKeyframeSelection()` centrally resolves all references against the working animation using the existing `findBonePropertyKeyframe()` tolerance policy. It removes missing references, canonicalizes tolerated time changes, deduplicates results and retains a valid primary or selects the first survivor. Exact comparisons are only between already canonical references, preserving distinct authored times closer than tolerance.

All installed authored snapshots and history restorations reconcile selection before notifying preview/UI listeners. Explicit primary movement remaps its reference to the canonical destination; collision results deduplicate. Exact removed references are dropped before reconciliation so deletion cannot redirect them to a nearby surviving key. Value-only edits retain references. Removing unrelated/secondary keys preserves pending inspector drafts when primary context is unchanged.

## Multi-delete/history behavior

The plural deletion command runs the existing immutable property-removal API for each selected reference and installs the validated result once. One deletion records one history snapshot, clears selection and refreshes the existing preview and markers. Sparse sibling properties, unrelated keys/events, caller data and source snapshots remain intact. Undo restores all deleted authored keys; Redo removes them again. History reconciles current selection but does not restore previously cleared transient selection. Selection operations preserve redo branches.

## Files changed

- `src/devtools/animation-editor/keyframeSelection.ts`: reusable reference resolution, comparison, reconciliation, marquee query and selection types.
- `src/devtools/animation-editor/AnimationEditorSelection.ts`: frozen selection set, primary context, range anchor and mutation remapping.
- `src/devtools/animation-editor/AnimationEditorState.ts`: selection commands/getters, atomic multi-delete, primary movement and single-key nudge guard.
- `src/devtools/animation-editor/TimelineInputController.ts`: modifiers, marquee pointer capture/geometry/cancellation and Escape handling.
- `src/devtools/animation-editor/TimelineController.ts`: resize and session lifecycle integration.
- `src/devtools/animation-editor/TimelineTracksController.ts`: all-selected and primary marker states, keyboard activation modifiers.
- `src/devtools/animation-editor/TimelineSessionController.ts`: plural deletion and button availability.
- `src/devtools/animation-editor/main.ts`, `style.css`: controls help, plural deletion label, primary/marquee visuals.
- `tests/animationEditorMultiSelection.test.ts`, `tests/browser/animationMultiSelection.spec.ts`: state and browser regression coverage.
- `tests/browser/animationEditor.spec.ts`, `animationKeyframeMarkers.spec.ts`: scrub tests now begin on the ruler, leaving lanes for marquee selection; the loop-observation deadline allows slow browser rendering.
- `README.md`, `docs/animation-editor.md`, this report: current behavior and verification documentation.
- `package.json`, `package-lock.json`: milestone version.

The supplied plan file was already untracked and is preserved.

## APIs/types changed

Editor-only additions: `KeyframeSelectionState`, `KeyframeSelectionModifiers`, `KeyframeMarquee`, `sameKey()`, `resolveKey()`, `reconcileKeyframeSelection()`, `keysInMarquee()`; state getters `selectedKeys`, `primaryKey`; methods `selectKeyframes()`, `selectKeyframeMarquee()`, `deleteSelectedKeyframes()`; optional modifiers on `selectKeyframe()`. Existing `KeyframeSelection`, `selectedKeyframe`, single-key movement and plural-compatible `deleteSelectedKeyframe()` remain usable. Engine exports, external schemas and runtime APIs are unchanged.

## Tests

Nine new state tests cover replacement selection, toggles, deterministic primary fallback, immutable/clean selection, range anchoring/cross-track fallback, reverse/inclusive marquee bounds, multi-track union, clear/navigation/switch behavior, failed switching, collapse retention, value edits, canonical normalization, deleted/moved references, near-tolerance distinct keys, primary time movement, deferred group nudge, atomic deletion/history, sparse siblings, source/caller immutability, events, redo preservation and inspector draft retention.

Four new browser scenarios exercise normal/Ctrl/Cmd/Shift selection, visual/inspector context, empty click, Escape, playback pausing, animation switching, multiple-track marquee, one-step Delete/Undo/Redo, real horizontal/vertical scrolling, resize during a gesture and interruption cleanup. Existing animation editor, authoring, marker, movement and track scenarios cover preview, playback/scrubbing, validation, drafts, IK/facing and development/production routes.

## Manual verification

Automated Chrome pointer/keyboard interactions use root X/Y and torso rotation keys across two bones. Selection screenshots were inspected for contrasting secondary markers, a stronger primary outline and row/playhead alignment. No separate hands-on user session is claimed. Browser captures are saved under `test-results/`.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0 — 65 files passed, 3 skipped; 1,086 tests passed, 27 existing skips.
- `npm run build`: passed, exit 0 — demo and library bundles/declarations produced; built `/core` smoke check passed.
- `npm run check`: passed, exit 0 — formatting, lint and typecheck.
- `npm run check:version`: passed, exit 0 — valid SemVer `0.5.2-5.1`.
- `git diff --check`: passed, exit 0.
- Chrome movement/track/initial-selection browser run: 22 checks passed across development and production.
- Chrome editor/authoring/marker/final-selection browser run: 69 checks passed initially; three production cases required follow-up. The existing loop-observation deadline was extended from 5 to 15 seconds to allow slower rendering while still requiring three observed wraps. The held-scrub and scrolled-marquee cases passed unchanged on a focused rerun. Final focused verification of all three cases passed against both routes: 6 passed, exit 0.

Together these runs verified 88 distinct development/production browser cases. The broader run exposed intermittent pointer-related browser failures; the focused final verification passed.

## Deferred to v0.5.2.5.2+

Copy/paste, duplication, group dragging/nudging, mirrored copying, cross-track paste mapping, interpolation editing, event markers/authoring, onion skinning, ghost poses and IK target authoring remain deferred.
