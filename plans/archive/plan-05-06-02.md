# Paper Puppeteer Engine — v0.5.6.2
## Bone Keyframe Generation

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.6.1**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

v0.5.6.1 implemented read-only sampling of solved IK poses.

Do NOT rewrite the IK sampler or existing bone keyframe APIs.

## Goal

Convert sampled IK results into ordinary authored bone-transform keyframes.

This phase generates a proposed bake result but does NOT commit it to the working animation.

### 1. Keyframe generation API

Create a pure operation conceptually like:

```ts
generateBakedBoneKeys(
  samples,
  rig,
  options
): IKBakePlan
```

Adapt to existing architecture.

The result must use the existing AnimationDefinition bone/property keyframe format.

Do not invent a separate runtime animation format.

### 2. Bone-local transforms

Generated keyframes must use the coordinate system expected by normal bone animation.

Never store:
- Screen-space transforms
- Camera-space transforms
- Final world matrices as local key values
- Unnormalized solver internals

Use existing conversion utilities.

### 3. Affected bones

Only generate keys for bones driven by the selected IK constraints.

For example:

```text
leftHandIK
    ↓
leftUpperArm.rotation
leftForearm.rotation
```

Include additional transform properties only when required by the actual solver output.

Do not automatically key the entire skeleton.

### 4. Frame sampling

Preserve the sample-time sequence from v0.5.6.1.

Example:

```text
Animation FPS: 10
Duration: 1 second

Generated key times:
0.0, 0.1, 0.2 ... 1.0
```

Use existing floating-point normalization and key-time matching policies.

### 5. Interpolation

Generated keys must use existing interpolation metadata.

Default to a conservative policy that reproduces the sampled poses reliably at the chosen sampling instants.

For stepped output, use existing stepped interpolation.

For smooth output, acknowledge that interpolation between sampled transforms may differ from continuous IK solving.

Do not claim exact between-sample equivalence unless verified.

Do not invent Bézier interpolation or an alternative evaluator.

### 6. Target tolerance

Provide a pure comparison helper to measure differences between:
- Original IK-solved poses
- Evaluated generated bone animation

Compare relevant joint/bone transforms at sample times.

Use documented tolerances for translation and rotation.

Do not silently accept invalid or non-finite output.

### 7. Preserve authored data

Generation should not overwrite existing tracks immediately.

The proposed result must explicitly describe:
- Bones affected
- Properties affected
- Generated key counts
- Existing keys that would be replaced
- Sampling settings
- Validation issues

The eventual commit phase will decide how to apply it.

### 8. Multiple constraints

Support multiple selected constraints only when their driven bone sets and precedence can be resolved safely.

Detect overlapping or conflicting ownership.

Reject ambiguous cases rather than relying on operation order.

### 9. Tests

Test:
- One arm IK chain
- Leg IK chain
- Multiple driven bones
- Keyframe sorting
- Exact end-time handling
- Rotation units
- Local transform conversion
- Stepped output
- Smooth output sampling
- Existing animation schema compatibility
- No unrelated bone keys generated
- Input/source immutability
- Sample fidelity within tolerance

### 10. Do NOT implement

- Commit to workingAnimation
- Remove or disable IK constraints
- React UI
- IK baking Undo/Redo
- Partial-range baking
- Keyframe simplification
- Advanced adaptive sampling

### 11. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- IK samples generate valid bone-transform keys
- Time and transform conventions are correct
- Generated animation can be evaluated by existing runtime
- Sampling accuracy can be measured
- Proposed changes are inspectable
- No authored mutation occurs
- Required commands pass

## Final report

Explain:
1. Generated keyframe representation
2. Local-transform conversion
3. Sampling/interpolation policy
4. Fidelity measurement
5. Files and APIs changed
6. Tests and results
7. Deferred work

Do not claim completion unless all commands pass.
