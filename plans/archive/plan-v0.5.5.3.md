# Paper Puppeteer Engine — v0.5.5.3
## React IK Timeline & Inspector

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.5.2**

Already implemented:
- Serializable IK target animation data
- IK target keyframe mutation APIs
- IK target evaluation
- Animated IK influence where supported
- Existing IK solver integration
- Scrubbing/playback support
- Existing Animation Editor with React UI
- Keyframe tracks, selection, Undo/Redo and copy/paste

Do not rebuild those systems.

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

---

## Goal

Implement **v0.5.5.3 — React IK Timeline & Inspector**.

Allow artists to author IK target animation through the Animation Editor's existing timeline and inspector.

Implement:
1. IK target tracks
2. IK constraint selection
3. IK target keyframe markers
4. Numeric target position editing
5. IK influence editing
6. Keyframe creation/update/deletion
7. Integration with existing selection and Undo/Redo
8. Immediate puppet preview refresh

Do NOT implement draggable IK target handles yet.

## 1. IK target tracks

Extend the existing Animation Editor timeline.

Conceptually:

```text
BONES
  leftUpperArm
    rotation
  leftForearm
    rotation

IK TARGETS
  leftHandIK
    targetX
    targetY
    influence

  rightHandIK
    targetX
    targetY
    influence
```

Use the actual constraint IDs and track types from the project.

Only show influence if supported.

Do not represent IK targets as fake skeleton bones.

## 2. Reuse timeline infrastructure

Reuse existing:
- Time ruler
- Playhead
- Time-to-X conversion
- Keyframe markers
- Track expansion
- Timeline scrolling
- Snapping
- Keyframe time matching
- Keyboard shortcuts

Do not implement a second timeline.

## 3. IK constraint selection

Allow selecting an IK constraint from the timeline.

Selection should identify its existing rig constraint.

Selecting an IK target must not accidentally select or edit the constrained bone's transform keys.

Extend the existing selection model using a clear typed distinction.

## 4. React IK inspector

When an IK target is selected, display its evaluated target values at currentTime.

Example:

```text
IK TARGET: leftHandIK

Target X:    [120.0]
Target Y:    [-35.0]
Influence:   [1.0]

X key:       [Set] [Delete]
Y key:       [Set] [Delete]
Influence:   [Set] [Delete]
```

Adapt to existing schema and React component conventions.

Display the target coordinate system clearly.

Do not show screen coordinates as authored data.

## 5. Numeric authoring

Allow an artist to enter target positions numerically.

Editing must use the pure mutation APIs from v0.5.5.1.

Prefer explicit commit behavior consistent with the existing bone transform inspector.

Do not create dozens of history entries while typing.

## 6. Property-level keying

Allow individual properties to be keyed where the schema supports them.

For example:

```text
targetX: keyed
targetY: unkeyed
influence: keyed
```

Do not force unrelated target properties into every keyframe unless required by the existing format.

## 7. Create and update keys

At currentTime, the artist can:
- Set X key
- Set Y key
- Set influence key
- Update an existing key
- Optionally set the complete target position as one convenience action

One logical edit should create one Undo history operation.

## 8. Delete keys

Allow deleting IK target keys without affecting:
- Other IK constraints
- Bone animation keys
- Animation events
- Unrelated target properties

After deletion, re-evaluate the animation using existing fallback semantics.

## 9. Keyframe selection

Integrate IK keys with the existing typed timeline selection architecture.

If feasible without unrelated refactoring, support existing:
- Single selection
- Multi-selection
- Delete
- Move
- Snap
- Copy/paste
- Duplicate

Do not duplicate their algorithms.

If a generic keyframe operation cannot safely support IK channels yet, implement the minimum authoring operations and document the limitation for v0.5.5.5.

Never interpret an IK key as a bone transform key.

## 10. Inspector preview

After committing a key:

```text
working animation changes
        ↓
IK tracks re-evaluated
        ↓
existing IK solver
        ↓
puppet pose updates
```

Do not reload the character.

Do not reconstruct the rig.

## 11. Playback safety

Beginning a numeric IK edit should pause playback.

Do not let the clock advance while the artist commits values at the playhead.

After commit, remain paused.

Scrubbing and playback must continue working normally afterward.

## 12. Dirty state and Undo/Redo

These mark authored animation dirty:
- Create IK key
- Update IK key
- Delete IK key
- Move IK key

These do not:
- Select IK constraint
- Expand IK track
- Inspect values
- Scrub
- Change transient preview state

Use the existing working-copy and history architecture.

## 13. React integration

Use existing React component/state conventions.

Do not create a second authoritative:
- currentTime
- selected animation
- playback state
- authored animation store

React components should display and update the established Animation Editor controller/state.

Clean up subscriptions on unmount.

## 14. Tests

Add tests for:
- IK track generation
- IK selection
- Inspector state
- Correct evaluated values
- Creating keys
- Updating keys
- Deleting keys
- Property-level keying
- Working-copy isolation
- Undo/Redo
- Dirty state
- Selection reconciliation
- Source immutability
- React/controller synchronization

## 15. Manual verification

Using a demo arm or leg IK constraint:

1. Select an IK target.
2. Scrub to 0.0.
3. Enter target position A.
4. Create keys.
5. Scrub to 0.5.
6. Enter target position B.
7. Create keys.
8. Scrub to 1.0.
9. Enter target position C.
10. Create keys.
11. Play the animation.

Verify the limb follows the animated target.

Also test key deletion, Undo/Redo and ordinary bone animation editing.

## 16. Do NOT implement yet

- Visual IK handles
- Pointer dragging
- IK baking
- Mirrored IK target authoring
- New IK solvers
- Target ownership changes outside existing semantics
- Physics
- Scene choreography

## 17. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- IK target tracks appear in timeline
- Constraint selection works
- IK target values are inspectable
- Numeric IK keyframe authoring works
- Influence editing works where supported
- Preview updates immediately
- History/dirty state works
- Working/source animation separation is preserved
- Existing bone animation editing remains functional
- Tests, typecheck and build pass

## Final report

Report:
1. Implemented React components
2. Timeline architecture changes
3. IK inspector workflow
4. Keyframe/selection integration
5. History/dirty behavior
6. Files/APIs changed
7. Tests
8. Manual verification
9. Required command results
10. Deferred work

Do not claim completion unless all required commands pass.
