# Paper Puppeteer Engine — v0.8.4
## Choreography Sequence Runner

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.8.3**

Stack: TypeScript (strict), Phaser runtime, React editor, Vite, npm, ES modules.

Existing features:
- Actor abstraction
- `moveTo()` / `walkTo()`
- `lookAt()` and facing
- v0.7 `playAndWait()`
- Playback lifecycle and cancellation
- Animation state controller

Do not duplicate movement or animation playback systems.

## Goal

Implement a reusable, optional runtime choreography sequence runner.

Allow developers to define ordered character actions and execute them reliably.

### 1. Sequential action execution

Target conceptual usage:

```ts
const sequence = new ChoreographySequence(actor);

sequence.moveTo(300, 200);
sequence.lookAt(otherActor);
sequence.playAnimation("draw-weapon");
sequence.playAnimation("attack");

const result = await sequence.run();
```

Adapt API names to the actual architecture.

Sequential actions should not begin until the preceding action completes successfully, unless explicitly configured otherwise.

### 2. Typed step representation

Introduce typed step descriptions or builders for:
- Move Actor
- Walk Actor
- Face/look at target
- Play animation and wait
- Wait for a duration
- Invoke a narrowly scoped synchronous cue/callback where suitable

Avoid arbitrary unvalidated strings for core step kinds.

Keep step definitions independent from React.

### 3. Execution engine

The runner should call existing:
- Actor movement operations
- Actor facing operations
- Puppet `playAndWait()`
- v0.7 lifecycle/cancellation APIs

Do not add a second playback evaluator or movement system.

### 4. Wait duration

For timed waits, use the application's existing scene/runtime update clock.

Avoid wall-clock timers.

Pause behavior should follow the engine's actual update/pause semantics.

Do not allow a paused scene to continue advancing scripted waits unexpectedly.

### 5. Result semantics

Define typed outcomes such as:
- Completed
- Cancelled
- Interrupted
- Failed due to invalid command/target
- Disposed

Reuse existing outcome types where appropriate.

A cancelled or failed step should not silently allow later steps to execute.

### 6. Cancellation

Support cancelling an active sequence.

Cancellation must:
- Stop the active action it owns
- Settle the sequence promise
- Prevent future steps from starting
- Release listeners and resources

Respect explicit ownership of Actor/Puppet operations.

Do not accidentally cancel unrelated playback owned by another system.

### 7. Invalid instructions

Validate:
- Missing Actor
- Unknown animation
- Invalid movement destination
- Invalid duration
- Disposed target
- Unsupported action

Reject a malformed sequence before execution where practical.

### 8. Repeated execution

Define whether a sequence can be run again.

Prefer clear single-run semantics initially, or provide an explicit reset/clone mechanism.

Do not allow accidental concurrent execution of one mutable sequence instance.

### 9. Tests

Cover:
- Ordered steps
- Move then play
- Play then face
- Timed wait
- Zero-duration steps
- Natural completion
- Interrupted playback
- Cancellation during movement
- Cancellation during animation
- Scene pause
- Disposal
- Invalid command
- Exactly-once settlement

Use deterministic update clocks and controlled promises.

### 10. Out of scope

Do NOT implement:
- Multi-Actor barriers
- Visual choreography timeline
- Automatic camera movement
- Branching dialogue system
- Scene file serialization
- AI behavior trees
- Physics navigation

### 11. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Developers can run ordered Actor actions
- Existing runtime APIs are reused
- Steps wait for actual completion
- Cancellation and errors behave predictably
- Scene pause and update timing are respected
- No hanging promises or stale listeners
- All required commands pass

## Final report

Provide:
1. Sequence API
2. Step model
3. Runtime execution architecture
4. Cancellation/error handling
5. Files/APIs changed
6. Tests
7. Exact command results
8. Deferred v0.8.5 features

Do not claim completion unless all commands pass.
