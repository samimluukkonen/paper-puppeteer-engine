# Paper Puppeteer Engine — v1.1.3
## Animation Variations

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.1.2.2**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems:
- Animation Editor
- New Animation from scratch
- Bone/IK keyframes
- Mirroring
- Keyframe retiming
- Graph Editor
- Undo/Redo
- Animation JSON export
- Project Workspace

## Goal

Allow an artist to create a new animation variation from an existing animation without modifying the source animation.

Example:

```text
attack-basic
     ↓ Create Variation
attack-heavy
     ↓ Edit independently
attack-heavy-final
```

The new animation must be a genuine, independently editable document.

## 1. Inspect existing tools

Review:
- Animation duplication
- New Animation workflow
- Animation registration
- Keyframe cloning
- Mirroring
- Retiming
- Working-copy ownership
- Animation IDs and package export

Reuse these systems.

Do not create a competing animation document model.

## 2. Create Variation

Add an action:

**Create Variation**

It should be available from the animation list and/or editor toolbar.

Open a small React dialog:

```text
CREATE ANIMATION VARIATION

Source: attack-basic

New name:
[ Heavy Attack ]

New ID:
[ attack-heavy ]

[ Cancel ] [ Create Variation ]
```

Validate duplicate IDs.

## 3. Independent animation copy

The new animation should preserve relevant authored content:
- Bone tracks
- IK target tracks
- Interpolation
- Bézier curves
- Events and payloads
- Supported animation settings
- Baking metadata where relevant

Use a correct deep copy or established immutable cloning function.

Never share mutable keyframe arrays between original and variation.

## 4. Optional initial transformations

If existing authoring APIs safely support them, provide a small set of optional transformations.

Suggested:
- Time scaling / speed variation
- Mirroring using existing tools
- Selected bone transform offsets

Do not create a completely new motion-transformation subsystem.

Applying time scaling must consistently update dependent keyframe and event times, or clearly reject unsupported cases.

## 5. Preview before creation

Where practical, allow a non-destructive preview of the proposed variation.

The source animation must remain unchanged.

Cancel discards temporary data.

## 6. Animation registration

After creation:
- Register new animation in the current character/project.
- Give it a unique ID.
- Select it.
- Initialize its own working-copy/history lifecycle.
- Mark it New/Unsaved.
- Permit immediate normal editing.

Do not overwrite the original animation.

## 7. Source provenance

Optional lightweight metadata may indicate which animation was used as the starting point.

Do not implement complex live inheritance.

Editing the original later should not silently alter its variations.

## 8. Integration

Verify variations work with:
- Graph Editor
- Pose Library
- Mirroring
- IK
- IK baking
- Events
- Animation queues/states
- Character package export
- Scene Editor animation references

## 9. Tests

Cover:
- New variation
- Deep-copy isolation
- Unique IDs
- Time scaling
- Event preservation
- IK/baking metadata
- Curve preservation
- Cancel/commit
- Undo/Redo
- Export/import
- Multiple variations
- Original animation immutability

## 10. Manual verification

1. Open an attack animation.
2. Create a variation.
3. Rename it.
4. Adjust arm keyframes.
5. Change its easing curve.
6. Preview both animations.
7. Confirm the original is unchanged.
8. Export/reload the new variation.
9. Use the variation in a Scene Editor clip.

## 11. Out of scope

Do not implement:
- Generative AI motion variations
- Automatic animation retargeting
- Live linked inheritance
- Motion blending graphs
- New runtime animation state systems

## 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

- Variations can be created from existing animations.
- Original animations remain unchanged.
- New copies are independently editable.
- Compatible tracks, curves and events are preserved.
- Variations appear in the workspace.
- Export/import works.
- Undo/Redo works.
- Tests, typecheck and build pass.

## Final report

Provide implemented workflow, deep-copy guarantees, supported transformations, files/APIs changed, tests and exact verification results.
