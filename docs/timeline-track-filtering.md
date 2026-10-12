# Timeline track search and filtering

[Animation Editor](animation-editor.md) · [All guides](../README.md#guides)

Milestone v0.5.7.1 is packaged as `0.5.7-1`.

## Navigation

Search tracks by bone ID (the rig's bone label), transform property, IK constraint name (the target label), `IK:`, `mix (influence)` or `Events`. Matching ignores case and surrounding whitespace. The current rig model has no separate bone display name or target-name field. Event names and payloads are not track labels and are not searched.

Search opens matching property groups temporarily and retains the ancestor path of each bone result. Ancestors shown only for context have italic labels. Collapsing a matched group retains its matching group label; a property search with Keyed Tracks Only retains collapsed groups only when that property has authored samples.

Show All Tracks, Keyed Tracks Only and Selected Target Only combine with search and independent IK/event checkboxes. Selected Target Only follows the selected bone, IK constraint or event. Keyed Tracks Only hides empty property channels and empty event tracks, preserving unkeyed ancestors when needed for context. A time-only sample is not an authored property key.

Expand All and Collapse All affect bone and IK property groups. Expand Selected opens the selected target and every group containing selected bone keys. Bone collapse hides its properties, as before; descendant bone groups keep their existing independent expansion. On narrow screens, open the Expand / collapse disclosure to access these commands.

Clear Filters resets search, track mode and both visibility toggles. It restores expansion preferences held before the search. Expansion changes made during search last for that search; changes made outside search remain normal manual preferences. Reset layout also clears all filters. Preferences stay local to the editor session and are not persisted to authored JSON.

## Selection and editing

Filtering and collapse retain bone, property, selected keys, primary key, IK target/key and event selection. A status message identifies hidden selection; Reveal Selection clears filters and expands every selected bone/IK group. Preview picking continues through the existing selection owner, including when the picked bone is hidden by search.

Copy, paste, duplicate, delete, drag and keyboard group operations use the complete selected key set. Delete shows the affected count and the hidden count; the selection status explicitly says commands include hidden keys. A hidden event retains its inspector and deletion command. Additive rectangle selection preserves existing hidden selected keys but never adds newly hidden rows, including hidden rows between visible ones.

Playback, scrubbing and key timing use the existing timeline clock and coordinates. Filters do not trim authored tracks or alter the animation's duration.

## Architecture and changed files

`timelineFiltering.ts` provides pure search expansion and visibility derivation. It returns references to existing `TimelineTrack` rows and context ancestors, event visibility and hidden-selection metadata. It reads the existing property-key queries and rig hierarchy; it does not own a second authored track model.

`AnimationEditorSelection.ts` owns filter preferences, temporary search expansion overrides, existing manual expansion sets and a visibility cache. Its dependencies are row identity, filter preferences, selection and event data. `AnimationEditorState.ts` exposes notification-batched editor commands. Neither class installs a working animation, records history, changes dirty state or modifies the rig for navigation. Playback-only notifications retain row and visibility identities.

The React shell in `editorMarkup.tsx` supplies the search, visibility and expansion controls, responsive expansion disclosure, status and empty-result hosts. `TimelineController.ts` binds controls and reveals selection; `TimelineTracksController.ts` changes label/lane visibility together while retaining row indices and surviving marker elements. `TimelineSessionController.ts` renders actual deletion counts. `AnimationWorkspaceController.ts` clears filters during layout reset. `style.css` supplies context styling and the compact narrow-screen layout.

`AnimationEditorSelectionCommands.ts` and `keyframeSelection.ts` apply visual visibility only to new rectangle-selection candidates; existing selection and authored operations remain independent. Package metadata, changelog, README and the editor guide record the milestone.

## Verification

Unit coverage in `tests/timelineFiltering.test.ts` exercises case-insensitive search, property/IK/event labels, nested hierarchy, keyed-only filtering, selected-target synchronization, combined visibility toggles, expansion restoration, empty results, hidden selection/reveal, additive marquee, complete clipboard/deletion/group scopes, and source/working/rig/history/export immutability. It also checks cached row and visibility identity during playback and scrubbing.

Local browser coverage in `animationTrackFiltering.spec.ts` and the existing timeline/workspace suites exercises the shipped Demo puppet, forearm search, keyed-only mode, hidden IK/events, expansion, empty/cleared search, hidden multi-key deletion and Undo, IK/event reveal, preview picking while filtered, play/scrub, unchanged row DOM during playback, alignment, dense tracks, resizing and narrow layout. These checks remain local-only.

For a hands-on walkthrough, search `forearm`, enable Keyed Tracks Only, hide IK tracks, expand/collapse groups, pick a bone in the canvas, reveal it, scrub/play, then Clear Filters. Confirm that the dirty indicator and Undo availability do not change from navigation. Desktop and 390×844 screenshots were inspected locally; the narrow ruler remains visible and the page has no horizontal overflow. Browser scenarios exercise the interaction walkthrough automatically.

Verified commands on 2026-10-12:

| Command                 | Result                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| `npm run typecheck`     | Exit 0                                                             |
| `npm run test`          | Exit 0; 123 files passed, 3 skipped; 2070 tests passed, 32 skipped |
| `npm run build`         | Exit 0; demo, library, declarations and Node `/core` check passed  |
| `npm run check`         | Exit 0; formatting, lint and typecheck passed                      |
| `npm run check:version` | Exit 0; `0.5.7-1` is valid SemVer                                  |

The filtering suite adds 20 unit cases. Local browser verification uses installed Chrome because the bundled Playwright executable is unavailable:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationTrackFiltering.spec.ts tests/browser/animationTimelineTracks.spec.ts tests/browser/animationWorkspace.spec.ts tests/browser/animationTimelineUpdates.spec.ts
```

Result: exit 0; all 30 browser scenarios passed across development and production. No browser installation or browser checks were added to CI.

## Deferred functionality

No new keyframe types, IK systems, bulk retiming, snap modes, sprite replacement, rig tweaking or scene choreography. Existing IK group selection, dragging and clipboard limits remain unchanged. Saved search presets, persistent layout storage, and searching individual event names are outside this milestone.
