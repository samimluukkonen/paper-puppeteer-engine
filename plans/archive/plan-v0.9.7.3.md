# Paper Puppeteer Engine — v0.9.7.3
## Scene Editor Ground Guide & Actor Alignment

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.7.2**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Already implemented:
- Shared Ground Reference foundation
- Animation Editor ground guide
- Scene Editor
- Actor placement
- Actor movement and choreography
- Scene timeline
- Scene playback and scrubbing
- Scene import/export

Do not rebuild these systems.

## Goal

Add a scene-level horizontal ground reference to Scene Editor.

The artist should be able to place multiple Actors consistently on the same visual ground.

## 1. Ground reference in Scene Editor

Integrate the shared Ground Guide renderer.

The Scene Editor ground reference must be expressed in scene-world coordinates.

Add controls:

```text
SCENE GROUND

[x] Show Ground

Ground Y: [ 400 ]

[x] Snap to Ground

[Reset Ground]
```

Values are illustrative.

Use the actual scene coordinate conventions.

## 2. Visual behavior

The ground line should:
- Extend across the visible stage
- Stay aligned to scene-world Y
- Respond correctly to camera zoom/pan
- Remain visible during scene playback
- Remain visible during scrubbing
- Not be included in normal character artwork

Do not confuse camera movement with ground movement.

## 3. Ground adjustment

Allow the artist to drag the line vertically or enter Y numerically.

Changing Ground Y must not automatically:
- Move existing Actors
- Change authored movement paths
- Modify animation keyframes
- Alter character rigs

Keep it a deliberate editor operation.

## 4. Actor grounding

Provide an explicit action:

**Snap Selected Actor to Ground**

This should align a suitable character contact reference with the scene ground.

Important:

Actor origins are not necessarily positioned at the feet.

Do not blindly set:

```ts
actor.position.y = groundY;
```

unless the coordinate system explicitly defines the actor origin as the ground-contact point.

Inspect existing rig and Actor conventions.

If reliable foot contact information is available, compute the required Actor position using the correct world transforms.

If not, support an explicit user-configured ground-contact offset, or clearly label the fallback as "Align Actor Origin to Ground".

Avoid implying inaccurate foot placement.

## 5. Actor dragging

When Snap to Ground is enabled, optionally constrain the relevant ground-contact position while dragging an Actor.

Preserve horizontal movement.

Allow temporarily disabling the constraint for:
- Jumping poses
- Flying characters
- Characters standing on elevated objects

Do not force every Actor to remain on one floor.

## 6. Multiple Actors

Test characters with:
- Different heights
- Different sprite sizes
- Different rig origins
- Different facing
- Different scales
- Different skins

The line should help align characters visually without assuming identical rigs.

## 7. Authored scene data

Persist the scene's ground guide configuration using the existing scene/project persistence strategy.

Keep it distinct from Actor transforms and action timing.

If the ground remains an editor-only reference, do not force unrelated runtime consumers to use it as a collision plane.

When an explicit snap operation moves an Actor, that movement should update the appropriate authored initial transform with Undo/Redo.

## 8. Playback and movement

Verify scene choreography still works.

When Actors walk or move:
- Existing v0.8 movement remains authoritative.
- Ground reference does not automatically change movement paths.
- Ground guide stays stable.
- Seeking/scrubbing stays deterministic.

Do not add gravity or pathfinding.

## 9. Tests

Cover:
- Show/hide
- Ground position adjustment
- World coordinate conversions
- Camera transforms
- Actor snapping
- Distinct Actor origins
- Character scale/facing
- No automatic movement on ground-guide change
- Undo/Redo
- Scene export/import
- Playback and scrubbing
- Resource cleanup

## 10. Manual verification

1. Open Scene Editor.
2. Add two different characters.
3. Enable ground line.
4. Position Ground Y.
5. Select Actor A.
6. Snap Actor A to ground.
7. Select Actor B.
8. Snap Actor B to ground.
9. Verify their visible contact positions.
10. Add walking choreography.
11. Play and scrub.
12. Export/reload the scene.
13. Confirm authored positioning and guide persist.

## 11. Out of scope

Do not implement:
- Multiple terrain surfaces
- Slopes and stairs
- Physics collision
- Automatic vertical movement correction
- Ground-aware pathfinding
- New Actor movement algorithms

## 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

The Scene Editor supports a stable scene-world ground reference and deliberate Actor alignment without changing character animations or introducing physics.

## Final report

Provide Scene Editor integration, snapping logic, coordinate handling, persistence, files changed, tests and exact verification results.
