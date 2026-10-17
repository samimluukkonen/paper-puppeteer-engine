# Paper Puppeteer Engine — v0.7.2
## Animation Queues

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.1**

Technology stack:
- TypeScript (strict)
- Phaser runtime
- React for editor UI only
- Vite, npm, ES modules

The engine has a reliable playback lifecycle that distinguishes completion, interruption, cancellation and disposal.

Do not rebuild animation playback or lifecycle detection.

## Goal

Implement **v0.7.2 — Animation Queues**.

Allow developers to schedule multiple animations in sequence, using the existing Puppet playback and crossfade systems.

Conceptual usage:

```ts
puppet.queue("draw-weapon");
puppet.queue("attack");
puppet.queue("sheath-weapon");
```

Use actual project API conventions.

### 1. Queue model

Implement a lightweight FIFO queue of playback requests.

Each request may contain:
- Animation ID
- Supported playback options
- Transition/crossfade duration where appropriate
- Playback speed or other existing supported options

Use strictly typed data.

Do not duplicate AnimationDefinition or copy entire animations into queue items.

### 2. Queue API

Provide operations conceptually equivalent to:

```ts
puppet.queue("attack");
puppet.clearQueue();
puppet.getQueue();
```

Choose names that do not conflict with current public APIs.

The queue inspection API should not expose mutable internal arrays.

### 3. Execution semantics

When no animation is running, a queued animation should start according to the documented queue policy.

When a non-looping animation is running, the next queued request should start after its natural completion.

Use the lifecycle system from v0.7.1.

Do not use `setTimeout()` or create a separate playback clock.

### 4. Looping behavior

An indefinitely looping animation cannot naturally unblock the queue.

Choose and document a safe explicit policy.

For example:
- Reject queueing behind an indefinite loop unless an interruption/transition policy is specified.
- Or support an explicit option to replace the loop at a defined point.

Do NOT silently leave the queue pending forever without feedback.

### 5. Queue interruption

Support an explicit way to:
- Clear pending requests
- Stop queued playback
- Replace the active animation
- Discard or preserve pending requests according to a documented policy

Normal existing `play()` calls should have predictable interaction with queued requests.

Do not accidentally resume an obsolete queue after interruption.

### 6. Crossfading

Reuse the existing transition system.

Do not implement another blend evaluator.

Define whether a queued transition starts when the previous clip naturally completes or at an explicitly configured pre-end blend point.

For this milestone, completion-triggered transitions are sufficient if pre-end blending requires larger architectural changes.

Do not claim seamless pre-end crossfading unless it is actually implemented.

### 7. Animation validation

Reject invalid queue requests cleanly.

Handle:
- Unknown animation IDs
- Invalid playback options
- Disposed Puppet
- Unsupported looping configuration

A failed request should not corrupt the active queue.

### 8. Layers

The initial queue should control the ordinary/base playback channel.

Preserve existing layered animation behavior.

Do not accidentally stop an unrelated animation layer.

If the architecture already supports separate per-layer queues cleanly, integration is optional, not required.

### 9. Resource lifecycle

Clear or invalidate pending requests when the Puppet is destroyed.

Avoid retained references to disposed character data.

### 10. Tests

Cover:
- Queue one animation
- Queue multiple animations
- FIFO ordering
- Queue while idle
- Queue behind non-loop
- Looping behavior
- Unknown animation
- Stop and clear
- Interrupt active clip
- Replace queue
- Crossfade semantics
- Playback events
- Large update delta
- Disposal
- No duplicate starts

### 11. Do NOT implement

- State machine
- Promise-based playback API
- Actor movement
- Multi-character choreography
- New animation file formats
- New IK systems

### 12. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

- Animations can be queued
- Playback order is deterministic
- Existing lifecycle drives advancement
- Infinite loops cannot silently deadlock queues
- Stop/clear/interrupt behavior is predictable
- Existing layers and crossfades remain compatible
- Pending requests are cleaned up
- Tests, typecheck and build pass

## Final report

Provide:
1. Queue APIs
2. FIFO execution and transition semantics
3. Looping policy
4. Interrupt/clear behavior
5. Layer interactions
6. Files/APIs changed
7. Tests and command results
8. Deferred functionality

Do not claim completion unless required commands pass.
