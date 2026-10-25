# Paper Puppeteer Engine — v1.1.7.5
## Root Motion Integration with Scene Editor & Choreography

Continue developing Paper Puppeteer Engine.

**Previous milestone: v1.1.7.4 — Environment Preview Integration.**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems:
- Root-motion tracks and runtime evaluation
- Actor world transforms
- v0.8 movement and choreography
- v0.9 Scene Editor action timeline
- Scene playback and deterministic scrubbing
- Animation queues/crossfades
- Scene package export/import

## Goal

Allow root-motion animations to drive Actor movement in actual scenes.

For example, a sword attack containing a forward step should be able to move an Actor by its authored displacement without requiring a separate moveTo command.

Existing scene choreography must remain compatible.

## 1. Inspect motion ownership

Review:
- Scene action ownership
- Actor moveTo/walkTo
- Animation clips
- Root-motion runtime API
- Actor facing and scale
- Parallel action conflict handling
- Scene playback/seek evaluator
- Animation completion and interruption
- Scene import/export

Do not implement a second Actor movement controller.

## 2. Explicit root-motion ownership

Introduce a clear policy for Scene Editor animation clips.

Recommended options:

**Scene-Controlled Movement**
- Existing Actor movement actions control translation.
- Animation root motion does not additionally translate the Actor.

**Animation Root Motion**
- The animation's root-motion track controls Actor translation during that clip.
- Conflicting scene movement actions cannot simultaneously own the Actor's translation.

Default existing clips to Scene-Controlled Movement for backward compatibility.

Do not silently combine both modes.

## 3. Scene Editor UI

Add a root-motion option to the selected animation clip inspector.

Example:

```text
ANIMATION CLIP

Animation:
[ sword-cut-forward ]

Movement Source:
(o) Scene-controlled
( ) Animation root motion

Root Displacement:
X: +80
Y:   0
```

Use actual evaluated displacement values.

Root displacement should be read-only in Scene Editor.

Authoring root-motion keys belongs in Animation Editor.

If the selected animation contains no root-motion track, show an appropriate empty/disabled state.

## 4. Runtime application

When Animation Root Motion is enabled:
- Use the authoritative root-motion evaluator.
- Apply displacement through existing Actor transforms.
- Respect facing and scale.
- Preserve skeletal animation/IK.
- Avoid double application.

Scene-controlled movement continues working as before.

## 5. Ownership conflicts

Handle:
- Root-motion clip overlapping moveTo/walkTo
- Two root-motion clips controlling one Actor
- Animation interruption
- Parallel choreography
- Clip replacement
- Looping clips

Choose a predictable, validated ownership rule.

Reject unsupported conflicts or apply a documented deterministic handoff.

Do not allow silent last-writer-wins movement behavior.

## 6. Clip boundaries

This is critical.

When a root-motion animation finishes:
- The Actor should retain its final displaced position.
- The next animation should begin from that resulting position.
- There should be no snap-back to the original location.
- The next root-motion clip should use a fresh local displacement origin.

If a clip is cancelled or interrupted, preserve the current Actor transform consistently with the existing runtime cancellation policy.

## 7. Looping scene clips

If a scene clip plays several root-motion cycles, use correct per-cycle displacement.

Do not reset the Actor to the same start position at each loop boundary unless the user explicitly requests a reset behavior.

Scene duration and root-motion clip duration must be well defined.

Infinite loops require an explicit interruption/end policy.

## 8. Deterministic scene seeking

At scene time T, the resulting Actor position must include all previously completed root-motion actions and the partial displacement of any currently active action.

The result must not depend on playback history.

Use the existing scene evaluator and action ordering.

Do not replay external callbacks merely to reconstruct Actor position.

## 9. Scene camera integration

Root-motion-driven movement should interact correctly with:
- Fixed scene camera
- Camera keyframes if implemented
- Background layers
- Parallax
- Ground reference
- Foot contact markers

The Actor moves through the world.

The camera and background systems should not mistake that movement for a change in world origin.

## 10. Animation events and lifecycle

Preserve existing animation events and completion behavior.

Seeking must not trigger gameplay side effects.

Normal playback must not dispatch the same event twice merely because root motion is enabled.

## 11. Serialization and validation

Persist the clip's movement source in SceneDefinition using backward-compatible defaults.

Extend validation for:
- Invalid movement source
- Missing animation root-motion data
- Overlapping motion ownership
- Invalid clip timing
- Unsupported looping policies

Ensure scene package exports include the root-motion animation data.

## 12. Tests

Cover:
- Scene-controlled movement
- Root-motion-controlled movement
- Conflict detection
- Forward sword step
- Backward dodge
- Vertical movement
- Facing and scaling
- Two Actors moving simultaneously
- Clip cancellation
- Clip handoff
- Loop continuity
- Direct scene seek
- Export/import
- Old scenes
- No skeletal animation mutation

## 13. Manual verification

Create a scene with two Actors.

1. Actor A starts at X = 100.
2. Actor B stands still.
3. Actor A plays a sword attack with +80 root displacement.
4. Enable Animation Root Motion for the clip.
5. Play the scene.
6. Verify Actor A ends at X = 180, subject to documented facing/scale transforms.
7. Play a subsequent idle animation.
8. Confirm the Actor stays at its new location.
9. Attempt an overlapping moveTo action.
10. Confirm the conflict is handled safely.
11. Scrub backward and forward.
12. Export/reload the scene.

## 14. Out of scope

Do not implement:
- Automatic blending of Actor movement with animation root motion
- Physics
- Collision
- Pathfinding
- Foot locking
- Root-motion retargeting
- Complex motion matching

## 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

Scene Editor can use authored animation root motion as a deliberate Actor movement source, with correct conflict handling, continuity, deterministic scrubbing and backward-compatible scene files.

## Final report

Explain ownership rules, runtime application, clip boundaries, seek behavior, serialization, files changed, tests and exact command results.
