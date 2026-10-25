# Paper Puppeteer Engine — v1.1.6.2
## Motion-Agnostic Displacement Preview

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.1.6.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The Animation Editor now supports Environment Preview with a static background.

## Goal

Allow the artist to preview how arbitrary animation motion appears relative to that environment.

Do NOT implement a walking-specific simulator.

Supported examples should include:
- Forward step during a sword cut
- Backward evasive step
- Sideways dodge
- Running
- Jumping
- Rolling
- Lunge attack
- Multiple directional movements within one animation

The tool should distinguish authored character motion from optional simulated world displacement.

## 1. Inspect motion architecture

Review:
- Puppet root and bone transforms
- Animation root translation, if present
- Actor world-space position
- Existing movement/choreography APIs
- Animation playback and scrubbing
- Scene coordinate conventions
- Facing and mirroring
- IK and foot contact evaluations

Determine which transforms belong to the skeleton and which represent Actor/world movement.

Do not invent a new movement engine.

## 2. Preview motion modes

Support the following behavior:

### A. As Authored

Display the animation exactly as currently evaluated, including its existing root/bone motion.

Apply no additional displacement.

This should be the default.

### B. Additional Preview Displacement

Allow the artist to add optional world-space displacement to the character's preview instance.

This displacement is NOT saved into animation keyframes.

It is only used to visualize motion relative to the environment.

Do not double-apply displacement already supplied by authored root/Actor movement.

If both exist, clearly expose that the added preview displacement is additive and requires deliberate opt-in.

### C. No Additional Movement

The artist may disable simulated displacement while keeping skeletal motion exactly as authored.

Do not freeze meaningful pelvis/root bone animation simply to keep the Actor origin stationary.

## 3. Preview trajectory

Implement a lightweight 2D preview trajectory.

Use time-position points defined relative to animation time.

Conceptual type:

```ts
interface PreviewPositionKey {
  time: number;
  offsetX: number;
  offsetY: number;
}

interface MotionPreviewSettings {
  enabled: boolean;
  positionKeys: PreviewPositionKey[];
}
```

Adapt to actual application conventions.

The trajectory should support:
- Horizontal movement
- Vertical movement
- Forward/backward movement
- Several movement segments
- Returning to an earlier position
- Stationary intervals

A sword-cut animation might move forward only during the stepping part, not during the entire clip.

A jump might move upward and then downward.

Do not assume constant speed.

## 4. Simple trajectory editor

Provide a compact panel in Animation Editor.

Example:

```text
PREVIEW DISPLACEMENT

[x] Enable Preview Displacement

Time       Offset X      Offset Y
0.00s      0             0
0.30s      0             0
0.55s      45            0
1.00s      45            0

[+ Add Position Point]
[Remove Selected Point]

[Reset Trajectory]
```

The numbers are illustrative.

Allow:
- Adding/removing preview position points
- Editing time and X/Y
- Choosing interpolation where supported
- Resetting the trajectory

Keep this separate from the real animation keyframe timeline.

Avoid building an entire second Scene Editor.

## 5. Time synchronization

Preview displacement must be evaluated using the same animation time as the current pose.

A preview point at 0.5 seconds should correspond to the pose at 0.5 seconds.

Reuse current playback/time evaluation utilities.

Do not use independent timers or asynchronous movement commands as the authoritative trajectory.

## 6. Position evaluation

Implement a deterministic position evaluator.

Conceptually:

```ts
evaluatePreviewDisplacement(
  settings,
  animationTime
): { x: number; y: number }
```

Use a compatible existing interpolation utility.

The result must be independent of previous preview state.

Seeking to 0.6 seconds must produce the same displacement regardless of whether the previous time was 0.2 or 0.9 seconds.

## 7. Visual trajectory

Where practical, display an optional preview trajectory line in the Phaser viewport.

The artist should see where the character will move.

Keep this overlay separate from background artwork and the actual character rig.

Do not require sophisticated path handles in the first implementation.

## 8. World-space application

Apply displacement to the preview Actor/root world transform only.

Do not:
- Rewrite skeletal animation tracks
- Modify rig joints
- Author IK keyframes
- Modify scene Actors
- Change AnimationDefinition
- Create regular animation Undo entries

Ensure scale and facing behavior remain consistent.

## 9. Root motion safety

This is particularly important.

An animation may already contain translation on a root bone.

That does not automatically mean it is world-space Actor translation.

Inspect the actual transform ownership and preserve its semantics.

Never silently convert skeletal root keys into Actor movement.

If additional displacement is applied, it must be clearly distinguishable from authored root motion.

## 10. Tests

Cover:
- No additional displacement
- Forward step
- Backward step
- Sideways movement
- Jump trajectory
- Multiple trajectory points
- Stationary intervals
- Root bone translation
- Facing left/right
- IK
- Same-time deterministic evaluation
- Source animation immutability
- Invalid numeric values

## 11. Manual verification

Test at least:

**Sword cut with forward step**
- Begin stationary.
- Perform the sword cut animation.
- Add a short forward displacement during the step.
- Observe movement relative to the static background.

**Jump**
- Play a jumping animation.
- Add an upward and downward preview trajectory.
- Verify that the existing skeletal animation and added displacement remain synchronized.

**Walk cycle**
- Play the normal walking animation.
- Preview it with and without additional world displacement.

## 12. Out of scope

Do not implement:
- Physics
- Gravity
- Collision
- Pathfinding
- Automatic trajectory generation
- Automatic foot locking
- Root-motion extraction algorithms
- Permanent animation root-motion baking
- Scene choreography authoring

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

Any animation can be previewed with optional, time-synchronized 2D world displacement against the static environment.

The system must not assume the character is walking and must not modify actual animation data.

## Final report

Provide motion architecture, preview trajectory model, transform semantics, deterministic evaluation, files changed, tests and verification results.
