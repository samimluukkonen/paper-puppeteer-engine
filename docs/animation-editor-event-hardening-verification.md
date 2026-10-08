# v0.5.2.7.3 — Event Copy/Paste, Playback Semantics & Hardening

## Implemented

Implemented `plans/plan-05-02-07-03.md`, completing the v0.5.2.7 event-authoring milestone. Package version is `0.5.2-7.3`. Added single-event copy/paste/duplicate, typed clipboard routing, runtime-compatible playback notifications, exact event-boundary clocks, catch-up safety, serialization/validation regressions and editor regression coverage. No dependency, JSON schema or production package export changes.

## Final event data model

The existing authored record remains `{ time: number, name: string, data?: unknown }`. Time is milliseconds; file/editor data must be supported JSON. There is no separate event `type`, authored ID or uniqueness rule. Optional payload absence and explicit `null` are distinct. Equal-time and identical records remain legal independent events. Opaque symbol references remain sidecars keyed by immutable event arrays and never serialize.

## Event timeline/editor architecture

The existing `animationEvents.ts` mutation API owns validation, JSON ownership, immutable arrays, stable references and stable timestamp sorting. Event tracks derive markers from those arrays; same-time markers stack with a shared X coordinate. DOM controllers own only gestures and field drafts. Timeline conversions and snapping remain shared with keyframes.

One `TimelineClipboard` replaces the keyframe command owner's private storage. Its discriminated content is either `{ kind: 'keyframes', data: KeyframeClipboard }` or `{ kind: 'event', data: EventClipboard }`. Existing keyframe mutation/clipboard helpers remain unchanged. Event cloning uses the runtime `copyAnimationEvent()` ownership helper; insertion uses `addAnimationEvent()` and retrieves the new sidecar identity.

Event projections cache only validated immutable snapshots. Mutable caller inputs are revalidated on every use, so edits or newly invalid timestamps cannot hide behind cached results.

The sole editor clock stores authored milliseconds internally and exposes seconds for navigation/UI. Event traversal uses that exact held clock, avoiding repeated seconds/milliseconds round trips: a 0.3 s start plus 0.6 s update reaches the 900 ms marker exactly, without firing it again on the following tick. Event and key marker navigation seek using their authored millisecond timestamps. Pose preview still uses silent runtime sampling and never dispatches through its pose-only player, including initialization/recompilation. A separate cached event-only compiled projection feeds the existing runtime traversal functions; it contains no alternate crossing algorithm.

## Event authoring workflow

Scrub and click **+ Event**, then edit Name, Time or Data. Fields commit using the existing blur/Enter rules. Select one event to copy or duplicate. Buttons change to **Copy Event**, **Paste Event** and **Duplicate Event** according to selection and clipboard content. Ctrl/Cmd+C/V/D apply in timeline context; inputs, textareas, selects, inherited content-editable targets and IME input retain native behavior. Copy and duplicate use committed authored data even when a gesture has a provisional preview.

Selecting an event clears keys. Selecting keys clears the event. Paste routes by the last copied content, independently of the current selection, and selects its newly authored event or keys. There is no event multi-selection or ambiguous double paste.

## Payload handling

Copy owns a detached frozen authored record with exact name, timestamp and optional nested JSON payload. Paste changes only time. Duplicate shares the same clone/paste helper. The ordinary strict destination validator rejects invalid JSON values, missing fields, unsupported extra fields, invalid timestamps and malformed names. No editor/DOM objects or references enter the clipboard or exported data. Payload absence, explicit null, arrays, objects, precise numbers and escaped text round-trip through history and the existing serializer.

## Movement/snapping

Existing event dragging, inspector time edits, cancellation and keyboard nudging remain unchanged in behavior. Shared Frame snapping uses stepped authored FPS or the smooth fallback of 10 FPS; None uses continuous movement. Shift-drag bypasses snapping and Shift-arrows move ten steps. Inspector movement clamps to duration and preserves unchanged fractional authored milliseconds. No timeline-coordinate implementation was duplicated.

## Clipboard behavior

Copy is transient: no mutation, history operation, dirty change, seek or selection change. Paste creates a new event at the exact held playhead time and validates against the destination animation. Compatible animation switches retain the clipboard. Timestamp equality never replaces an event, including identical same-time records.

Duplicate retains the user's clipboard and playhead. Stepped animations use one authored frame; smooth clips use the existing nudge step (0.01 s with None, 0.1 s with Frame). Forward duplication clamps to duration; duplication of an endpoint event steps backwards. Very short clips still choose a distinct valid time. When floating-point precision prevents a distinct destination, duplicate returns false instead of stacking unintentionally.

