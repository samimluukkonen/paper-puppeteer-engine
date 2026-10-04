# Visual Animation Editor Foundation — v0.5.2.1

Open `/animation-editor/` from **Open Animation Editor** in the demo or **Animation Editor** in the Rig Editor. The sample character loads with its default skin and its first animation (`idle`). The independent Rig Editor remains at `/rig-editor/`.

Select `idle`, `walk`, or another character animation in the Animation menu. Click or drag anywhere on the timeline to preview its authored pose. Pointer capture keeps scrubbing active outside the timeline; time clamps at both ends. Release, pointer cancellation, focus loss, or hiding the page ends scrubbing. Touch and pen use the same pointer path. **Reset time** jumps to the start. With the timeline focused, arrow keys move by 0.01 seconds, Shift increases the step to 0.1 seconds, and Home / End jump to the endpoints.

The ruler adapts to duration and available width, with major labels, minor ticks, and an end marker. The playhead and numeric time display reflect continuous seconds. Read-only metadata shows smooth/stepped playback, authored FPS for stepped clips, and loop state. Preview remains stopped while navigating. There are no editable tracks or playback controls in this milestone.

## Data and preview ownership

`AnimationEditorState` is independent of Phaser and the DOM. It owns a frozen source snapshot per animation and a separately cloned working animation in the existing versioned file format. Caller-owned character animations remain untouched. Editor-only selection, time, validation issues, and history stay outside the serialized data. `subscribe()` connects external state changes to the preview and UI.

`currentTime` is the sole editor clock, in continuous seconds. `duration` reads the working animation's explicit `duration` in milliseconds and converts it to seconds; keys and events do not redefine the endpoint. Zero-duration clips are invalid in the existing runtime schema and display its validation errors. Empty/partial tracks and event-only clips retain their explicit positive duration. No character, no animations, or no selection uses a disabled zero-length timeline.

`TimelineController` owns pointer capture and measured DOM width, generates the ruler through pure helpers, and translates pixels into calls to `setCurrentTime()`. It has no independent animation clock. Ruler, playhead, and the empty track region are separate so later versions can add bone/property/event rows without replacing time navigation.

`AnimationEditorPreview` compiles only when the working animation identity changes and owns an existing `AnimationPlayer` over the puppet's joints. It converts seconds to milliseconds and calls `sample(..., { mode: 'playback' })`, then `Puppet.syncPose()` projects the pose through the runtime rendering pipeline. This reuses interpolation, shortest-path rotations, and stepped sampling; timeline code never interpolates bones. Selection resets previously controlled joints to bind pose, including when switching to sparse clips. The preview has no configured IK constraints so authored poses are directly visible. Scrubbing neither advances runtime playback clocks nor dispatches animation events.

`replaceWorkingAnimation()` is an internal future-authoring boundary: it uses the existing JSON/schema/reference validation, owns a fresh frozen copy, and records an authored replacement through the shared `SnapshotHistory`. Invalid replacements preserve the held working copy and pose. Dirty state compares the working snapshot with a saved baseline, following the Rig Editor pattern. `markSaved()`, `undo()`, and `redo()` provide plumbing without exposing authoring or export UI. `selectAnimation()` refuses dirty replacement unless explicitly called with `{ discardChanges: true }`; no confirmation dialog is needed while the UI only navigates. Scrubbing and selection never record history.

For a custom character, pass `{ characterUrl: '../characters/hero/character.json' }` as the third constructor argument of `AnimationEditorScene`. It uses the shared cancelable character loader, existing manifest validation, and default skin. Failed loads show errors; scene shutdown invalidates pending loads, disposes the preview subscription/player, and destroys the puppet.

## APIs

- `AnimationEditorState(rig?, animations?)`: animation catalogue and owned session.
- `animationIds`, `selectedAnimationId`, `sourceAnimation`, `workingAnimation`, `currentTime`, `duration`, `loop`, `isPlaying`, `dirty`, `validationIssues`: read-only session views.
- `selectAnimation(id | null, options?)`, `setCurrentTime(seconds)`, `subscribe(listener)`: navigation and notifications.
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
- [ ] Scrub a visible walk pose and reset time; confirm the preview changes immediately while stopped.
- [ ] Use keyboard navigation and resize to a narrow window; confirm the same current time and correct playhead position.
- [ ] Load a stepped clip (e.g. add `"playback": { "mode": "stepped", "fps": 10 }` to a temporary idle response); confirm metadata and held frames while time stays continuous.
- [ ] Clear selection, load a character with no animations, and load invalid zero-duration data; confirm useful empty/error messages without exceptions.
- [ ] Confirm **No unsaved changes** after all navigation. Unit tests verify caller/source isolation and runtime agreement for smooth/stepped/partial clips.

The automated browser suite performs the route, artwork, selection, click/drag/clamping, release, keyboard, resize, empty-state, invalid-data, and stepped-frame scenarios against development and production builds. Run with `npm run test:browser`; `PLAYWRIGHT_CHANNEL=chrome` can use installed Chrome.

Verification performed on October 4, 2026: `npm run typecheck`, `npm run test` (639 passed, 26 existing skips), `npm run build`, and `npm run check` passed. The 42 new unit tests cover navigation/data isolation, validation/history, pure timeline logic, and runtime pose agreement. All 36 browser scenarios were verified across development and production: 35 passed in the full run, and the remaining navigation test passed after correcting the test to commit its Rig Editor field before clicking Undo. Desktop (1600px) and narrow (620px) screenshots were visually inspected for puppet artwork, ruler labels, end marker, playhead, and responsive layout. Source immutability and smooth/stepped pose agreement were checked by the unit suite.

## Deferred to v0.5.2.2+

Playback controls, editable bone/property/event tracks, keyframe markers and authoring, selection of keys, keyframe dragging/copy/paste, interpolation and FPS editing, snapping, animation export/save/import UI, onion skinning, ghost poses, and IK authoring/baking remain deferred.
