# Paper Puppeteer Engine — v0.9.7.2
## Animation Editor Ground Guide & IK Alignment

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.7.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The shared Ground Reference foundation is implemented.

The Animation Editor already supports:
- Bone keyframes
- IK constraints and IK target animation
- IK baking
- Foot planting
- Timeline playback/scrubbing
- Onion skinning
- Mirroring
- Rig-Tweak mode
- Undo/Redo

Do not rebuild these systems.

## Goal

Integrate a visible, configurable ground reference into Animation Editor.

The artist must be able to use it while creating walking, running, jumping, crouching and other foot-based animations.

## 1. Ground controls

Add a Ground section to an appropriate Animation Editor toolbar, viewport panel or inspector.

Suggested UI:

```text
GROUND REFERENCE

[x] Show ground line

Ground Y: [ 120 ]

[x] Enable snapping

[Reset Ground Position]
```

Follow existing React UI conventions.

## 2. Visual ground line

Render the horizontal line across the character preview.

The guide must remain stationary in preview-world coordinates while:
- Animation plays
- The playhead moves
- Bones animate
- IK targets animate
- Onion skinning is enabled

Camera zoom/pan should move its screen position appropriately.

Do not parent the ground guide to an animated bone or Puppet transform.

## 3. Dragging ground level

Allow the artist to reposition the ground line vertically.

Use a clear ground-guide drag handle or dedicated tool.

Requirements:
- Correct screen-to-world conversion
- No interference with joint/IK dragging
- Numeric inspector synchronization
- Escape to cancel
- Undo/Redo for persisted configuration edits where appropriate

Dragging the ground must not change any animation keys.

## 4. IK target alignment

Provide a small optional action:

**Align Selected IK Target to Ground**

Use the existing IK target authoring system.

Important:

- IK targets are not necessarily located at the bottom of the character's feet.
- The existing rig may have an offset between foot sole and IK end effector.
- Do not assume target Y equals sole-contact Y.

If the rig already has a foot-contact marker or usable offset, calculate correct alignment using existing transforms.

If no trustworthy contact point exists, either provide an explicitly labeled "Align IK target Y to guide" action or disable exact foot-contact snapping with a helpful explanation.

Do not claim exact contact alignment without the necessary data.

## 5. Animation data safety

Moving or toggling the ground guide must NEVER:
- Create keyframes
- Change bones
- Reposition IK targets
- Bake IK
- Move animation events
- Change animation duration

Only an explicit user-requested IK alignment action may author or modify IK keys through existing authoring APIs.

## 6. Timeline behavior

Verify the ground stays in the correct place during:
- Scrubbing
- Playback
- Pausing
- Looping
- Reversing direction where supported
- Animation switching

Avoid recreating the overlay every animation frame.

## 7. Different animations

The ground reference should be available when:
- An existing animation is loaded
- A new animation is created
- An animation is empty
- A character has no animation yet, if the editor supports that state

Prefer a shared reference per character authoring workspace rather than forcing the user to configure the same ground position independently for every animation.

## 8. Facing and transforms

Verify with:
- Facing left/right
- Different character scales
- Root translation
- Foot IK animation
- Nested bone transforms
- Mirrored animations

A moving root must not accidentally drag the stationary ground reference.

## 9. Existing foot planting

Inspect current foot-planting logic.

Do not automatically change the foot-planting solver to use this new ground line.

The ground line is an authoring guide unless an existing explicit configuration mechanism safely supports using it.

## 10. Tests

Cover:
- Show/hide
- Ground dragging
- Numeric position
- Playback and scrubbing
- Coordinate transforms
- Animation switching
- IK target alignment
- Missing foot-contact data
- Undo/Redo
- Keyframe immutability
- React/Phaser cleanup

## 11. Manual verification

1. Open an existing walking animation.
2. Enable ground reference.
3. Align line with the visible foot-contact level.
4. Play animation.
5. Look for floating or penetrating feet.
6. Scrub through the walk cycle.
7. Edit IK target keys where appropriate.
8. Switch animation.
9. Confirm guide position persists.
10. Disable guide and ensure normal editing works.

## 12. Out of scope

Do not implement:
- Automatic foot locking
- Automatic keyframe generation
- Gravity
- Physics
- Collision
- Mesh deformation
- Terrain systems

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The Animation Editor has a usable ground-level reference that remains fixed during animation, supports visual adjustment, and can assist IK placement without silently modifying authored animation data.

## Final report

Provide UI changes, ground positioning behavior, IK alignment rules, data safety, files changed, tests and verification results.
