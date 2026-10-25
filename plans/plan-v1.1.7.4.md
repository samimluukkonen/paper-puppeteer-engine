# Paper Puppeteer Engine — v1.1.7.4
## Root Motion & Environment Preview Integration

Continue developing Paper Puppeteer Engine.

**Previous milestone: v1.1.7.3 — Visual Root Motion Authoring.**

Stack: React, TypeScript (strict), Phaser, Vite, npm and ES modules.

The engine now supports:
- Root-motion animation tracks
- Deterministic root evaluation
- Animation Editor root-motion key authoring
- Existing skeletal animation and IK

The v1.1.6 Environment Preview may also exist. Inspect actual repository status.

## Goal

Allow artists to evaluate authored root motion against a stationary world reference.

This should solve the central frustration: animating dynamic character actions while being able to see how much the character actually travels.

## 1. Inspect existing preview

Review:
- Animation Editor preview
- Environment Preview, if implemented
- Static background loading
- Ground reference
- Foot contact markers
- Preview-only movement trajectories
- Fixed/follow camera modes
- Root-motion evaluator

Reuse existing architecture.

## 2. Authored root-motion display

When an animation includes authored root motion, provide a clear option to display it during preview.

The character must travel relative to:
- Static background
- Fixed ground line
- World reference/grid

The background itself remains fixed in world space.

Do not parent it to the character.

## 3. Root motion versus preview displacement

If v1.1.6 preview-only displacement exists, define explicit modes:

**Authored Root Motion**
- Displays actual animation root motion.
- Does not add preview-only displacement.

**Preview-Only Displacement**
- Displays the existing temporary trajectory.
- Does not also apply authored root movement.

**No World Displacement**
- Displays skeletal motion without additional Actor/root translation.

Use mutually exclusive options by default.

Do not silently apply root motion plus preview displacement and move the character twice.

Additional additive combinations are out of scope.

## 4. Environment Preview availability

If v1.1.6 is implemented:
- Integrate with its background selection.
- Reuse its playback and camera controls.
- Reuse ground settings and texture lifecycle.
- Avoid rebuilding any preview systems.

If it is not implemented:
- Ensure root motion can still be viewed against the existing stationary ground/world grid in Animation Editor.
- Do not implement the entire previously planned v1.1.6 feature set as part of this milestone.
- Report the missing optional Environment Preview integration.

## 5. Fixed camera

The camera stays at a fixed world location while root motion plays.

A sword-step animation should visibly advance the character across the background.

Do not automatically recenter each frame.

## 6. Follow camera

If the existing preview supports following:
- Follow the evaluated character/root world position.
- Keep the background fixed in world coordinates.
- Avoid double-applying camera offsets.
- Preserve deterministic seeking.

Use existing Phaser camera conventions.

## 7. Deterministic scrubbing

At a requested animation time:
- Evaluate skeletal pose
- Evaluate root displacement
- Apply the selected preview mode
- Position the preview character
- Position optional follow camera

The result must be independent of previous playhead positions.

Seeking must not change authored animation data.

## 8. Loop behavior

Provide consistent preview behavior for:
- Non-looping animations
- Loop reset
- Continuous travel through repeated cycles

Use the loop semantics implemented in v1.1.7.2.

Do not accumulate displacement twice across repeated playback frames.

## 9. Ground contact visualization

If foot contact markers exist, allow displaying them against the stationary ground reference.

This can help the artist observe:
- Foot lifting
- Foot landing
- Contact alignment
- Possible world-space foot drift

Do not claim that a marker is planted unless a separate contact-timing system defines that information.

Do not automatically change IK.

## 10. Optional preview trajectory conversion

If preview-only displacement points already exist, offer an explicit, non-destructive action:

**Copy Preview Trajectory to Root Motion**

Requirements:
- Preview the result first.
- Convert coordinates and interpolation correctly.
- Warn about replacing existing root-motion keys.
- Use one Undo transaction.
- Preserve the original preview trajectory until successful commit.
- Never silently convert preview movement into authored motion.

Do not implement this if existing preview representation cannot be converted safely; report the limitation instead.

## 11. Tests

Cover:
- Static background
- Authored root motion
- Preview-only movement
- No movement mode
- Fixed/follow camera
- Forward/backward scrubbing
- Loop boundaries
- Root + skeletal IK
- Ground marker visualization
- No double displacement
- Preview-to-root copying where implemented
- Undo/Redo
- Source immutability during passive preview

## 12. Manual acceptance test

Test:

**Sword cut with forward step**
- Author root motion of 80 units.
- Play against a stationary environment.
- Verify the character advances visibly.

**Jump**
- Author a vertical displacement curve.
- Verify the environment remains stationary while the character rises and lands.

**Walk cycle**
- Enable continuous root-motion loops where supported.
- Verify movement accumulates without jumps or double application.

## 13. Out of scope

Do not add:
- Physics
- Automatic ground collision
- Automatic foot locking
- Scene choreography editing
- New camera keyframe systems
- Motion extraction from pelvis bones

## 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The artist can see genuine authored root motion against a static world reference, using existing Environment Preview functionality where available.

No movement is duplicated and previewing never changes animation keys.

## Final report

Explain preview modes, coordinate handling, camera behavior, loop semantics, optional trajectory conversion, files changed, tests and exact verification results.
