# v0.5.2.4.3 — Move Keyframes & Timeline Hardening

## Implemented

Single authored keys can be dragged horizontally or nudged with Left/Right arrows. Moves preserve local values and clip-level interpolation, clamp to duration, keep rows sorted, replace same-property collisions and select the resulting canonical key time. Playback pauses when a gesture starts and remains paused. Provisional gestures have no authored, dirty-state or history changes. Escape, pointer cancellation, lost capture, blur, visibility loss and session/navigation/edit boundaries cancel movement. Package version is `0.5.2-4.3`.

## Timeline architecture

The existing `AnimationEditorPlayback` remains the sole continuous clock. Ruler, playhead, scrub and marker positions reuse `timeToTimelineX()` / `timelineXToTime()`. Runtime/authored times remain milliseconds; editor coordinates and navigation use seconds. `TimelineController` measures the current timeline client rectangle for pointer conversions, including after scroll and resize, and captures the pointer on the stable timeline container. Empty-lane scrubbing retains its existing playback intent. Key dragging pauses playback and blocks Play until release/cancellation.

## Key marker/selection architecture

`workingAnimation` remains authoritative. The existing frozen track model and bone/property row cache still produce all authored markers; unrelated navigation and playback preserve row identity. `TimelineTracksController` positions just the selected marker provisionally on its original lane and reconciles authored markers after commit. Vertical pointer motion does not change bone/property. Pointer clicks select on down; Enter/Space preserve native keyboard activation. A 3px threshold avoids turning ordinary clicks into edits.

The existing frozen `KeyframeSelection` continues to hold one bone/property/time identity. A committed move selects the destination's canonical time before notifying inspector/preview subscribers. Undo/Redo retains the prior transient-selection policy: validate against the restored authored snapshot, retaining an existing selected time or clearing a missing one. No persistent IDs or JSON fields are added.

## Key movement architecture

`moveBonePropertyKeyframe(animation, rig, boneId, property, fromTimeMs, toTimeMs)` is the sole time-mutation implementation. It validates the input/result using existing animation validation, resolves source and destination through `matchingRow()` and the shared `KEYFRAME_TIME_TOLERANCE_MS = 1e-6` milliseconds, and returns a persistent replacement. Source/caller data is never mutated or frozen. Unchanged bone tracks, untouched rows, events and playback settings are shared.

Sparse source rows lose only the moved property. Sparse destination rows preserve their other properties. Empty edited rows are removed, and the selected bone's rows remain sorted. Missing source keys and tolerant self-matches return the original snapshot. Moving onto a distinct nearby key uses the nearest-match identity rule even when that key is within source tolerance. Interpolation is currently clip-level, so its metadata stays unchanged. No rendered pose, IK result or world-space value is read or baked.

`AnimationEditorState` holds a frozen provisional `KeyframeDrag` (`key`, `previewTime`). During drag it seeks the existing clock and leaves the authored snapshot unchanged; the preview evaluates the original animation at the destination time. Release invokes the central move API once. Cancellation returns to the source key time and preserves saved/dirty state, history and redo.

## Snapping

Snap defaults to **None**, preserving continuous seconds. **Frame** uses nearest-frame rounding, `Math.round(time * fps) / fps`, with authored FPS from stepped clips. Smooth clips and invalid/unavailable FPS use the shared 10 FPS fallback. Zero and duration remain reachable even for off-frame durations. Time is clamped before and after snapping. Snapping is a transient authoring preference and never globally retimes keys or events.

Shift bypasses snapping during pointer dragging. Left/Right nudges by one snapped frame when Frame is enabled, or 0.01 seconds otherwise. Shift+Arrow uses ten steps. Keyboard shortcuts respect typing controls, IME composition, consumed events and Ctrl/Cmd/Alt modifiers. Without a selected key, the timeline's existing arrows scrub instead.

## Collision policy

A destination collision replaces the destination property's value with the moving key's value. The bone/property must match; other properties and bones are unaffected. The closest destination sample within the shared tolerance supplies the canonical authored time, with stored-order ties. All destination samples of that property within tolerance of the canonical time are removed before the moved sample is installed. Other sparse-row properties retain their original times and values. This prevents adding duplicate same-property keys, including tolerated collisions.

Undo restores the exact pre-move immutable snapshot, including the replaced destination value and original sparse rows. Redo restores the exact moved snapshot.

## History behavior

Every changed drag commits one `SnapshotHistory` action on pointer release. Intermediate pointer moves never call history or mutate authored data. Each changed keyboard nudge is one action, including repeated keydown nudges. Unchanged clicks, cancelled gestures, tolerant self-matches and nudges clamped to an unchanged endpoint add no history entry and preserve redo. Changed edits invalidate redo through the existing history implementation. The existing saved-baseline comparison determines dirty state.

## Files changed

