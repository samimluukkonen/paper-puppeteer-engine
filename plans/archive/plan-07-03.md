# Paper Puppeteer Engine — v0.7.3
## Runtime Animation State Controller

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.2**

Technology stack:
- TypeScript (strict)
- Phaser runtime
- React for editor UI only
- Vite, npm, ES modules

Already implemented:
- Stable animation playback lifecycle
- Completion/interruption notifications
- Animation queues
- Existing crossfades, layers and playback
- Rig/animation/character loading

Do not introduce another animation evaluator.

## Goal

Implement **v0.7.3 — Animation State Controller**.

Enable applications to define reusable animation states such as idle, walking and running without repeatedly writing manual `play()` calls.

Conceptual usage:

```ts
const controller = new AnimationStateController(
  puppet,
  {
    initialState: "idle",
    states: {
      idle: { animation: "idle", loop: true },
      walking: { animation: "walk", loop: true },
      running: { animation: "run", loop: true }
    }
  }
);

controller.setState("walking");
controller.setState("idle");
```

This is illustrative. Adapt to actual public API conventions.

### 1. Runtime-only state definitions

A state should reference an existing animation ID.

Support:
- State ID
- Animation ID
- Looping behavior
- Optional existing playback options
- Optional transition/fade configuration

Keep state configuration separate from animation JSON and rig data.

Do not invent another animation format.

### 2. State transitions

When changing state:
- Validate the destination
- Use the existing playback API
- Use existing crossfades
- Update state identity deterministically
- Expose current state

Changing to the currently active state should normally be idempotent.

Do not restart a walking animation on every repeated `setState("walking")` call unless explicitly requested.

### 3. Transition policies

Support straightforward state transition configuration.

Examples:
- Idle → Walking: crossfade 0.2 s
- Walking → Running: crossfade 0.15 s
- Running → Idle: crossfade 0.2 s

Use the project's existing transition semantics and units.

Avoid a complex generic rule-expression language.

### 4. One-shot actions

Provide a well-defined way for a temporary non-looping action to play and then return to a persistent state.

Example:

```text
Current state: idle
      ↓
Play attack once
      ↓
Attack naturally completes
      ↓
Return to idle
```

Reuse v0.7.1 lifecycle and v0.7.2 queueing where suitable.

Do not create a competing queue.

### 5. State versus direct playback

Define what happens if application code calls the existing `puppet.play()` while a state controller is active.

Possible policy:
- Imperative playback temporarily overrides the state controller.
- Or state controller has explicit exclusive ownership.

Choose one consistent policy, document it and test it.

Do not let the state controller immediately restart idle over every attack.

### 6. No gameplay dependencies

This component should not know:
- Keyboard input
- Player velocity
- AI decisions
- World navigation
- Combat rules
- Scene scripts

Applications decide WHEN to enter a state.

The controller decides HOW to play its animation.

### 7. Error handling

Validate:
- State IDs
- Animation references
- Initial state
- Transition durations
- Loop options

Reject invalid state changes without corrupting active playback.

### 8. Layers and IK

State changes should use existing base animation behavior by default.

Preserve unrelated overlay layers and their masks.

Do not reset IK, weapon constraints or skins unnecessarily.

### 9. Lifecycle

Provide a clean disposal/unsubscription mechanism.

Prevent late playback callbacks from resurrecting disposed state controllers.

### 10. Tests

Cover:
- Initial state
- State changes
- Repeated state requests
- Crossfades
- Unknown states
- Missing animations
- One-shot action
- Action completion/return
- Interrupted action
- Manual `play()` interaction
- Queue interaction
- Layer preservation
- Disposal

### 11. Do NOT implement

- React state-machine editor
- Graph-based transitions
- Physics-driven state changes
- Navigation/movement
- AI behavior trees
- Multi-actor choreography

### 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Named animation states work
- State changes use existing playback system
- Repeated state calls are safe
- Transition behavior is configurable
- One-shot actions can return to a persistent state
- Direct playback and state ownership are defined
- No duplicate animation state/evaluation system exists
- Runtime remains React-independent
- Tests, typecheck and build pass

## Final report

Provide:
1. State controller architecture
2. Public APIs
3. Transition configuration
4. One-shot action handling
5. Queue/direct-playback interactions
6. Files/APIs changed
7. Tests
8. Verification results
9. Deferred functionality

Do not claim completion unless all commands pass.
