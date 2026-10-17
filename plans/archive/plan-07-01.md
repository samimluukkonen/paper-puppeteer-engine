# Paper Puppeteer Engine — v0.7.1
## Playback Lifecycle & Completion Foundation

Continue developing my standalone Paper Puppeteer Engine project.

**Current completed version: v0.6.5**

### Technology stack
- TypeScript (strict)
- Phaser runtime
- React + TypeScript editor UI
- Vite, npm, ES modules

The engine already supports skeletal animation, IK, animation layers, crossfading, animation events, character packages, Rig Editor and Animation Editor.

**Important:** React is for the editor only. The runtime animation controller must not depend on React.

Do NOT rewrite working systems.

## Goal

Implement **v0.7.1 — Playback Lifecycle & Completion**.

Establish reliable runtime playback status and lifecycle notifications. These will become the foundation for animation queues, animation states and promise-based playback in later v0.7 milestones.

### 1. Inspect existing runtime

Before implementing, inspect:
- Puppet public playback API
- Animation playback state
- Animation evaluator
- Crossfade/transition system
- Animation layers and masks
- Existing event dispatcher
- Looping and playback-speed semantics
- Completion/end-of-clip behavior

Reuse current mechanisms. Avoid creating a second animation player.

### 2. Playback lifecycle

Support clearly distinguished outcomes:

- Started
- Playing
- Paused, if supported
- Naturally completed
- Interrupted by another playback request
- Explicitly stopped/cancelled
- Disposed when the Puppet is destroyed

Use a typed representation consistent with existing architecture.

Natural completion must not be confused with interruption.

### 3. Playback identity

Introduce a stable runtime playback-instance identifier or handle, if necessary.

Starting the same animation twice should not cause an old playback's completion notification to be confused with the new one.

Animation ID and playback-instance ID are different concepts.

### 4. Lifecycle API

Provide a runtime API to inspect or subscribe to playback lifecycle.

Conceptually:

```ts
puppet.getPlaybackStatus();

const unsubscribe = puppet.onPlaybackLifecycle(
  (event) => {
    // Started, completed, interrupted, etc.
  }
);
```

Adapt names to the actual codebase.

Keep the API additive and backward-compatible.

### 5. Natural completion

For non-looping animations, signal completion exactly once when playback reaches the appropriate end condition.

Handle:
- Normal update deltas
- Large delta crossing the end
- Playback-speed changes
- Pause/resume
- Zero-duration clips
- Exact duration boundaries

Use the current runtime clock and time semantics.

Do not implement independent timers.

### 6. Looping

An indefinitely looping clip must not report natural completion at every loop boundary.

Preserve existing loop and animation-event behavior.

If the runtime already reports loop iterations, keep that signal distinct from final completion.

### 7. Interruption

When animation A is replaced by B:
- A receives an interrupted outcome exactly once
- B starts normally
- A must not later emit a natural-completion notification

Define the behavior for existing crossfades explicitly, including when the outgoing animation is considered interrupted.

Do not break the actual visual blend.

### 8. Existing animation events

Lifecycle notifications are NOT authored animation events.

Preserve existing keyframed animation events and their dispatch order.

Do not serialize lifecycle state to animation JSON.

### 9. Cleanup

Subscriptions must be removable.

Destroying a Puppet must:
- Terminate active playback safely
- Release listeners
- Prevent later notifications from stale playback instances

### 10. Tests

Cover:
- Start and completion
- Start twice
- Pause/resume
- Non-loop end
- Looping
- Large delta
- Zero duration
- Playback replacement
- Crossfade interruption
- Explicit stop
- Disposal
- Exactly-once terminal notifications
- Existing animation-event compatibility

### 11. Do NOT implement

- Animation queues
- Animation state machine
- `playAndWait()`
- Scene choreography
- `walkTo()` or `lookAt()`
- New interpolation or IK systems
- React runtime dependencies

### 12. Required verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Playback lifecycle is reliable
- Natural completion is distinguishable from interruption
- Looping behavior is explicit
- Terminal outcomes are emitted exactly once
- Public lifecycle subscriptions are safe
- Existing playback/crossfades/events remain compatible
- Runtime has no React dependency
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented lifecycle API
2. Playback-instance identity
3. Completion/interruption semantics
4. Crossfade handling
5. Files and APIs changed
6. Tests
7. Exact verification results
8. Deferred work for v0.7.2

Do not claim completion unless required commands pass.
