# v0.5.2.7.1 — Animation Event Model, Track & Selection

## Implemented

Implemented `plans/archive/plan-v0.5.2.7.1.md`: centralized event queries and immutable authored mutations, a separate Events timeline row, event markers, exclusive single-event selection, clock/preview synchronization, and a read-only event inspector. Package version is `0.5.2-7.1`; dependencies and engine behavior are unchanged.

## Existing event schema

`AnimationClip.events?: readonly AnimationEvent[]` is the runtime representation. Each event has `time: number` in milliseconds, `name: string`, and optional `data?: unknown`. The external JSON definition narrows payloads to JSON values through `AnimationJsonEvent.data?: JsonValue`. Version 1 file validation accepts only these event fields, requires a finite time within `[0, duration]`, and validates the name with the existing identifier schema. It distinguishes omitted data from explicit JSON `null` and rejects non-JSON payloads.

Event timestamps are not unique and authored arrays need not already be sorted. Compilation stably sorts events by time. Editor mutations reuse the strict file parser and rig validation, then stably sort the resulting authored array; existing same-time relative order is preserved. Duration must remain positive under the authoritative schema. Zero-duration/invalid definitions therefore show existing validation diagnostics and leave the held valid animation or an empty editor intact.

## Event identity/reference strategy

`AnimationEventRef` is an opaque frozen editor object with a unique symbol token. A WeakMap stores an ordered reference array beside each event array. Each occurrence gets its own reference, even if timestamps, names, payloads, or event objects are identical. References are resolved within the current authored snapshot, never through DOM elements, names, or timestamps alone.

The pure mutation helpers transfer surviving references to the new sorted array. Updating time/name/data preserves identity; adding creates a fresh reference; removing drops only the exact reference. History owns immutable animation snapshots and therefore retains their event sidecars through Undo/Redo. Unrelated key/settings edits share the unchanged event array. Importing replacement JSON intentionally creates fresh references; stale selection clears rather than guessing which identical event was imported. References are never added to JSON or the runtime schema, and do not survive reloading the editor.

## Event track architecture

`buildEventTimelineTrack()` produces a cached immutable `EventTimelineTrack` with `TimelineEventMarker` entries containing `ref`, `time` in editor seconds, `name`, and `stackIndex`. It reads only authored event data and remains independent of DOM/Phaser. Mutable inputs are not cached. The original bone/property row model is unchanged.

`EventTrackController` owns the separate label/lane and reconciles buttons by event reference. `TimelineTracksController` places it before bone/property rows and retains surviving DOM nodes during playback, selection, and history. Marker centers use the existing `timeToTimelineX()` conversion for resizing and endpoints. Titles and accessible names show authored names/times. Key marquee geometry explicitly excludes the event lane when calculating bone/property row indices.

## Selection architecture

`AnimationEditorSelection` owns one transient event reference alongside the existing key selection. Selecting an event clears keys, bone/property context, and transform drafts. `AnimationEditorState.selectAnimationEvent()` validates the reference, cancels key dragging, pauses playback, ends scrubbing, updates the authoritative clock, and notifies preview/UI subscribers. Selecting a key (including additive/range/marquee commands), bone, or property clears the event. Invalid event references preserve held state. Empty-area clicks and Escape clear timeline selection; navigation/playback retain a valid event selection without forcing time back.

Selected event buttons use `aria-pressed` and a distinct color. `EventInspectorController` renders read-only Time, Name, and Data only when present using text content. Selection/inspector/navigation do not install snapshots, dirty the animation, record history, or invalidate redo. Mutations reconcile surviving references without seeking; deletion or undoing event creation clears missing selection. History never resurrects a cleared transient selection.

The existing pose-only preview remains authoritative. Event selection, scrubbing, playback, restarts, loops, initialization, and recompilation do not dispatch authored runtime callbacks. No event dispatcher or sampling semantics were changed.

## Same-time event handling

Every event occurrence remains independent. Stable sorting preserves ties, adds append after existing equal-time events, and time updates never overwrite another event. Same-time marker buttons stack in 30-pixel rows at exactly the same X coordinate. Label/lane heights grow together to keep every button clickable while preserving ruler alignment and the existing scroll container. Event markers never participate in key collision, dragging, nudge, deletion, or clipboard controls.

## Files changed

