# Paper Puppeteer Engine — v0.5.6.5
## IK Baking Production Hardening & Regression

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.6.4**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

Already implemented:
- Read-only IK bake sampling
- Bone keyframe generation
- Atomic bake commits
- Per-animation IK deactivation
- React Bake panel
- Non-destructive preview
- Undo/Redo integration

This phase completes v0.5.6.

Do not introduce major new features.

## Goal

Harden IK Baking for real artist workflows.

Focus on motion fidelity, runtime compatibility, animation editing, serialization and regression testing.

### 1. Bake fidelity

Compare the original IK-driven animation and baked animation.

Sample both at:
- Animation start
- Every generated keyframe time
- Midpoints between generated keys
- Near animation end
- Exact animation end

Measure:
- Relevant local bone transforms
- End-effector world position
- Relevant joint rotations

Define reasonable documented tolerances.

Distinguish exact sampling-time agreement from between-key interpolation error.

Do not hide fidelity errors.

### 2. Sampling quality

Test:
- 8 FPS
- 10 FPS
- 12 FPS
- Higher sampling FPS
- Stepped interpolation
- Smooth interpolation
- Different playback speeds

Changing sampling FPS should not change animation duration.

If the selected sampling frequency is too low to preserve motion acceptably, show meaningful feedback.

Do not implement adaptive sampling or automatic key reduction in this milestone.

### 3. Constraint deactivation

Verify baked IK is not applied twice.

Test:
- One selected constraint
- Multiple independent constraints
- Other constraints remaining active
- Different animation clips sharing the same rig
- Switching from baked to non-baked animations

Do not modify shared rig constraints globally.

### 4. Animation editing after bake

Baked keys must behave like ordinary bone keyframes.

Verify:
- Select keys
- Edit values
- Delete keys
- Move keys
- Group movement
- Copy/paste
- Duplicate
- Change interpolation
- Undo/Redo

No special keyframe representation should be required after baking.

### 5. Playback

Verify:
- Play/Pause
- Restart
- Loop
- Playback speed
- Scrubbing
- Animation completion
- Crossfades
- Animation layers

Ensure baked and non-baked clips interact according to established runtime constraint precedence.

Document any unsupported transition configuration rather than silently producing incorrect motion.

### 6. IK edge cases

Test:
- Unreachable targets
- Zero IK influence
- Partial influence
- Changing influence
- Rotated parent bones
- Facing left/right
- Nonuniform puppet scale
- Unequal bone lengths
- Zero-duration animation
- No IK keys
- Multiple IK constraints
- Invalid constraint references

No crashes or invalid transforms.

### 7. Onion skinning

After baking:
- Temporal ghosts update
- Ghosts show the authored baked animation
- No stale procedural IK preview remains
- Ghost sampling does not dispatch events
- Animation data is never mutated by ghosts

### 8. Mirroring

Verify v0.5.4 bone mirroring works on baked bone keys.

IK target data should not accidentally be mirrored or reactivated by ordinary bone mirror operations.

### 9. Animation events

Baking must preserve event markers, payloads and timing.

Preview and sampling must not dispatch gameplay events.

Normal playback should maintain existing event semantics.

### 10. JSON import/export

Verify:

```text
Original IK animation
        ↓
Bake
        ↓
Export animation.json
        ↓
Import/reload
        ↓
Same baked bone motion
        ↓
No double IK
```

Ensure any per-animation constraint override survives serialization.

Test stable canonical export over repeated round trips.

### 11. CharacterLoader

Load exported baked animations through CharacterLoader.

Confirm production Puppet playback does not rely on editor-only state.

No special bake-time editor controller should be needed in production.

### 12. Source immutability and history

Perform:

```text
Load original animation
Bake IK
Edit baked keys
Undo
Undo
Redo
Export
Import
Revert
```

Verify history and dirty-state lifecycle are correct.

Original source animation must remain immutable.

### 13. React/Phaser lifecycle

Test:
- Open/close Bake panel
- Change animation
- Change character
- Switch editor route
- Toggle preview
- Unmount components
- Destroy Phaser scene

No leaked handles, subscriptions or stale bake plans.

### 14. Full regression pass

Verify no regressions to:

**Rig Editor**
- Joint placement
- Bone hierarchy
- Sprite alignment
- Slots/attachments
- IK preview
- Undo/Redo
- Rig export

**Animation Editor**
- Bone keyframes
- IK target authoring
- Timeline
- Multi-selection
- Snapping
- Copy/paste
- Interpolation
- Events
- Mirroring
- Onion skinning
- Import/export
- Playback

**Runtime**
- Puppet playback
- IK solver
- Weapon constraints
- Foot planting
- Blending/layers
- Skins
- CharacterLoader

### 15. Documentation

Update artist-facing documentation.

Explain:
1. What IK baking does
2. When an artist should bake
3. Difference between IK keys and bone keys
4. Selecting constraints
5. Sampling FPS
6. Previewing the bake
7. Committing
8. Editing baked bone keys
9. Undoing the bake
10. Fidelity limitations

Include an example of animating a reaching arm with IK and converting it into editable shoulder/elbow rotation keys.

### 16. Automated tests

Expand coverage for:
- Bake fidelity
- Determinism
- Constraint isolation
- No double IK
- Keyframe interpolation
- Undo/Redo
- Serialization
- CharacterLoader compatibility
- Source immutability
- Event isolation
- React lifecycle

Do not claim manual verification that was not actually performed.

### 17. Do NOT implement

- Partial-range baking
- Adaptive keyframe reduction
- Automatic motion cleanup
- New IK solvers
- Advanced animation retargeting
- Sprite replacement
- Rig-tweak mode
- Physics
- Ragdolls
- Scene choreography

### 18. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Final v0.5.6 definition of done

v0.5.6 is complete when:
- IK can be sampled read-only
- Solved poses become ordinary bone keyframes
- Baked motion approximates original IK motion within documented tolerance
- Constraints are deactivated correctly for the baked animation
- Other animations retain their IK functionality
- Bake actions are atomic and undoable
- React Bake UI works
- Playback and editing of baked keys work
- Animation events remain intact
- Onion skinning and mirroring remain functional
- Export/import preserves baked behavior
- CharacterLoader works
- Source animation remains immutable
- Documentation is updated
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented functionality
2. Final baking architecture
3. Sampling and fidelity results
4. Constraint deactivation
5. React UI workflow
6. Keyframe editing compatibility
7. Undo/Redo behavior
8. Serialization and CharacterLoader results
9. Performance findings
10. Files/APIs changed
11. Automated tests
12. Manual verification
13. Documentation changes
14. Required command results
15. Deferred features

Do not claim completion unless all required commands pass.
