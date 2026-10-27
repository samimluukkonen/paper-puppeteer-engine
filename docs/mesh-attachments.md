# Mesh attachment foundation — v1.4.2.1

[All guides](../README.md#guides)

This milestone adds optional authored mesh data, validation, immutable catalogs and pure geometry utilities alongside rigid sprites. Rendering, skeletal deformation, bone weights, painting and animated vertices remain future work. Selecting a mesh retains its slot assignment but creates no Phaser image; other rigid attachments continue rendering normally.

## Using this milestone

For artwork you need to see and animate today, keep using rigid sprite attachments and the existing **Slots and Attachments**, **Aligning Sprites** and **Creating and Changing Skins** Feature Guides. There is no mesh conversion button, visual mesh editor or mesh Feature Guide tour in this milestone.

If you import a character containing mesh data, its geometry and skin mappings survive package export/import. A selected mesh produces no visible artwork in either the editor preview or runtime. Select a rigid attachment in that slot to display artwork; selecting a skin or attachment does not convert or deform the mesh.

Finish skeleton, slot placement and sprite alignment before creating experimental mesh data. Once a mesh is bound, edits that change its saved rest configuration are rejected and rolled back. Restore that configuration or recreate the mesh explicitly from the revised authored rig. Changing animation poses, playback, facing or camera zoom does not change the saved bind pose.

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

The default skin still selects visible rigid artwork. The optional `mesh-data` skin selects the mesh ID and will leave that slot unrendered. `json` is the version-1 rig document for the character package, not a complete character ZIP. The first vertex is `(-20, -30)` in attachment-local space; its Puppet bind position is `(-16, -30)` after the attachment's X offset.

### Troubleshooting

| Symptom                                                       | Action                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mesh is assigned but the slot is blank                        | Mesh rendering is deferred. Select the retained rigid attachment to display artwork.                                                             |
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

Invalid data fails before installation or export. Validation never repairs winding, drops triangles or renumbers vertices. This bounded triangle surface format does not prove manifold topology: UV seams, disconnected components and unused vertices are allowed, with no automatic triangulation or hole inference.

Pure helpers are exported through `/core` and the root/runtime entry points:

- `triangleSignedArea2`, `validateMeshTopology`, `getMeshVertex`, `meshBounds`, `MESH_LIMITS`, `MESH_AREA_EPSILON`.
- `imagePixelToUV`, `uvToImagePixel`, `imagePixelToAttachmentLocal`, `attachmentLocalToImagePixel`.
- `createMeshBindPose`, `validateMeshBindPose`, `createRectangleMeshAttachment`.
- `meshAttachmentToBindPose`, `bindPoseToMeshAttachment`, `meshBindPoseToBoneLocal`.
- `replaceMeshGeometry(mesh, { vertices, triangles }, rig)` validates a detached topology proposal while retaining bind data and supplied IDs. Future subdivision tools can retain existing IDs, add stable IDs/UVs and replace triangle indices atomically. This helper does not implement subdivision.

Coordinate helpers require finite positive dimensions. Bounds return `undefined` for an empty array; lookup returns `undefined` for an unknown ID. Inverse point conversion can return `undefined` for unsupported points/transforms; missing bind references or an unsupported attachment bind matrix throw. Evaluate authored geometry only after shape and semantic validation.

## Compatibility and persistence

Outer rig, manifest and skin formats remain version 1. Existing rigid characters retain omitted defaults and load unchanged. Unsupported outer versions use the existing version error; mesh/bind versions are strict literals, and unknown variants/fields fail validation. Older strict file importers reject mesh fields instead of interpreting meshes as sprites. No migration of old assets is needed.

`serializeRigDefinition()` preserves authored vertex/index order, stable IDs and numeric precision, sorts object keys and produces canonical JSON. Import uses shared shape, reference, topology and bind checks. `Rig` and `SlotState` deeply freeze owned mesh catalogs. Catalog updates validate before assignment and preserve old state on failure.

Character, scene and project packages reuse retained authored rig files and texture references. Runtime namespacing changes texture keys without changing bind geometry. Mesh texture replacements must retain original image dimensions and origin multipliers of 1. Resizing/pivot migration requires explicit mesh recreation instead of rigid sprite export conversion.

## Implementation and verification

The main implementation files are `types.ts`, `schemas.ts`, `meshGeometry.ts`, `meshBindPose.ts`, `meshAttachments.ts`, `validation.ts`, `Rig.ts`, `SlotState.ts` and the pure public barrels. `boneMath.ts` shares effective rest-position calculation with `Rig`. Puppet/renderer catalogs accept the attachment union; `PuppetRenderer` leaves mesh slots unrendered. Rig Editor history/catalog paths preserve and validate meshes. Character/scene packaging checks binary dimensions and prevents rigid pivot conversion from changing meshes. `schemas/rig.schema.json` is regenerated from the authoritative schema. Package and changelog metadata use SemVer `1.4.2-1`.

`tests/meshAttachments.test.ts` covers rectangle alignment, UV/pixel conversions, negative coordinates, topology/limits/overlaps, safe topology replacement, bind conversion and rest edits, immutable catalog updates, unchanged legacy types, mixed Puppet skins and deterministic character/project ZIP round trips. Existing artwork tests narrow rigid attachments before adding frame fields. Required checks are `npm run typecheck`, `npm run test` and `npm run build`, with sequential test files under the repository's one-worker configuration.
