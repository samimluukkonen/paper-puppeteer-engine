# Visual Animation Editor — v0.5.2.2.2

Open `/animation-editor/` from **Open Animation Editor** in the demo or **Animation Editor** in the Rig Editor. The sample character loads with its default skin and its first animation (`idle`). The independent Rig Editor remains at `/rig-editor/`.

Select `idle`, `walk`, or another character animation in the Animation menu. Click or drag anywhere on the timeline to preview its authored pose. Pointer capture keeps scrubbing active outside the timeline; time clamps at both ends. Release, pointer cancellation, focus loss, or hiding the page ends scrubbing. Touch and pen use the same pointer path. With the timeline focused, arrow keys move by 0.01 seconds, Shift increases the step to 0.1 seconds, and Home / End jump to the endpoints.

The sample `sword` and `guardUpperBody` clips contain baked arm rotations for a two-handed katana grip, so both show a complete sword-ready pose without IK. `sword` adds the idle body bob; `guardUpperBody` is the torso/arm overlay used while walking in the demo. The editor shows the default skin without the demo's katana prop; interactive weapon aiming and grip IK remain demo behavior.

**Play** starts or resumes at the current time. **Pause** holds time, playhead, and pose. **Restart** immediately returns to zero and preserves whether playback is active. **Space** toggles Play/Pause outside input, select, textarea, and content-editable regions; holding Space toggles only once. **Loop preview** toggles a transient editor preference (off by default). With it off, playback stops exactly at duration and holds the final pose. With it on, the editor wraps time and preserves overshoot, including deltas spanning several animation lengths. Dragging while playing temporarily suspends advancement; release, cancellation, lost pointer capture, focus loss, or page hiding ends the drag and resumes from the scrubbed time. Dragging while paused stays paused. Releasing at the final endpoint stops non-looping playback; looping playback wraps on the next update. An explicit Pause during a drag cancels resume. Pressing Play at the endpoint starts again at zero. Selecting another animation resets time and pauses. Controls are disabled without a valid animation. There is no separate Stop control in this milestone.

The ruler adapts to duration and available width, with major labels, minor ticks, and an end marker. The playhead and numeric time display reflect continuous seconds. Read-only metadata shows smooth/stepped playback, authored FPS for stepped clips, authored loop state, preview loop preference, and current playback/scrub status. The preview preference is independent of the source clip’s `loop` field and persists across animation selection.

## Data and preview ownership

`AnimationEditorState` is independent of Phaser and the DOM. It owns a frozen source snapshot and saved baseline per animation and a separately cloned working animation in the existing versioned file format. `markSaved()` retains the selected animation's working data across selection changes while keeping its original source untouched. Explicitly discarding changes restores the last saved baseline on the next selection. Caller-owned character animations remain untouched. Editor-only selection, time, playback, preview loop preference, scrubbing, validation issues, and history stay outside the serialized data. `subscribe()` connects external state changes to the preview and UI.

`currentTime` is the sole editor clock, in continuous seconds. `AnimationEditorScene.update()` converts Phaser's elapsed milliseconds to seconds and calls `advancePlayback()`. Rendering runs at the normal Phaser rate; pose quantization remains the evaluator's responsibility. `duration` reads the working animation's explicit `duration` in milliseconds and converts it to seconds; keys and events do not redefine the endpoint. Zero-duration clips are invalid in the existing runtime schema and display its validation errors. Empty/partial tracks and event-only clips retain their explicit positive duration. No character, no animations, or no selection uses a disabled zero-length timeline. Nonpositive or nonfinite playback deltas do nothing, and completed playback sends no further time notifications. Looping reduces a finite positive delta modulo duration before adding it to current time, preserving the held fraction even for `Number.MAX_VALUE`. The zero-length guard runs before modulo; empty or rejected zero-duration clips hold time at zero with playback stopped.

`TimelineController` owns pointer capture and measured DOM width, generates the ruler through pure helpers, and translates pixels into calls to `setCurrentTime()`. It calls `beginScrub()` on pointer-down and `endScrub()` on release or interruption, and releases a captured pointer when selection clears the scrub state. It has no independent animation clock. Ruler, playhead, and the empty track region are separate so later versions can add bone/property/event rows without replacing time navigation.

`AnimationEditorPreview` compiles only when the working animation identity changes and owns an existing `AnimationPlayer` over the puppet's joints. The compiled preview uses `loop: false` without changing source or working data, so the evaluator also samples the exact final pose for stepped clips whose endpoint falls between frames. It converts seconds to milliseconds and calls `sample(..., { mode: 'playback' })`, then `Puppet.syncPose()` projects the pose through the runtime rendering pipeline. This reuses interpolation, shortest-path rotations, and stepped sampling; timeline code never interpolates bones. Selection resets previously controlled joints to bind pose, including when switching to sparse clips. The preview has no configured IK constraints so authored poses are directly visible. Scrubbing and editor playback neither advance runtime playback clocks nor dispatch animation events.

