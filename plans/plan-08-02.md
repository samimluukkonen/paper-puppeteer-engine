# Paper Puppeteer Engine — v0.8.2
## Actor Movement & walkTo()

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.8.1**

Stack: TypeScript (strict), Phaser runtime, React editor, Vite, npm, ES modules.

The Actor abstraction now exists and delegates animation control to the v0.7 runtime.

Do not rebuild the Actor foundation or animation player.

## Goal

Implement deterministic, script-controlled movement for Actors.

Target usage:

```ts
await actor.moveTo(500, 300);

await actor.walkTo(700, 300, {
  speed: 120,
});
```

These are conceptual APIs; adapt to existing runtime conventions.

## 1. Movement architecture

Introduce movement requests using Actor's authoritative position.

Support:
- Start point
- Destination
- Speed in world units per second
- Arrival detection
- Cancellation
- Completion outcome

Keep movement separate from bone animation.

### 2. Deterministic updates

Advance movement using the existing Phaser/runtime update delta.

Do NOT implement movement using:
- `setTimeout()`
- `setInterval()`
- Wall-clock polling
- A second independent game loop

Correctly convert milliseconds/seconds according to existing update conventions.

### 3. moveTo()

Implement movement between two positions at a specified speed.

Requirements:
- Travel at consistent world-space speed
- Prevent overshooting destination
- Handle zero distance
- Handle large delta times
- Reject invalid positions or speeds
- Settle completion when destination is reached

Movement must not depend on render frame rate.

### 4. walkTo()

Implement `walkTo()` as movement combined with existing locomotion animation.

Conceptually:

```text
Start walk animation
       ↓
Move actor toward destination
       ↓
Arrive
       ↓
Stop locomotion / restore previous state
```

Reuse v0.7 animation state-controller and crossfade behavior where suitable.

Do not invent a new animation state machine.

### 5. Explicit animation mapping

Do not hardcode animation IDs like `walk` and `idle` globally.

Allow the Actor or movement options to identify which animations represent walking and idle.

Support characters with different naming conventions.

If no locomotion mapping is supplied, `moveTo()` must still work.

### 6. Movement interruption

Define a clear policy for a second movement request.

Preferred initial policy:
- New movement replaces current movement.
- Previous request settles as interrupted.
- New movement starts from actual current position.

Use v0.7-style typed terminal outcomes where practical.

### 7. Cancellation

Support cancellation with existing runtime conventions and optionally AbortSignal.

Cancellation must:
- Stop position updates
- Settle pending movement requests
- Avoid leaving locomotion playback in an inconsistent state
- Remove associated subscriptions

### 8. Ownership of animation state

If another system interrupts walking animation while the Actor is moving, avoid fighting the newer owner's playback request.

Do not automatically restart walk every update.

Define whether movement continues independently or is cancelled by an animation interruption.

Document and test the chosen policy.

### 9. Scope boundaries

This is direct point-to-point motion.

Do NOT implement:
- Pathfinding
- Collision avoidance
- Obstacles
- Navmesh
- Physics velocity
- Root-motion extraction

The Actor's rendered position is moved directly according to the existing transform model.

### 10. Tests

Cover:
- Straight-line movement
- Diagonal movement
- Constant speed
- Large delta
- Zero distance
- Arrival and exact destination
- Invalid speed
- Interruption
- Cancellation
- Disposal
- Locomotion animation start/stop
- No duplicate promise settlement
- Existing Puppet position synchronization

Use deterministic simulated update deltas.

### 11. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- `moveTo()` works
- `walkTo()` coordinates movement and animation
- Movement is frame-rate independent
- Arrival, cancellation and interruption are reliable
- Existing animation state remains consistent
- Actor/Puppet position stays synchronized
- No pathfinding or physics dependencies
- All required commands pass

## Final report

Report:
1. Movement APIs
2. Delta-time integration
3. Animation ownership
4. Completion/cancellation semantics
5. Files/APIs changed
6. Tests
7. Exact verification results
8. Deferred v0.8.3 work

Do not claim completion unless all commands pass.
