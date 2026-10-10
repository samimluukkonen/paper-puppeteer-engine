# Paper Puppeteer Engine — v0.5.4.3
## Mirrored Keyframe Authoring

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.4.2**

The project has:
- Validated left/right bone symmetry mappings
- Pure pose mirroring
- Left-to-right, right-to-left and swap operations
- Existing animation keyframe mutation APIs
- Multi-key selection
- Copy/paste and duplication
- Group edits
- Undo/Redo
- Interpolation editing

Do not rewrite these systems.

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript, ES modules.

---

## Goal

Implement **v0.5.4.3 — Mirrored Keyframe Authoring**.

Allow authored animation transforms and selected keyframes to be mirrored onto corresponding bones.

Implement:
1. Mirror current pose into authored keyframes
2. Mirror selected keyframes
3. Preserve keyframe timing
4. Preserve interpolation metadata
5. Handle target collisions
6. Atomic authored operations
7. Undo/Redo integration

Do NOT build the complete React UI yet.

## 1. Mirror current pose

Support a command conceptually like:

```ts
mirrorCurrentPoseToKeys(
  animation,
  rig,
  mapping,
  currentTime,
  direction,
  options
)
```

At the current time:
- Evaluate the original authored pose
- Use the existing v0.5.4.2 mirror math
- Determine corresponding target-bone transforms
- Commit authored keys on the appropriate destination tracks

Do not edit the rig or source animation.

Do not bake the final IK-corrected pose.

## 2. Explicit commit behavior

Mirroring must be an intentional authored operation.

A mirror preview or selection must not automatically create keys.

Keep authored mutations centralized in the animation editing/controller layer.

## 3. Selected bone support

Allow mirroring a selected bone onto its mapped counterpart.

Example:

```text
Selected: leftForearm

Mirror left → right

Source:
leftForearm.rotation @ 0.5 = 35°

Destination:
rightForearm.rotation @ 0.5 =
appropriate mirrored rotation
```

Use rest-pose-aware mirror math, not an unconditional `rotation * -1`.

## 4. Selected keyframe support

Support mirroring multiple selected keys from existing timeline selection state.

Selected keys may span:
- Multiple bones
- Multiple properties
- Multiple times

Destination keys should be written to corresponding mirrored bone/property tracks.

Unselected properties must not be keyed unintentionally.

When mirroring a property requires additional evaluated pose context, resolve it through the existing evaluator and pure mirror math. Do not silently substitute a potentially incorrect direct value transformation.

## 5. Timing

Preserve source keyframe times.

For example:

```text
Left arm:
0.0
0.3
0.7
1.0

Mirror → right arm

Right arm:
0.0
0.3
0.7
1.0
```

Do not shift, stretch or resample time automatically.

Preserve existing animation duration.

## 6. Interpolation metadata

Preserve supported authored interpolation modes.

Example:

```text
leftArm.rotation
0.0 smooth
0.5 stepped
1.0 smooth
```

Corresponding mirrored keys should retain the same interpolation metadata, unless the existing schema requires a documented transformation.

Do not introduce another interpolation evaluator.

## 7. Partial animations

Keep partial property animation support.

If only rotation keys are selected, do not automatically generate X/Y/scale tracks.

Avoid silently converting sparse animations into complete transform snapshots.

## 8. Copy directions

Support:
- Left-to-right
- Right-to-left
- Swap

For Swap, calculate everything from the unchanged original animation snapshot.

Do not overwrite one side before reading the other.

## 9. Key collisions

Reuse the existing keyframe collision policy.

When a mirrored destination already has a key at the same time, follow the project's established replace/reject semantics.

Do not create duplicate same-track/same-time keys.

If any required mapping or target is invalid, reject the entire operation rather than partially writing keys.

## 10. Atomic operations

One mirror action must produce:
- One authored transaction
- One Undo history entry
- One dirty-state update
- One coherent selection refresh

Do not create a separate Undo operation for each generated key.

## 11. Undo/Redo

Example:

```text
Select 12 left-side keys
Mirror to right side
Undo
→ right side restored exactly

Redo
→ mirrored keys restored
```

Existing destination keys replaced by a mirror operation must be restored exactly on Undo.

## 12. Selection after mirroring

After commit, select the newly created/updated destination keys where appropriate.

Maintain coherent:
- Primary key
- Selected bone
- Selected property
- Current time

Do not alter timeline time unnecessarily.

## 13. Events and attachments

Do not mirror animation events.

Do not automatically alter:
- Weapon attachments
- Skin selection
- Slots
- Event payloads
- Facing
- IK targets

These are separate concepts.

## 14. Validation

Run existing animation validation after constructing the proposed result and before committing it.

Do not weaken validation.

Reject invalid transforms, missing bone references or unsupported mirror operations with actionable errors.

## 15. Tests

Cover:
- Single bone mirroring
- Selected key mirroring
- Multi-key mirroring
- Multiple bones/properties
- Left-to-right
- Right-to-left
- Swap
- Timing preservation
- Interpolation preservation
- Partial tracks
- Collision handling
- Atomic failure
- Undo/Redo
- Selection reconciliation
- Source immutability
- IK output not baked
- Events and attachments unchanged

## 16. Do NOT implement

- Full React mirror toolbar
- Automated left/right animation generation
- Time-reversed mirroring
- Cross-animation mirroring
- Mirrored event payloads
- Mirrored IK target authoring
- Sprite replacement
- Rig joint editing

## 17. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix every failure.

## Definition of done

- Current pose can be mirrored into authored keyframes
- Selected keys can be mirrored
- Timing/interpolation preserved
- Partial tracks supported
- Collision handling correct
- Operations atomic
- Undo/Redo works
- Animation validation passes
- Existing runtime evaluator remains authoritative
- Tests, typecheck and build pass

## Final report

Report:
1. Implemented operations
2. Mirrored keyframe algorithm
3. Partial property handling
4. Collision semantics
5. History/dirty behavior
6. Files and APIs changed
7. Tests and verification
8. Deferred features

Do not claim completion unless all required commands pass.
