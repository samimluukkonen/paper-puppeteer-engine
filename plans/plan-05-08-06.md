# Paper Puppeteer Engine — v0.5.8.6
## Production Asset Workflow & Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.8.5**

Technology stack:
- React + TypeScript (strict)
- Phaser
- Vite
- npm
- ES modules

Already implemented:
- Sprite import/replacement
- Visual artwork alignment
- Rig-Tweak Mode in Animation Editor
- Attachment/skin management
- Safe texture replacement and hot reload
- Rig and animation JSON import/export
- Character manifests and CharacterLoader

This phase completes v0.5.8.

Do not introduce another major subsystem.

## Goal

Create a reliable end-to-end workflow from artist artwork to a finished, reusable character package.

Focus on:
1. Asset/package export
2. Manifest integrity
3. Reload verification
4. Session lifecycle
5. Data compatibility
6. React/Phaser cleanup
7. Artist documentation
8. Full regression testing

### 1. Character package structure

Use the existing character-package format.

Conceptually:

```text
characters/
  demo-puppet/
    character.json
    rig.json

    skins/
      default.json
      alternate.json

    animations/
      idle.json
      walk.json
      attack.json

    images/
      head.png
      torso.png
      upper-arm.png
      forearm.png
      hand.png
```

Adapt to actual manifest conventions.

Do not invent incompatible file formats.

### 2. Complete asset export

Allow the artist to export all necessary updated character files, including:
- Character manifest
- Rig definition
- Skins
- Attachments where stored separately
- Animations
- Imported/replaced image binaries

Preserve existing relative paths and stable identifiers where possible.

### 3. Browser file-system limitations

Do not assume a browser can automatically overwrite files in the source repository.

Implement an explicit download/export workflow.

Prefer existing project export utilities.

A ZIP archive is appropriate if it can be added cleanly using existing capabilities or a justified minimal dependency.

A reliable multi-file download/export fallback is acceptable if archive support is unavailable.

Do not claim files were saved into the repository unless they actually were.

### 4. Manifest validation

Before export, check:
- Every referenced rig exists
- Every referenced skin exists
- Every referenced animation exists
- Attachment images exist
- Paths resolve within the package
- Stable IDs remain consistent
- No unresolved temporary object URLs are serialized
- No incompatible frame references exist

Display actionable issues.

### 5. Transactional package construction

Build the proposed package from a consistent snapshot of authored data and pending asset changes.

Validate before producing the final downloadable result.

Do not partially mutate current working definitions just to export.

### 6. Reload verification

Provide a reliable way to test:

```text
Edited character
      ↓
Export character package
      ↓
Reload/import package
      ↓
CharacterLoader
      ↓
Puppet
      ↓
Play existing animations
```

Use the existing runtime loader and data formats.

Do not create an editor-only production playback path.

### 7. Visual equivalence

Verify exported/reloaded characters preserve:
- Bone hierarchy
- Joint positions
- Sprite origins/offsets
- Attachment identities
- Skins
- Render depth
- Animation timing and poses
- IK behavior
- Mirroring behavior
- Baked animation data

### 8. Dirty-state lifecycle

Track pending changes in appropriate domains:

```text
Rig: Modified
Animation: Modified
Assets: Modified
Skins: Clean
```

Use actual project state domains.

Do not confuse downloading an asset with overwriting its original source file.

Define and document when a clean checkpoint is established.

### 9. Unsaved-change protection

Protect against losing pending artwork/rig edits when:
- Changing character
- Switching editor route
- Reloading assets
- Importing another package
- Closing an editor session where supported

Use existing React editor confirmation patterns.

### 10. Error recovery

Handle:
- Invalid image files
- Missing assets
- Invalid JSON
- Unsupported versions
- Duplicate IDs
- Failed texture loads
- Interrupted imports
- Invalid package paths

Do not leave the editor in a partially corrupted state.

### 11. React/Phaser resource cleanup

Verify cleanup for:
- Temporary textures
- Blob/object URLs
- Image preview objects
- Rig manipulation handles
- IK gizmos
- Onion-skin ghost objects
- React subscriptions
- Pointer listeners

Test switching characters repeatedly.

### 12. Full artist workflow test

Perform or document a representative test:

1. Prepare transparent sprites.
2. Import artwork.
3. Assign pieces to attachment slots.
4. Build/adjust character rig.
5. Align origins and offsets.
6. Export rig.
7. Open Animation Editor.
8. Create bone animation.
9. Animate IK targets.
10. Preview onion skinning.
11. Replace a forearm image.
12. Align replacement artwork.
13. Correct elbow joint using Rig-Tweak Mode.
14. Return to Animation Mode.
15. Verify existing keyframes remain.
16. Export complete character package.
17. Reload via CharacterLoader.
18. Play animations in production runtime.

Note any steps that require manual file placement.

### 13. Full regression testing

Verify:

**Rig Editor**
- Joint editing
- Bone hierarchy
- Origins/offsets
- Slots/attachments
- Skins
- Undo/Redo
- Export

**Animation Editor**
- Bone keyframes
- Timeline navigation
- Interpolation
- Events
- Onion skinning
- Mirroring
- IK authoring
- IK baking
- Rig-Tweak Mode
- Import/export

**Runtime**
- CharacterLoader
- Puppet playback
- IK
- Crossfading
- Animation layers
- Attachments
- Skins
- Facing
- Baked animations

### 14. Documentation

Write artist-facing documentation covering:

**Artwork preparation**
- Transparent body-part images
- Filenames and asset organization
- Consistent pivot planning

**Rig Editor**
- Building joints
- Bone hierarchy
- Aligning artwork
- Slots and attachments
- Creating skins

**Animation Editor**
- Creating keyframes
- IK authoring
- Onion skinning
- Mirroring
- Rig-Tweak Mode

**Sprite replacement**
- Importing a new image
- Preserving attachment IDs
- Aligning different image sizes
- Previewing existing animations

**Production export**
- Creating character packages
- Saving files
- Updating manifests
- Loading characters at runtime

### 15. Automated tests

Expand coverage for:
- Package export
- Manifest validation
- Asset reference resolution
- Binary image inclusion
- JSON round-trip
- Source immutability
- Dirty-state lifecycle
- CharacterLoader compatibility
- Sprite replacement/revert
- Rig/animation separation
- Texture cleanup

Do not claim manual tests were performed unless actually exercised.

### 16. Do NOT implement yet

Defer:
- Scene choreography
- Physics
- Ragdolls
- Mesh deformation
- Automatic artwork generation
- Automatic rigging
- Advanced animation retargeting
- Full general-purpose image editor

### 17. Required verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Final v0.5.8 definition of done

v0.5.8 is complete when:
- Artists can import sprite artwork
- Sprite replacement is safe
- Artwork origins/offsets are editable
- Joint placement remains correctly separated from artwork placement
- Rig-Tweak Mode works from Animation Editor
- Attachments and skins can be managed visually
- Replacement artwork preserves animation compatibility
- Complete character packages can be exported
- Exported packages load through CharacterLoader
- Source definitions remain protected
- React/Phaser resource lifecycle is stable
- Rig Editor and Animation Editor have no regressions
- Artist documentation is complete
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented functionality
2. Complete artist workflow
3. Asset and rig architecture
4. Sprite replacement guarantees/limitations
5. Package export/import architecture
6. Runtime compatibility results
7. React/Phaser lifecycle findings
8. Files/APIs changed
9. Automated tests
10. Manual verification
11. Documentation changes
12. Exact verification command results
13. Deferred features

Do not claim completion unless all commands pass.
