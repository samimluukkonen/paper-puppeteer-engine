# Paper Puppeteer Engine — v0.9.6
## Visual Scene Editor — Production Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.5**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Completed features:
- Scene Editor workspace
- Actor stage placement
- Scene action timeline
- Scene playback and scrubbing
- Scene JSON import/export
- Scene package/runtime integration

This phase completes v0.9.

The project is a private tool for myself and my artist friend. Prioritize reliability and practical usability, not commercial product polish.

## Goal

Make the Visual Scene Editor dependable for producing scripted character scenes.

### 1. Complete artist workflow

Verify the following workflow:

1. Open Scene Editor.
2. Create a new scene.
3. Add two character packages.
4. Position both Actors.
5. Set their starting animation.
6. Add walk actions.
7. Set movement destinations.
8. Add facing commands.
9. Add animation clips.
10. Add an optional scene cue.
11. Preview the scene.
12. Scrub backward and forward.
13. Adjust timing.
14. Undo/Redo.
15. Export the scene.
16. Reload it.
17. Play it through the standalone runtime.

This workflow should be usable without writing TypeScript scene code.

### 2. Timeline correctness

Verify:
- Multiple Actors
- Simultaneous actions
- Sequential actions
- Animation start/end timing
- Movement durations
- Looping clips
- Clip dragging
- Snapping
- Conflict validation
- Timeline zoom/pan
- Undo/Redo

### 3. Playback correctness

Test:
- Play/Pause/Restart
- Scrubbing in either direction
- Scene completion
- Cancellation
- Actor interruption
- Large frame deltas
- Scene pause
- Animation crossfading
- Cue timing

The preview must not duplicate gameplay events during seeks.

### 4. Character isolation

Scene authoring must not modify source:
- Rig definitions
- Animations
- IK tracks
- Skins
- Attachments
- Sprite binaries

The scene stores character references and Actor/action configuration.

### 5. React/Phaser lifecycle

Exercise:
- Open/close Scene Editor
- Switch scenes
- Add/remove Actors
- Change characters
- Reload scene
- Rapid scrubbing
- Start/stop playback repeatedly
- Unmount components
- Destroy Phaser scene

No stale listeners, duplicate GameObjects or leaked character resources.

### 6. Performance

Measure representative scenarios:
- Two Actors
- Five Actors
- Multiple simultaneous movement actions
- Overlapping animation playback
- Complex IK-enabled characters
- Large scene timelines

Avoid unnecessary React updates on every Phaser frame.

Only optimize measured bottlenecks.

### 7. Feature Guide Wizard

If the previously planned Feature Guide Wizard is implemented, extend its registry with Scene Editor tours.

Suggested topics:
- Creating a Scene
- Adding an Actor
- Positioning an Actor
- Creating animation clips
- Adding movement
- Arranging action timing
- Previewing a Scene
- Exporting a Scene

Use existing guide registry and spotlight infrastructure.

Do not rebuild the wizard.

If the wizard is not present, document this as deferred rather than creating it from scratch in this milestone.

### 8. Regression checks

**Rig Editor**
- Joint editing
- IK constraints
- Sprite alignment
- Skins and attachments

**Animation Editor**
- New animation creation
- Keyframes
- IK authoring/baking
- Onion skinning
- Mirroring
- Events
- Import/export

**v0.7 Runtime**
- Animation queues
- State controller
- Async playback
- Lifecycle notifications

**v0.8 Runtime**
- Actor movement
- Facing
- Choreography sequences
- Parallel actions
- Cancellation

**v0.9 Editor**
- Scene documents
- Actor stage
- Timeline
- Preview
- Import/export
- Standalone scene playback

### 9. Documentation

Create a practical **Making Your First Scene** guide.

Explain:
- What Scene Editor is
- How it differs from Rig/Animation Editors
- How to add Actors
- How the timeline works
- How movement and animation clips interact
- How to preview/scrub
- How to export and load scenes
- What is deliberately unsupported

Use actual current UI and APIs.

### 10. Automated tests

Extend tests for:
- Scene validation
- Action conflicts
- Timeline edits
- Undo/Redo
- Playback scheduling
- Deterministic seeking
- Side-effect isolation
- Cancellation
- Character package references
- Import/export
- Runtime integration
- Resource cleanup

Use existing test tools.

Do not claim manual verification unless actually performed.

### 11. Known limitations

Document unsupported capabilities such as:
- Pathfinding and obstacle avoidance
- Physics-based movement
- Branching story logic
- Dialogue authoring
- Camera choreography
- Timeline-controlled audio

These may be future additions, but they are not necessary to complete v0.9.

### 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint/browser/integration tests and consumer builds where available.

Fix all failures.

## Final v0.9 definition of done

v0.9 is complete when:
- A scene can be created visually
- Characters can be placed on the stage
- Actions can be scheduled on a timeline
- Multiple Actors can act concurrently
- Playback works
- Scrubbing is deterministic for supported actions
- Import/export works
- The scene runs through the standalone runtime
- Authored character data remains unchanged
- Undo/Redo works
- Resource cleanup is reliable
- Documentation is updated
- No release-blocking defects remain
- Tests, typecheck and build pass

## Final report

Provide:
1. Overall v0.9 readiness verdict
2. Final Scene Editor architecture
3. Scene format and runtime adapter
4. Timeline and scheduling behavior
5. Scrubbing semantics
6. Import/export and package loading
7. React/Phaser lifecycle
8. Performance observations
9. Files/APIs changed
10. Automated tests
11. Actual manual verification
12. Documentation
13. Exact verification command results
14. Remaining limitations
15. Recommendations for v1.0

Do not claim completion unless required checks pass.
