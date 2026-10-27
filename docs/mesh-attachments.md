# Visual mesh geometry — v1.4.2.2

[All guides](../README.md#guides)

Mesh attachments store validated geometry, UVs and bind references alongside rigid sprites. Rig Editor can convert a rigid sprite attachment, edit vertices and safely subdivide/retriangulate its triangles. Phaser renders the authored mesh as textured geometry. Bone weights, automatic skeletal deformation, vertex animation and cloth remain outside this milestone.

## Using this milestone

Open **Feature Guide → Rig Editor → Editing Mesh Geometry** for an eight-step tour of conversion, vertex editing, safe subdivision/deletion, UVs, history and saving. It reveals the Mesh geometry inspector without editing the character. The guide becomes available when a valid character has a slot and a whole-image sprite attachment or existing mesh; use **Slots and Attachments** first when needed.

1. Open a character in **Rig Editor**, select a sleeve's artwork **slot** in the hierarchy, then open **Mesh geometry** in the inspector (or use the conversion action in **Attachments & skins**).
2. Choose **Convert to Mesh Attachment**. This creates four corners and two triangles, retaining the texture, pivot-relative positions, attachment transforms and binary artwork. The rigid definition remains available. If the default skin is active, conversion creates and selects a named `-mesh` skin variant; all existing skins remain untouched. For a nondefault skin, only that skin's selected slot mapping changes. Other slots retain their assignments.
3. Choose **Edit Mesh Geometry**. Cyan diamonds distinguish mesh vertices from round bone joints, square slot markers, green contact markers and IK crosshairs. Click a diamond or select its ID in **Mesh vertex**. Drag it or commit **Vertex X/Y** with Enter/blur. Arrow keys nudge a selected vertex; Shift increases the step. X/Y are attachment-local coordinates, independent of camera zoom and facing.
4. Click a triangle edge or choose **Mesh edge**, then **Subdivide edge**. The midpoint gets a stable ID, averaged endpoint UVs and consistently split adjacent triangles. Existing UVs remain unchanged when vertices move. **Triangle inspection** lists the current triangle vertex IDs.
5. **Delete vertex** retriangulates only a connected triangle fan. Edge midpoints and ordinary interior vertices are supported. A corner without a valid replacement triangle, disconnected fan or invalid cavity is rejected atomically. The editor explains the failed operation; the last valid geometry remains intact.
6. One completed drag is one **Undo** action. **Escape**, window blur or editor teardown cancels the active drag. Numeric edits, subdivision, deletion and conversion each have their own Undo/Redo entry. Escape inside a numeric field cancels its draft.
7. Export a character package or rig JSON through the existing commands. Reload it and select the authored mesh skin using **Mesh skin** or **Active skin**. The original default skin deliberately retains rigid artwork. Geometry, stable IDs and UVs survive reload; image binaries are unchanged.

Wheel zoom and middle-button pan work while editing. Vertex picking follows the live slot/attachment affine, including rotated, reflected and nonuniformly scaled ancestors. Animated pose inspection changes only the preview; mesh geometry belongs to the rig attachment working copy and creates no animation keys, Actor motion or scene choreography.

Finish skeleton, slot placement and sprite alignment before converting. The saved bind snapshot conservatively protects every bone and slot rest transform. A rest-transform change is rejected until the mesh is explicitly recreated; animation poses, facing and camera changes do not alter the bind snapshot. Meshes use whole images; atlas frames and image-size/pivot-changing replacements are unsupported.

### Rendering

`PuppetRenderer` uses a small adapter to Phaser 4.2.1's native **Mesh2D** object (WebGL). Indexed triangles carry attachment-local X/Y and normalized top-left UVs. Existing slot mounts retain full affine projection, depth ordering, opacity and visibility. Texture filtering follows the existing host texture/pixel-art policy; conversion never smooths artwork or changes sampling globally. `Puppet.getSlotMesh(slot)` returns native geometry; `getSlotImage(slot)` continues to return rigid images only. Render-only onion previews copy geometry and borrowed textures as well as presentation. Switching or destroying attachments destroys geometry objects and leaves host-owned textures intact. Canvas-only Phaser hosts cannot render Mesh2D.

### Developer quick start

This complete example creates an optional mesh beside a working rigid attachment. The `cloth` texture key must be declared in the character manifest and point to an actual 80 × 40 image. Use the source image's real dimensions when adapting the example.

```ts
import {
  createRectangleMeshAttachment,
  meshAttachmentToBindPose,
  Rig,
  serializeRigDefinition,
  type RigDefinition,
  type SpriteAttachmentDefinition,
} from 'paper-puppeteer-engine/core';

const sprite: SpriteAttachmentDefinition = {
  id: 'cloth-sprite',
  texture: 'cloth',
  x: 4,
  originX: 0.25,
  originY: 0.75,
};
const rest: RigDefinition = {
  root: 'root',
  bones: [{ id: 'root' }],
  slots: [{ id: 'cloth-slot', bone: 'root' }],
  attachments: [sprite],
  skins: [{ version: 1, name: 'default', slots: { 'cloth-slot': sprite.id } }],
};

// Capture authored rest data, never a playing Puppet's joint values.
const mesh = createRectangleMeshAttachment(
  { ...sprite, id: 'cloth-mesh' },
  { width: 80, height: 40 },
  rest,
);
const file = {
  ...rest,
  version: 1 as const,
  attachments: [sprite, mesh],
  skins: [
    ...rest.skins!,
    { version: 1 as const, name: 'mesh-data', slots: { 'cloth-slot': mesh.id } },
  ],
};

const rig = new Rig(file); // Validate the complete proposal before installing it.
const json = serializeRigDefinition(file); // Save authored data, not the Rig instance.
const cornerInBindSpace = meshAttachmentToBindPose(mesh, 'cloth-slot', mesh.vertices[0]!);
```

The default skin still selects rigid artwork. The optional `mesh-data` skin selects the textured mesh. `json` is the version-1 rig document for the character package, not a complete character ZIP. The first vertex is `(-20, -30)` in attachment-local space; its Puppet bind position is `(-16, -30)` after the attachment's X offset.

### Troubleshooting

| Symptom                                                       | Action                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mesh is assigned but the slot is blank                        | Select the intended mesh skin, enable artwork visibility and use a WebGL Phaser host.                                                            |
| A rest or slot edit reports a bind-pose mismatch              | Keep the saved rest configuration or explicitly recreate the mesh from the revised authored rig; animation scrubbing cannot fix a bind mismatch. |
| A pivot edit is rejected                                      | Mesh pivots are baked into positions. Recreate geometry with the intended origin.                                                                |
| A replacement/export reports image dimensions or pivot errors | Preserve the mesh image dimensions and use origin multipliers of 1, or recreate the mesh for the replacement image.                              |
| Import reports topology or unsupported-version errors         | Fix the reported authored data using the limits below. Invalid triangles and unsupported versions are rejected rather than repaired.             |

## Schema and ownership

`RigDefinition.attachments` now contains `AttachmentDefinition`, a union of `SpriteAttachmentDefinition` and `MeshAttachmentDefinition`. Legacy sprites omit `type`; explicit `type: 'sprite'` is supported too. No existing artwork is converted automatically.

Meshes retain existing `id`, `texture`, transform, normalized origin and optional `groundContacts` fields. `texture` references the stable key in `CharacterManifest.textures`, rather than introducing a second image identity. Additional required fields are:

| Field                            | Meaning                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `type: 'mesh'`                   | Explicit attachment variant                                          |
| `meshVersion: 1`                 | Mesh version, independent of the enclosing rig version               |
| `imageSize: { width, height }`   | Positive integer source-image dimensions in pixels                   |
| `vertices: [{ id, x, y, u, v }]` | Stable IDs, attachment-local rest positions and normalized image UVs |
| `triangles: number[]`            | Triples indexing the authored vertex array                           |
| `bindPose`                       | Required version-1 authored rest snapshot                            |

Whole images are supported. Mesh `frame` fields, including base-frame aliases, are rejected; atlas trimming, rotated frames and UV tiling need future explicit support. A mesh pivot is baked into its vertex positions. Stored normalized origins record geometry-creation provenance; evaluation does not subtract the pivot again.

Slot ownership remains `slot.bone`. Slots select attachment IDs; skins map slot IDs to attachment IDs or `null`. Meshes retain the same catalogs, draw order, visibility/clearing commands and package references. An attachment can be selected by several slots; bind coordinate conversion explicitly names the selected slot. Authored mesh data never contains Phaser objects, temporary texture keys, editor state or animation samples.

## Coordinates and rest configuration

All coordinates use X right and Y down; rotations are radians and scales are unitless. Transforms compose as `T(x, y) * R(rotation) * diag(scaleX, scaleY)` through complete affine ancestor matrices. Reflections and nonuniform scales require full affine multiplication.

| Space                                       | Definition                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image pixels                                | Source-image top left `(0, 0)` to bottom right `(width, height)`                                                                                   |
| Image UV                                    | `u = pixelX / width`, `v = pixelY / height`, each in `[0, 1]`                                                                                      |
| Attachment-local / mesh-local bind geometry | `x = pixelX - originX * width`, `y = pixelY - originY * height`, before attachment scale/rotation/offset                                           |
| Bone local                                  | Relative to the owning joint; attachment placement first passes through the attachment and slot transforms                                         |
| Puppet bind space                           | Mesh-local point transformed by authored attachment, slot, owning bone and ancestor rest transforms; excludes Puppet/Actor placement               |
| Evaluated Puppet space                      | Current FK/animation/IK bone transforms composed through the Puppet hierarchy; future deformation compares these with the saved bind configuration |
| Actor / world                               | Puppet placement, scale/facing and Actor/container ancestry map evaluated Puppet points into world coordinates                                     |
| Viewport                                    | Camera pan/zoom and canvas projection are presentation only; never store these in bind data or future bone influences                              |

`bindPose` stores `version: 1`, the root bone ID, every bone's stable ID/parent and **effective** rest transform, every slot's ID/bone and rest transform, and the attachment rest transform. Bone positions resolve parent `length` through the same helper as `Rig`. Omitted numeric defaults become explicit; bone/slot snapshots sort by stable ID. Bind vertices remain attachment local; `meshAttachmentToBindPose()` converts them to Puppet bind coordinates.

Capture from authored `RigDefinition` or immutable `Rig`, never playing joints or sampled animation. Runtime FK/IK, facing, Actor motion and camera changes leave the snapshot untouched. Future weights can reference stable vertex IDs and bone IDs, using saved inverse bone rest transforms through `meshBindPoseToBoneLocal()`. Weight fields are intentionally unsupported in this milestone.

Rig validation compares saved bind data with the current authored configuration. Effective length normalization permits only floating-point roundoff: `16 * Number.EPSILON * max(1, |a|, |b|)` per numeric field. Changed hierarchy, missing/duplicate snapshot identities, changed effective bone/slot rest transforms or changed attachment transforms fail validation. Composed bind matrices must be finite and invertible within the shared affine inverse tolerance.

There is no implicit rebind. Restore the rest configuration or explicitly recreate/rebind the mesh. The Rig Editor rolls invalid proposals back through its existing history owner. The snapshot conservatively includes every bone and slot, so changing an unrelated bone rest transform or adding a slot also requires recreating/rebinding meshes. A future targeted binding format can relax that policy explicitly.

## Geometry and validation

`createRectangleMeshAttachment(sprite, imageSize, rig)` creates a detached mesh with four stable corner IDs (`top-left`, `top-right`, `bottom-right`, `bottom-left`), full-image UVs and triangles `[0, 1, 2, 0, 2, 3]`. Defaults preserve the centered sprite pivot; explicit origins, offsets, rotation and signed scales are retained. Negative attachment-local coordinates are normal.

Shape/scalar schemas and semantic rig checks reject:

- Empty/reserved/duplicate vertex IDs, nonfinite positions/UVs, and UVs outside `[0, 1]`.
- Positions outside ±1,000,000 local units, fewer than 3 or more than 1,024 vertices, or more than 2,048 triangles.
- Empty/incomplete triples, fractional/negative/out-of-range indices, and repeated-index/collinear triangles.
- Triangle doubled signed area at or below `1e-8` local units squared. Positive area is clockwise in Y-down coordinates, before reflected attachment/bone/world transforms.
- Overlapping triangle interiors above the same doubled-area tolerance, including duplicate, crossing and contained triangles. Shared edges/vertices with zero intersection area are allowed. An AABB sweep skips disjoint pairs.
- Invalid image references at character assembly, unsupported mesh/bind versions, stale bind data and singular/unsupported composed rest transforms. Character/scene package imports also compare `imageSize` with binary image headers.

Invalid data fails before installation or export. Validation never repairs winding, drops triangles or renumbers vertices. This bounded triangle surface format does not prove manifold topology: UV seams, disconnected components and unused vertices are allowed, with no global triangulation or hole inference. Editor operations require a connected supported fan and validate their complete result.

Pure helpers are exported through `/core` and the root/runtime entry points:

- `triangleSignedArea2`, `validateMeshTopology`, `getMeshVertex`, `meshBounds`, `MESH_LIMITS`, `MESH_AREA_EPSILON`.
- `imagePixelToUV`, `uvToImagePixel`, `imagePixelToAttachmentLocal`, `attachmentLocalToImagePixel`.
- `createMeshBindPose`, `validateMeshBindPose`, `createRectangleMeshAttachment`.
- `meshAttachmentToBindPose`, `bindPoseToMeshAttachment`, `meshBindPoseToBoneLocal`.
- `meshEdges`, `subdivideMeshEdge(mesh, a, b, rig)` and `deleteMeshVertex(mesh, id, rig)` provide the bounded editor operations.
- `replaceMeshGeometry(mesh, { vertices, triangles }, rig)` validates a detached topology proposal while retaining bind data and supplied IDs. The editor topology operations use this atomic validation boundary.

Coordinate helpers require finite positive dimensions. Bounds return `undefined` for an empty array; lookup returns `undefined` for an unknown ID. Inverse point conversion can return `undefined` for unsupported points/transforms; missing bind references or an unsupported attachment bind matrix throw. Evaluate authored geometry only after shape and semantic validation.

## Compatibility and persistence

Outer rig, manifest and skin formats remain version 1. Existing rigid characters retain omitted defaults and load unchanged. Unsupported outer versions use the existing version error; mesh/bind versions are strict literals, and unknown variants/fields fail validation. Older strict file importers reject mesh fields instead of interpreting meshes as sprites. No migration of old assets is needed.

`serializeRigDefinition()` preserves authored vertex/index order, stable IDs and numeric precision, sorts object keys and produces canonical JSON. Import uses shared shape, reference, topology and bind checks. `Rig` and `SlotState` deeply freeze owned mesh catalogs. Catalog updates validate before assignment and preserve old state on failure.

Character, scene and project packages reuse retained authored rig files and texture references. Runtime namespacing changes texture keys without changing bind geometry. Mesh texture replacements must retain original image dimensions and origin multipliers of 1. Resizing/pivot migration requires explicit mesh recreation instead of rigid sprite export conversion.

## Implementation and verification

The data foundation remains in `types.ts`, `schemas.ts`, `meshGeometry.ts`, `meshBindPose.ts`, `meshAttachments.ts`, `validation.ts`, `Rig.ts` and `SlotState.ts`. `meshEditing.ts` adds pure edge subdivision and connected-fan deletion; `meshRendering.ts` adapts authored data to Phaser Mesh2D. `PuppetRenderer` owns geometry objects, while the host retains textures. `RigEditorState`, `RigEditorInputController`, `RigEditorOverlay`, `MeshGeometryPanel` and `AttachmentController` share the existing history, selection and viewport paths. Package metadata uses SemVer `1.4.2-2`; outer data formats remain version 1.

`tests/meshEditing.test.ts` covers conversion, skin isolation, vertex edits, invalid proposals, UV interpolation, subdivision/deletion, grouped history, cancellation, reflected viewport coordinates, export/import and texture cleanup. `tests/meshAttachments.test.ts` retains validation, bind, rigid compatibility and deterministic character/project/scene package round trips. `tests/browser/meshEditor.spec.ts` exercises the actual desktop canvas, numeric edits, zoom/pan, Escape, Undo/Redo and export/reload. Browser checks remain local-only. Required checks are `npm run typecheck`, `npm run test` and `npm run build`, with sequential test files under the repository's one-worker configuration.
