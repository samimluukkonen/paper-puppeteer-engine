# v0.5.2.4.1 — Bone and property timeline tracks

## Implemented

Every available rig bone now has a timeline row. Expansion reveals all supported transform properties (`x`, `y`, `rotation`, `scaleX`, `scaleY`). Bone and property rows display authored-key presence and synchronized selection. Track navigation stays outside authored data and history. The package version is `0.5.2-4.1`; runtime, schemas and library exports are unchanged.

## Timeline track architecture

`buildTimelineTracks()` returns a frozen flat array of discriminated `TimelineTrack` rows. Each row contains `boneId`, `depth` and `hasKeys`; bone rows add `expanded`, property rows add `property`. It reuses `boneHierarchy()` and the runtime's `transformProperties` ordering. Collapse hides properties while keeping descendants visible. Missing animation data produces the same available bones with empty key indicators; a missing rig produces no rows.

`getAuthoredBoneProperties()` reads sparse authored samples, including zero-valued samples, independently of evaluated pose and current time. Time-only rows and empty tracks do not count as authored property keys.

`AnimationEditorState` owns expansion and lazily caches visible rows by working-animation identity and expansion changes. Playback, scrub and selection notifications reuse that array. Authored edits and Undo/Redo automatically refresh key presence through their existing working-snapshot replacements.

`TimelineTracksController` renders one label and one full-width lane per visible row. It retains surviving elements when layout changes, preserving focused expansion controls. Playback does not rebuild DOM rows. Labels and lanes live in the same CSS grid scroll container and use matching fixed row heights. `TimelineController` retains the existing ruler, width observer, time conversion, pointer capture, keyboard navigation and global playhead across the time column. Scrub focus uses `preventScroll` so pointer-down preserves both row and page scroll position. The playhead line is centered on its shared time coordinate to remain visible at the endpoint, and the scroll container prevents horizontal overflow. Positioned property lanes can host future key markers in that shared coordinate system.

## Selection ownership

`AnimationEditorState.selectedBoneId` remains the sole selected-bone state for puppet picking, hierarchy, inspector and timeline. `selectedTimelineProperty` adds transient property selection. `selectTimelineProperty()` changes bone/property atomically with one notification. `selectBone()` clears the property selection, including selection of the same bone. Successful animation selection also clears property selection while retaining expansion for the rig session.

Selection changes cancel temporary transform drafts while keeping `currentTime` and playback intent. Expansion, collapse, scroll and selection never install animation snapshots, record history or change dirty state. Existing dirty edits and redo history are preserved. A collapsed property may remain selected until the next selection command.

## Files changed

- `src/devtools/animation-editor/timelineTracks.ts`: track types and pure row construction.
- `src/devtools/animation-editor/TimelineTracksController.ts`: stable label/lane rendering and navigation buttons.
- `src/devtools/animation-editor/AnimationEditorState.ts`: transient expansion/property state and cached visible rows.
- `src/devtools/animation-editor/TimelineController.ts`: track adapter integration and disposal.
- `src/devtools/animation-editor/keyframes.ts`: authored-property presence query.
- `src/devtools/animation-editor/main.ts`, `style.css`: shared scroll layout, row styling and full-height playhead.
- `tests/animationEditorTracks.test.ts`: pure track/session regressions.
- `tests/browser/animationTimelineTracks.spec.ts`: browser integration, geometry and navigation regressions.
- `docs/animation-editor.md`, this report: usage, API and verification documentation.
- `package.json`, `package-lock.json`: milestone version.

The requested plan and the other pre-existing plan files were preserved.

## APIs/types added or changed

- `TimelineTrack`, `BoneTimelineTrack`, `PropertyTimelineTrack`.
- `buildTimelineTracks(rig, animation, expandedBones)`.
- `getAuthoredBoneProperties(animation, boneId)`.
- `AnimationEditorState.timelineTracks`, `selectedTimelineProperty`.
- `isTimelineBoneExpanded(boneId)`, `setTimelineBoneExpanded(boneId, expanded)`.
- `selectTimelineProperty(boneId, property)`.
- `selectBone()` now clears transient property selection.
- `TimelineTracksController(labels, lanes)`, `render(state)`, `dispose()`.

All additions are editor APIs; no animation JSON fields or production package exports were added.

## Tests

Ten pure tests cover hierarchy ordering, all available bones, stable supported-property order, immutable rows, expansion, authored-key presence, atomic selection, invalid targets, source/caller isolation, clean/dirty state, history/redo preservation, draft cancellation, playback and scrub compatibility, cached row identity, key-presence refresh after authored edits/Undo/Redo, animation switching, empty tracks, no selection, missing rig, rejected zero-duration data, and the demo character's complete skeleton.

Three browser scenarios cover hierarchy/timeline/puppet selection synchronization, property selection, keyboard expansion and retained focus, scrolling and row/time-lane geometry, playback continuity, global playhead alignment, scrubbing after vertical scroll without shifting row/page scroll, desktop/narrow layouts, key-presence refresh after authoring and undo, unkeyed tracks, and no animation selected. Existing animation-editor and bone-authoring suites provide playback, pointer capture, settings/history, invalid-data, draft, IK/facing and route regressions.

## Manual verification

Verification uses automated Chrome interactions and inspection of captured screenshots. No separate hands-on browser session is claimed. Desktop and narrow track captures are produced by the browser suite under `test-results/`. The pure tests also compare every demo bone against the shared hierarchy and expand all bones to verify complete supported-property availability.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 1,016 tests passed, 26 skipped in the two existing profiling suites.
- `npm run build`: passed, exit 0; demo, library, declarations and Node `/core` smoke check succeeded.
- `npm run check:version`: passed, exit 0.
- Biome checks for the animation editor and added tests: passed, exit 0.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationTimelineTracks.spec.ts tests/browser/animationEditor.spec.ts tests/browser/animationBoneAuthoring.spec.ts`: passed, exit 0; all 62 scenarios passed against development and production builds using the repository's one-worker configuration.

## Deferred to v0.5.2.4.2+

Keyframe diamonds and marker selection, dragging/moving keys, multi-key and box selection, copy/paste, duplication, interpolation editing, event tracks, onion skinning, mirrored keys and IK target tracks remain deferred. This milestone provides the row containers and shared coordinate infrastructure for future markers.
