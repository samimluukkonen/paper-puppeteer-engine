# Visual Animation Editor — v0.5.2.2.3

Open `/animation-editor/` from **Open Animation Editor** in the demo or **Animation Editor** in the Rig Editor. The sample character loads with its default skin and its first animation (`idle`). The independent Rig Editor remains at `/rig-editor/`.

Select `idle`, `walk`, or another character animation in the Animation menu. Click or drag anywhere on the timeline to preview its authored pose. Pointer capture keeps scrubbing active outside the timeline; time clamps at both ends. Release, pointer cancellation, focus loss, or hiding the page ends scrubbing. Touch and pen use the same pointer path. With the timeline focused, arrow keys move by 0.01 seconds, Shift increases the step to 0.1 seconds, and Home / End jump to the endpoints.

The sample `sword` and `guardUpperBody` clips contain baked arm rotations for a two-handed katana grip, so both show a complete sword-ready pose without IK. `sword` adds the idle body bob; `guardUpperBody` is the torso/arm overlay used while walking in the demo. The editor shows the default skin without the demo's katana prop; interactive weapon aiming and grip IK remain demo behavior.

**Play** starts or resumes at the current time. **Pause** holds time, playhead, and pose. **Restart** immediately returns to zero and preserves whether playback is active. **Space** toggles Play/Pause outside input, select, textarea, and content-editable regions; holding Space toggles only once. **Loop preview** toggles a transient editor preference (off by default). With it off, playback stops exactly at duration and holds the final pose. With it on, the editor wraps time and preserves overshoot, including deltas spanning several animation lengths. Dragging while playing temporarily suspends advancement; release, cancellation, lost pointer capture, focus loss, or page hiding ends the drag and resumes from the scrubbed time. Dragging while paused stays paused. Releasing at the final endpoint stops non-looping playback; looping playback wraps on the next update. An explicit Pause during a drag cancels resume. Pressing Play at the endpoint starts again at zero. Selecting another animation resets time and pauses. Controls are disabled without a valid animation. There is no separate Stop control in this milestone.

The ruler adapts to duration and available width, with major labels, minor ticks, and an end marker. The playhead and numeric time display reflect continuous seconds, formatted as `0.742 / 2.000 s` without rounding the internal clock. Metadata shows smooth/stepped playback, authored FPS for stepped clips, authored loop state, preview loop preference, speed, and current playback/scrub status. Preview loop and speed preferences persist across animation selection.

**Speed** offers 0.25×, 0.5×, 1× (default), 1.5×, and 2×. Each update advances animation time by elapsed real time multiplied by this editor-only speed. Changing speed while playing or scrubbing preserves time and playback intent; it never changes authored data, dirty state, or undo history.

**Mode** edits the animation's existing `playback` property in the working copy. Smooth interpolation stays continuous. Stepped mode holds poses at authored FPS boundaries while the playhead stays continuous and Phaser continues rendering at its normal rate. Switching to stepped mode starts at 10 FPS; switching to smooth removes the FPS field as required by the schema. **FPS** is enabled only for stepped clips and accepts finite values from 1 to 240, including fractional rates. Existing clips with valid runtime FPS outside those editor bounds still load and preview unchanged. Invalid or empty edits show a validation error and restore the held value. Mode/FPS edits update the paused or playing preview immediately without retiming keys or events (the format stores their times in milliseconds).

**Undo** and **Redo** restore authored settings through the existing snapshot history and refresh the preview. Settings changes mark the working animation dirty when it differs from the saved baseline. The original source remains immutable. Animation switching preserves a dirty working copy and reports the issue; undo edits back to the baseline before switching. Saving/exporting animation data remains deferred.

Mode/FPS edits also protect page navigation, refresh, closing, and character selection with the browser's unsaved-change confirmation. Undo the edits before leaving to avoid discarding them. Preview navigation and playback preferences do not trigger this confirmation.

## Data and preview ownership

`AnimationEditorState` is independent of Phaser and the DOM. It owns a frozen source snapshot and saved baseline per animation and a separately cloned working animation in the existing versioned file format. `markSaved()` retains the selected animation's working data across selection changes while keeping its original source untouched. Explicitly discarding changes restores the last saved baseline on the next selection. Caller-owned character animations remain untouched. Editor-only selection, time, playback, speed, preview loop preference, scrubbing, validation issues, and history stay outside the serialized data. Authored FPS/mode use the existing `playback` union; no schema or engine changes are needed. `subscribe()` connects external state changes to the preview and UI.

`currentTime` is the sole editor clock, in continuous seconds. `AnimationEditorScene.update()` converts Phaser's elapsed milliseconds to seconds and calls `advancePlayback()`. Rendering runs at the normal Phaser rate; pose quantization remains the evaluator's responsibility. `duration` reads the working animation's explicit `duration` in milliseconds and converts it to seconds; keys and events do not redefine the endpoint. Zero-duration clips are invalid in the existing runtime schema and display its validation errors. Empty/partial tracks and event-only clips retain their explicit positive duration. No character, no animations, or no selection uses a disabled zero-length timeline. Nonpositive or nonfinite playback deltas do nothing, and completed playback sends no further time notifications. Looping reduces the speed-scaled delta modulo duration before adding it to current time, preserving the held fraction even for `Number.MAX_VALUE`. If multiplication overflows, real time is reduced by one preview loop before scaling. The zero-length guard runs before modulo; empty or rejected zero-duration clips hold time at zero with playback stopped.

