# Paper Puppeteer Engine — v1.4.2.2
## Visual Mesh Geometry Editor

Continue developing Paper Puppeteer Engine.

Previous milestone: **v1.4.2.1**.

The project now contains an optional validated mesh attachment model.

Stack: React, strict TypeScript, Phaser, Vite, npm.

## Goal

Allow an artist to create and edit deformable mesh geometry visually inside Rig Editor.

The workflow must be simple enough for someone primarily interested in animation rather than 3D modeling.

## 1. Inspect editor architecture

Review:
- Rig Editor selection and inspectors
- Phaser preview
- Attachment/slot selection
- Sprite replacement
- Joint/pivot editing
- Existing gizmo system
- Undo/Redo
- Editor viewport transformations

Reuse existing tools.

## 2. Create mesh from sprite

Add an explicit action:

**Convert to Mesh Attachment**

Requirements:
- Start from selected rigid sprite
- Create a rectangular mesh
- Preserve image reference, placement and appearance
- Keep a reversible path to the original attachment
- Do not overwrite the sprite binary
- Do not silently alter other skin assignments

Prefer non-destructive conversion or an undoable attachment-type replacement.

## 3. Mesh edit mode

Add a clear Rig Editor mode:

**Edit Mesh Geometry**

When active:
- Display vertices
- Display triangle edges
- Display selection
- Permit direct vertex manipulation
- Show textured mesh preview

Mesh geometry handles must be visually distinguishable from:
- Bone joints
- IK targets
- Foot markers
- Sprite origins

## 4. Vertex editing

Support:
- Select vertex
- Drag vertex
- Numeric X/Y editing
- Add vertex through a well-defined safe operation
- Delete vertex where topology remains valid
- Undo/Redo

For simplicity, begin with **edge subdivision** as the primary way to add vertices.

Ensure edge subdivision updates adjacent triangles consistently.

Do not create dangling edges or invalid triangle references.

## 5. Triangle topology

Provide safe operations for:
- Triangle inspection
- Edge subdivision
- Triangulation after supported topology edits
- Validation feedback

Avoid a full polygon-modeling toolset.

A simple mesh editor that reliably subdivides rectangles and adjusts vertices is sufficient for this milestone.

## 6. UV mapping

Keep the image correctly mapped to the mesh.

When subdividing an edge, interpolate UV coordinates appropriately.

Provide numeric UV editing only if necessary for practical corrections.

Do not automatically remap the entire texture unpredictably when geometry changes.

## 7. Textured preview

Render the current mesh geometry using the existing Phaser rendering architecture where possible.

The mesh should:
- Display correct artwork
- Respect attachment transforms
- Respect opacity/visibility
- Maintain expected draw order
- Stay aligned with the rig

If the renderer requires specialized mesh support, implement the smallest suitable adapter rather than a separate renderer.

## 8. Pixel-art support

Maintain existing pixel-art sampling conventions.

Where supported, avoid accidental blurring caused by texture filtering.

Do not force smoothing or subdivision onto existing rigid sprites.

## 9. Undo/Redo

One completed vertex drag = one Undo action.

Escape cancels the active operation.

Invalid topology edits must fail atomically.

## 10. Data ownership

Editing mesh geometry changes the appropriate rig/attachment working copy.

It must not:
- Create animation keys
- Modify Actor root motion
- Change scene choreography
- Modify image binaries
- Move unrelated bones

## 11. Tests

Cover:
- Convert sprite to mesh
- Vertex selection/dragging
- Edge subdivision
- UV interpolation
- Invalid topology rejection
- Undo/Redo
- Camera zoom/pan
- Export/import
- Existing rigid attachments
- Texture cleanup

## 12. Manual acceptance

1. Open an existing character.
2. Select a sleeve sprite.
3. Convert it to a mesh.
4. Subdivide the mesh.
5. Move a vertex.
6. Verify artwork mapping.
7. Undo/Redo.
8. Export/reload.
9. Confirm rigid sprite attachments still work.

## 13. Out of scope

Do not implement:
- Bone weight painting
- Automatic mesh deformation
- Vertex animation tracks
- Cloth physics
- Advanced UV unwrapping
- Sculpting tools

## 14. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

The artist can create and edit textured mesh attachments in Rig Editor without editing JSON or breaking existing character artwork.

## Final report

Provide editor tools, topology operations, UV behavior, rendering approach, history handling, files changed, tests and exact verification results.
