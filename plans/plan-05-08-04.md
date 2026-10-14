# Paper Puppeteer Engine — v0.5.8.4
## Visual Attachment & Skin Management

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.8.3**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

Existing systems:
- Slots and attachments
- Skins and partial overrides
- Character manifests
- Sprite import and preview
- Artwork alignment
- Rig-Tweak Mode
- Runtime attachment swapping
- Validation and JSON import/export

Do not rebuild these systems.

## Goal

Implement **v0.5.8.4 — Visual Attachment & Skin Management**.

Allow artists to manage which artwork is assigned to which slots and skins without manually editing JSON files.

### 1. React attachment panel

Create a panel displaying:
- Slots
- Attached artwork
- Available imported assets
- Active skin
- Attachment identifiers
- Visibility/depth information where supported

Reuse current React editor conventions.

### 2. Slot assignment

Allow selecting a slot and:
- Assigning an existing attachment
- Replacing the assignment
- Clearing an assignment
- Previewing the result

Use existing runtime attachment APIs.

Do not change bone hierarchy or IK relationships when swapping artwork.

### 3. Attachment creation

Allow defining an attachment from imported artwork.

Use stable attachment IDs independent from physical filenames.

Validate:
- Duplicate IDs
- Missing textures
- Invalid frames
- Invalid slot references
- Unsupported attachment types

Do not store temporary browser object URLs in JSON.

### 4. Skin selection

Allow selecting existing skins and previewing them immediately.

Switching skins must not:
- Rebuild the skeleton
- Modify animation keyframes
- Break IK
- Reset playback unexpectedly

### 5. Skin authoring

Support:
- Creating a skin
- Renaming it where schema permits
- Assigning attachments by slot
- Removing overrides
- Returning to default/fallback mappings

Preserve existing partial skin override semantics.

Do not duplicate entire skin data unnecessarily.

### 6. Visual preview

Changes should update the Puppet preview immediately.

Preserve:
- Bone transforms
- Render hierarchy
- Attachment depth
- Sprite offsets/origins
- Facing
- Animation state

### 7. Selection and artwork alignment

Selecting an attachment should cooperate with the existing Rig Editor artwork inspector.

Do not duplicate selection state across independent panels.

### 8. Undo/Redo

Authoring changes should create logical history operations.

Examples:
- Assign attachment
- Remove attachment
- Change skin override

Keep these separate from animation keyframe history.

### 9. JSON compatibility

Continue using existing:
- Slot schema
- Attachment schema
- Skin schema
- Character manifest references

Do not invent editor-only runtime attachment formats.

### 10. Asset validation

Check that skin/attachment references resolve to available artwork.

For missing assets, display actionable errors.

Do not silently remove missing references.

### 11. Tests

Cover:
- Assignment
- Removal
- Attachment creation
- Stable IDs
- Skin switching
- Partial overrides
- Invalid references
- Render-order preservation
- Undo/Redo
- Source immutability
- Serialization

### 12. Manual verification

1. Load demo character.
2. Select a hand slot.
3. Assign a different hand sprite.
4. Preview animations.
5. Create an alternate skin.
6. Change headwear/clothing attachments.
7. Switch between skins.
8. Undo/Redo changes.
9. Export/reload definitions.
10. Confirm bone animation remains identical.

### 13. Do NOT implement

- New rigging algorithms
- Automatic skin generation
- Sprite atlas packing
- Animated sprite deformation
- Scene choreography
- Production package export

### 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Slots can be inspected
- Artwork can be assigned to slots
- Attachments can be created/removed
- Skins can be selected and authored
- Partial overrides remain compatible
- Preview updates correctly
- Animation and IK remain unaffected
- Undo/Redo works
- JSON remains compatible
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented attachment/skin workflow
2. React UI components
3. Asset/attachment identity handling
4. Skin override semantics
5. Files/APIs changed
6. Tests and manual verification
7. Verification results
8. Deferred functionality

Do not claim completion unless all commands pass.
