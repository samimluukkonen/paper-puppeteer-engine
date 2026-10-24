# Paper Puppeteer Engine — v1.1.2.2
## Visual Graph / Curve Editor

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.1.2.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The Animation Editor already supports keyframes, timeline selection, interpolation, Undo/Redo and a shared curve evaluation foundation.

## Goal

Implement a visual **Graph Editor** inside Animation Editor.

The artist should be able to see and modify how an animated property changes over time.

Examples:
- Bone rotation
- Bone X/Y translation
- IK target position
- IK influence

Use the actual supported property channels.

## 1. Inspect existing editor

Review:
- Timeline layout
- Track selection
- Keyframe selection
- Property inspector
- Time zoom/pan utilities
- Animation working-copy controller
- History transactions
- Existing curve interpolation APIs

Reuse existing state and utilities.

## 2. Graph Editor panel

Add a Graph Editor view/panel accessible from Animation Editor.

Suggested UI:

```text
ANIMATION EDITOR

[ Timeline ] [ Graph Editor ]

Selected Bone: rightForearm

Property:
[ Rotation ▼ ]

       Value
         |
     •───╮
         ╰────•
         |
         +------------ Time

[Auto] [Linear] [Stepped] [Bezier]
```

This is conceptual.

Follow existing React styling.

## 3. Property selection

Allow selecting supported numeric animation channels.

Examples:
- Translation X
- Translation Y
- Rotation
- Scale X/Y
- IK target X/Y
- IK influence

Show only channels that exist or are supported by the current animation schema.

Do not invent unsupported properties.

## 4. Curve visualization

Display:
- Keyframe points
- Interpolated curve
- Time axis
- Value axis
- Selected keyframe
- Bézier handles for applicable segments
- Current playhead position

Use the existing runtime evaluator to sample graph curves.

Do not use a separate interpolation approximation that disagrees with actual playback.

## 5. Curve editing

Support:
- Selecting keys
- Moving key times where permitted
- Editing key values
- Dragging Bézier handles
- Choosing interpolation mode
- Resetting handles to a sensible default
- Numeric editing for precision

Ensure handle movement respects valid segment time boundaries.

Do not silently reorder or merge keys.

## 6. Timeline synchronization

Graph Editor and Timeline must share:
- Current animation
- Current playhead
- Selected bones/tracks
- Selected keyframes
- Authored document
- Undo/Redo

Changes in Graph Editor must be immediately reflected in Timeline and Phaser preview.

Avoid competing copies of selection or keyframe state.

## 7. Coordinate system

Implement correct conversions between:
- Animation time
- Property value
- Graph coordinates
- Pointer coordinates

Support:
- Zoom
- Pan
- Resize
- Negative values
- Small/large ranges
- Frame snapping, where appropriate

Graph scaling must not alter authored keyframe data.

## 8. Rotation and angle display

Display angular values using the project's existing degree/radian conventions.

Preserve shortest-path and rotation-wrapping semantics.

Avoid visual discontinuities caused only by display wrapping.

## 9. Editing and history

One completed drag must produce one Undo operation.

Support Escape to cancel.

Preview-only pointer movement must not commit partially invalid interpolation handles.

Do not modify unrelated channels.

## 10. Live preview

Changing an interpolation curve should update the character pose immediately at the current playhead.

Playback should use the new curve through the normal runtime evaluation path.

Avoid excessive React re-renders during Phaser playback.

## 11. Keyboard and usability

Support:
- Keyframe selection
- Delete where appropriate
- Escape/cancel
- Focus-safe keyboard shortcuts
- Inspector synchronization
- Clear empty states

Tooltips should explain tangent handles and interpolation modes.

## 12. Tests

Cover:
- Graph rendering data
- Property selection
- Keyframe editing
- Tangent dragging
- Invalid handle constraints
- Rotation curves
- Timeline synchronization
- Undo/Redo
- Live preview
- Zoom/pan
- Resize
- Export/import
- React lifecycle cleanup

## 13. Manual verification

1. Open an animation.
2. Select a forearm bone.
3. Open Graph Editor.
4. Select Rotation.
5. Add multiple keyframes.
6. Switch interpolation to Bézier.
7. Drag tangents.
8. Preview the animation.
9. Compare graph and actual movement.
10. Undo/Redo.
11. Export/reload.
12. Confirm the curve is preserved.

## 14. Out of scope

Do not implement:
- Automatic curve generation
- Full physics-based animation
- Animation retargeting
- Scene choreography editing
- New IK solvers

## 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- A visual Graph Editor is available.
- The artist can inspect property curves.
- Bézier handles can be edited.
- Curve changes affect actual playback.
- Timeline and graph stay synchronized.
- Undo/Redo works.
- Serialization works.
- Old animations remain compatible.
- Tests, typecheck and build pass.

## Final report

Provide Graph Editor components, coordinate conventions, evaluator reuse, history behavior, files/APIs changed, tests, actual manual verification and exact command results.
