# Paper Puppeteer Engine — v1.4.3.1
## Runtime Skeletal Mesh Deformation

Continue developing Paper Puppeteer Engine.

Previous milestone: **v1.4.2.2**.

Stack: React, strict TypeScript, Phaser, Vite, npm, ES modules.

Implemented:
- Mesh attachments and validation
- Mesh geometry authoring
- Existing FK/IK skeletal evaluator
- Runtime Puppet and Actor transforms
- CharacterLoader

## Goal

Implement skeletal skinning for mesh attachments.

Mesh vertices should follow the movement of one or more bones, with smoothly blended influence.

This must work alongside ordinary rigid attachments.

## 1. Inspect runtime

Review:
- FK world transforms
- IK solver and final pose
- Rig bind/rest matrices
- Attachment origin/offset
- Facing/mirroring
- Puppet scale/root transforms
- Phaser renderer capabilities
- Runtime update lifecycle

Use the actual evaluated pose, not a second skeletal transform evaluator.

## 2. Bone influence model

Extend mesh vertices with bone influence weights.

Conceptual:

```ts
interface BoneInfluence {
  boneId: string;
  weight: number;
}
```

Support multiple bone influences per vertex.

Use a conservative maximum such as four influences unless repository constraints favor another limit.

Weights must be:
- Finite
- Nonnegative
- Normalized to 1
- Associated with valid bones

New meshes should default to one valid bone influence so they remain usable before weight painting.

## 3. Bind-pose matrices

Calculate or store the necessary inverse bind transforms.

Ensure:
- Bind-pose vertices render at their authored positions.
- Bone movement deforms vertices relative to bind pose.
- Rest transformations are not applied twice.
- Rig changes that invalidate binding are detected.

Do not derive bind transforms from an arbitrary animation frame.

## 4. Linear blend skinning

Implement standard 2D weighted skeletal deformation or an equivalent mathematically consistent approach.

Conceptually, each vertex uses the weighted combination of posed bone transforms relative to their bind transforms.

Define clearly which transforms are attachment-local and which are Puppet/world transforms.

Avoid double application of:
- Actor translation
- Root motion
- Facing inversion
- Attachment offset
- Bone transformations

## 5. Evaluation order

Use a consistent pipeline:

1. Evaluate animation channels.
2. Evaluate FK.
3. Apply IK/constraints.
4. Obtain final posed bone transforms.
5. Evaluate mesh deformation.
6. Apply Puppet/Actor world placement as appropriate.
7. Render.

Preserve the existing runtime's authoritative order where it already differs for valid reasons.

## 6. Rendering backend

Investigate the actual Phaser renderer and supported capabilities before choosing an implementation.

Use the simplest performant mesh rendering method that fits the project.

Requirements:
- Correct texture mapping
- Correct triangle rendering
- Correct draw order
- Consistent opacity
- Predictable UVs
- Efficient vertex updates
- No unnecessary texture recreation

Do not assume WebGL-specific functionality works in Canvas mode.

If mesh rendering requires WebGL, detect unsupported backends and provide an explicit diagnostic or supported fallback.

Never silently render an empty character.

## 7. Mixed character support

A Puppet may contain:
- Rigid sprites
- Mesh attachments
- Several mesh attachments
- Different skins

All must render correctly in the same character.

Ordinary rigid attachments should not incur unnecessary mesh-update overhead.

## 8. Animation and IK

Mesh deformation should respond to:
- Bone rotation
- Bone translation
- Parent bone movement
- IK-driven poses
- Facing
- Puppet/Actor scaling
- Root motion

Foot contact markers remain bone-based references unless explicitly extended.

Do not convert them automatically into mesh-vertex markers.

## 9. Determinism

Evaluating the same rig and animation time must produce the same deformed vertices.

Scrubbing backward must not depend on previously deformed geometry.

Always evaluate from immutable bind geometry rather than repeatedly deforming last frame's vertices.

## 10. Tests

Cover:
- One-bone weights
- Two-bone blending
- Weight normalization
- Bind-pose identity
- Parent/child bone transforms
- IK evaluation
- Facing
- Negative/nonuniform scale where supported
- Root motion
- Multiple mesh attachments
- Mixed rigid sprites
- Deterministic seeking
- Resource disposal

## 11. Out of scope

Do not implement: bf
- Weight painting UI
- Animated mesh verticesöäÄ^
'ä¨ä -–…-..-
- Cloth physics
- Collision
- GPU compute shaders
- Automatic rigging
- Mesh retargeting

## 12. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Also run available renderer/runtime integration tests.

## Definition of done

The Puppet runtime can deform textured mesh attachments based on evaluated bone poses while preserving rigid sprites, IK, root motion and scene compatibility.

## Final report

