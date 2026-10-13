# Advanced timeline snapping and guides

[Animation editor](animation-editor.md) · [Timeline navigation](timeline-navigation.md)

v0.5.7.3 adds **Enable Snapping** and independent **Frames**, **Keyframes**, **Events** and **Playhead** controls to the Animation Editor. Snapping starts disabled, preserving continuous editing; all target types are initially selected. Preferences belong to the loaded editor session, survive animation changes/imports, and never enter animation JSON, dirty state or Undo history.

Drag a bone key or animation event near a target to align its authored time. A dashed green vertical guide and `Snap: Event @ 0.750 s` label show the active target. The guide uses the same content-time/pixel projection as markers and disappears when the pointer leaves tolerance, snapping is bypassed, or the gesture ends or is cancelled. Hold **Shift** after starting a drag to bypass snapping; releasing Shift restores it even without moving the pointer. Existing Shift-click range selection remains available.

Targets include authored bone and IK property markers on collapsed or filtered tracks, all animation events, and the playhead time captured **before** drag selection seeks to the anchor. Preview clock updates do not move this captured target. Frames use authored stepped FPS, or the existing 10 FPS fallback for smooth clips. Preview speed and ruler tick spacing do not define the frame grid. Off-grid clip endpoints remain reachable through ordinary boundary clamping. When a pointer reaches or overshoots a hard clip/group bound, the bound takes precedence and only a target at that exact bound can display a guide.

The threshold is **8 screen pixels**, converted to seconds with `timelineXToTime(8, duration, contentWidth)`. Content width already includes zoom. Thus a target five pixels away attracts at 1×, 2× and 4×, while a target twelve pixels away does not. Select the nearest eligible target first. Equal distances prefer **Playhead → Event → Keyframe → Frame**; equal type/distance prefers the earlier time. Numerical equality uses only floating-point roundoff tolerance, independently of authored collision tolerance. DOM order, authored row order and visibility do not determine priority.

For a selected group, snapping resolves the clicked anchor once, within the group's feasible time bounds. The existing movement command applies one delta to every selected property. Selected source marker identities are excluded; another unselected property or event at the same time remains eligible. Relative spacing survives snapping and duration boundaries. Bone collisions retain the existing same-track property replacement rules, including sparse siblings. Events keep separate identities and permit multiple events at one time.

IK markers retain their existing single-key movement/arrow commands, now using the same resolver and authored targets. Marker dragging, group selection and clipboard commands for IK remain unavailable. Canvas IK target manipulation edits target coordinates and does not use timeline snapping. Arrows retain the existing one-frame step when Frames is enabled, otherwise 0.01 seconds; Shift multiplies the step by ten. Nudges exclude their own source and do not attract back to the coincident current playhead. Numeric bone/event inspector times remain explicit continuous edits.

Drag previews hold only provisional times and guide metadata. Release passes the resolved authored time into existing validated transactional commands. Each changed drag records one Undo action. Escape, pointer cancellation/capture loss, blur, page hiding, disposal, navigation, selection, document edits and history changes cancel without modifying animation data. Undo/Redo restores exact snapshots and collision values; loaded source animations remain immutable.

## Implementation and editor APIs

- `timelineSnapping.ts`: `resolveTimelineSnap(proposedTime, context, settings)` returns `time`, `targetType`, `targetTime` and `guide`. `buildTimelineSnapTargets(animation)` uses existing property lists, key identities and opaque event references. `AnimationEditorTimelineSnapping` owns frozen session settings, measured geometry, authored FPS and candidates cached per working snapshot. Headless callers can set content width explicitly; the fallback is 100 pixels per second.
- `AnimationEditorState`: `timelineSnapSettings`, `setTimelineSnapSettings(patch)`, `setTimelineSnapContentWidth(width)` and `timelineSnapGuide`. The existing `setKeyframeSnapMode('none' | 'frame')` remains a compatibility adapter selecting disabled or frame-only snapping.
- `AnimationEditorKeyframeCommands`, `AnimationEditorEventCommands`, `AnimationEditorIKCommands`: typed resolver contexts, source exclusions and existing mutation/history boundaries. Bone/event drag records include captured `playheadTime` and transient `snapGuide`.
- `TimelineInputController`: measured content geometry and Shift key transitions. `TimelineController`: guide rendering through `timeToTimelineX`. `TimelineSessionController`, React `editorMarkup.tsx` and `style.css`: preference controls and subtle guide styling.

No engine/package exports, runtime sampling, animation schemas, interpolation, IK baking or keyframe types change. Package version is `0.5.7-3`.

## Verification

`tests/timelineSnapping.test.ts` covers the four modes, individual toggles, nearest-target selection, deterministic ties, identity exclusions, active settings/override refresh, forward/backward nudge progress, zoom-dependent tolerance, disabled/overridden snapping, malformed geometry/FPS, bounds, immutable settings/source data, group spacing, guide lifecycle, bone/IK collision replacement, distinct same-time events, cached targets after history and atomic Undo/Redo.

Local-only `tests/browser/animationTimelineSnapping.spec.ts` exercises all modes at 1×/2×/4×, five-pixel attraction versus twelve-pixel rejection, actual guide projection/labels, stationary-pointer Shift transitions, Escape/pointer cancellation, clean preferences/previews, group timing, snapped Undo/Redo and event stacking. Existing key/group/event/IK movement browser regressions use the new checkboxes and proximity-based frame policy. Browser checks remain outside CI.

For an interactive check, enable one mode at a time and drag near a key, event and playhead at several zoom levels. Select keys with different original times, drag one anchor, and compare their spacing. Hold/release Shift; cancel with Escape; then commit a snapped move and Undo/Redo it. Verify that toggling controls and cancelled drags leave **No unsaved changes** and exports unchanged.

Verified locally: `npm run typecheck`, `npm run test` (2,113 passed, 32 existing skips), `npm run build` and `npm run check` passed. The 22 selected Chrome browser scenarios passed across development and production, using a 60-second scenario budget. Browser verification exercised the checklist at 1×/2×/4×; the group-guide screenshot was visually inspected and the label's stacking above the sticky ruler corrected. No separate human interactive session was performed.
