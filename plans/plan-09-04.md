# Paper Puppeteer Engine — v0.9.4
## Scene Playback, Preview & Scrubbing

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.3**

Stack: React, TypeScript (strict), Phaser, Vite, npm and ES modules.

Already implemented:
- Scene documents
- Stage Actor placement
- Scene timeline/action editing
- v0.8 Actor movement and choreography
- v0.7 animation playback lifecycle

Do not implement another Puppet animation evaluator.

## Goal

Preview authored scenes using the existing runtime.

The artist must be able to:
- Play
- Pause
- Restart
- Stop
- Scrub
- Inspect Actors at selected scene times

### 1. Scene runtime adapter

Create a small adapter/runner that transforms validated SceneActionDefinition data into v0.8 Actor and choreography operations.

Do not directly embed runtime execution logic in React timeline components.

Use the authoritative runtime Actor movement, animation and facing APIs.

### 2. Deterministic scene clock

Use the existing Phaser/runtime delta-time update mechanism.

Scene actions must follow one authoritative scene time.

Do not use browser wall-clock timers for scene execution.

Support playback speed if it integrates cleanly.

### 3. Action scheduling

Actions should start at their authored times.

Support:
- Sequential commands
- Parallel actions across Actors
- Named cues
- Clip completion
- Stop and restart

Respect the conflict/ownership policies established in v0.9.3.

### 4. Playback versus authoring

Keep runtime preview state separate from SceneDefinition.

Playing a scene must not:
- Write scene actions
- Move authored initial Actor positions
- Create Undo history
- Mark scene dirty
- Modify character animation files

### 5. Scrubbing

Scrubbing is more difficult than playing because Actor movement and choreography are stateful.

Implement an explicit, reliable preview-seeking strategy.

Preferred:
- Start from a known initial scene snapshot.
- Evaluate or deterministically simulate authored actions up to the requested time in an isolated preview context.
- Display the corresponding Actor transforms and animation poses.

Reuse existing pure animation evaluation and movement calculations where possible.

Do not rely on uncontrolled accumulated runtime state from the previous scrub position.

Do not approximate arbitrary stateful scripts as if they were pure animations.

### 6. Side-effect safety

While scrubbing or rebuilding preview state:
- Do not dispatch scene cues externally.
- Do not fire gameplay callbacks.
- Do not trigger sounds or other external side effects.
- Do not fire keyframed animation events as gameplay events.

During actual playback, preserve existing event semantics.

Distinguish preview seeking from runtime execution.

### 7. Playback interactions

Define clear behavior for:
- Scrubbing while playing
- Restart during playback
- Animation transitions
- Scene pause
- Scene completion
- Actor interruption
- Cancellation
- Character disposal

Use existing v0.7/v0.8 lifecycle outcomes.

Prevent hanging promises and obsolete scheduled actions.

### 8. Concurrent Actors

All Actors in a scene must use the same scene time.

Two simultaneous walks should remain synchronized even when their durations differ.

Do not create independent animation clocks for each scene timeline track.

### 9. Unsupported seeking

If some complex action cannot be evaluated safely at arbitrary time, identify and report it explicitly.

Do not silently display a misleading pose.

Prefer a correct limited preview to an incorrect "complete" simulator.

### 10. Tests

Cover:
- Start/pause/restart
- Action scheduling
- Parallel movement
- Animation clips
- Facing changes
- Loop boundaries
- Scene end
- Forward/backward scrubbing
- Seek from different previous states
- No event dispatch during seek
- No authored data mutation
- Cancellation/disposal
- Deterministic time stepping

### 11. Manual verification

Create a two-character encounter:
1. Actors begin apart.
2. Both walk toward the center.
3. They face one another.
4. Actor A bows.
5. Actor B responds.

Verify playback and seek to times before, during and after movement.

### 12. Out of scope

Do not implement:
- Visual camera director
- Dialogue renderer
- Branching narrative
- Physics/pathfinding
- New animation solvers

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

Scene playback works through the existing runtime, authored actions execute at correct times, and scrubbing produces deterministic non-destructive previews for supported action types.

## Final report

Describe the runtime adapter, scene clock, seeking strategy, side-effect isolation, tests and actual verification results.
