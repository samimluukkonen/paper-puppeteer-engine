# v0.5.2.4.2 — Keyframe markers and selection

## Implemented

Authored property keys appear as diamonds on expanded timeline tracks. A single selected key coordinates bone/property selection, pauses playback, cancels drafts, and seeks the existing playhead/preview. Selected diamonds have a contrasting visual state. Selected-key deletion is available through a button and guarded Delete/Backspace shortcuts. Previous/Next Key navigate the selected property. Package version: `0.5.2-4.2`.

## Marker architecture

`buildTimelineTracks()` projects authored sparse rows from `workingAnimation` into frozen `PropertyTimelineTrack.keyframes`. Each `TimelineKeyframe` contains `boneId`, `property`, `time` in editor seconds, and authored `value`. Missing properties, time-only rows, bind poses, evaluated poses, and event data never create property markers. No separate animation copy is maintained.

The existing row cache invalidates when the working snapshot or expansion changes. Inspector mutations, settings replacements, and history restoration therefore refresh marker data immediately. Playback and scrubbing retain row/marker identity. `TimelineTracksController` reconciles key buttons by canonical authored time within each bone/property row, preserves surviving elements, and positions marker centers with `timeToTimelineX()` using the same measured width and duration as ruler/playhead. Resize repositions markers. A small right gutter keeps endpoint diamonds visible.

## Keyframe selection architecture

`AnimationEditorState` owns one frozen `KeyframeSelection` containing bone, property, and continuous seconds. `selectKeyframe()` resolves through the existing centralized millisecond tolerance query before storing the canonical authored time. Invalid targets preserve held state. Bone/property selection, pause, seek, expansion when needed, and draft cancellation happen before one notification; the existing inspector and preview subscriptions remain authoritative.

Selecting another key replaces selection. Bone/property label navigation and successful animation switching clear it. Collapse retains it. Dragging, keyboard time navigation, and playback retain it without forcing time back. A click on empty timeline space clears only key selection while seeking. Marker pointer-down does not start a scrub; native button focus and Enter/Space activation remain available. Selection is neither dirty, authored history, nor serialized data. No persistent key IDs or external JSON fields were added.

## Deletion/history behavior

`deleteSelectedKeyframe()` pauses, cancels drafts, and calls the existing `removeBonePropertyKeyframe()` mutation API at the selected authored time. It preserves current time after scrubbing, unrelated keys/properties/events, and immutable source/caller data. A changed animation records exactly one snapshot history operation and updates dirty state, preview, keyed indicators, and marker data. The removed selection clears before notification, including when another distinct authored time is within tolerance.

Working replacements and history restoration validate remaining selection with the same key-time query. Missing keys clear it; tolerated replacement time changes canonicalize it without seeking. Undo restores the deleted marker and preview but does not restore transient selection. Redo removes the marker and clears a selection made after Undo. Keyboard deletion ignores typing controls, content-editable regions, modified commands, repeated keydowns, and IME composition; ordinary Backspace outside typing controls is prevented from navigating browser history.

## Files changed

- `src/devtools/animation-editor/timelineTracks.ts`: marker and selection types; immutable authored marker model.
- `src/devtools/animation-editor/AnimationEditorState.ts`: single-key selection, validity, selected deletion and adjacent navigation.
- `src/devtools/animation-editor/TimelineTracksController.ts`: reconciled key buttons, selection visuals and shared coordinates.
- `src/devtools/animation-editor/TimelineController.ts`: marker geometry integration, click/drag selection behavior, commands and shortcut guards.
- `src/devtools/animation-editor/main.ts`, `style.css`: command buttons, marker accessibility, help text and styling.
- `tests/animationEditorKeyframeSelection.test.ts`: marker/selection/mutation/history regressions.
- `tests/animationEditorTracks.test.ts`: existing row expectations extended with marker data.
- `tests/animationEditorPreview.test.ts`: key selection and delete/Undo/Redo preview regression.
- `tests/browser/animationKeyframeMarkers.spec.ts`: marker geometry, selection, navigation, deletion safety and inspector integration.
- `docs/animation-editor.md`, this report: usage, architecture, API and verification documentation.
- `package.json`, `package-lock.json`: milestone version.

