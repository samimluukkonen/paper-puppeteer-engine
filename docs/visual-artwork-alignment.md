# Visual artwork alignment

[All guides](../README.md#guides) · [Rig editor](rig-editor.md) · [Sprite replacement](sprite-replacement.md)

Milestone v0.5.8.2 uses package SemVer `0.5.8-2`. It extends the existing Rig Editor; alignment edits remain rig/attachment data, separate from binary replacement assets and animation documents.

| Mode                   | Canvas operation                                         | Authored fields                          |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------- |
| Joint Editing          | Drag a bone joint; arrow keys nudge, comma/period rotate | Bone bind transforms                     |
| Artwork Offset Editing | Select and drag artwork or its pivot; arrow keys nudge   | Bone sprite or active attachment `x/y`   |
| Sprite Origin Editing  | Drag across artwork to choose its texture-local pivot    | Sprite/attachment `originX/originY` only |
| Slot Transform Editing | Drag square slot markers; arrow keys nudge               | Slot placement `x/y`                     |

Missing artwork never falls back to joint editing. Slot selection in an artwork mode edits the active attachment, including when a slot marker overlaps its joint. The inspector labels each numeric group explicitly. Bone/slot fields and canvas movement are disabled during an animation pose preview; switch to Bind pose to edit the skeleton or slot placement.

## Coordinate conventions

Bone positions are local to their parent joint; logical bone lengths retain the existing runtime direction/distance rules. Puppet translation, scale and facing live outside the skeleton. Slot transforms are local to the parent bone. Sprite offsets are local to the image's render mount: a bone's composed frame, or a slot's composed bone-plus-slot frame. Images can have their own scale and attachment rotation. These affect the image-local conversion for pivot editing, independently of offsets.

The authored schema still stores origins as normalized fractions from the texture's top-left, in `[0, 1]`. Pixel coordinates are `origin × current image dimension`; pixel edits divide by that dimension. Dimensions come from the current Phaser image, including a previewed/applied replacement, rather than original asset metadata. Decimal pixel coordinates and edited artwork offsets/origins retain full precision through JSON export/reload. Reverting a replacement retains the normalized origin and recomputes its displayed pixels for the original dimensions.

Pointer conversion uses camera `getWorldPoint()` followed by the existing affine `worldToLocal()` helper. Offset dragging uses the render mount, so nested bones, rotated parents, nonuniform scales, facing, zoom and pan share the runtime convention. Origin dragging captures the starting image matrix, dimensions and normalized origin; preview changes cannot feed back into the next pointer conversion. The image-local point becomes a top-left texture coordinate by adding the captured origin. Outside-image origin drags clamp to the existing schema bounds. Singular transforms cannot produce alignment edits.

Changing origin keeps the sprite offset and skeleton joint fixed: the artwork shifts around the chosen texture point. It does not compensate offsets or move joints. For an elbow pivot, select the correct elbow point within the forearm texture, then reset or precisely set the sprite offset so that point lies at the elbow joint. The joint is the bone's rotational pivot; the image origin is the texture point placed at the sprite offset.

## Inspector and helpers

The existing inspector includes selected bone/slot/active attachment, offset and normalized origin fields, bone/slot rotation and scale, image dimensions, pixel origins, artwork scale/rotation and the parent joint's world position. `AlignmentInspector` mounts a React component within the existing inspector host. Numeric edits use the existing delegated validation and focus-based history grouping; inputs stay mounted across history and dimension refreshes.

**Reset sprite offset** removes `x/y` overrides, returning to zero. **Reset origin** removes origin overrides, returning to the schema default of `0.5/0.5`. **Center sprite origin** explicitly authors `0.5/0.5`. Each helper is one undo operation. Use Grid for offset snapping, Dim unselected artwork and Artwork opacity for overlap inspection, and the Bones visibility toggle for neighboring joint markers. Selected joint reference, sprite pivot, bounding outline and their connecting guide remain visible during artwork alignment even with Bones hidden. Marker sizes stay constant on screen while zooming.

Facing and Pose/Time controls affect only preview state. Pose sampling evaluates existing compiled bone tracks at the chosen millisecond time over the edited bind pose, with no animation player, event delivery or key authoring. IK animation target channels are not evaluated by this bone pose preview; the existing independent fixed-target IK Preview remains available. This does not bake IK or alter animation timing, events, bone keys or IK keys.

## History and APIs

Artwork drags use `RigEditor.previewArtwork()` and `finishArtworkGesture()`: preview changes only the Phaser images; release commits a complete field patch through `editSpriteFields()` once. Working rig snapshots, dirty state, recovery drafts and exports remain unchanged until release. Escape, blur, hidden/pagehide, mode/facing/pose changes, artwork replacement and editor disable cancel the proposal. Joint/slot drags retain existing grouped edits; cancellation restores the prior operation with `RigEditorState.cancelOperation()` / `SnapshotHistory.cancelOperation()` and preserves redo.

`getSelectedImage()` exposes the current preview dimensions; `getJointReference()` returns the selected bone or slot parent bone's world position. `setFacing()` and `setPreviewPose()` change preview state only. `RigEditor` accepts optional compiled preview clips after its existing IK-chain argument; the scene supplies the character's existing clips. `artworkAlignment.ts` owns explicit pixel/normalized and image-local origin conversions. `rigSerialization.ts` preserves authored artwork precision without changing schema version 1.

## Verification

Unit regressions cover joint versus artwork and slot operations; normalized/pixel conversions; replacement dimensions; nested rotation, puppet translation/nonuniform scale and facing; zoom/pan; non-default origins; temporary rig immutability; one-operation Undo/Redo; cancellation and redo; serialization and unchanged animation keys/events/timing. Inspector tests cover current dimensions, validation, focus grouping and history refresh.

Local browser scenarios in `rigArtworkAlignment.spec.ts`, `rigEditor.spec.ts` and `artworkReplacement.spec.ts` exercise replacement artwork, alignment precision, mode behavior, rotation, facing, animation poses, history and identical visual export/reload. Browser checks remain local-only.

| Check                                      | Result                                                             |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `npm run typecheck`                        | Exit 0                                                             |
| `npm run test`                             | Exit 0; 2,227 passed, 32 skipped                                   |
| `npm run build`                            | Exit 0; demo, library declarations and Node core check passed      |
| `npm run lint` / `npm run format:check`    | Exit 0                                                             |
| `npm run check:version`                    | Exit 0; `0.5.8-2`                                                  |
| Local Chrome development scenarios         | 23 passed; both characters and both editors' replacement lifecycle |
| Local Chrome production alignment workflow | 1 passed; exact forearm placement after export/reload              |

The replacement-forearm scenario performs the workflow below and checks exact canvas equality after export/reload. Its generated screenshot was also visually inspected. Browser runs use installed Chrome via `PLAYWRIGHT_CHANNEL=chrome`; the longer multi-step workflows use a 90-second test timeout. No browser installation or smoke-test steps were added to CI.

Manual workflow:

1. Open Rig Editor and select the forearm visual slot.
2. Import a replacement PNG/WebP, Preview it, then Apply it. Confirm dimensions in the alignment inspector.
3. Choose Artwork Offset Editing; drag the artwork relative to the elbow or edit offsets numerically.
4. Choose Sprite Origin Editing; select the elbow point in the texture with a drag or enter exact pixel origins. Reset offset to put that pivot at the joint if needed.
5. Select the forearm bone in Bind pose and adjust its rotation; inspect several existing animation bone poses and times.
6. Undo/Redo the alignment; cancel a held gesture with Escape and verify it leaves data unchanged.
7. Switch facing and inspect joint/pivot guides; use zoom, pan and dimming for precision.
8. Restore Bind pose/right facing and desired presentation, download rig JSON and reload the export. Confirm identical placement. Keep the same replacement texture available: JSON does not package image bytes.

Deferred features remain those excluded by the plan: Animation Editor Rig-Tweak integration, automatic anatomical detection, mesh deformation, a full skin manager, new IK algorithms and sprite asset package export.