## Runtime playback semantics

- **Normal playback:** `advanceAnimationTime()`, `countAnimationEvents()` and `collectAnimationEvents()` remain authoritative. Crossings use an exclusive previous bound and inclusive new bound, independent of stepped pose sampling. Held/render frames do not repeatedly emit nearby markers.
- **Looping:** preview-loop preference overrides only the event projection's loop flag. Traverse the unwrapped interval before wrapping the clock, including the tail, zero/end boundary and head. Whole-cycle updates still dispatch events when wrapped time is unchanged.
- **Large delta:** collect every crossing, including multiple full loops. The shared runtime 10,000-event limit and safe cycle bounds reject excessive catch-up before time, event delivery or authored history changes. Errors use editor diagnostics. Huge nonlooping deltas safely clamp to the endpoint; event-free loops retain finite overflow fallback behavior, including positive millisecond durations whose seconds representation underflows.
- **Same-time events:** all markers dispatch in deterministic runtime order. Runtime compilation sorts by authored time; stable crossing sorting retains that order. When a zero marker for the next cycle and a duration marker for the previous cycle coincide, the runtime's zero-before-duration order is preserved.
- **Restart:** initial Play at zero, Play after nonlooping completion, and explicit Restart while playing each emit zero-time markers once. Repeated Play and pause/resume do not repeat them, including pause/resume at a wrapped zero. Paused Restart/Home only navigates; the next Play consumes one start. Restart during a scrub stays silent.
- **Scrubbing/navigation:** scrubbing, ruler navigation, clicking playhead/markers, manually setting time, key/event selection, edits, recompilation and Undo/Redo cause zero event callbacks. Scrub release resumes from the scrubbed time without replaying intervening markers or emitting zero-time starts.

`state.onAnimationEvent(listener)` returns an unsubscribe function. Events use the existing `FiredAnimationEvent` shape, with clip name and layer `base`. Delivery follows state subscribers, so the held preview pose is synchronized first. Both runtime player and editor reuse `dispatchAnimationEvents()`, which snapshots listeners, copies JSON payloads per listener, completes other notifications after a listener fails, and returns errors for the existing aggregate-error handling. The runtime event model was not redesigned and no game/story-specific side effect was added.

## History/dirty behavior

Paste and Duplicate each install exactly one validated snapshot, pause playback and select the new event. Undo removes it; Redo restores the exact snapshot, including metadata/payload presence and deterministic array order. Surviving identities reconcile; deletion/Undo of the selected event clears selection safely, and Redo does not resurrect cleared transient selection. Copy, navigation and playback stay outside history and dirty comparison. Caller input and source animation remain immutable. Create/edit/move/duplicate/delete stress tests undo to the clean baseline and redo every exact snapshot.

## Serialization/validation

Working events use the existing version 1 serializer and `parseAnimationClip()` reloader. Valid edits, same-time events, nested payloads, optional/null payloads and stable ordering survive reload. Negative, nonfinite and out-of-range timestamps, missing/empty names, unsupported fields and malformed payload values are rejected without installing snapshots or changing history. Keyframe paste/duplicate retain existing group spacing, collisions, duration extension, interpolation and selection behavior. No export UI was added.

## Files changed

- `src/devtools/animation-editor/TimelineClipboard.ts`: typed shared storage and pure event cloning/insertion helpers.
- `src/devtools/animation-editor/AnimationEditorKeyframeCommands.ts`: shared typed clipboard injection; existing keyframe copy/paste/duplicate logic retained.
- `src/devtools/animation-editor/AnimationEditorPlayback.ts`: one millisecond clock, exact navigation, start-consumption state and overflow-safe event-free wrapping.
- `src/devtools/animation-editor/AnimationEditorState.ts`: event clipboard commands, selection-based routing, exact authored seeks, runtime traversal integration and event subscriptions.
- `src/devtools/animation-editor/editorPlaybackEvents.ts`: cached validated event projection and runtime catch-up preflight.
- `src/devtools/animation-editor/timeline.ts`: shared clamping overloads retain typed seconds/milliseconds boundaries.
- `src/devtools/animation-editor/TimelineInputController.ts`, `TimelineSessionController.ts`, `editorMarkup.ts`: shared shortcut/button routing, labels, enablement and help text.
- `src/engine/animationTimeline.ts`: extracted shared event budget and start-event collection.
- `src/engine/animationNotifications.ts`, `AnimationPlayer.ts`: shared runtime notification delivery without changing runtime behavior.
- `tests/animationEditorEventClipboard.test.ts`, `animationEditorEventPlayback.test.ts`: clipboard/history/serialization/validation, runtime agreement, navigation safety and precision regressions.
- `tests/animationEditorPlayback.test.ts`: huge event-free loop regression separated from bounded event catch-up.
- `tests/browser/animationEvents.spec.ts`: event clipboard controls, native field guards, same-time selection, history and cross-animation paste.
- `README.md`, `docs/animation-editor.md`, this report: behavior/API/verification documentation.
- `package.json`, `package-lock.json`: milestone version.

