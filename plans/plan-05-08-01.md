# Paper Puppeteer Engine — v0.5.8.1
## Sprite Import & Replacement Foundation

Continue development of my standalone Paper Puppeteer Engine.

**Current completed version: v0.5.7.5**

### Technology stack
- React + TypeScript (strict) for editor UI
- Phaser for rendering
- Vite, npm, ES modules

Already implemented:
- Visual Rig Editor and Animation Editor
- Hierarchical skeletons, joints and bone transforms
- Slots, attachments and skins
- Character manifests and external asset loading
- Rig/animation JSON import/export
- IK, animation authoring, onion skinning and mirroring
- Undo/Redo and dirty-state tracking

Do NOT rebuild existing systems.

## Goal

Implement **v0.5.8.1 — Sprite Import & Replacement Foundation**.

Allow artists to select local sprite images and preview them as replacements for existing character artwork.

This milestone establishes the asset-management foundation. Advanced replacement propagation and production package export come later.

### 1. Inspect existing asset architecture

Review:
- CharacterLoader
- Character manifest format
- Slot/attachment definitions
- Skin definitions
- Phaser texture loading and cache ownership
- Rig Editor artwork rendering
- Existing React editor structure

Reuse established conventions.

### 2. Image import

Add React UI for importing image files.

Initially support transparent PNG and WebP images where supported by the browser and Phaser.

Validate:
- Supported format
- Non-empty file
- Decodable image
- Dimensions
- Reasonable file size
- Invalid/corrupt files

Provide actionable errors.

Do not add a large image-processing dependency.

### 3. Replacement target selection

Allow choosing an existing artwork asset or attachment image to replace.

Show:
- Existing image
- Proposed replacement
- Filename
- Width and height
- Associated asset/attachment references

Start with one replacement at a time.

### 4. Asset working-copy model

Separate:

```text
Original asset
      ↓
Temporary imported asset
      ↓
Preview
      ↓
Explicit commit
```

Do not overwrite source asset files automatically.

Keep imported binary data separately from serialized rig/animation definitions.

Use stable asset identifiers where existing architecture supports them.

Browser object URLs must never be written into character JSON.

### 5. Phaser preview

Display imported artwork using Phaser's existing rendering system.

Requirements:
- Load/decode safely before use
- Preserve current rig bone hierarchy
- Preserve existing attachment relationship
- Avoid changing joint locations
- Avoid changing animation keyframes
- Preserve original texture until replacement succeeds

Do not create new Puppet classes for specific artwork.

### 6. Texture lifecycle

Handle temporary texture keys and object URLs safely.

Avoid:
- Texture cache collisions
- Repeated unnecessary decoding
- Memory leaks
- Destroying textures still used by other attachments
- Stale image references

Use a clear temporary asset lifecycle.

### 7. Commit and cancel

Provide:

- Preview Replacement
- Apply Replacement
- Cancel

Cancel must restore original artwork without modifying authored data.

Commit must register a pending asset change and update the relevant preview.

Do not claim this writes files into the project repository.

### 8. Dirty-state handling

Track pending artwork changes separately from animation keyframe edits.

An image replacement is an asset change, not an animation keyframe change.

Preserve original image data so the artist can revert the operation.

Do not silently mark an animation modified merely because its artwork changes.

### 9. Tests

Cover:
- Valid PNG/WebP import
- Invalid image rejection
- Empty/corrupt files
- Image metadata
- Preview state
- Commit/cancel
- Original asset preservation
- Texture identity/collision handling
- Cleanup
- No rig or animation mutation

### 10. Manual verification

Using the existing demo character:

1. Select a forearm sprite.
2. Import a replacement PNG.
3. Preview it.
4. Cancel and verify the original returns.
5. Import again and apply.
6. Check that the bone hierarchy and animation remain functional.
7. Switch animations and verify no crash.
8. Test an invalid image.

### 11. Do NOT implement yet

- Advanced dimension migration
- Bulk sprite replacement
- Complete attachment/skin editor
- Rig-Tweak mode
- Automatic origin recalculation
- Production asset package export
- File-system overwrite
- Scene choreography

### 12. Required verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Artist can import a local sprite
- Image validation works
- Before/after preview works
- Apply/cancel works
- Original assets remain recoverable
- Asset state is separate from animation data
- Phaser texture lifecycle is safe
- Existing rig and animations remain functional
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented features
2. Asset working-copy architecture
3. Image validation
4. Texture lifecycle
5. React components
6. Files/APIs changed
7. Tests and manual verification
8. Exact command results
9. Deferred functionality

Do not claim completion unless all commands pass.
