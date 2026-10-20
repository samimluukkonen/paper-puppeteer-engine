# Paper Puppeteer Engine — v0.6.6.3
## Complete New Character Creation Workflow

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.6.6.2**

Stack: React, TypeScript (strict), Phaser, Vite, npm, ES modules.

Implemented:
- New Character creation
- Fresh character workspaces
- Empty rig initialization
- Bone and joint authoring
- Sprite import
- Slot/attachment assignment
- Default skin authoring

The engine already supports animation creation, editor import/export, CharacterLoader and character package export.

## Goal

Complete and harden the workflow for creating a brand-new character without any existing character files.

### 1. Animation Editor integration

A newly created character must be available in the Animation Editor even when it has no animations.

The artist should be able to:

1. Build the rig.
2. Open Animation Editor.
3. Click New Animation.
4. Create an empty animation.
5. Add bone-transform keyframes.
6. Preview playback.
7. Export the animation.

Reuse the existing New Animation workflow, if implemented.

Do not require pre-existing animation JSON.

### 2. Shared character workspace

Ensure Rig Editor and Animation Editor operate on the same active character and appropriate working documents.

Switching editors must not discard:
- Unsaved rig changes
- Imported sprite assets
- Skin assignments
- New animations

Preserve independent dirty states.

### 3. Complete package export

Use the existing character package exporter.

For a new character, export actual generated files.

Example:

```text
characters/
  forest-guardian/
    character.json
    rig.json

    skins/
      default.json

    animations/
      idle.json

    images/
      torso.png
      head.png
      ...
```

Follow the existing production format exactly.

Do not invent incompatible manifests.

### 4. No demo dependencies

A newly exported character must not reference:
- demo puppet rig files
- random-paperdoll-sketch assets
- temporary Blob URLs
- hardcoded editor example paths

All necessary character-specific files should be included in the package or explicitly validated external dependencies.

### 5. Export validation

Before export, verify:
- Rig hierarchy is valid
- Bone IDs are unique
- Referenced slots and attachments exist
- Sprite assets are available
- Skins are valid
- Animation bone references are valid
- Manifest paths resolve
- Required files exist

Distinguish incomplete drafts from export-ready characters.

Display actionable errors.

### 6. CharacterLoader round trip

Test:

```text
New Character
     ↓
Build Rig
     ↓
Import Artwork
     ↓
Create Animation
     ↓
Export Package
     ↓
CharacterLoader
     ↓
Puppet
     ↓
Play Animation
```

The exported character must load without any special handling for characters created through the editor.

### 7. Empty states

Handle:
- New character with no bones beyond schema minimum
- New character with no artwork
- New character with no animations
- Unassigned slots
- Missing images
- Incomplete skin
- Invalid rig

These states must remain safe in the editor.

Export should reject invalid production packages when necessary.

### 8. Existing character regression

Verify both existing characters still work:

- demo puppet
- random-paperdoll-sketch

Do not alter their assets or schemas unnecessarily.

### 9. Artist documentation

Write a beginner-friendly guide:

**Creating Your First Character**

Cover:
1. Click New Character.
2. Enter name and ID.
3. Build a skeleton.
4. Position joints.
5. Import transparent sprites.
6. Assign attachments to slots.
7. Align artwork.
8. Create default skin.
9. Create an animation.
10. Export the character.
11. Load it in another application.

Use the actual editor controls and file formats.

### 10. Automated and manual tests

Test:
- New character creation
- Full rig assembly
- Artwork import
- Skin setup
- First animation creation
- Character package export
- Package import/reload
- CharacterLoader playback
- Source immutability
- Undo/Redo
- Unsaved changes
- React/Phaser resource cleanup

Perform the feasible end-to-end workflow.

Do not claim manual UI verification unless it actually occurred.

### 11. Scope restrictions

Do not implement:
- Character generator templates
- AI-created artwork
- Auto-rigging
- Mesh deformation
- Physics
- Scene choreography

### 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing browser and consumer-example tests where available.

Fix all failures.

## Definition of done

An artist can create a brand-new character using only the editor UI, build a rig, import and align sprite artwork, create an animation and export a complete character package that loads successfully through CharacterLoader.

No existing example character files or manually authored JSON are required.

## Final report

Provide:
1. Complete artist workflow
2. Animation integration
3. Export/package architecture
4. CharacterLoader compatibility
5. React/Phaser lifecycle
6. Files/APIs changed
7. Tests
8. Actual manual verification
9. Exact command results
10. Remaining limitations

Do not claim completion unless required checks pass.
