# Paper Puppeteer Engine — v1.4.3.2
## Visual Bone Weight Painting

Continue developing Paper Puppeteer Engine.

Previous milestone: **v1.4.3.1**.

Stack: React, strict TypeScript, Phaser, Vite, npm, ES modules.

The engine now supports:
- Mesh attachments
- Visual mesh topology editing
- Bone influence weights
- Runtime skeletal mesh deformation
- Existing FK/IK evaluation

## Goal

Allow my artist friend to control how mesh vertices respond to different bones using visual weight painting.

Example:

A sleeve mesh may be influenced by:
- Upper-arm bone
- Forearm bone

Vertices near the elbow should blend smoothly between the two.

## 1. Inspect existing editor tools

Review:
- Mesh geometry editor
- Rig bone selection
- Phaser pointer interactions
- Editor selection/dragging
- Existing inspector
- Undo/Redo
- Mesh weight representation
- Deformation preview

Reuse established patterns.

## 2. Weight Paint mode

Add an explicit Rig Editor mode:

**Paint Bone Weights**

UI should include:
- Selected mesh
- Selected influence bone
- Brush size
- Brush strength
- Paint / erase
- Normalize
- Reset weights
- Preview deformation

Keep controls understandable for an artist.

## 3. Weight visualization

Display mesh weights visually.

For the currently selected bone:
- Strong influence should be visually distinct from weak influence.
- Zero influence should be distinguishable.
- Selected vertices should remain visible.

Use a simple heatmap or vertex color overlay.

This is an editor overlay, not exported artwork.

## 4. Brush behavior

Support:
- Painting additional influence
- Reducing influence
- Adjustable brush radius
- Adjustable strength
- Numeric editing of selected vertex weights

Operate on the existing mesh vertices.

For the first implementation, distance-based vertex brushes are sufficient.

Do not create new mesh vertices when painting.

## 5. Weight normalization

Weights at each vertex must sum to 1 within tolerance.

Define stable normalization behavior when:
- One bone weight increases
- A weight decreases
- A weight is erased
- The maximum influence count is reached
- The selected bone is deleted
- All weights would otherwise become zero

Never save invalid zero-total influence sets.

Use a documented fallback influence where necessary.

## 6. Bone influence management

Allow choosing the influence bone from the existing rig hierarchy.

Support a practical limit on influences per vertex.

If reducing influence count requires dropping weights, use deterministic policies and report meaningful changes.

Don't silently change all weights on unrelated vertices.

## 7. Preview

Show mesh deformation using the existing runtime evaluator.

The artist should be able to:
1. Select a sleeve mesh.
2. Select upper-arm bone.
3. Paint weights.
4. Select forearm bone.
5. Blend the elbow region.
6. Change the test pose.
7. Observe smooth deformation.

Preview posing must not accidentally create animation keys.

Use existing rig preview mechanisms.

## 8. Undo/Redo

A brush stroke should produce one Undo transaction.

Support cancel.

Do not create a history entry for every pointer movement.

## 9. Topology edits and weights

Define safe behavior when mesh geometry changes after painting.

For edge subdivision:
- Interpolate new vertex weights from adjacent vertices.
- Normalize weights.
- Preserve valid bone IDs.

Deleting vertices must remove obsolete weight records safely.

Do not silently reset all painted weights after a topology edit.

## 10. Bone deletion/rebinding

When deleting or replacing a bone used by a mesh, detect the dependency.

Provide:
- Clear validation error or warning
- Safe reassignment workflow
- Rebinding where explicitly requested

Do not leave dangling bone references.

## 11. Tests

Cover:
- Paint influence
- Erase influence
- Normalize
- Maximum influences
- Brush radius/strength
- Stroke Undo/Redo
- Bone selection
- Numeric editing
- Topology subdivision
- Deleted bone
- Export/import
- Live preview parity

## 12. Manual acceptance

1. Open a character with a sleeve.
2. Convert sleeve to mesh.
3. Add subdivisions.
4. Bind to upper arm and forearm.
5. Paint a smooth elbow transition.
6. Bend the elbow using existing controls.
7. Compare with the original rigid sprite.
8. Undo/Redo.
9. Export/reload.
10. Verify painted weights persist.

## 13. Out of scope

Do not implement:
- Automatic weight generation using AI
- Cloth simulation
- Soft-body physics
- Vertex animation keyframes
- Advanced mesh sculpting
- General-purpose topology remeshing

## 14. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

An artist can paint and edit bone weights on a mesh and immediately preview how the artwork deforms with skeletal movement.

## Final report

Describe UI workflow, brush algorithm, normalization rules, topology compatibility, history, files changed, tests and verification results.
