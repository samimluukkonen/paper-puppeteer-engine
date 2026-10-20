# Paper Puppeteer Engine — v0.6.6.2
## Build a New Character from Scratch

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.6.6.1**

Stack: React, TypeScript (strict), Phaser, Vite, npm, ES modules.

v0.6.6.1 introduced new character workspaces with independent fresh rigs.

## Goal

Make it possible to build a complete character from an empty rig using the existing Rig Editor.

The workflow must not require manually editing JSON files.

### 1. Inspect existing rig tools

Review the current functionality for:
- Bone creation and deletion
- Parent-child relationships
- Joint manipulation
- Slot creation
- Attachment assignment
- Sprite import
- Origin and offset editing
- Skin creation
- Undo/Redo

Reuse working features. Implement only the missing operations necessary to build a new character.

### 2. Bone creation

A new character must allow adding bones through the editor.

Support:
- Add root bone, if none exists
- Add child bone to selected parent
- Edit bone ID/name
- Position the joint
- Adjust bone length and local transform

Suggested UI:

```text
SKELETON

root
  └── torso
       ├── head
       ├── leftUpperArm
       └── rightUpperArm

[ + Add Bone ]
```

Names are examples only; do not hardcode humanoid bones.

Allow non-humanoid character rigs.

### 3. Bone hierarchy

Validate:
- Unique bone identifiers
- Valid parents
- No cycles
- No self-parenting
- Valid transforms

Support safe deletion and reparenting if missing from the current editor.

For destructive hierarchy changes, warn about dependent slots, IK constraints and animation tracks.

Do not silently delete dependent authored data.

### 4. Visual joints

Artists must be able to place joints directly in the Phaser preview.

For example:
- Select upper arm
- Position shoulder joint
- Add forearm as child
- Position elbow joint
- Add hand as child

Use existing local/world conversion utilities.

Joint positions are rig data, not animation keys.

### 5. Import artwork

Use existing PNG/WebP import.

Allow importing transparent character body-part sprites.

Example assets:

```text
torso.png
head.png
upper-arm-left.png
forearm-left.png
hand-left.png
```

The artist should choose their own files.

Do not generate placeholder artwork or reference demo textures.

### 6. Assign artwork

Use the engine's existing architecture:

```text
Bone
  ↓
Slot
  ↓
Attachment
  ↓
Skin
  ↓
Sprite artwork
```

Ensure newly created bones can receive slots and artwork through the UI.

If slot creation is not currently possible, add the minimal necessary controls.

Preserve stable IDs independent of filenames.

### 7. Artwork alignment

Reuse existing tools for:
- Sprite origins
- Sprite offsets
- Joint markers
- Attachment transforms
- Render depth
- Facing preview

The artist must be able to align a sprite so it rotates correctly around its joint.

### 8. Default skin

Allow building the character's default appearance.

The artist should be able to add artwork incrementally.

Missing artwork during editing should not crash the editor.

### 9. Preview

The character preview must update as bones and artwork are added.

Support:
- Bone selection
- Joint editing
- Hierarchical rotation preview
- Skin/attachment visibility
- Render ordering

Do not require an animation to test the rig.

### 10. Undo/Redo

Every logical authored operation must integrate with existing rig history.

Operations include:
- Add bone
- Remove bone
- Change parent
- Move joint
- Create slot
- Assign attachment
- Change artwork alignment

Cancelled operations must not modify authored data.

### 11. Tests

Cover:
- Creating a root and child bones
- Nested hierarchy
- Bone deletion/reparenting
- Cycle rejection
- Adding slots
- Assigning artwork
- Default skin setup
- Origin/offset editing
- Empty asset states
- Undo/Redo
- Serialization
- Existing character compatibility

### 12. Out of scope

Do not implement:
- Automatic rigging
- Automatic joint detection
- AI sprite generation
- Mesh deformation
- New IK solver types
- Character-specific hardcoded bone templates
- Scene choreography

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

Starting from an entirely new character, an artist can construct a skeleton, position joints, import their own artwork, assign sprites and build a usable default skin without manually writing rig JSON.

## Final report

Provide:
1. Implemented rig-building features
2. React and Phaser integration
3. Hierarchy validation
4. Artwork assignment workflow
5. Files/APIs changed
6. Tests
7. Exact command results
8. Deferred v0.6.6.3 work

Do not claim completion unless required commands pass.