`replaceWorkingAnimation()` is an internal future-authoring boundary: it uses the existing JSON/schema/reference validation, owns a fresh frozen copy, and records an authored replacement through the shared `SnapshotHistory`. Invalid replacements preserve the held working copy and pose. Replacements must retain the selected animation’s name; renaming is deferred. Dirty state compares the working snapshot with a saved baseline, following the Rig Editor pattern. `markSaved()`, `undo()`, and `redo()` provide plumbing without exposing authoring or export UI. `selectAnimation()` refuses dirty replacement unless explicitly called with `{ discardChanges: true }`; no confirmation dialog is needed while the UI only navigates. Scrubbing and selection never record history.

`previewLoop` and `isScrubbing` are the only new state fields. `isPlaying` retains playback intent during a drag, so `advancePlayback()` skips while `isScrubbing` and resumes naturally after `endScrub()`; no separate saved playback flag is needed. Successful animation selection clears both playback and scrub state and resets time before notifying the preview. Failed selection preserves the held session. Binding a new session, disposal, and scene shutdown pause before ending a scrub, preventing accidental resume.

Playback commands, loop toggles, scrubbing, and time advancement never change animation snapshots, dirty state, or authored history. Existing dirty edits remain dirty. Replacements and history restoration that shorten duration clamp time and pause if the endpoint is reached.

For a custom character, pass `{ characterUrl: '../characters/hero/character.json' }` as the third constructor argument of `AnimationEditorScene`. It uses the shared cancelable character loader, existing manifest validation, and default skin. Failed loads show errors; scene shutdown invalidates pending loads, pauses and releases editor playback, disposes the preview subscription/player, and destroys the puppet.

## APIs

- `AnimationEditorState(rig?, animations?)`: animation catalogue and owned session.
- `animationIds`, `selectedAnimationId`, `sourceAnimation`, `workingAnimation`, `currentTime`, `duration`, `loop` (authored), `previewLoop`, `isPlaying`, `isScrubbing`, `dirty`, `validationIssues`: read-only session views.
- `selectAnimation(id | null, options?)`, `setCurrentTime(seconds)`, `subscribe(listener)`: navigation and notifications.
- `play()`, `pause()`, `togglePlayback()`, `restart()`, `advancePlayback(deltaSeconds)`: transient playback commands on `AnimationEditorState`; `isPlaying` retains playback intent during a scrub.
- `setPreviewLoop(boolean)`, `beginScrub()`, `endScrub()`: editor preference and pointer navigation lifecycle.
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
- [ ] Load a stepped clip (e.g. add `"playback": { "mode": "stepped", "fps": 10 }` to a temporary idle response); confirm metadata and held frames while time stays continuous.
- [ ] Clear selection, load a character with no animations, and load invalid zero-duration data; confirm useful empty/error messages without exceptions.
- [ ] Confirm **No unsaved changes** after all navigation. Unit tests verify caller/source isolation and runtime agreement for smooth/stepped/partial clips.

The automated browser suite performs the route, artwork, selection, click/drag/clamping, release, keyboard, resize, empty-state, invalid-data, stepped-frame, playback, endpoint-hold, and typing-target scenarios against development and production builds. The route test also edits and undoes a Rig Editor field. Run with `npm run test:browser`; `PLAYWRIGHT_CHANNEL=chrome` can use installed Chrome.

Verification performed on October 5, 2026 for looping and scrub/play interaction: `npm run typecheck`, `npm run test` (743 passed, 26 existing skips), `npm run build`, `npm run check`, `npm run check:version`, and `git diff --check` passed. Added 18 unit cases for loop boundaries, overshoot, repeated loops, multi-duration and maximum finite deltas, paused/playing scrubs, endpoint release, explicit pause during a drag, selection during a drag, rejected zero-duration safety, unchanged caller/source/working snapshots, history/dirty isolation, and smooth/stepped pose sampling without runtime updates or events. The scene shutdown test now also verifies clearing an active scrub without resuming. Added six browser scenarios; all 30 Animation Editor cases passed in installed Chrome across development and production using `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEditor.spec.ts`. Browser actions checked repeated loops, loop preference persistence, stopping after disabling loop, suspended time and artwork during drag, resume on release, paused endpoint scrubbing, selection during drag, pointer cancellation, lost capture, and blur. Desktop (1600px), narrow (620px), and enabled-loop screenshots were visually inspected for artwork, controls, metadata, timeline, and responsive layout. These interaction checks were automated; no separate interactive manual session was performed. Large deltas and overshoot accuracy were verified in unit tests.

Implementation files changed: `AnimationEditorState.ts` owns the transient loop/scrub lifecycle and wrapping; `TimelineController.ts` connects the loop toggle and captured pointer lifecycle; `AnimationEditorScene.ts` clears scrubbing on shutdown; `AnimationEditorPreview.ts` clarifies why sampling keeps a non-looping compiled clip. `main.ts` and `style.css` add the preview control, help text, and pressed styling. State/preview/scene unit tests and `tests/browser/animationEditor.spec.ts` cover the new behavior. This guide and `docs/development.md` describe the milestone; `package.json` and `package-lock.json` use SemVer `0.5.2-2.2`.

## Deferred features

Playback speed, editable FPS or smooth/stepped controls, editable bone/property/event tracks, keyframe markers and authoring, selection of keys, keyframe dragging/copy/paste, interpolation editing, snapping, animation export/save/import UI, onion skinning, ghost poses, and IK authoring/baking remain deferred.
