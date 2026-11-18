# v0.5.2.2.4 playback verification

Verification date: October 5, 2026. Package version: `0.5.2-2.4`.

## Implemented

The v0.5.2.2 editor supports Play/Pause, Restart, non-loop final-pose holding, overshoot-preserving looping, 0.25×–2× playback, paused/playing scrubs, safe animation switching, and authored smooth/stepped mode and FPS changes with undo/redo. Restart preserves playback intent; there is no separate Stop control.

This stabilization pass adds Home outside typing controls, modifier/IME guards for timeline navigation, event-free preview compilation, and finite fallback for invalid durations. Recompiling or switching a preview resets sparse joint properties while retaining optional IK, pose presets, and facing. Help and accessible shortcut metadata reflect Home. Runtime event dispatch, animation formats, and package exports are unchanged.

## Architecture audit

- `AnimationEditorState.currentTime` remains the only editor clock, in continuous seconds. The scene converts Phaser deltas from milliseconds and delegates advancement to state. No clock was added to the preview or timeline.
- State owns playback intent, speed, preview looping, and scrubbing. Non-loop playback clamps to duration and pauses. Loop playback reduces speed-scaled deltas modulo duration and preserves overshoot; overflowing scaling reduces real time before scaling.
- Scrubbing holds playback advancement while retaining `isPlaying` intent. Release/interruption resumes from the held time; explicit Pause cancels resume. Non-loop endpoint release pauses. Successful selection resets time and pauses; failed selection preserves the working session.
- State subscriptions synchronize the button label, ruler/playhead, numeric time, metadata, and preview. Status-only changes skip evaluator/render work; playback does not measure timeline layout or rewrite unchanged controls.
- Preview uses `AnimationPlayer.sample(..., { mode: 'playback' })`. It compiles only when working-animation identity changes, with preview-only `loop: false` and `events: []`. There is no second interpolator, runtime clock advancement, or gameplay event dispatch.
- Joint preparation restores prior procedural output before sampling. Runtime pose presets and `PosePipeline.syncPose()` handle subsequent pose processing, configured constraints/IK, and rendering. Preview does not add or reorder weapon constraints. Sparse selection resets joint transforms without disabling configured constraints. Both partial and full IK mixes remain stable across repeated sampling.
- Facing mirrors the outer puppet container and leaves authored local animation transforms intact. The shipped Animation Editor has no IK/facing controls; embedding with configured IK/facing remains supported and tested.
- Timing/state code remains independent of DOM/Phaser and testable in Node. Strict TypeScript remains enabled; no explicit `any`, dependencies, React, global playback state, evaluator duplication, or schema changes were introduced.

## Authored versus transient state

Authored mode/FPS changes use validated, frozen working-copy replacements and snapshot undo/redo. They can dirty the working animation; key/event times and the immutable source remain untouched. Saving/export UI remains deferred.

Time, selection, Play/Pause, Restart/Home, loop preference, speed, scrubbing, and puppet IK/facing/presets are preview state. They do not alter animation snapshots, dirty state, or authored history. Existing unsaved edits remain protected during navigation and selection.

## Files changed

- `src/devtools/animation-editor/AnimationEditorPreview.ts`: preserve procedural configuration on reset; strip preview events; remove unnecessary non-null assertions.
- `src/devtools/animation-editor/TimelineController.ts`: global Home and modifier/IME/input guards.
- `src/devtools/animation-editor/main.ts`: shortcut help and accessible Home metadata.
- `src/devtools/animation-editor/timeline.ts`: finite duration fallback.
- `tests/animationEditorPlayback.test.ts`: short/long/extreme durations and repeated command/selection cycles.
- `tests/animationEditorPreview.test.ts`: IK/preset/facing compatibility and all-marker suppression across initialization/recompilation.
- `tests/animationEditorTimeline.test.ts`: invalid duration cases.
- `tests/browser/animationEditor.spec.ts`: global Home, guarded keyboard targets, repeated selection, and visibility interruption.
- `README.md`, `docs/animation-editor.md`, `docs/development.md`: shortcuts, ownership, regression coverage, and version documentation.
- `docs/animation-editor-playback-verification.md`: this report.
- `package.json`, `package-lock.json`: milestone version.

The supplied plan and future-plan files were not edited.

## APIs

No public engine or serialized-data API changes. `AnimationEditorState` still owns `currentTime`, `play()`, `pause()`, `restart()`, `advancePlayback()`, speed/loop preferences, scrubbing, and authored settings/history. `TimelineController` extends Home handling to non-typing targets. `AnimationEditorPreview` no longer requires `resetToBindPose()` from its puppet adapter; it uses existing joint `reset()` and pose preparation instead. `animationDurationSeconds()` now returns zero for nonfinite duration inputs.

## Tests and verification

Added 11 unit cases and three browser scenarios (six cases across development and production). Existing playback/settings tests cover speed, authored FPS, source/working-copy isolation, dirty/history invariants, endpoint handling, scrub intent, switching, and large/overflowing deltas.

- `npm run typecheck`: passed.
- `npm run test`: 815 passed; 26 existing optional profile cases skipped.
- `npm run build`: passed; demo, library, declarations, and built `/core` Node smoke check.
- `npm run check`: passed.
- `npm run check:version`: passed.
- `git diff HEAD --check`: passed.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test`: all 82 passed across development and production (7.0 minutes).

The full unit suite covers Rig Editor editing/history/export, Puppet runtime, smooth/stepped sampling, blending, masked layers, runtime events, IK, slots, attachments, skins, character loading, and JSON validation. Browser checks exercise real Phaser rendering and route/base-path behavior in both builds.

## Manual verification

Browser interactions are driven by Playwright; no separate human-driven manual session is claimed. Development desktop/narrow and production desktop screenshots were reviewed visually; artwork, controls, ruler, and endpoint playhead remained consistent. The browser pass covers smooth and stepped clips, loop on/off, multiple speeds, scrubbing paused/playing, switching animations, restart paused/playing, final-frame holding, shortcut guards, repeated selection, and focus/visibility interruption. Rig Editor scenarios cover editing, undo/redo, exports/imports, and reload. Demo scenarios cover runtime playback, IK, and mirrored presentation. Animation preview IK/presets/facing are additionally verified against runtime sampling in unit integration tests because the Animation Editor page does not expose those controls.

## Deferred to v0.5.2.3+

Bone tracks; keyframe creation, deletion, moving, selection, and copy/paste; interpolation editing; event editing; onion skinning; mirrored keyframes; IK target authoring; IK baking; and the final animation export workflow remain deferred.
