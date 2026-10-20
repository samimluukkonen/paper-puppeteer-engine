# Paper Puppeteer Engine — v0.7.4
## Async Animation API

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.3**

Technology stack:
- TypeScript (strict)
- Phaser runtime
- React for editor UI only
- Vite, npm, ES modules

Already implemented:
- Playback lifecycle/completion
- Animation queues
- Animation state controller
- Existing Puppet animation playback and transitions

Do not duplicate the lifecycle implementation.

## Goal

Implement **v0.7.4 — Async Animation API**.

Make it possible for applications to wait for an animation to finish naturally.

Target usage:

```ts
await puppet.playAndWait("draw-weapon");

await puppet.playAndWait("attack");

await puppet.playAndWait("sheath-weapon");
```

Use the actual existing Puppet public API conventions.

### 1. playAndWait()

Implement an awaitable playback operation.

Conceptually:

```ts
const result = await puppet.playAndWait(
  "attack"
);
```

It must rely on the playback-instance lifecycle established in v0.7.1.

Do not poll the animation time with timers.

### 2. Typed completion result

Distinguish:
- Naturally completed
- Interrupted
- Cancelled
- Puppet disposed

Prefer a typed discriminated result.

Example:

```ts
type PlaybackOutcome =
  | { status: "completed" }
  | { status: "interrupted" }
  | { status: "cancelled" }
  | { status: "disposed" };
```

Reuse the existing lifecycle outcome types rather than creating duplicated definitions.

Callers must not confuse interruption with successful completion.

### 3. Exactly-once promise settlement

Every started awaitable request must settle at most once and must not remain pending after a terminal lifecycle outcome.

Remove completion listeners after settlement.

Do not allow old playback callbacks to settle a later playback request.

### 4. Looping animations

An indefinitely looping animation has no natural completion.

The default `playAndWait()` behavior should reject an indefinite loop request with an actionable explanation rather than await forever.

If a finite repeat count is already supported, it may be awaited.

Do not implement a new looping subsystem just for this API.

### 5. Cancellation

Support cancellation using existing patterns.

Where appropriate, accept an `AbortSignal`.

Example:

```ts
const controller = new AbortController();

const resultPromise = puppet.playAndWait(
  "attack",
  { signal: controller.signal }
);

controller.abort();
```

Decide and document whether cancellation only stops the wait or also stops the underlying playback.

Prefer a consistent default that avoids surprising unrelated playback changes.

### 6. Interruption

When another animation replaces the awaited animation, the waiting operation must settle with an interrupted outcome.

Do not falsely report natural completion.

### 7. Disposal

If the Puppet is destroyed during an awaited animation:
- Settle pending waits
- Remove listeners
- Avoid accessing destroyed Phaser objects

No hanging promises.

### 8. Queue integration

Avoid creating a second queueing mechanism.

If an awaitable queued playback helper is useful, build it on the existing queue.

Respect the same interruption and looping policies.

### 9. State controller integration

Ensure temporary one-shot actions and state transitions can use the awaitable lifecycle without duplicate subscriptions.

Do not allow stale await completions to restore an outdated state.

### 10. Event waiting

If existing runtime animation events are already observable, optionally offer an awaitable event helper.

For example:

```ts
await puppet.waitForAnimationEvent(
  "strike"
);
```

Only implement this if it fits cleanly with the existing event system.

It must support cancellation and disposal.

Do not delay the main milestone for an elaborate event-waiting API.

### 11. Deterministic tests

Use controlled animation updates and promises.

Do not rely on real-time sleeps.

Test:
- Natural completion
- Interrupted completion
- Explicit cancellation
- Abort before start
- Abort during playback
- Disposal
- Unknown animation
- Infinite-loop rejection
- Multiple simultaneous waits
- Playback replacement
- Same animation replayed
- Zero-duration clip
- No listener leaks

### 12. Scope restrictions

Do not implement:
- `walkTo()` movement
- `lookAt()` actor targeting
- Scene timeline
- Camera choreography
- Gameplay scheduling
- Network synchronization

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- `playAndWait()` works for finite animations
- Natural completion is distinct from interruption
- Cancellation is supported
- Infinite loops cannot silently hang default awaits
- Disposal settles pending requests
- Awaitable playback uses existing lifecycle
- Queue/state-controller compatibility is preserved
- No listener leaks or duplicate settlement
- Tests, typecheck and build pass

## Final report

Provide:
1. Async API design
2. Completion result types
3. Cancellation policy
4. Loop behavior
5. Queue/state integration
6. Files/APIs changed
7. Tests
8. Exact verification results
9. Deferred functionality

Do not claim completion unless required commands pass.
