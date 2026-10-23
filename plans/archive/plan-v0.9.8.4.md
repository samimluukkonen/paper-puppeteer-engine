# Paper Puppeteer Engine — v0.9.8.4
## Foot Contact Markers — Production Hardening

Continue developing Paper Puppeteer Engine.

Current completed version: **v0.9.8.3**.

Stack: React, TypeScript (strict), Phaser, Vite, npm, ES modules.

Foot contact marker functionality is implemented in:
- Rig Editor
- Animation Editor
- Scene Editor

This phase completes v0.9.8.

The application is intended for myself and one artist friend. Prioritize practical reliability.

## Goal

Finalize the foot contact marker workflow, validate compatibility and ensure it is safe for existing characters and animations.

### 1. Full coordinate audit

Verify the marker transform pipeline:

```text
Bone-local marker position
          ↓
Evaluated bone transforms
          ↓
Post-IK pose
          ↓
Puppet/root transform
          ↓
Actor/scene transform
          ↓
World contact position
```

Adapt to actual engine architecture.

Check facing, nested rotations and negative/nonuniform scales where supported.

Do not use sprite pixel coordinates in place of bone-local coordinates.

### 2. Rig export/import

Verify markers survive:
- Rig JSON export
- Rig JSON import
- Character package export
- CharacterLoader
- Project export/import if implemented

Existing rigs without markers must remain compatible.

### 3. Animation data

Foot markers should not require new animation tracks.

Verify:
- Existing keys remain unchanged
- Mirrored animations work
- IK and baked IK continue working
- Animation switching is safe
- Rig-Tweak mode preserves correct document ownership

Do not bake marker positions into the animation.

### 4. Artwork replacement

Test sprite replacement and skin switching.

Because markers are attached to bones rather than texture pixels, replacing artwork should not automatically destroy marker positions.

However, new artwork may have different visual proportions.

Warn that the artist may need to manually realign the contact markers if the sole position has changed.

Do not promise exact contact position for every skin automatically.

### 5. Dependency safety

When deleting or renaming a marker, inspect:
- Persisted Scene Editor grounding selections
- Project asset references
- Other explicit marker-ID references

Provide actionable warnings.

Do not silently corrupt referenced scene data.

### 6. Feature Guide Wizard

If the existing guided tutorial system is implemented, add:

**Rig Editor — Creating Foot Contact Markers**
- Select foot bone
- Create marker
- Position marker
- Align with ground reference
- Save rig

**Animation Editor — Aligning Feet to Ground**
- Enable ground guide
- Show contact markers
- Select marker/IK constraint
- Preview correction
- Commit/Undo

**Scene Editor — Grounding Characters**
- Enable ground reference
- Select Actor
- Select marker
- Snap Actor
- Preview scene

Use existing guide registration and spotlight anchors.

Do not rebuild the Guide Wizard.

### 7. Empty and invalid states

Check:
- Character without foot markers
- Empty rig
- Non-humanoid character
- Missing marker bone
- No IK constraint
- Disabled IK
- Unreachable target
- Different character scales
- Scene without Actors
- Animation without keyframes
- Mirrored/facing changes

Avoid crashes and inaccurate success messages.

### 8. Performance and lifecycle

Ensure marker visualization does not:
- Recreate Phaser objects every frame
- Produce excessive React updates
- Leak listeners
- Accumulate stale gizmos on character changes

Verify proper cleanup on editor unmount and scene disposal.

### 9. End-to-end artist test

Exercise:

1. Open an existing character.
2. Create contact markers for both feet.
3. Position markers in Rig Editor.
4. Export/reload rig.
5. Open Animation Editor.
6. Enable ground reference.
7. Observe foot contact through a walk animation.
8. Preview and commit a supported IK correction.
9. Undo/Redo.
10. Open Scene Editor.
11. Add character.
12. Snap using the selected foot contact marker.
13. Add another character with different proportions.
14. Snap it independently.
15. Play/scrub scene.
16. Export/reload the scene and character packages.

Confirm:
- Marker positions persist.
- Grounding is correct within documented tolerance.
- No unexpected keyframes are authored.
- Existing animations are preserved.

### 10. Regression tests

Check existing:
- Bone and joint editing
- IK constraint authoring
- Foot planting
- IK baking
- Mirroring
- Onion skinning
- Sprite replacement
- Scene Actor movement
- Scene scrubbing
- Undo/Redo
- Character and scene exports
- Ground Reference Guides

### 11. Scope restrictions

Do not introduce:
- Automatic foot contact phase recognition
- Foot sliding compensation
- Foot locking during movement
- Physics
- Collision
- Terrain navigation
- Mesh deformation

These are optional future features.

### 12. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Run existing browser/E2E and runtime integration tests where available.

Fix all failures.

Do not claim manual verification unless actually performed.

## Final v0.9.8 definition of done

- Rig Editor can author foot contact markers.
- Markers use bone-local coordinates.
- Markers follow evaluated bone poses.
- Animation Editor can visualize ground contact.
- Explicit IK-assisted contact alignment works for supported rigs.
- Scene Editor can snap an Actor using a real marker.
- Old characters without markers still work.
- Rig/scene references remain valid.
- Export/import preserves marker definitions.
- Existing animation keys are not modified implicitly.
- Undo/Redo works.
- Feature Guide integration works where available.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall readiness
2. Marker data model
3. Bone/world transform correctness
4. Rig Editor workflow
5. Animation Editor workflow
6. Scene Editor workflow
7. Export/import behavior
8. Backward compatibility
9. Files/APIs changed
10. Tests
11. Actual manual verification
12. Exact command results
13. Remaining limitations

Do not claim completion unless all required checks pass.
