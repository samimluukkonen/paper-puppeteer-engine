# Paper Puppeteer Engine — v0.5.7.2
## Timeline Navigation & Zoom

Continue Paper Puppeteer Engine development.

**Current completed version: v0.5.7.1**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

The Animation Editor already supports:
- Track search/filtering
- Timeline ruler and playhead
- Keyframe tracks
- Scrubbing and playback
- Frame snapping
- Keyframe selection
- IK targets, animation events and keyframe editing

Do not redesign working timeline infrastructure.

## Goal

Implement **v0.5.7.2 — Timeline Navigation & Zoom**.

Make editing short and long animations easier through precise timeline navigation.

### 1. Horizontal timeline zoom

Add zoom in/out controls.

Use the existing timeline time-to-pixel mapping.

Zoom changes visual scale, not authored animation time.

Provide sensible minimum/maximum zoom bounds.

### 2. Cursor-anchored zoom

When zooming around the pointer, preserve the time under that pointer as closely as possible.

This prevents the timeline from jumping unexpectedly.

If pointer anchoring conflicts with the existing architecture, use playhead-centered zoom as a documented fallback.

### 3. Horizontal panning

Support comfortable horizontal navigation.

Reuse existing scrolling where possible.

Suitable interactions may include:
- Shift + mouse wheel
- Trackpad horizontal scrolling
- Middle-button dragging, if conflict-free
- Existing scrollbar

Do not interfere with keyframe dragging or marquee selection.

### 4. Fit commands

Add:
- Fit Entire Animation
- Fit Selected Keyframes
- Center Playhead

Fit Selection should use the full time range of selected compatible keys.

If selection is empty, disable it or fall back to Fit Entire Animation.

These actions must not modify keyframe times.

### 5. Playhead follow

During playback, optionally keep the playhead visible.

Do not constantly center it if that produces distracting motion.

Use an unobtrusive follow policy when the playhead approaches the viewport edge.

Allow the artist to disable auto-follow.

### 6. Precise time navigation

Provide a compact editable current-time control.

Support accurate jumps to a timestamp.

If the animation has valid authored FPS, also support frame-number display/input using the existing time conventions.

Keep the underlying animation time continuous.

Do not change animation data merely by navigating to a frame.

### 7. Keyboard navigation

Use the existing shortcut infrastructure.

Support sensible commands such as:
- Home: start
- End: animation end
- Previous/Next key where existing selection makes this meaningful
- Zoom In/Out
- Fit Animation

Do not hijack keys while typing in inputs.

Avoid conflicts with the existing keyframe nudge commands.

### 8. Shared coordinate architecture

All timeline elements must share one time coordinate system:

- Ruler
- Playhead
- Bone keyframes
- IK target keys
- Animation events
- Marquee
- Drag preview
- Onion-skin references

Do not duplicate time-to-X conversion algorithms.

Ensure zoom and scroll are handled consistently.

### 9. Edge cases

Handle:
- Zero-duration animation
- Very short animation
- Long animation
- Empty selection
- Key at time 0
- Key at duration
- Window resize
- Different browser zoom levels
- Timeline with many tracks

### 10. Tests

Add tests for:
- Time/pixel conversions
- Zoom anchoring
- Pan offset
- Fit animation
- Fit selection
- Center playhead
- Frame/time conversion
- Boundary handling
- No authored mutation
- Selection preservation

### 11. Manual verification

Test:
1. Zoom in on a small group of keys.
2. Pan horizontally.
3. Scrub while zoomed.
4. Move a key while zoomed.
5. Fit selected keys.
6. Fit entire animation.
7. Play with auto-follow enabled.
8. Resize the editor.
9. Confirm markers and playhead remain aligned.

### 12. Do NOT implement

- New keyframe manipulation modes
- Advanced snapping guides
- Bulk time stretching
- Curve editor
- Scene choreography

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Timeline zoom works
- Timeline pan works
- Fit commands work
- Time/frame navigation works
- Optional playhead follow works
- Existing selection/editing remains accurate
- Shared coordinate conversions remain consistent
- Source/working animation unchanged by navigation
- Tests, typecheck and build pass

## Final report

Report:
1. Features implemented
2. Timeline coordinate architecture
3. Zoom/pan behavior
4. Fit and navigation commands
5. React components/files changed
6. Tests
7. Manual verification
8. Required command results

Do not claim completion unless all commands pass.
