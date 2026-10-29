# Paper Puppeteer Engine — v1.4.5
## Mesh Deformation — Cross-Editor Integration

Continue developing Paper Puppeteer Engine.

Previous milestone: **v1.4.4**.

Stack: React, strict TypeScript, Phaser, Vite, npm, ES modules.

The engine now supports:
- Mesh attachments
- Weight painting
- Runtime skeletal deformation
- Deformation animation tracks
- Existing character/scene authoring

## Goal

Ensure mesh deformation works consistently across the full Paper Puppeteer Engine pipeline.

Do not add another deformation model.

## 1. Architecture audit

Review the current mesh implementation against:
- Rig Editor
- Animation Editor
- Scene Editor
- Environment Preview, if implemented
- CharacterLoader
- Actor choreography
- Scene runtime
- Project Workspace
- Export/import

Identify incompatible assumptions.

## 2. Rig Editor integration

Verify:
- Mesh creation
- Editing geometry
- Bone binding
- Weight painting
- Switching skins
- Replacing artwork
- Updating rig bind poses
- Undo/Redo

Changing the rig should use existing dependency validation.

Do not silently invalidate animated mesh tracks.

## 3. Animation Editor integration

Verify:
- FK/IK pose evaluation
- Mesh deformation
- Keyframes
- Graph Editor
- Animation Variations
- Mirroring
- Onion skinning
- Root motion
- Foot markers
- Ground reference

Onion skinning should either render mesh poses correctly or clearly communicate a documented limitation.

Do not silently show incorrect ghost poses.

## 4. Scene Editor integration

Ensure deformable characters behave correctly with:
- Actor movement
- Root motion
- Facing
- Actor scale
- Camera zoom/pan
- Parallax backgrounds
- Scene cuts/fades
- Deterministic scrubbing
- Multiple Actors

Scene Editor must use the same runtime skinning evaluator as Animation Editor.

Do not implement a scene-specific mesh deforming algorithm.

## 5. Attachment ordering

Mixed characters may include:
- Rigid attachments
- Skinned meshes
- Several transparent mesh layers

Maintain correct render ordering and blending.

Ensure a mesh sleeve can render behind or in front of other character parts according to existing slot rules.

Avoid breaking the established character draw order.

## 6. Skins and sprite replacement

A different skin may use:
- A different rigid sprite
- Another mesh
- The same mesh with different artwork

Define which combinations are supported.

When replacing artwork, preserve geometry/weights only when it remains valid to do so.

Different image proportions may require deliberate remapping.

Do not blindly stretch UVs or reposition contact markers without informing the artist.

## 7. Character packages

Extend existing exporters/loaders as needed.

Verify exported characters contain:
- Mesh geometry
- UV coordinates
- Bone weights
- Bind/rest information
- Texture references
- Deformation animation tracks

No temporary browser URLs or editor-only Phaser objects.

## 8. Backward compatibility

Old rigid-sprite characters should:
- Load unchanged
- Animate unchanged
- Export unchanged where formats allow
- Avoid unnecessary mesh runtime work

Old animations without deformation tracks must evaluate normally.

## 9. Shared asset lifecycle

Check texture ownership.

When a character has several meshes referencing the same image:
- Avoid duplicate image decoding where appropriate.
- Do not dispose shared textures prematurely.
- Clean up per-instance mesh resources safely.

## 10. Validation

Extend existing project dependency checks for:
- Missing mesh textures
- Missing bones
- Invalid weights
- Invalid topology
- Invalid deformation vertex references
- Unsupported renderer/backend
- Incompatible attachment replacements

Allow unfinished drafts while blocking invalid production exports.

## 11. Tests

Cover:
- Rig-to-animation workflow
- Animation-to-scene workflow
- Multiple Actors
- Mixed rigid/mesh characters
- Mirroring/facing
- IK and root motion
- Skin replacement
- Asset export/import
- Project recovery
- Direct seek consistency
- Resource disposal

## 12. Out of scope

Do not implement:
- Physics
- GPU compute systems
- Automatic rigging
- Complex mesh morph libraries
- New camera/audio features

## 13. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Also run standalone runtime integration checks.

## Definition of done

A deformable character created in Rig Editor can be animated in Animation Editor, placed in Scene Editor and loaded by a standalone consumer with consistent visual results.

## Final report

Provide cross-editor fixes, renderer parity, serialization, compatibility, resource lifecycle, files changed, tests and exact results.
