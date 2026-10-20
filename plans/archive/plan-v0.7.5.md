# Paper Puppeteer Engine — v0.7.5
## Runtime Animation Controller — Production Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.4**

Technology stack:
- TypeScript (strict)
- Phaser runtime
- React + TypeScript editor
- Vite, npm, ES modules

Completed v0.7 features:
- Playback lifecycle/completion
- Animation queues
- Animation state controller
- Async `playAndWait()` API
- Cancellation and interruption handling

This phase completes v0.7.

Do not add major new features.

## Goal

Ensure the new runtime animation controller is stable, reusable and compatible with the production authoring tools from v0.6.

### 1. Public API review

Inspect all new public methods and types.

Ensure:
- Naming is consistent
- APIs are discoverable
- Return types are meaningful
- Optional arguments are typed
- Errors are actionable
- Existing Puppet APIs are preserved where possible

Do not introduce unnecessary competing ways to do the same thing.

### 2. Playback interaction matrix

Verify interactions between:

- Direct `play()`
- Queued animations
- State transitions
- One-shot actions
- `playAndWait()`
- Stop/cancel
- Crossfades
- Playback speed
- Looping

Define deterministic precedence and behavior.

### 3. Crossfade regression

Test transitions between:
- Idle and walk
- Walk and run
- Attack and idle
- Queued clips
- One-shot and persistent state

Reuse existing blending implementation.

Ensure lifecycle notifications match actual clip ownership and playback transitions.

### 4. Layer compatibility

Verify new controller behavior does not unexpectedly remove unrelated animation layers.

Test:
- Base animation
- Upper-body overlay
- Partial bone masks
- Crossfade with overlays active
- Stop/interruption

Do not redesign the layer system.

### 5. IK and procedural animation

Verify:
- Hand IK
- Leg IK
- Foot planting
- Weapon constraints
- Animated IK targets
- Baked IK animations

State transitions and queues must not reset rig constraints incorrectly.

### 6. Animation events

Verify keyframed animation events still fire correctly during:
- Normal playback
- Queued playback
- State transitions
- Crossfades
- Async playback

Preserve existing event ordering and loop semantics.

Lifecycle events must remain separate from authored animation events.

### 7. Resource cleanup

Stress-test:
- Repeated animation changes
- Queue clear/rebuild
- State controller creation/destruction
- Cancellation
- Puppet disposal
- Phaser scene shutdown
- Repeated character loading

No retained event listeners or pending promises after disposal.

### 8. Runtime consumer example

Extend the existing standalone runtime example.

Demonstrate:

**Basic playback**
```ts
puppet.play("idle");
```

**Queued animations**
```ts
puppet.queue("attack");
puppet.queue("recover");
```

**State controller**
```ts
controller.setState("walking");
```

**Async animation**
```ts
const result =
  await puppet.playAndWait("attack");
```

These are conceptual examples. Use the actual implemented public API signatures.

Include valid sample character animations.

Do not import React editor code into the runtime example.

### 9. Full regression testing

Verify:

**Runtime**
- CharacterLoader
- Puppet playback
- Layering/crossfading
- Lifecycle
- Queues
- State controller
- Async playback
- Animation events
- IK and baking
- Attachments/skins
- Cleanup

**Authoring**
- Rig Editor
- Animation Editor
- New Animation workflow, if present
- Mirroring
- Onion skinning
- IK target authoring
- IK baking
- Sprite replacement
- Rig-Tweak mode
- Export/import

**Data**
- Existing rig/animation schemas
- Stable serialization
- Older supported fixtures
- Character package loading

### 10. Performance testing

Measure representative runtime behavior with:
- One Puppet
- Multiple Puppets
- Continuous state changes
- Queued animations
- Crossfades
- IK active
- Repeated async operations

Avoid duplicate animation evaluations or unnecessary per-frame allocations.

Report measured findings rather than guessed performance figures.

### 11. Documentation

Update developer-facing documentation covering:
1. Basic playback
2. Lifecycle notifications
3. Queued animations
4. Animation states
5. One-shot actions
6. Async playback
7. Cancellation/interruption
8. Looping behavior
9. Crossfades
10. Animation layers
11. Cleanup/disposal

Include examples showing safe handling of non-completed await results.

### 12. Backward compatibility

Ensure the new controller does not force existing consumers to adopt it.

Existing `Puppet.play()` usage should continue working according to established behavior.

New controller features should remain opt-in where practical.

### 13. Tests

Expand automated coverage for:
- State transitions
- Queues
- Loop handling
- Interruption
- Cancellation
- Async completion
- Race conditions
- Layer preservation
- Animation events
- Puppet disposal
- Exported character integration

Use deterministic test clocks.

Do not claim manual browser verification unless actually performed.

### 14. Scope restrictions

Do not implement:
- Actor navigation
- `walkTo()` / `lookAt()` choreography
- Multi-character sequencing
- Visual scene editor
- Physics
- Ragdolls
- Mesh deformation

These belong to future milestones.

### 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint, browser smoke tests and standalone consumer build where available.

Fix all failures.

## Final v0.7 definition of done

v0.7 is complete when:
- Playback lifecycle is reliable
- Animation queues work
- Animation state controller works
- Async playback works
- Completion/interruption/cancellation semantics are explicit
- Existing crossfades and layers remain compatible
- IK and animation events remain correct
- Runtime remains independent from React/editor code
- Existing Puppet playback is backward-compatible
- A standalone runtime example demonstrates the new APIs
- Resource cleanup is correct
- Documentation is complete
- No known release-blocking regressions remain
- Tests, typecheck and build pass

## Final report

Provide:
1. Overall v0.7 readiness verdict
2. Implemented functionality
3. Final public runtime API
4. Playback/queue/state semantics
5. Async and cancellation behavior
6. Crossfade/layer compatibility
7. IK/event compatibility
8. Performance findings
9. Resource cleanup findings
10. Files/APIs changed
11. Tests and manual verification
12. Exact command results
13. Known limitations
14. Future v0.8 recommendations

Do not claim completion if release-blocking problems remain.
