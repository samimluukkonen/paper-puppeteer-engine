# Paper Puppeteer Engine — v0.5.8.2
## Visual Artwork Alignment

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.8.1**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

The project already has:
- Rig Editor joint manipulation
- Bone hierarchy
- Sprite origins and offsets
- Slot transform editing
- Imported/replacement artwork preview
- Undo/Redo
- Rig JSON export

Do NOT rebuild these systems.

## Goal

Implement **v0.5.8.2 — Visual Artwork Alignment**.

Improve the Rig Editor workflow for precisely aligning imported/replaced sprites with existing bones and joints.

This is an enhancement of existing functionality, not a new skeleton implementation.

### 1. Explicit editing modes

Ensure the artist can clearly distinguish:

```text
Joint Editing
→ Changes rig joint/bone structure

Artwork Offset Editing
→ Moves sprite relative to its bone

Sprite Origin Editing
→ Changes sprite pivot/origin

Slot Transform Editing
→ Changes attachment placement
```

Never silently substitute one operation for another.

### 2. Artwork alignment handles

Reuse existing Phaser editor handles where practical.

Support:
- Selecting artwork
- Dragging sprite offset
- Editing origin/pivot
- Numeric precision
- Visual joint marker
- Appropriate zoom/pan behavior

Joint location should remain visible as a reference during artwork alignment.

### 3. Pivot accuracy

Allow precise placement of a sprite's intended rotational pivot.

For example, the artist should be able to align a forearm image so it rotates naturally around the elbow joint.

Do not confuse:
- Skeleton joint position
- Texture-local sprite origin
- Sprite offset
- Slot transform

Keep conversions explicit.

### 4. Transform correctness

Check:
- Nested bones
- Parent rotation
- Puppet translation and scaling
- Facing/mirroring
- Zoom and pan
- Non-default sprite origins
- Imported images with different dimensions

Reuse existing coordinate conversion helpers.

### 5. Pixel and normalized coordinates

Inspect the current sprite-origin representation.

If the runtime stores normalized origins, provide useful pixel-coordinate editing where practical without changing the authored schema unnecessarily.

Ensure conversion is correct for actual image dimensions.

Do not silently round away meaningful precision.

### 6. React alignment inspector

Extend the existing Rig Editor inspector.

Display:
- Selected bone/slot/attachment
- Sprite dimensions
- Origin X/Y
- Offset X/Y
- Relevant rotation/scale settings
- Joint reference position

Use existing React components.

### 7. Alignment helpers

Provide small usability improvements such as:
- Reset sprite offset
- Reset origin
- Center sprite origin
- Toggle joint markers
- Hide/dim neighboring artwork
- Snap artwork movement where appropriate

Do not add complicated automatic joint detection.

### 8. Undo/Redo

One logical drag must create one history operation.

Numeric edits must behave consistently with existing Rig Editor history.

Cancelled gestures should not change rig data.

### 9. Preview existing animations

Where supported by current architecture, allow previewing a few existing animation poses while inspecting artwork alignment.

This helps the artist see how a replacement sprite moves.

Do not author animation keys in Rig Editor.

Do not bake IK.

### 10. Data separation

Sprite alignment may alter existing rig/attachment authored data according to current schema.

It must NOT modify:
- Bone animation keyframes
- IK target keys
- Animation events
- Animation timing

Changing the skeleton itself is a distinct joint-editing operation.

### 11. Tests

Cover:
- Joint vs artwork movement
- Origin conversion
- Nested transforms
- New image dimensions
- Facing
- Undo/Redo
- Serialization
- Rig immutability until commit
- Animation data unchanged

### 12. Manual verification

1. Load character in Rig Editor.
2. Import or select replacement forearm artwork.
3. Move artwork relative to elbow.
4. Adjust sprite origin.
5. Rotate forearm to check alignment.
6. Undo/Redo.
7. Switch facing.
8. Export/reload rig.
9. Verify identical visual placement.

### 13. Do NOT implement

- Rig-Tweak integration in Animation Editor
- Automatic anatomical joint detection
- Mesh deformation
- Full skin manager
- New IK algorithms
- Sprite asset package export

### 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Artwork alignment controls are clear and precise
- Joint editing remains separate
- Sprite origins and offsets work correctly
- Imported artwork can be aligned
- Nested transforms/facing work
- Undo/Redo works
- Rig export/reload preserves alignment
- Animation data remains untouched
- Tests, typecheck and build pass

## Final report

Describe:
1. Implemented alignment controls
2. Transform coordinate conventions
3. Joint/origin/offset separation
4. React and Phaser integration
5. Files/APIs changed
6. Tests
7. Manual verification
8. Required command results
9. Deferred features

Do not claim completion unless all commands pass.
