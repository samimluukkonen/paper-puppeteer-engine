# Paper Puppeteer Engine — v0.9.3
## Visual Scene Timeline

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.2**

Stack: React, TypeScript (strict), Phaser, Vite, npm and ES modules.

The Scene Editor supports SceneDefinition documents and visual Actor placement.

The Animation Editor already has mature timeline infrastructure.

Do not duplicate that timeline architecture unnecessarily.

## Goal

Allow artists to schedule scene actions visually on per-Actor timeline tracks.

Example:

```text
TIME       0s      2s      4s      6s

Actor A    Idle | Walk ── | Bow |
Actor B    Idle | Walk ────── | Bow |
Events                 Cue
```

### 1. Scene timeline

Create an editable timeline with:
- Time ruler
- Playhead
- Horizontal zoom/pan
- Per-Actor tracks
- Action clips/markers
- Selection
- Snapping
- Duration bounds

Reuse existing Animation Editor time-coordinate, selection and snapping utilities where practical.

Keep Scene and Animation Editor authored data models distinct.

### 2. Typed scene actions

Support an initial set matching v0.8 capabilities:

- Play animation
- Walk/move to position
- Change facing/look at Actor or point
- Timed wait or hold, if needed
- Generic named scene cue

Use a discriminated SceneActionDefinition model.

Do not serialize arbitrary JavaScript callbacks.

### 3. Action timing

Each action must have stable identity and explicit timing.

Support:
- Start time
- Duration where meaningful
- Actor ID
- Type-specific parameters

Define clear semantics for animation clips with looping or natural duration.

Never silently infer the duration of an infinite loop.

Actions of zero duration, such as facing changes or cues, may appear as markers.

### 4. React action inspector

Selecting a timeline action should expose its supported properties.

Examples:

**Animation**
- Animation ID
- Start time
- Duration or finite-play policy
- Playback options

**Movement**
- Destination X/Y
- Speed or explicit duration, consistent with existing v0.8 movement rules
- Start time

**Facing**
- Direction or target Actor/point
- Start time

**Cue**
- Name
- Time
- JSON-compatible payload if appropriate

Only offer valid animation IDs for the selected Actor's character.

### 5. Editing

Support:
- Add action
- Select action
- Move action in time
- Change supported duration
- Delete action
- Duplicate action
- Edit numeric values

Use existing history transactions.

One completed drag = one Undo action.

### 6. Conflict policy

Define and validate overlapping actions.

Examples:
- Two movement clips should not simultaneously own one Actor's position.
- Two base-animation clips require an explicit transition/ownership rule.
- Movement plus an animation may coexist only through a documented compatibility policy.

Allow different Actors to act concurrently.

Do not silently execute conflicting actions in arbitrary order.

### 7. Movement destination editing

Allow selecting a movement clip and editing its destination through the inspector.

If easy with existing stage handles, allow a non-destructive destination marker on the stage.

Do not confuse an Actor's initial position with a future movement destination.

### 8. Events and cues

Generic scene cues should be metadata/signals for application code.

Keep them separate from animation-authored events.

Do not hardcode sound, dialogue or combat-specific behavior.

### 9. Validation

Validate:
- Actor references
- Animation references
- Start/duration bounds
- Invalid target Actors
- Unsupported overlapping ownership
- Invalid movement parameters
- Non-finite numeric values

Reject invalid edits atomically.

### 10. Tests

Cover:
- Track creation
- Add/move/delete actions
- Cross-Actor timing
- Looping clip rules
- Movement timing
- Snap behavior
- Conflict detection
- Undo/Redo
- Serialization
- Source isolation

### 11. Out of scope

Do not implement:
- Scene playback engine
- Arbitrary scripting
- Branching dialogue
- Camera choreography
- Physics/pathfinding
- Complex nonlinear timelines

### 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

The artist can arrange multiple Actor actions on a shared scene timeline, edit their timing and properties, and save them as valid authored SceneDefinition data.

## Final report

Describe the action model, timeline architecture, timing/conflict policies, files changed, tests and verification results.
