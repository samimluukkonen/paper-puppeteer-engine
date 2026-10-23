# Paper Puppeteer Engine — v0.9.8.2
## Visual Foot Contact Marker Editor

Continue developing Paper Puppeteer Engine.

Current completed version: **v0.9.8.1**.

Stack: React, TypeScript (strict), Phaser, Vite, npm, ES modules.

The engine now supports bone-local foot contact marker definitions and world-position evaluation.

## Goal

Allow my artist friend to create, modify and delete foot contact markers visually inside Rig Editor.

No manual JSON editing should be required.

### 1. Rig Editor panel

Extend the existing Rig Editor UI with a **Foot Contact Markers** section.

Suggested controls:

```text
FOOT CONTACT MARKERS

Left Foot Contact
Right Foot Contact

[+ Add Contact Marker]

Selected: Left Foot Contact

Name:   [ Left Foot Contact ]
Bone:   [ leftFoot          ]

Local X: [ 12 ]
Local Y: [ 28 ]

[ Delete Marker ]
```

Numbers and bone names are examples only.

Use existing React inspector conventions.

### 2. Create marker workflow

When adding a marker:
1. Choose a bone.
2. Supply or generate a unique ID.
3. Initialize a reasonable local position.
4. Display the marker immediately.
5. Allow dragging it to the correct foot-contact point.

Support new and existing characters.

Do not require a character to have two legs.

### 3. Phaser marker handles

Display a distinct marker, such as a small crosshair, in the existing Rig Editor preview.

Requirements:
- Visible in front of sprite artwork
- Highlight when selected
- Correctly follows its bone
- Does not appear in exported character artwork
- Does not interfere with unrelated editor controls

Reuse existing editor gizmo architecture.

### 4. Direct manipulation

Allow dragging markers in the character preview.

Convert pointer movement to the marker's parent bone-local coordinate system using existing transform utilities.

Handle:
- Nested bones
- Rotation
- Scale
- Facing
- Camera zoom
- Camera pan
- Root transform

Avoid arbitrary world-space coordinate storage.

### 5. Ground reference integration

Show existing v0.9.7 ground line while editing markers.

This lets the artist visually align foot contact markers against the reference floor.

Do not automatically move the foot bones or the ground line.

### 6. Inspector synchronization

Dragging a marker updates numeric X/Y fields.

Changing numeric values moves the marker.

Use one authoritative rig working copy.

### 7. Multiple foot markers

Allow creating:
- Left foot marker
- Right foot marker
- Additional contact markers if desired

Do not hardcode names.

Ensure each marker is independently selectable.

### 8. Undo/Redo

Support:
- Add marker
- Move marker
- Rename marker
- Change referenced bone
- Delete marker

Each completed drag must produce one history operation.

Escape should cancel the current drag.

Do not mark animations dirty when only the rig marker changes.

### 9. Safe deletion

Before deleting a marker, inspect any persisted references that use its ID, including future Scene Editor grounding selections where present.

Do not silently leave invalid references.

Use existing dependency validation conventions.

### 10. Tests

Cover:
- Creation
- Selection
- Dragging
- Numeric editing
- Facing and scale
- Zoom/pan
- Undo/Redo
- Invalid bone
- Duplicate ID
- Deletion
- Rig serialization
- No animation mutation
- React/Phaser cleanup

### 11. Manual verification

1. Open a character with feet.
2. Select a foot bone.
3. Create a marker.
4. Position it at the bottom of the foot sprite.
5. Rotate the foot bone.
6. Verify the marker follows.
7. Repeat on the other foot.
8. Test facing changes.
9. Undo/Redo.
10. Export/reload the rig.

### 12. Out of scope

Do not implement automatic foot detection, IK alignment automation, gravity, collision or footstep generation.

### 13. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix all failures.

## Definition of done

The artist can visually define accurate foot contact points in Rig Editor and save them with the character rig.

## Final report

Describe React controls, Phaser handles, coordinate conversions, history, files/APIs changed, tests and exact command results.