The user-provided plan file is unchanged.

## APIs/types changed

Editor additions: `EventClipboard`, `TimelineClipboardContent`, `TimelineClipboard`, `copyEventSelection()`, `pasteEventClipboard()`, `timelineClipboard`, `eventClipboard`, `copySelectedEvent()`, `pasteEvent()`, `duplicateSelectedEvent()`, `copyTimelineSelection()`, `pasteTimelineClipboard()`, `duplicateTimelineSelection()` and `onAnimationEvent()`.

Internal playback duration callbacks now provide milliseconds. Added `currentTimeMilliseconds`, `setCurrentTimeMilliseconds()`, `requestStart()` and `consumeStart()`; editor-state time/navigation remains in seconds. Keyframe commands accept the shared clipboard as a constructor dependency. `clampTime()` supports same-unit seconds and milliseconds with separate typed overloads. Added internal shared `MAXIMUM_ANIMATION_EVENTS_PER_UPDATE`, `assertAnimationEventBudget()`, `collectAnimationStartEvents()` and `dispatchAnimationEvents()`; production package exports, authored animation types and schemas remain unchanged.

## Tests

Unit tests cover exact copying/ownership, same-time identities, content-based routing, compatible cross-animation paste, destination rejection, duplicate timing/bounds, clipboard retention, payload presence, source immutability, Undo/Redo stress and serialization. Playback tests compare complete event sequences directly with `AnimationPlayer` for forward, speed-scaled, multi-loop and large-delta updates, plus exclusive/inclusive boundaries, zero-time restart consumption, scrub/navigation silence, stepped timing, catch-up rejection, payload isolation, listener failures and fractional millisecond/seconds precision.

The complete unit suite also exercises Rig Editor, animation loading/timeline/playhead, smooth/stepped playback/speed/FPS, bone/property tracks, multi-key selection and movement, key clipboard/collisions, interpolation, history/dirty state, validators, character loading, source isolation, IK and facing. Existing profile skips remain unchanged.

## Manual verification

A separate human manual pass was not performed. The generated event-track screenshot was visually inspected for visible clipboard controls, selected-event fields, ruler/playhead alignment and separate stacked same-time markers. Automated Chrome browser scenarios exercise the visible controls against both development and production builds. The plan's runtime callback/large-delta checks are covered with instrumented state/runtime tests; the editor does not add an event debugger or preview side effects during navigation. Browser artifacts and failure-only traces are written under ignored `test-results/`.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 81 files passed, 3 skipped; 1,325 tests passed, 28 existing skips.
- `npm run build`: passed, exit 0; demo, library, declarations and Node core check succeeded.
- `npm run lint`, `npm run format:check`, `npm run check:version` and `git diff --check`: passed.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test --workers=2 --timeout=60000`: 198 passed, 8 failed, exit 1. The failures comprised two copies of a new test's stale expansion-button selector, development loading/reload timeouts, and production playback/interpolation timing checks under host contention.
- After correcting the selector and rebuilding the final code, `PLAYWRIGHT_CHANNEL=chrome npx playwright test --last-failed --workers=1 --timeout=60000`: all 8 passed, exit 0. All 206 development/production scenarios have passing results across the full pass and isolated rerun. No assertion or validator was weakened.

An earlier concurrent unit/browser pass hit an existing sketch-demo test's 5-second timeout while the host was busy. The complete unit suite then passed standalone without changing that test. Earlier browser attempts were stopped to rebuild after precision hardening and to reduce host contention. The final isolated rerun confirmed the eight cases above; the two-worker run was not a single clean full-suite run.

## Deferred to v0.5.2.8+

Advanced event debugger, breakpoints, event multi-selection/group dragging/batch copying, final production export workflows, onion skinning, ghost poses, mirrored keyframe copying, IK target authoring/baking, scene choreography, physics, ragdolls and mesh deformation. No unrelated authoring features were added.
