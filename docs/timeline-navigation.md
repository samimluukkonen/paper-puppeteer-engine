# Timeline navigation and zoom

[All guides](../README.md#guides)

The Animation Editor keeps navigation outside authored animation data and Undo/Redo. Zoom, scroll, fit, follow and time/frame jumps preserve selected keys, animation times, source/working snapshots and exports.

## Zoom and pan

On narrow screens, open **Navigation** for the fit, center, follow and zoom buttons.

Use **+ / −** or the Zoom menu for 1× (Fit) through 128× horizontal scale. Buttons and menu changes anchor the playhead's viewport position, clamped to the nearest edge when it is offscreen. **Ctrl/Cmd + mouse wheel** uses continuous zoom anchored at the pointer. Scroll boundaries can prevent exact anchoring near the start/end. All dimensions use measured CSS pixels, including fractional dimensions at browser zoom levels.

**Shift + mouse wheel** pans horizontally. Trackpad horizontal scrolling and the native scrollbar also work. Ordinary wheel scrolling still navigates many tracks vertically. Changing zoom cancels an active key/event drag or marquee before changing its coordinate scale; scrolling updates existing drag and marquee previews through the same coordinate conversions.

## Fit and precise navigation

- **Fit Entire Animation** restores 1× and scrolls to the start.
- **Fit Selected Keyframes** includes the complete range of selected bone keys across properties and tracks, including hidden keys. The existing single IK key or selected event can also be fitted. Empty selection disables the command. Ranges receive 10% padding on either side where bounds permit; one timestamp uses 8×. Zoom limits still apply.
- **Center Playhead** scrolls the current time to the middle where content bounds permit.
- **Time (s)** accepts continuous seconds. Enter or committing the field jumps to that time and centers it. Values clamp to the animation range; invalid/empty input restores the current time. Escape restores unfinished text.
- **Frame** appears for valid authored stepped FPS. Frames are zero-based: frame N seeks to N/FPS seconds, clamped to duration. The display follows the engine's frame-boundary tolerance and flooring convention. Displaying a frame never rounds the underlying continuous editor clock. Fractional/unsafe frame numbers are rejected.

**Follow playhead** is enabled by default and can be disabled. During playback it scrolls by a viewport portion when the playhead approaches an edge, leaving comfortably visible playback still. Paused scrubs never trigger follow. Resizing preserves zoom and the center time; selecting another animation or character resets the view to Fit. Reset layout also restores Fit.

## Keyboard commands

Typing inputs, selects, editable regions, dialogs, IME composition and modified shortcuts retain their existing guards. Home/End jumps to the animation start/end outside typing controls. With timeline focus, **+ / = / −** zooms, **F** fits the animation, and **[ / ]** selects the previous/next authored key on the selected bone property. Existing Left/Right key nudges and ruler arrow scrubbing keep their behavior.

## Coordinate ownership

`timeline.ts` remains the sole content-time/pixel conversion implementation. `timelineNavigation.ts` composes those functions with measured content/viewport widths and native `scrollLeft`; it provides pure bounded zoom, fit, pan, center, follow and runtime-compatible frame conversions. `TimelineNavigationController` owns only transient view preferences and native input listeners. `TimelineController` supplies the same measured timeline width to ruler ticks, playhead, bone/IK/event tracks and summaries. `TimelineInputController` obtains scroll-adjusted content bounds for scrubbing, key/event drag previews and marquee selection. No second time-to-X algorithm is introduced. Onion-skin poses continue to use the same continuous session clock and existing neighboring-key references, independent of visual timeline scale.

The ruler generates ticks for the visible range at the current scale while retaining exact start/end markers; zooming a long clip does not allocate ticks for its entire offscreen extent.

## Verification

Pure and controller tests cover conversion round trips, pointer anchoring, boundaries, fit ranges, hidden multi-property selection, center, resize, optional follow, frame conventions, invalid drafts, listener cleanup and immutable source/working/history/export data. Local Playwright scenarios exercise pointer zoom/pan, zoomed scrubbing and key dragging, fit, precise jumps, keyboard guards, playback follow, resizing and zero duration against development and production. Browser checks remain local-only.

For hands-on verification, zoom into a small key group, pan, scrub and move a key, then Undo. Fit the selection and the entire animation, play with follow enabled/disabled, and resize the editor. Confirm key/event/IK markers, ruler and playhead stay aligned. Use an authored stepped clip to compare continuous Time (s) with zero-based Frame input.
