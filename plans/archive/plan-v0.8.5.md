# Paper Puppeteer Engine — v0.8.5
## Multi-Actor Choreography Coordination

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.8.4**

Stack: TypeScript (strict), Phaser runtime, React editor, Vite, npm, ES modules.

Already implemented:
- Actor abstraction
- Movement and walking
- Facing/lookAt
- Animation queues/states
- `playAndWait()`
- Choreography Sequence Runner
- Cancellation and completion outcomes

Do not rebuild existing Actor or choreography logic.

## Goal

Enable coordinated scripted behavior involving multiple Actors.

Examples:
- Two characters walk toward each other.
- Both stop.
- They face one another.
- One performs an animation.
- The other responds.

### 1. Concurrent actions

Support running independent Actor actions simultaneously.

Conceptually:

```ts
await choreography.parallel([
  actorA.walkTo(400, 300),
  actorB.walkTo(600, 300),
]);
```

Reuse existing Actor operations.

Do not implement another movement system.

### 2. Synchronization barriers

Provide a way to wait until all actions in a group finish before proceeding.

Example:

```text
Actor A walks ────────┐
                      ├── Both arrived
Actor B walks ────┐   │
                  └───┘
                      ↓
             Next scene action
```

Use typed outcomes.

Do not treat interrupted/cancelled actions as successful arrivals.

### 3. Multi-Actor scripting

Provide an ergonomic API to combine sequential and parallel operations.

Conceptually:

```ts
await choreography.parallel([
  () => actorA.walkTo(400, 300),
  () => actorB.walkTo(600, 300),
]);

actorA.lookAt(actorB);
actorB.lookAt(actorA);

await actorA.playAndWait("bow");
await actorB.playAndWait("bow");
```

This is illustrative.

Prefer lazy action factories or typed action descriptions where needed to avoid starting future actions before the sequence reaches them.

### 4. Actor registration

If useful, introduce a lightweight Actor registry for one choreography context.

Validate:
- Duplicate Actor IDs
- Missing Actors
- Disposed Actors

Do not create a full ECS or scene-management framework.

### 5. Conflict policy

Detect or prevent competing choreography operations that both claim exclusive control of the same Actor.

Examples:
- Two simultaneous movement commands on one Actor
- Two conflicting base-animation requests

Use existing interruption/ownership semantics.

Do not let parallel operations fight over the same transform unpredictably.

### 6. Cancellation propagation

If a coordinated sequence is cancelled:
- Cancel actions owned by that sequence
- Prevent later steps from starting
- Settle all affected waits
- Preserve unrelated Actor operations

Define and document what happens if one parallel branch fails.

A fail-fast policy that cancels owned sibling branches is acceptable.

### 7. Synchronization without extra clocks

Movement and wait steps must use the existing runtime update clock.

Do not use multiple independent timers for actors in the same scene.

Promise-based orchestration may coordinate completion, but should not replace deterministic runtime updates.

### 8. Events and cues

Allow orchestration to react to existing animation completion or authored animation events where the v0.7 API supports it.

Do not duplicate event dispatch.

Keep generic cue callbacks optional and runtime-only.

Dialogue, sound design, camera effects and gameplay actions may be handled by application code; do not hardcode them into Puppet.

### 9. Tests

Cover:
- Two simultaneous walks
- Different arrival times
- Synchronization barrier
- Sequential actions after parallel group
- Animation response
- Cancellation of group
- Branch failure
- Same-Actor conflict
- Disposed Actor
- Actor registration
- Listener cleanup
- Deterministic update behavior

### 10. Out of scope

Do NOT implement:
- Visual scene editor
- Scene timeline serialization
- Branching story logic
- Pathfinding
- Combat AI
- Physics
- Camera director

### 11. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Multiple Actors can execute actions simultaneously
- Synchronization waits for all required successful outcomes
- Conflicting ownership is handled
- Cancellation propagates safely
- Existing Actor/Puppet systems remain authoritative
- No duplicated clocks or lifecycle systems
- All required commands pass

## Final report

Provide:
1. Multi-Actor API
2. Parallel/sequence composition
3. Synchronization semantics
4. Conflict and cancellation policies
5. Files/APIs changed
6. Tests
7. Exact verification results
8. Deferred v0.8.6 work

Do not claim completion unless all commands pass.