- `src/devtools/animation-editor/animationEvents.ts`: pure queries, references, immutable mutation foundations, event marker/track model.
- `AnimationEditorSelection.ts`, `AnimationEditorState.ts`: transient selection, reconciliation, clock coordination, and programmatic document/history integration.
- `EventTrackController.ts`, `TimelineTracksController.ts`: dedicated event row and button reconciliation.
- `EventInspectorController.ts`, `TimelineController.ts`, `editorMarkup.ts`, `style.css`: read-only authored inspector, rendering, and marker styling.
- `TimelineInputController.ts`: exclusive selection clearing and event-independent key marquee geometry.
- `tests/animationEditorEvents.test.ts`: event model, mutation, selection, validation, identity, history, and ownership regressions.
- `tests/animationEditorPreview.test.ts`: event selection at start/middle/end updates poses without event callbacks.
- `tests/browser/animationEvents.spec.ts`: event track, same-time markers, endpoint alignment, inspector, keyboard/pointer selection, and existing editor workflows.
- `package.json`, `package-lock.json`, `README.md`, `docs/animation-editor.md`, this report: milestone version and documentation.

The supplied plans are unchanged. No engine, schema, library export, or dependency changes.

## APIs/types changed

New editor-only pure APIs: `getAnimationEvents()`, `getAnimationEventReferences()`, `getEventsAtTime()` (authored milliseconds), `findAnimationEvent()`, `addAnimationEvent()`, `updateAnimationEvent()`, `removeAnimationEvent()`, and `buildEventTimelineTrack()`. Mutation helpers accept an animation and rig, return an immutable authored snapshot, reject invalid input atomically, and leave caller/source data unfrozen and unchanged. Updating replaces the complete event record; omission removes optional data.

New types: `AnimationEventRef`, `TimelineEventMarker`, and `EventTimelineTrack`. State exposes `selectedEvent`, `selectedEventData`, `eventTimelineTrack`, `selectAnimationEvent()`, `clearEventSelection()`, and `clearTimelineSelection()`. Programmatic state `addAnimationEvent()`, `updateAnimationEvent()`, and `removeAnimationEvent()` install validated working snapshots through the existing document/history boundary. There are no event editing controls in this version.

## Tests

Seven added pure/state tests cover millisecond queries, identical same-time event references, stable ordering, JSON compatibility, deep payload ownership, source immutability, unsafe descriptors/cyclic data rejection, endpoint marker coordinates, cached row identity, exclusive selection, atomic time/pause changes, invalid references, dirty/history behavior, movement/removal references through Undo/Redo, and empty/invalid/zero-duration states.

The existing preview callback regression now explicitly selects every start/middle/end event while playing/scrubbing, verifies the sampled pose, and observes zero event dispatches. It also verifies ordinary runtime callbacks still fire for the same caller-owned clip outside the editor.

Three browser scenarios run against both development and production URLs. Related existing track alignment, key dragging/snapping, and multi-selection/marquee scenarios verify that the event row preserves keyframe workflows.

## Manual verification

The automated browser pass uses events at 0, 0.5 (two independent events), and 2 seconds. It verifies the separate row, endpoint and resize alignment, same-time stacking and clicks, pause/seek/playhead/preview updates, inspector fields, keyboard activation, exclusive event/key selection, clean navigation/history state, playback, and key authoring/undo. The timeline screenshot was visually reviewed: stacked circles remain separate, endpoint centers align with the ruler, and the selected event/inspector are visible. A separate hands-on manual pass has not been performed. Callback suppression is verified through the real preview/runtime integration test.

For a manual pass, load an animation containing events at 0, duration, and two at one intermediate time. Check the separate Events row, ruler alignment after resizing, individually clickable stacks, single selected styling, playhead/preview movement, read-only inspector values, mutual exclusion with key selection, clean dirty/history state, and working key editing/playback/scrubbing. Preview callback suppression is asserted in integration tests.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 77 files passed and 3 skipped; 1,276 tests passed and 28 skipped. Existing skip policy is unchanged.
- `npm run build`: passed, exit 0; production demo/library bundles, declarations, and Node `/core` smoke check passed.
- `npm run lint`: passed, exit 0.
- `npm run check:version`: passed, exit 0; `0.5.2-7.1` is valid SemVer.
- Formatting checks for changed files and `git diff --check`: passed, exit 0.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEvents.spec.ts tests/browser/animationMultiSelection.spec.ts tests/browser/animationKeyframeMovement.spec.ts tests/browser/animationTimelineTracks.spec.ts`: passed, exit 0; all 32 targeted development/production scenarios passed (3.5 minutes).

Browser checks used Chrome with the configured single worker on development and production URLs. The sandbox initially prevented the test server from binding port 4173; approved execution outside the sandbox allowed localhost/Chrome verification. One initial production navigation returned 404 while a concurrent build replaced generated assets. The entire targeted browser set then passed with the completed production build held fixed; no application assertion or timeout was weakened. The complete browser suite was not run for this milestone.

## Deferred to v0.5.2.7.2+

Create-event UI, editable event inspector, event dragging/nudging, copy/paste/duplication, multi-selection, payload JSON editing, playback debug logs, and further event-preview semantics. Onion skinning, ghost poses, mirrored key operations, and IK-target authoring remain deferred. Runtime events and crossfade/loop dispatch were not redesigned.
