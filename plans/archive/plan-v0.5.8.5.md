# Paper Puppeteer Engine — v0.5.8.5
## Safe Sprite Replacement & Hot Reload

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.8.4**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

Already implemented:
- Local sprite import and preview
- Artwork alignment tools
- Animation Editor Rig-Tweak Mode
- Visual attachment management
- Skin management
- Stable character manifests
- Existing animation and IK runtime

Do NOT rebuild these systems.

## Goal

Implement **v0.5.8.5 — Safe Sprite Replacement & Hot Reload**.

Make sprite replacement dependable in real production.

An artist should be able to redraw a body part, import the new version, and see it replace the old artwork without rebuilding the skeleton or reauthoring animations.

### 1. Stable attachment identity

Preserve existing logical:
- Attachment IDs
- Slot relationships
- Bone hierarchy
- Skin mappings
- Render depth
- Animation references

Do not derive attachment identity from imported filenames.

### 2. Shared artwork references

Determine whether an imported asset is used by multiple attachments or skins.

Distinguish:

```text
Replace shared artwork asset
→ All its references update

Replace one attachment's artwork
→ Only that attachment changes
```

Do not silently replace every use when the artist intended only one.

### 3. Image dimensions

Handle same-size and different-size replacements.

If dimensions differ, show:

```text
Old size: 256 × 256
New size: 320 × 320
```

Clearly explain possible consequences for:
- Sprite origin
- Texture-local pivot
- Sprite alignment
- Frame references
- Visible scale

Do not silently alter bone positions.

### 4. Pivot preservation

Inspect how sprite origins are stored.

When dimensions change, offer a safe, explicit alignment policy.

Where supported:
- Preserve normalized origin
- Preserve pivot position in texture-local pixels
- Manually realign afterward

Do not assume these are equivalent.

Preview the choice before commit.

### 5. Atlas/frame handling

If an attachment references a texture frame, validate that the replacement still provides a valid frame.

Do not silently switch to an unrelated frame.

If the replacement invalidates frame references, reject or require explicit resolution.

### 6. Phaser texture refresh

Update the active preview after replacement.

Ensure:
- New image appears
- Old textures are not destroyed while still referenced
- Cache keys remain coherent
- No stale textures remain visible
- React and Phaser reflect the same asset revision

Avoid duplicate texture loading on repeated animation playback.

### 7. Animation compatibility

Verify replacement works during:
- Idle
- Walk
- Attack animations
- IK-driven motion
- Baked IK motion
- Mirrored animations
- Onion skinning

Animation keyframes must remain unchanged.

### 8. Attachment compatibility

Verify:
- Slots remain attached to correct bones
- Skin mappings remain intact
- Render order is preserved
- Facing still works
- Replacement sprite responds to existing bone transforms

### 9. Transactional replacement

Use a safe preflight-and-commit model.

If image decoding, frame validation or texture registration fails:
- Keep original artwork
- Preserve authored definitions
- Report actionable errors
- Do not leave half-applied texture state

### 10. Undo/Revert

Support reverting a replacement to the original artwork.

Preserve original asset data for the active editor session.

Follow existing history conventions without treating replacement as an animation edit.

### 11. Repeated replacement

Test:

```text
forearm-v1.png
      ↓
forearm-v2.png
      ↓
forearm-v3.png
```

No accumulation of stale textures or broken references.

### 12. Tests

Cover:
- Same-size replacement
- Different-size replacement
- Origin preservation policies
- Shared asset replacement
- Single-attachment replacement
- Frame validation
- Texture lifecycle
- Failed replacement rollback
- Undo/Revert
- Multiple skins
- Source immutability
- Animation compatibility

### 13. Manual verification

1. Load a character with several animations.
2. Replace forearm sprite with same-size artwork.
3. Verify animation.
4. Replace it with different-size artwork.
5. Inspect pivot alignment.
6. Apply a preservation policy.
7. Switch skins.
8. Test onion skinning.
9. Test IK playback.
10. Revert replacement.
11. Replace again and verify no cache artifacts.

### 14. Do NOT implement

- Automatic sprite generation
- Image painting tools
- Sprite atlas packing
- Automatic animation retargeting
- Mesh deformation
- Scene choreography

### 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Sprite replacement preserves stable logical identity
- Shared/individual replacement behavior is clear
- Dimension changes are handled explicitly
- Pivot preservation is predictable
- Phaser textures refresh safely
- Skin and attachment mappings remain intact
- Existing animations remain unchanged
- Replacement can be reverted
- Repeated replacement is stable
- Tests, typecheck and build pass

## Final report

Provide:
1. Replacement architecture
2. Stable identity behavior
3. Dimension/pivot policies
4. Shared asset handling
5. Texture/cache lifecycle
6. Files/APIs changed
7. Tests and manual verification
8. Command results
9. Deferred functionality

Do not claim completion unless all commands pass.
