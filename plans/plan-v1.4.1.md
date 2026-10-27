# Paper Puppeteer Engine — v1.4.1
## Rig Constraints & Deformation Preparation

Continue developing my Paper Puppeteer Engine.

### Current project

The confirmed implementation includes:
- React + TypeScript (strict)
- Phaser rendering
- Vite, npm, ES modules
- Rig Editor, Animation Editor, Scene Editor
- FK and two-bone IK
- Visual rig and IK authoring
- Root motion
- Ground guides and foot contact markers
- Pose Library, Graph Editor and animation tools
- Project Workspace and import/export

Inspect the repository for features implemented after v1.2.6. Do not assume v1.3 is complete.

This application is used privately by myself and one artist friend.

## Goal

Improve the existing Rig Editor constraint-authoring workflow and prepare a documented architecture for optional mesh deformation.

Do not introduce mesh rendering yet.

### 1. Architecture audit

Inspect:
- RigDefinition and bone IDs
- Bind/rest-pose representation
- Bone world-transform evaluation
- FK/IK evaluation ordering
- Constraint storage and validation
- Rig Editor gizmos
- Rig-Tweak mode
- Skin and attachment definitions
- CharacterLoader
- Existing history/persistence

Document the actual coordinate and transform systems.

### 2. Improve constraint authoring

Audit existing two-bone IK constraint editing.

Ensure the artist can:
- Identify the IK chain visually
- See its root, intermediate and end bones
- See and move the target
- Understand bend direction
- Edit supported parameters in the inspector
- Identify unreachable targets
- Disable/enable constraints
- Undo/redo edits

Reuse the existing solver.

Provide visible feedback for invalid chain configuration rather than silently accepting it.

### 3. Bend direction controls

If supported by the solver, expose the bend direction as an explicit editable parameter.

Show a visual indicator in Rig Editor.

If the solver currently uses a different mechanism, adapt the controls to its real behavior.

Do not create conflicting bend-direction state.

### 4. Constraint evaluation

Ensure the evaluation order is documented and deterministic.

At minimum, identify:
1. Authored FK transforms
2. Animation/IK target state
3. Constraint evaluation
4. Final bone world transforms
5. Future attachment deformation

Do not change the established animation result simply to accommodate future mesh work.

### 5. Deformation architecture preparation

Identify the best extension points for:
- Rigid sprite attachments
- Future mesh attachments
- Bind-pose geometry
- Bone influence weights
- Deformed vertex evaluation
- Phaser rendering

Define a clear separation between authored mesh data and runtime mesh state.

Keep runtime logic independent of React.

### 6. Compatibility requirements

Existing:
- Characters
- Rigs
- Animations
- IK
- Mirroring
- Sprite replacement
- Skins
- Foot markers
- Root motion

must remain functional.

No automatic conversion to mesh.

### 7. Tests

Cover:
- Existing IK fixtures
- Constraint creation/editing
- Bend-direction editing where supported
- Invalid chains
- Undo/Redo
- Bind/rest transforms
- FK/IK stability
- Serialization and compatibility

### 8. Out of scope

Do not implement:
- Mesh geometry
- Weight painting
- Runtime skinning
- Cloth physics
- New general-purpose IK solver
- A full constraint graph

### 9. Verification

Run the repository's actual equivalents of:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

Existing constraints are easier to understand and edit, and the repository has a documented, non-invasive extension plan for deformable mesh attachments.

## Final report

Provide architectural findings, constraint improvements, mesh extension points, files changed, tests and exact verification results.
