# Paper Puppeteer Engine — v0.5.7.3
## Advanced Timeline Snapping & Guides

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.7.2**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

Existing timeline features:
- Keyframe dragging/group movement
- Frame snapping
- Timeline zoom and scrolling
- Keyframe selection
- IK target tracks
- Event markers
- Undo/Redo

Do not rewrite existing snapping/movement systems.

## Goal

Implement **v0.5.7.3 — Advanced Snapping & Guides**.

Extend existing snapping so artists can precisely align animation timing.

### 1. Snap target types

Support snapping to:
- Authored frame boundaries
- Existing keyframe times
- Animation event times
- Current playhead time

Reuse existing time-coordinate and marker models.

Do not create competing timeline coordinate calculations.

### 2. Snap settings

Add React controls such as:

```text
SNAPPING

[x] Enable Snapping

[x] Frames
[x] Keyframes
[x] Events
[x] Playhead
```

Use existing UI conventions.

Snapping settings are editor-only.

They must not be serialized into animation JSON or mark animation dirty.

### 3. Shared snap resolver

Create or extend one centralized snapping operation.

Conceptually:

```ts
resolveTimelineSnap(
  proposedTime,
  context,
  settings
): SnapResult
```

The result should include:
- Resolved time
- Snap target type
- Target time
- Information required to display a guide

Adapt types to the existing codebase.

Avoid duplicated snapping logic in React components.

### 4. Pixel-aware tolerance

Use a reasonable snapping threshold in screen pixels, converted through the current timeline zoom.

This ensures snapping feels consistent at different zoom levels.

Do not rely on one fixed tolerance in animation seconds at every zoom level.

### 5. Deterministic priorities

When several targets are nearby, choose deterministically.

Prefer nearest eligible target first, with a documented tie-breaking policy.

Do not let the order of DOM elements determine snapping.

### 6. Exclude self-snapping

When dragging a key, it must not snap back to its own original marker unless that is an intentional no-move result.

For group movement, exclude the selected keys' original positions from candidate targets.

Avoid false self-collisions.

### 7. Group movement

Existing multi-key dragging must preserve relative timing.

Resolve snapping for the group's anchor and apply one shared time delta.

Do not snap each key independently.

### 8. Visual snapping guide

While dragging, display a subtle vertical guide at the active snapped time.

Optionally show a small label such as:

```text
Snap: Event @ 0.750 s
```

Hide the guide after the gesture ends.

Do not overload the timeline with permanent guide lines.

### 9. Temporary snapping override

If compatible with existing shortcuts, allow a modifier key to temporarily disable snapping during drag.

Use the established editor convention.

Document it in shortcut help.

### 10. Event and IK integration

Reuse snapping in supported:
- Bone key movements
- IK key movements
- Animation event dragging

Do not force unsupported generic operations into a shared code path without proper typing and validation.

Same-time event rules must remain different from same-track keyframe collision rules.

### 11. Atomic history

Snapping only determines proposed authored times.

Final mutations must still go through existing transactional operations.

One drag remains one Undo action.

Cancelled drags must leave animation unchanged.

### 12. Tests

Add tests for:
- Frame snap
- Keyframe snap
- Event snap
- Playhead snap
- Multiple nearby candidates
- Tie-breaking
- Self-snap exclusion
- Group delta preservation
- Zoom-dependent tolerance
- Disabled snapping
- Undo/Redo integration
- Source immutability

### 13. Manual verification

Test at several zoom levels:

1. Drag a key near another key.
2. Drag near an animation event.
3. Drag near the playhead.
4. Toggle snapping modes.
5. Move multiple selected keys.
6. Verify relative spacing.
7. Temporarily disable snapping.
8. Cancel a drag.
9. Undo/Redo a snapped move.

### 14. Do NOT implement

- New interpolation methods
- New keyframe types
- Bulk retiming
- Automatic animation cleanup
- IK baking changes
- Curve editor

### 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Frame/key/event/playhead snapping works
- Shared snap resolver exists
- Zoom-aware tolerance is consistent
- Guides display correctly
- Group dragging preserves spacing
- Collision handling remains correct
- Snap controls do not dirty animation
- Existing keyframe/event editing remains functional
- Tests, typecheck and build pass

## Final report

Report:
1. Implemented snapping modes
2. Snap resolution architecture
3. Priority/tolerance policies
4. Guide rendering
5. Group-movement integration
6. Files/APIs changed
7. Tests
8. Manual verification
9. Required command results

Do not claim completion unless all commands pass.
