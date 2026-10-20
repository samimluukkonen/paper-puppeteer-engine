# v0.5.2.7.2 — Event Authoring, Editing & Movement

## Implemented

Implemented `plans/archive/plan-v0.5.2.7.2.md` using the existing event schema, mutation API, stable session references, document history, event track and timeline coordinate/snapping policy. Package version is `0.5.2-7.2`. No dependencies or runtime formats changed.

## Event authoring workflow

- Scrub to a time and click **+ Event**. The event uses `currentTime`, pauses playback, selects the new reference and focuses its required neutral default name `event` for immediate editing.
- Edit Time (seconds), Name, or optional Data. Time and Name commit on blur/Enter; JSON commits on blur or Ctrl/Cmd+Enter. Plain Enter in JSON adds a newline. Escape restores the inspector drafts.
- Delete with **Delete Event** or Delete/Backspace outside typing controls. Only the selected reference is removed; selection clears and surviving markers refresh immediately.
- Empty/unselected sessions disable creation and hide the event inspector.

## Payload handling

Data is parsed as JSON, then passed through existing strict animation/event validation before ownership. Blank text removes optional `data`; explicit `null` remains present. Invalid JSON, nonfinite JSON numbers, undefined values, functions, Maps, Sets, cyclic data and unsupported event fields cannot enter the working animation. Failed commits retain text for correction and report validation errors. No JSON editor dependency was added.

## Event movement/snapping

Pointer movement reuses `timelineXToTime` and `timeToTimelineX`. One provisional `EventDrag` stores the original time and preview event; marker position, inspector and playhead follow it without changing committed data or exports. Pointer release installs one validated snapshot changing only time. Escape, pointer cancellation/capture loss, window blur, hidden documents, disposal, navigation, history and authored changes cancel the provisional movement. Inspector focus transitions complete before a new drag starts, allowing pending blur edits to commit safely.

Time is bounded to 0…duration. Shared Frame snapping uses authored stepped FPS or the existing smooth fallback of 10 FPS; None uses continuous time. Shift during dragging bypasses snapping. Arrows nudge one frame or 0.01 s according to the same policy; Shift nudges ten steps. Inputs retain native editing. Ruler arrows and Home/End navigate without moving selected events.

## Same-time event behavior

Time equality never causes replacement. Distinct and identical events retain separate stable references; committed equal-time markers stack in authored order. Movement preserves name/data and unrelated events. No-op field commits or marker clicks preserve the original event-array order, including valid unsorted imported lists, without recording history or marking dirty. Unchanged fractional millisecond timestamps are preserved exactly across seconds display/commit boundaries.

## History/dirty behavior

Create, edit, delete and move install immutable validated working snapshots, with one history entry per logical operation. Drag previews and text keystrokes stay transient. No-op edits create no history entry. Undo/Redo restores exact authored snapshots, including payload presence and order. Surviving selected references follow time changes and sorting; history does not restore a cleared transient selection. Source animation and caller inputs remain unchanged. Selecting, inspecting, scrubbing and playback controls never dirty authored data.

## Files changed

- `src/devtools/animation-editor/AnimationEditorState.ts`: authoring commands, provisional movement, shared-policy nudging and gesture cancellation boundaries.
- `src/devtools/animation-editor/animationEvents.ts`: validated no-op updates preserve unsorted authored snapshots.
- `src/devtools/animation-editor/EventInspectorController.ts`: local text drafts, commits, validation feedback, creation/deletion and listener disposal.
- `src/devtools/animation-editor/EventTrackController.ts`: marker pointer adapter and preview positions.
- `src/devtools/animation-editor/TimelineInputController.ts`: event capture lifecycle, shared conversion, shortcuts and cancellation.
- `src/devtools/animation-editor/TimelineTracksController.ts`, `TimelineController.ts`: event drag wiring, rendering and inspector disposal.
- `src/devtools/animation-editor/editorMarkup.ts`, `style.css`: controls, accessible labels/help, JSON textarea and movement cursor.
- `tests/animationEditorEventAuthoring.test.ts`, `animationEditorEventInspector.test.ts`, `animationTimelineControllerLifecycle.test.ts`, `browser/animationEvents.spec.ts`: authoring and regression coverage.
- `README.md`, `docs/animation-editor.md`, this report: workflow and API documentation.
- `package.json`, `package-lock.json`: milestone version.

## APIs/types changed

Added editor-only `EventDrag` and `AnimationEditorState.createAnimationEvent()`, `deleteSelectedEvent()`, `setSelectedEventDataJson(text)`, `eventDrag`, `beginEventDrag(ref)`, `previewEventDrag(seconds, disableSnapping?)`, `commitEventDrag()`, `cancelEventDrag()`, `moveSelectedEvent(seconds)` and `nudgeSelectedEvent(direction, large?)`. `selectedEventData` presents provisional time during dragging; `workingAnimation` and export remain committed.

`EventInspectorController(app, getState)` now owns editable controls and `dispose()`. `TimelineInputController.beginEventDrag()` shares the existing pointer lifecycle. `TimelineTracksController` accepts an optional event-pointer callback; its event controller uses it to begin movement. Engine schema/types/exports remain unchanged.

## Tests

Unit coverage checks creation at currentTime, source/caller immutability, dirty state, exact Undo/Redo, supported-field preservation, payload validation/removal/null, selected-only deletion, bounds, same-time events, stable selection, shared snapping/nudging, provisional exports, no-op unsorted lists, cancellation, field blur transactions, native-input shortcut guards, pointer identity/capture/disposal and inspector-focus drag transitions.

Browser coverage exercises marker alignment/resizing, event/key selection, clean navigation, preview/playback/key-edit regression, creation at 0.75 s, immediate marker/inspector synchronization, name/time/JSON commits, validation correction, same-time stacks, drag/playhead snapping and bypass, keyboard nudging, cancellation, boundary movement and deletion Undo/Redo in development and production.

## Manual verification

The browser scenarios perform the plan's user interactions automatically in Chrome. A separate human manual pass was not performed. Marker/preview screenshots and failure-only traces are written under ignored `test-results/`.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 79 files passed, 3 skipped; 1,288 tests passed, 28 existing skips.
- `npm run build`: passed, exit 0; demo, library, declarations and Node core check succeeded.
- `npm run lint`, `npm run format:check`, `npm run check:version` and `git diff --check`: passed.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEvents.spec.ts tests/browser/animationKeyframeMovement.spec.ts`: passed, exit 0; all 22 development/production scenarios passed against the final build.

An earlier browser pass caught unchanged-event sorting and an inspector-blur/drag lifecycle issue; both were fixed with unit regressions. All event scenarios then passed in development and production. One additional production keyframe drag test failed transiently on that pass; it passed three consecutive isolated reruns without changes to keyframe authoring. The final combined browser run passed all 22 cases against the completed build.

## Deferred to v0.5.2.7.3+

Event multi-selection, marquee selection, copy/paste, duplication and group movement; firing events during scrub, runtime event debugging, onion skinning, ghost poses and IK target authoring.