`TimelineController` owns pointer capture and measured DOM width, generates the ruler through pure helpers, and translates pixels into calls to `setCurrentTime()`. It calls `beginScrub()` on pointer-down and `endScrub()` on release or interruption, and releases a captured pointer when selection clears the scrub state. It has no independent animation clock. Ruler, playhead, and the empty track region are separate so later versions can add bone/property/event rows without replacing time navigation.

`AnimationEditorPreview` compiles only when the working animation identity changes and owns an existing `AnimationPlayer` over the puppet's joints. The compiled preview uses `loop: false` without changing source or working data, so the evaluator also samples the exact final pose for stepped clips whose endpoint falls between frames. It converts seconds to milliseconds and calls `sample(..., { mode: 'playback' })`, then `Puppet.syncPose()` projects the pose through the runtime rendering pipeline. This reuses interpolation, shortest-path rotations, and stepped sampling; timeline code never interpolates bones. Selection resets previously controlled joints to bind pose, including when switching to sparse clips. The preview has no configured IK constraints so authored poses are directly visible. Scrubbing and editor playback neither advance runtime playback clocks nor dispatch animation events.

`replaceWorkingAnimation()` validates authored changes with the existing JSON/schema/reference checks, owns a fresh frozen copy, and records one replacement through the shared `SnapshotHistory`. FPS and mode setters use this boundary. Invalid replacements preserve the held working copy and pose. Replacements must retain the selected animation’s name; renaming is deferred. Dirty state compares the working snapshot with a saved baseline, following the Rig Editor pattern. `markSaved()` is internal save plumbing, while `undo()` and `redo()` are exposed for settings edits. `selectAnimation()` refuses dirty replacement unless explicitly called with `{ discardChanges: true }`. Scrubbing and selection never record history.

`previewLoop`, `playbackSpeed`, and `isScrubbing` are transient state views. `isPlaying` retains playback intent during a drag, so `advancePlayback()` skips while `isScrubbing` and resumes naturally after `endScrub()`; no separate saved playback flag is needed. Successful animation selection clears both playback and scrub state and resets time before notifying the preview. Failed selection preserves the held session. Binding a new session, disposal, and scene shutdown pause before ending a scrub, preventing accidental resume.

Playback commands, loop toggles, scrubbing, and time advancement never change animation snapshots, dirty state, or authored history. Existing dirty edits remain dirty. Replacements and history restoration that shorten duration clamp time and pause if the endpoint is reached.

For a custom character, pass `{ characterUrl: '../characters/hero/character.json' }` as the third constructor argument of `AnimationEditorScene`. It uses the shared cancelable character loader, existing manifest validation, and default skin. Failed loads show errors; scene shutdown invalidates pending loads, pauses and releases editor playback, disposes the preview subscription/player, and destroys the puppet.

## APIs

- `AnimationEditorState(rig?, animations?)`: animation catalogue and owned session.
- `animationIds`, `selectedAnimationId`, `sourceAnimation`, `workingAnimation`, `currentTime`, `duration`, `loop` (authored), `previewLoop`, `isPlaying`, `isScrubbing`, `dirty`, `validationIssues`: read-only session views.
- `selectAnimation(id | null, options?)`, `setCurrentTime(seconds)`, `subscribe(listener)`: navigation and notifications.
- `play()`, `pause()`, `togglePlayback()`, `restart()`, `advancePlayback(deltaSeconds)`: transient playback commands on `AnimationEditorState`; `isPlaying` retains playback intent during a scrub.
- `setPreviewLoop(boolean)`, `beginScrub()`, `endScrub()`: editor preference and pointer navigation lifecycle.
- `playbackSpeed`, `setPlaybackSpeed(number)`: transient speed view and setter; unsupported speeds return false.
- `setAuthoredFPS(number)`, `setAuthoredPlaybackMode('smooth' | 'stepped')`: validated authored edits; return success, use working-copy history, and leave key/event times untouched.
- `PREVIEW_PLAYBACK_SPEEDS`, `AUTHORED_FPS_MIN`, `AUTHORED_FPS_MAX`, `DEFAULT_AUTHORED_FPS`: shared editor control values.
- `replaceWorkingAnimation(input)`, `markSaved()`, `undo()`, `redo()`: internal authored-change foundation.
- `AnimationEditorPreview(state, puppet)` / `dispose()`: existing evaluator-to-puppet adapter.
- `TimelineController(app)` / `bind(state, characterId?)` / `showError(message)` / `dispose()`: DOM adapter.
- `animationDurationSeconds`, `clampTime`, `timeToTimelineX`, `timelineXToTime`, `generateRulerTicks`, `RulerTick`: pure timeline logic.
- `AnimationEditorSceneOptions`, `ReadonlyAnimation`: editor configuration and immutable data views.

