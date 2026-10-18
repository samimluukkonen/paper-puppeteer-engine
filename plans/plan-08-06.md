# Paper Puppeteer Engine — v0.8.6
## Actor & Scene Choreography Production Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.8.5**

Stack:
- TypeScript (strict)
- Phaser runtime
- React editor
- Vite, npm, ES modules

Completed v0.8 features:
- Actor abstraction
- Actor movement and `walkTo()`
- Facing and `lookAt()`
- Choreography sequences
- Multi-Actor coordination
- Completion and cancellation support

This phase completes v0.8.

Do not introduce major new features.

## Goal

Make the choreography layer dependable for scripted narrative scenes and external applications.

### 1. Public API audit

Review:
- Actor construction
- Puppet ownership
- Position handling
- `moveTo()`
- `walkTo()`
- `lookAt()`
- Choreography sequences
- Parallel actions
- Cancellation
- Disposal

Ensure APIs are typed, documented and consistent.

Do not change established Puppet APIs unnecessarily.

### 2. End-to-end scripted scene

Build a small reusable runtime example using existing exported character packages.

Scenario:

1. Load two characters.
2. Create two Actors.
3. Place them at opposite sides of a scene.
4. Start idle animations.
5. Walk them toward one another concurrently.
6. Wait until both arrive.
7. Face them toward each other.
8. Play a short animation for Actor A.
9. Play a response animation for Actor B.
10. Return both to idle.
11. Dispose resources.

Use animation names that actually exist in the sample character packages, or provide clearly documented replacements.

Do not hardcode project-specific story, character or franchise behavior into the engine.

### 3. Movement fidelity

Test:
- Different delta-time sequences
- Constant speed
- Exact destination arrival
- Zero-distance requests
- Repeated movement
- Interruptions
- Paused scenes
- Actor disposal

Verify world transforms remain correct.

### 4. Animation integration

Test choreography with:
- Animation queues
- State controller
- Crossfades
- `playAndWait()`
- Animation events
- IK
- Baked IK
- Skin switching
- Puppet facing

No duplicate playback clocks or event dispatchers.

### 5. Synchronization and cancellation

Stress-test:
- Cancel during a walk
- Cancel during an animation
- Cancel during a timed wait
- Cancel parallel actions
- Dispose one Actor during a group
- Replace an Actor's playback externally
- Run several scenes sequentially
- Attempt conflicting commands

No hanging promises or unhandled rejections.

### 6. Resource lifecycle

Check for:
- Retained Actor references
- Playback listeners
- Movement subscriptions
- Pending sequence promises
- Phaser GameObjects
- Runtime controller leaks

Repeated scene creation/destruction must clean up appropriately.

### 7. Performance

Measure representative scenes containing:
- One Actor
- Two Actors
- Several Actors
- Concurrent walks
- Animation crossfades
- IK-active Puppets

Use actual measurements rather than invented FPS numbers.

Avoid unnecessary per-frame allocations and redundant evaluation.

### 8. Runtime/editor separation

The choreography layer must work without importing:
- React
- Rig Editor
- Animation Editor
- Editor history
- Editor-only assets

The standalone Puppet runtime must continue working without Actor.

### 9. Regression testing

Verify:

**Runtime v0.1–v0.7**
- CharacterLoader
- Puppet playback
- Layers/crossfades
- Animation queues
- State controller
- Async playback
- IK
- Animation events
- Skins/attachments

**Authoring**
- Rig Editor
- Animation Editor
- Sprite replacement
- New Character workflow, where implemented
- IK constraint authoring, where implemented
- Character package export

**Choreography**
- Actor lifecycle
- Movement
- Facing
- Sequential actions
- Parallel actions
- Cancellation
- Disposal

### 10. Documentation

Create developer-facing guides covering:

1. Creating an Actor from a Puppet
2. Direct position updates
3. `moveTo()` and `walkTo()`
4. Animation state integration
5. `lookAt()` and facing limitations
6. Sequencing actions
7. Concurrent multi-Actor scenes
8. Completion and interruption
9. Cancellation
10. Ownership/disposal

Include a complete working example using the actual public APIs.

Explain explicitly that movement is direct point-to-point motion, not collision-aware navigation.

### 11. Release readiness

Prepare:
- v0.8 release notes
- Public API overview
- Supported capabilities
- Known limitations
- Future v0.9 integration considerations

Do not publish to npm, push Git tags or create remote releases without explicit authorization.

### 12. Required verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint, integration, browser and consumer-example checks where available.

Fix all failures.

Do not claim manual UI/runtime verification unless actually performed.

## Final v0.8 definition of done

v0.8 is complete when:
- Actors control Puppets through a clean runtime API
- Direct movement works
- Walk animation integrates with movement
- Spatial facing works
- Ordered choreography works
- Multiple Actors can act concurrently
- Synchronization is reliable
- Cancellation and interruption settle correctly
- Runtime remains editor-independent
- Existing Puppet API remains compatible
- No release-blocking regressions remain
- Documentation and runtime examples exist
- Tests, typecheck and build pass

If blocking issues remain, report v0.8 as NOT release-ready.

## Final report

Provide:
1. Overall release-readiness verdict
2. Final Actor/choreography architecture
3. Public APIs
4. Movement and facing behavior
5. Sequential/parallel choreography
6. Cancellation and error semantics
7. Runtime integration results
8. Performance findings
9. Resource cleanup findings
10. Files/APIs changed
11. Tests
12. Manual verification
13. Exact command results
14. Known limitations
15. Recommendations for v0.9

Do not claim completion unless all release gates pass.
