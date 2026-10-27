# Paper Puppeteer Engine — v1.4.2.1
## Deformable Mesh Attachment Foundation

Continue developing Paper Puppeteer Engine.

Previous milestone: **v1.4.1**.

Stack: React, strict TypeScript, Phaser, Vite, npm, ES modules.

## Goal

Introduce an optional mesh attachment type that can eventually deform with the skeleton.

A mesh attachment represents a textured 2D surface containing vertices and triangles.

Ordinary rigid sprite attachments must continue working unchanged.

This phase focuses on data structures, validation and geometry utilities.

## 1. Inspect existing attachment architecture

Review:
- AttachmentDefinition
- Slot/bone ownership
- Skins
- Image asset references
- Texture origin/offset
- Character package serialization
- Rig validation
- Schema migrations
- Renderer interfaces

Use existing stable IDs and versioning conventions.

## 2. Mesh attachment model

Extend existing attachment types with a mesh variant.

Conceptually:

```ts
interface MeshVertex {
  id: string;
  x: number;
  y: number;
  u: number;
  v: number;
}

interface MeshAttachment {
  type: "mesh";
  imageAssetId: string;
  vertices: MeshVertex[];
  triangles: number[];
}
```

These types are illustrative.

Adapt to existing project conventions.

Include all required data for:
- Textured 2D vertices
- Triangle indices
- Stable vertex identity
- Attachment-local positions
- Texture UV coordinates
- Rig bind/rest-pose reference
- Future bone weights

Do not mix runtime Phaser objects with authored mesh data.

## 3. Initial geometry

Support a simple rectangular mesh created from an existing sprite.

The initial mesh may contain:
- Four corner vertices
- Two triangles
- UV coordinates covering the image

Provide a safe way to subdivide that geometry in the next milestone.

Preserve image alignment, pivot and existing attachment transform conventions.

## 4. Coordinate systems

Clearly document:
- Image pixel coordinates
- Attachment-local coordinates
- Mesh bind-pose coordinates
- Bone local coordinates
- Evaluated Puppet/world coordinates
- Actor/world transforms

This is critical for correct deformation later.

Do not let bone influence data depend on editor zoom or viewport pixel coordinates.

## 5. Topology validation

Validate:
- Finite vertex positions
- Valid UV values
- Unique vertex IDs
- Valid triangle indices
- No references to missing vertices
- Nondegenerate triangles within tolerance
- Valid image reference
- Supported mesh size limits

Establish consistent triangle winding.

Define behavior for invalid or overlapping triangles.

Avoid pretending every arbitrary triangle mesh is valid.

## 6. Rig bind pose

Mesh geometry must have a documented bind/rest configuration.

It must be possible later to calculate how bones deform each vertex relative to this bind pose.

Do not derive the bind pose from whichever animation frame happens to be playing.

Changing rig rest transforms must not silently invalidate bound meshes.

## 7. Attachment compatibility

Support mesh attachments within existing:
- Slots
- Skin mappings
- Attachment ordering
- Visibility
- Character package definitions

A slot should not require a fundamentally different ownership model simply because its attachment is a mesh.

## 8. Serialization and migration

Old characters with rigid attachments must load without changes.

Mesh data should:
- Serialize deterministically
- Validate during import
- Survive project export/import
- Use stable references
- Reject unsupported schema versions appropriately

## 9. Geometry utilities

Implement pure geometry helpers where useful:
- Triangle validation
- Vertex lookup
- Mesh bounds
- Rectangle mesh creation
- Coordinate conversion
- UV conversion

No React dependencies.

## 10. Tests

Cover:
- Rectangle mesh
- Valid/invalid triangles
- Duplicate vertices
- Missing image
- UV mapping
- Negative coordinates
- Rest-pose metadata
- Serialization
- Old attachment compatibility
- Rigid/mesh mixed rigs

## 11. Out of scope

Do not implement:
- Visual mesh editor
- Bone weight painting
- Skeletal deformation
- Animated vertex offsets
- Physics
- GPU rendering infrastructure

## 12. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

The engine has a clean, validated, optional mesh attachment format that can coexist with rigid sprites and be extended for bone skinning.

## Final report

Provide schema, coordinate definitions, compatibility strategy, utilities, files changed, tests and verification results.