## APIs/types changed

- Added `KeyframeSelection` and `TimelineKeyframe`; both use seconds.
- Added immutable `PropertyTimelineTrack.keyframes`.
- Added `AnimationEditorState.selectedKeyframe`, `selectKeyframe(selection)`, `clearKeyframeSelection()`, `deleteSelectedKeyframe()`.
- Added `getAdjacentKeyframe(-1 | 1)` and `selectAdjacentKeyframe(-1 | 1)`.
- `selectBone()`, `selectTimelineProperty()`, and successful `selectAnimation()` clear key selection.
- `TimelineTracksController.render(state, width)` now takes the shared measured timeline width.

All changes are editor APIs. Runtime exports, JSON schemas, keyframe mutation signatures, and centralized tolerance remain unchanged.

## Tests

Ten new pure tests cover authored marker times/values, sparse property presence, immutable model/source data, endpoint coordinate conversion, atomic selection, clean/history/redo preservation, invalid targets, centralized tolerance and distinct nearby keys, selected deletion after scrubbing, one history operation, unrelated property preservation, immediate inspector mutation refresh, Undo/Redo validity, working replacement canonicalization, coordinated navigation, stationary playback markers, retained scrub selection, and adjacent navigation.

The preview regression verifies immediate key seeking, deletion at a retained selected time after scrubbing, and Undo/Redo pose refresh through the existing runtime evaluator. Four new browser scenarios run against development and production, covering actual geometry/resize/endpoints, native keyboard activation, selected styling and inspector state, preview artwork, play/pause, stationary markers, scrub retention, empty clicks, adjacent commands, guarded shortcuts, exact deletion history, and marker creation/update/removal through the existing inspector.

## Manual verification

Automated Chrome interactions verified inspector creation/update/deletion at zero, middle and duration; marker selection, coordinated bone/property/playhead/inspector/preview updates; selected deletion after scrubbing; Undo/Redo; stationary playback markers; retained scrub selection; empty-click clearing; adjacent navigation; resize geometry; and shortcut safety. Desktop marker and narrow timeline screenshots were inspected: marker centers align with ruler/playhead coordinates, endpoint diamonds are visible, selection is distinct, and rows remain aligned. No separate hands-on browser session is claimed. The browser suites generate captures under `test-results/` when run.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 1,027 tests passed, 26 optional profiling tests skipped (19 per-frame, six renderer, and one Rig Editor overlay). Profiling requires `VITE_PROFILE=1`; two files consist entirely of profiling tests, while the overlay profile is in an otherwise executed test file.
- `npm run build`: passed, exit 0; demo, library, declarations and Node `/core` smoke check succeeded.
- `npm run lint`: passed, exit 0.
- Formatting checks and `npm run check:version`: passed, exit 0.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationKeyframeMarkers.spec.ts tests/browser/animationTimelineTracks.spec.ts tests/browser/animationBoneAuthoring.spec.ts tests/browser/animationEditor.spec.ts`: 70 scenarios verified across development and production. The initial run passed 67; three affected development scenarios passed with the same command plus `--last-failed` (exit 0). Two selector collisions were fixed by keeping bone/property DOM metadata on lanes and making the new lane selector explicit. The existing empty-animation reload case passed on rerun and on its production run.

A concurrent unit rerun timed out in an unrelated existing demo test while Chrome was active. The final full unit run above passed after Chrome stopped; no timeout configuration or unrelated demo code was changed.

## Deferred to v0.5.2.4.3+

Key dragging/movement, multi-key/box selection, copy/paste, duplication, keyframe groups, event markers, interpolation editing, onion skinning and mirrored key operations remain deferred. No additional authoring workflows were introduced.
