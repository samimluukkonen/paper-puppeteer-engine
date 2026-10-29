# Paper Puppeteer Engine — v1.4.6
## Advanced Rigging & Mesh Deformation — Production Hardening

Continue developing Paper Puppeteer Engine.

Previous milestone: **v1.4.5**.

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Implemented v1.4 features:
- Improved constraint editing
- Mesh attachment model
- Visual mesh geometry editing
- Skeletal mesh deformation
- Visual weight painting
- Deformation keyframe authoring
- Cross-editor integration

This application is a private tool for myself and one artist friend.

## Goal

Complete v1.4 by making mesh deformation reliable, understandable and useful during actual character production.

Prioritize artist usability and preservation of existing data.

Do not introduce another major subsystem.

## 1. End-to-end artist workflow

Test this realistic scenario:

### Flexible Sleeve During a Sword Attack

1. Open an existing project.
2. Select a character.
3. Open Rig Editor.
4. Select a sleeve sprite.
5. Convert it to a mesh attachment.
6. Subdivide the mesh around the elbow.
7. Bind it to upper-arm and forearm bones.
8. Paint and normalize weights.
9. Bend the elbow using existing FK/IK tools.
10. Inspect deformation.
11. Adjust weights.
12. Save/export the rig.
13. Open Animation Editor.
14. Create/open a sword attack.
15. Animate the arm.
16. Apply root motion for a forward step if appropriate.
17. Add corrective mesh keys if needed.
18. Preview and scrub.
19. Use Environment Preview if available.
20. Undo/Redo.
21. Save/export animation.
22. Open Scene Editor.
23. Add the character as an Actor.
24. Play the sword attack.
25. Preview camera movement.
26. Export/reload the project.
27. Play through the standalone runtime.

The artist should not need to manually edit JSON.

## 2. Additional mesh scenarios

Verify:
- Long hair
- Cape or cloak section
- Flexible clothing
- Character with multiple mesh attachments
- Character with no mesh attachments
- Multiple instances of the same deformable character

Do not require physical cloth simulation.

## 3. Visual correctness

Inspect common deformation problems:
- Excessive stretching
- Fold collapse
- Texture tearing
- Inverted triangles
- Bone binding offset
- UV distortion
- Incorrect draw order
- Incorrect facing
- Incorrect mesh opacity
- Invalid weight normalization

Where appropriate, add lightweight diagnostics.

Do not automatically "repair" artistic deformation without explicit action.

## 4. Deformation debugging

Provide optional editor overlays where useful:
- Mesh triangles
- Vertex handles
- Selected bone weights
- Bone influence names
- Invalid topology indicators

Allow hiding overlays during ordinary animation preview.

Avoid cluttering the artist's workspace.

## 5. Renderer and performance

Test representative sizes:
- Small meshes
- Medium meshes
- Large meshes
- Multiple deformable Actors
- Mixed rigid/mesh characters

Measure:
- Vertex update cost
- Phaser rendering cost
- IK + skinning evaluation
- Animation scrubbing
- Scene playback
- Memory/resource usage

Optimize measured bottlenecks only.

Do not add advanced GPU infrastructure unless clearly necessary.

## 6. Data safety

Verify:
- Undo/Redo
- Autosave
- Crash recovery
- Rig export/import
- Animation export/import
- Scene export/import
- Project export/import
- Missing asset handling
- Schema validation

A malformed mesh must not corrupt unrelated characters or animations.

## 7. Backward compatibility

Test existing example characters, including:
- Demo Puppet
- random-paperdoll-sketch

Confirm their original rigid artwork and animations work.

Also test existing scenes containing those characters.

Do not require automatic mesh conversion.

## 8. Feature Guide Wizard

Extend the existing guide system with short tutorials.

### Creating a Mesh Attachment
- Select sprite
- Convert to mesh
- Subdivide
- Edit vertices
- Save

### Painting Bone Weights
- Select mesh
- Select bone
- Paint weights
- Preview deformation
- Normalize/fix issues

### Animating Mesh Deformation
- Open animation
- Select deformable mesh
- Set correction key
- Modify shape
- Scrub/preview

Use actual stable UI anchors.

Guide navigation must not author geometry or keys automatically.

## 9. Documentation

Create a concise artist-facing guide:

**Getting Started with Mesh Deformation**

Explain:
- Rigid sprite versus mesh
- Mesh vertices and triangles
- Bone weights
- Weight painting
- Bind pose
- IK versus mesh deformation
- Deformation keyframes
- Common distortion problems
- Performance considerations
- Exporting characters

Use screenshots or existing documentation conventions where practical.

## 10. Regression matrix

### Rig Editor
- Bones/joints
- FK/IK
- Constraint editing
- Sprite attachments
- Skins
- Contact markers
- Mesh geometry
- Weight painting

### Animation Editor
- Timeline
- Graph Editor
- Root motion
- IK
- Mirroring
- Onion skinning
- Pose Library
- Animation Variations
- Deformation keys

### Scene Editor
- Actor placement
- Movement
- Root motion
- Camera
- Backgrounds
- Transitions
- Deformed character rendering

### Project Workspace
- Asset management
- Autosave
- Recovery
- Validation
- Export/import

## 11. Automated tests

Expand tests for:
- Mesh validation
- Bind transforms
- Skinning mathematics
- Weight normalization
- Vertex editing
- Topology changes
- Deformation keyframe evaluation
- Deterministic seeking
- Runtime parity
- Missing dependencies
- Undo/Redo
- Serialization
- Resource cleanup

Do not claim manual verification unless actually performed.

## 12. Known limitations

Document deferred features:
- Cloth simulation
- Soft-body physics
- Mesh collision
- Automatic weight generation
- Advanced mesh retargeting
- Multi-resolution meshes
- GPU-only optimization
- Complex shape-key libraries

These are not required to finish v1.4.

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint, browser/E2E and standalone consumer checks where available.

Fix failures.

## Final v1.4 definition of done

v1.4 is complete when:
- Existing rigid characters still work.
- Mesh attachments are optional.
- Mesh geometry can be edited visually.
- Bone weights can be painted.
- Skeletal mesh deformation works.
- Meshes respond correctly to FK/IK.
- Corrective deformation keys work.
- Animation and Scene Editors render meshes correctly.
- Runtime evaluation is deterministic.
- Import/export preserves mesh data.
- Autosave/recovery works.
- Undo/Redo works.
- Existing assets remain compatible.
- Feature Guide tutorials are available.
- No serious data-loss or rendering blockers remain.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall v1.4 readiness
2. Mesh/constraint architecture
3. Visual mesh editor
4. Weight painting
5. Skinning implementation
6. Deformation keyframes
7. Cross-editor compatibility
8. Runtime/rendering performance
9. Export/import and recovery
10. Files/APIs changed
11. Automated tests
12. Actual manual verification
13. Exact verification results
14. Known limitations
15. Recommended v1.5 priorities

Do not claim readiness if important checks fail.
