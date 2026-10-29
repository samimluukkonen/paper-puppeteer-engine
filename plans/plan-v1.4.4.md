# Paper Puppeteer Engine — v1.4.4
## Deformation Keyframe Animation

Continue developing Paper Puppeteer Engine.

Previous milestone: **v1.4.3.2**.

Stack: React, strict TypeScript, Phaser, Vite, npm, ES modules.

Implemented:
- Mesh attachments
- Bone weights
- Runtime skeletal deformation
- Visual mesh editing
- Weight painting
- Animation Editor with timeline and Graph Editor

## Goal

Allow artists to animate optional mesh vertex corrections.

Skeletal skinning should remain the default source of deformation.

Deformation keys provide additional artistic control when bone weights alone cannot produce the desired shape.

Examples:
- Adjust a sleeve during a sword cut.
- Correct an elbow fold.
- Reshape a cape during a turn.
- Refine a piece of flexible armor.

Do not implement cloth simulation.

## 1. Inspect animation architecture

Review:
- AnimationDefinition
- Stable mesh/vertex IDs
- Keyframe models
- Interpolation
- Timeline tracks
- Graph Editor
- Working-copy/history
- Existing animation evaluator
- Skinning pipeline

Reuse existing data and evaluator utilities.

## 2. Deformation key model

Introduce optional animation tracks for supported mesh attachments.

Each deformation key should contain:
- Time
- Referenced mesh attachment
- Stable vertex references
- Vertex X/Y offsets
- Supported interpolation

Prefer sparse storage of modified vertices.

Do not duplicate entire mesh geometry at every frame unnecessarily.

## 3. Deformation coordinate semantics

Choose and document a precise evaluation order.

Recommended initial approach:

1. Start with immutable bind-pose mesh vertices.
2. Evaluate authored per-vertex correction offsets in bind/attachment-local space.
3. Apply corrections to the base vertices.
4. Apply bone-weight skinning using the evaluated pose.
5. Render through the existing Puppet/Actor transforms.

This keeps deformation deterministic and avoids accumulating corrections over frames.

Do not mix these corrections with root motion or pelvis translation.

## 4. Animation Editor mode

Add a clear mode:

**Edit Mesh Deformation**

When active:
- Choose a deformable mesh
- Select vertices
- Adjust vertex offsets at the playhead
- Create/update deformation keys
- Preview resulting shape

Keep vertex handles visually distinct from bone and IK handles.

## 5. Timeline tracks

Add per-mesh deformation tracks.

Conceptual:

```text
ANIMATION TIMELINE

Root Motion
Skeleton
IK

Mesh Deformation
  Sleeve Mesh
  Cape Mesh
```

Support:
- Add key
- Select key
- Move key
- Delete key
- Duplicate
- Edit offsets
- Undo/Redo

Use existing timeline controls.

## 6. Neutral/default state

An animation without deformation keys must evaluate to normal bone-weighted mesh deformation.

A missing vertex correction means zero offset.

Do not require every mesh vertex to have a key at every timestamp.

## 7. Visual editing

The artist should be able to correct the deformed silhouette at a selected animation time.

If the editor displays handles in posed/world space while storing bind-space offsets, implement a robust mapping.

Where inverse mapping is ambiguous or singular, avoid silently writing incorrect offsets.

A clearly labeled bind-space correction mode is preferable to unreliable direct manipulation.

## 8. Compatibility with animation tools

Inspect and define correct behavior for:
- Mirroring
- Animation Variations
- Pose Library
- IK baking
- Graph Editor
- Motion Diagnostics
- Animation copy/paste

Do not silently delete deformation tracks during duplication or export.

For unsupported operations, provide an explicit warning or preserve the data unchanged.

## 9. Topology compatibility

Stable vertex identities are essential.

If mesh topology changes:
- Preserve compatible deformation references.
- Detect deleted or replaced vertex IDs.
- Flag incompatible deformation tracks.
- Do not silently apply corrections to the wrong vertices.

## 10. Preview and seeking

The same animation time must produce identical deformation regardless of previous playback state.

No accumulated deformation.

No hidden authored changes during playback or scrubbing.

## 11. Tests

Cover:
- No deformation keys
- One vertex correction
- Multiple vertices
- Interpolation
- FK/IK compatibility
- Root motion
- Mirroring behavior
- Topology changes
- Invalid vertex references
- Undo/Redo
- Serialization
- Direct seek determinism
- Runtime/editor parity

## 12. Manual acceptance

Create a sword-cut animation with a mesh sleeve.

1. Animate the arm using bones.
2. Preview weighted deformation.
3. Select a frame where the elbow bends sharply.
4. Add deformation correction keys.
5. Adjust the sleeve shape.
6. Scrub before, during and after the correction.
7. Verify smooth transitions.
8. Undo/Redo.
9. Export/reload.
10. Verify runtime playback matches the editor.

## 13. Out of scope

Do not implement:
- Cloth physics
- Dynamic collision
- Automatic corrective shape generation
- Mesh retargeting
- Full shape-key library
- New animation blending framework

## 14. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

The artist can add optional time-based mesh corrections to animations without changing base mesh geometry, bone weights or unrelated animation tracks.

## Final report

Describe data schema, transform order, editor behavior, topology handling, compatibility, files changed, tests and exact results.