These APIs live under `src/devtools/animation-editor/`; the production package exports and external JSON schemas are unchanged.

## Verification checklist

- [ ] Open the demo, Rig Editor, and Animation Editor independently; navigate between them under the local and deployed base paths.
- [ ] In the Rig Editor select `head`, edit its X value, and undo; confirm validation still succeeds.
- [ ] Confirm the sample puppet artwork and default skin appear in the Animation Editor.
- [ ] Select `idle` and `walk`; confirm time resets to zero and duration/metadata/ruler update.
- [ ] Confirm ruler labels, minor ticks, end marker, playhead, and numeric current time are visible.
- [ ] Click near start, middle, and end; continuously drag and release outside both timeline edges; confirm time clamps and stops changing on release.
- [ ] Scrub a visible walk pose and restart; confirm the preview changes immediately while paused.
- [ ] Play, pause, resume, and restart both while playing and paused; confirm time, playhead, and artwork stay synchronized.
- [ ] Confirm playback stops at duration and holds the final pose with Loop preview off; Play at the endpoint starts again at zero.
- [ ] Enable Loop preview, observe repeated wrapping, disable it, and confirm playback stops at the final pose.
- [ ] Drag while playing: confirm time and artwork hold until pointer movement, then resume on release. Drag while paused and confirm it remains paused.
- [ ] Switch animation while playing or dragging; confirm the old pointer is released, playback pauses, time resets, and the new pose appears.
- [ ] Confirm loop toggles, dragging, and repeated wrapping keep **No unsaved changes**. Unit tests cover overshoot, very large finite deltas, and rejected zero-duration data.
- [ ] Confirm Space toggles once per press, including with a button focused, and leaves form controls and content-editable regions alone.
- [ ] Use keyboard navigation and resize to a narrow window; confirm the same current time and correct playhead position.
- [ ] Set Mode to stepped; confirm metadata and held frames while time stays continuous.
- [ ] Clear selection, load a character with no animations, and load invalid zero-duration data; confirm useful empty/error messages without exceptions.
- [ ] Confirm **No unsaved changes** after all navigation. Unit tests verify caller/source isolation and runtime agreement for smooth/stepped/partial clips.
- [ ] Compare 0.5×, 1×, and 2× playback; confirm speed persists across selection without dirtying data.
- [ ] Switch Mode to stepped, edit FPS while paused and playing, and confirm immediate pose changes with continuous time and normal rendering.
- [ ] Reject empty, negative, zero, and out-of-range FPS without changing the held animation. Confirm typing an FPS draft while playing does not reset the input.
- [ ] Undo/redo settings edits and return to the clean baseline before switching animations; source and caller data remain unchanged in unit tests.

The automated browser suite performs the route, artwork, selection, click/drag/clamping, release, keyboard, resize, empty-state, invalid-data, stepped-frame, playback, endpoint-hold, and typing-target scenarios against development and production builds. The route test also edits and undoes a Rig Editor field. Run with `npm run test:browser`; `PLAYWRIGHT_CHANNEL=chrome` can use installed Chrome.

Verification for v0.5.2.2.3 on October 5, 2026: `npm run typecheck`, `npm run test` (797 passed, 26 existing skips), `npm run build`, `npm run check`, `npm run check:version`, and `git diff --check HEAD` passed. Added 54 unit cases covering all five speeds, source/working-copy isolation, transient dirty/history rules, live speed changes and scrubbing, loop overshoot and overflow, FPS bounds and rejection, authored mode/FPS history, immediate paused/playing pose updates, and smooth versus stepped sampling against the runtime at 120 updates per second. `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEditor.spec.ts` passed all 38 cases across development and production. The three new scenarios compare actual 0.5×/1×/2× timing, verify authored settings and undo/redo through canvas screenshots, and reject invalid FPS while preserving uncommitted input during playback. Desktop and narrow screenshots were visually inspected. These browser interactions were automated; no separate interactive manual session was performed.

Implementation files: `src/devtools/animation-editor/AnimationEditorState.ts`, `TimelineController.ts`, `main.ts`, and `style.css`; tests: `tests/animationEditorSettings.test.ts` (new), `tests/animationEditorPreview.test.ts`, and `tests/browser/animationEditor.spec.ts`; documentation: `README.md`, `docs/animation-editor.md`, and `docs/development.md`; version: `package.json` and `package-lock.json` now use `0.5.2-2.3`. New editor APIs are listed above. The engine, external schemas, and production package APIs remain unchanged.

## Deferred features

Editable bone/property/event tracks, keyframe markers and authoring, selection of keys, keyframe creation/deletion/movement/copy/paste, per-keyframe interpolation editing, event editing, snapping, animation export/save/import UI, onion skinning, mirrored keyframes, ghost poses, and IK authoring/baking remain deferred. Playback hardening in v0.5.2.2.4 is a separate plan.
