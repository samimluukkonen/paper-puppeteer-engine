# Paper Puppeteer Engine — v1.1.7.2
## Runtime Root Motion Evaluation & Application

Continue developing Paper Puppeteer Engine.

**Previous milestone: v1.1.7.1 — Root Motion Data Model.**

Stack: React, TypeScript (strict), Phaser, Vite, npm and ES modules.

Existing systems:
- Puppet animation evaluation
- Actor world transforms
- Animation playback lifecycle
- Animation queues and crossfades
- Scene choreography
- Scene deterministic scrubbing
- Optional root-motion tracks from v1.1.7.1

## Goal

Implement reliable root-motion evaluation and optional application to Actor world transforms.

The engine must understand the difference between:
1. Evaluating skeletal animation
2. Evaluating root displacement
3. Applying displacement to an Actor

These operations must not be accidentally combined.

## 1. Inspect existing runtime

Examine:
- Animation evaluator
- Actor transform ownership
- Animation playback controller
- Delta-time updates
- Loop counters
- Transition/crossfade behavior
- Facing/mirroring
- Scene playback scheduling
- Existing deterministic seek APIs

Reuse established architecture.

## 2. Absolute root-motion evaluation

Implement a pure function or equivalent:

```ts
evaluateRootMotionAtTime(
  animation,
  localTime
): { x: number; y: number }
```

It must:
- Evaluate root-motion keys using existing interpolation rules.
- Produce deterministic results.
- Avoid mutating Actor or Puppet state.
- Work with arbitrary valid animation time.
- Return zero displacement when root motion is absent.

Use existing numeric curve evaluation.

## 3. Delta evaluation

Add an API for calculating displacement between two playback positions.

Conceptually:

```ts
getRootMotionDelta(
  animation,
  previousTime,
  currentTime
): { x: number; y: number }
```

Clearly distinguish wrapped local animation time from elapsed unwrapped playback time.

The delta must not be computed naively across a loop boundary.

## 4. Loop handling

For looping clips, define how displacement accumulates.

Example:
- A one-second walk cycle moves forward 40 world units per cycle.
- Three complete cycles should yield 120 units of travel when root motion is enabled.

Use the net displacement between the cycle's start and end.

Support a clearly documented continuous-loop mode.

Ensure:
- No jump at loop boundaries
- No duplicated motion
- Stable multi-cycle calculations
- Correct large-delta stepping
- Deterministic elapsed-time evaluation

If an animation is authored with an incompatible reset discontinuity, report that limitation instead of concealing it.

## 5. Actor application

Provide an explicit runtime mechanism for applying root motion to the Actor.

Do not automatically enable it for every animation.

Default behavior must preserve existing playback.

Root-motion application should:
- Use existing Actor transform APIs
- Respect defined facing and scale semantics
- Preserve skeletal bone transforms
- Keep IK evaluation consistent
- Apply movement exactly once

Do not directly modify pelvis bone tracks.

## 6. Playback policy

Introduce a lightweight typed root-motion policy if needed.

Conceptual choices:

- Ignore root motion for Actor translation
- Apply animation root motion

The default must remain backward-compatible.

A separate Actor moveTo/walkTo operation and root motion should not both independently own Actor translation without an explicit conflict rule.

Do not implement automatic additive blending here.

## 7. Pausing, stopping and interruption

Define consistent behavior for:
- Pause
- Resume
- Stop
- Restart
- Cancel
- Animation queue transition
- Animation completion
- Crossfade between animations

Avoid snap-back caused by discarding an already applied Actor movement.

Ensure no unresolved promises or stale movement controllers remain.

## 8. Scene-independent runtime API

The root-motion evaluator should be reusable by:
- Animation Editor
- Environment Preview
- Scene Editor
- Standalone runtime consumers

It must not import React or editor-specific modules.

## 9. Deterministic seeking

Seeking to time T must calculate the same result regardless of previous playback.

Do not implement authoritatively by repeatedly accumulating deltas from whatever frame was previously displayed.

Use absolute sampled displacement and documented cycle accounting.

Delta application is appropriate for forward runtime playback only when driven by a correct timeline state.

## 10. Tests

Test:
- Zero displacement
- Forward movement
- Backward movement
- Vertical jump offsets
- Multiple segments
- Irregular frame deltas
- Large frame delta crossing multiple loops
- Pause/resume
- Restart
- Cancel
- Animation transitions
- Facing/mirroring
- Character scaling
- IK compatibility
- No double application
- No mutation during seek
- Backward compatibility

## 11. Out of scope

Do not implement:
- Visual authoring
- Scene-specific clip UI
- Root rotation/scaling
- Physics
- Collision
- Automatic foot planting
- Motion extraction from skeletal bones

## 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The runtime can deterministically evaluate root displacement and optionally apply it to an Actor exactly once, with documented looping and interruption semantics.

## Final report

Describe:
1. Evaluation APIs
2. Coordinate transforms
3. Delta and loop handling
4. Actor application
5. Playback and interruption
6. Compatibility
7. Files/APIs changed
8. Tests and verification results