- `src/devtools/animation-editor/keyframeEdits.ts`: central pure time-move operation.
- `src/devtools/animation-editor/timeline.ts`: snap mode, FPS fallback and pure snapping helper.
- `src/devtools/animation-editor/AnimationEditorState.ts`: gesture state, commit/cancel boundaries, selected moves, nudges and snapping preferences.
- `src/devtools/animation-editor/TimelineController.ts`: captured pointer gestures, fresh coordinates, guarded shortcuts and snap control.
- `src/devtools/animation-editor/TimelineTracksController.ts`: marker pointer adapter and provisional marker positioning.
- `src/devtools/animation-editor/main.ts`, `style.css`: snap selector, help text and drag styling.
- `tests/animationEditorKeyframeMovement.test.ts`: pure/state movement regressions.
- `tests/animationEditorPreview.test.ts`: smooth/stepped move evaluation, history, loop/speed and facing regression.
- `tests/browser/animationKeyframeMovement.spec.ts`: real pointer, snapping, cancellation, history, keyboard, scrolling and resize scenarios.
- `tests/browser/animationKeyframeMarkers.spec.ts`: selected deletion after navigation uses End, since arrows now move selected keys.
- `docs/animation-editor.md`, this report: behavior, APIs and verification.
- `package.json`, `package-lock.json`: milestone version.

## APIs/types changed

- Added pure `moveBonePropertyKeyframe(animation, rig, boneId, property, fromTimeMs, toTimeMs)`.
- Added `KeyframeSnapMode`, `DEFAULT_KEYFRAME_FPS`, `snapKeyframeTime(seconds, duration, mode, fps?)`.
- Added immutable `KeyframeDrag` with original `key` identity and `previewTime`.
- Added state `keyframeDrag`, `beginKeyframeDrag(selection)`, `previewKeyframeDrag(seconds, disableSnapping?)`, `commitKeyframeDrag()`, `cancelKeyframeDrag()`.
- Added state `moveSelectedKeyframe(seconds)`, `nudgeSelectedKeyframe(-1 | 1, large?)`.
- Added state `keyframeSnapMode`, `keyframeFPS`, `setKeyframeSnapMode('none' | 'frame')`.
- `DEFAULT_AUTHORED_FPS` now aliases the shared fallback constant.
- `TimelineTracksController(labels, lanes, onKeyPointerDown)` accepts a DOM gesture adapter.

Existing runtime exports, schemas, selection types, clock, transform authoring and history format are preserved. No `any`, unsafe new casts, global mutable timeline state, duplicate coordinate conversion or UI array mutation is introduced.

## Tests

The movement unit suite covers basic movement, sorted neighbor crossing, endpoint clamps, same-property replacement, tolerated collisions, nearby distinct source/destination identity, sparse-row isolation, immutable source/caller data, interpolation/event preservation, invalid/no-op requests, nearest-frame snapping, FPS fallback, off-frame endpoints, selection following, paused playback, provisional clocks, exact Undo/Redo, clean cancellation, preserved redo, keyboard nudging and cancellation boundaries.

Preview tests verify provisional evaluation against unchanged authored data, immediate move/Undo/Redo updates through the existing evaluator in both smooth and stepped modes, facing isolation, playback speed and looping with retimed keys. The full unit suite also covers rig hierarchy/editor, character loading, validation, IK, facing, source immutability and all prior animation editor milestones.

Five new browser scenarios run against development and production alongside existing editor, marker, track, authoring and export regressions. Horizontal scrolling uses a controlled overflow fixture because the standard responsive layout fits the timeline to its available width. No zoom control exists. Browser assertions cover vertical isolation, marker geometry, preview/inspector/keyed refresh, snapping, Shift bypass, collisions, bounds, cancellation, playback pause, shortcuts and single-step history.

## Manual verification

Verification uses automated Chrome pointer/keyboard interactions and generated screenshots; no separate hands-on user session is claimed. The browser fixture supplies keys at 0, 0.5 and 1 seconds, and tests moving the middle key to 0.7, Undo/Redo, both clamps, frame snapping, collision replacement, keyboard nudges, scrolled/resized coordinates and starting a drag during playback. Desktop and scrolled/resized timeline screenshots were inspected for row alignment, marker placement and playhead geometry. Screenshots are written under `test-results/`.

## Required command results

- `npm run typecheck`: passed, exit 0, including the final browser fixture change.
- `npm run test`: passed, exit 0; 1,057 tests passed and 26 optional profiling tests skipped; 62 test files passed and two profiling-only files skipped.
- `npm run build`: passed, exit 0; demo, library bundles, declarations and the Node `/core` character loading/validation/animation/IK smoke check succeeded.
- `npm run lint`: passed, exit 0.
- Formatting checks on changed files, `git diff --check` and `npm run check:version`: passed, exit 0.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationKeyframeMovement.spec.ts tests/browser/animationKeyframeMarkers.spec.ts tests/browser/animationTimelineTracks.spec.ts tests/browser/animationBoneAuthoring.spec.ts tests/browser/animationEditor.spec.ts tests/browser/animationExport.spec.ts`: 82 passed; two scroll-fixture failures, one in each build. The original responsive fixture had no horizontal overflow.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationKeyframeMovement.spec.ts`: eight movement scenarios passed against the final builds; the two scroll scenarios exposed an additional fixture issue where the narrow-layout marker was below the viewport. The fixture now supplies horizontal overflow and scrolls the marker into view before raw mouse input.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationKeyframeMovement.spec.ts --grep 'drag coordinates'`: both corrected development/production scenarios passed, exit 0. All 84 selected browser scenarios have passed across these runs; no failing scenario remains. These fixture corrections required no production behavior change.

## Deferred to v0.5.2.5+

Multi-key selection/operations, box selection, key groups, copy/paste, duplication, vertical track moves, mirrored key copying, interpolation/tangent/easing editing, events/event UI, onion skinning, ghost poses, IK target authoring and IK baking remain deferred.
