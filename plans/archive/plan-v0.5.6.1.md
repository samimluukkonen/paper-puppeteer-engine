# Paper Puppeteer Engine — v0.5.6.1
## IK Bake Sampling Foundation

Continue development of my standalone Paper Puppeteer Engine.

**Current completed version: v0.5.5.5**

Technology stack:
- React for editor UI
- TypeScript (strict)
- Phaser
- Vite
- npm
- ES modules

Already implemented:
- Bone animation and keyframe authoring
- Two-bone arm/leg IK
- Animated IK targets and influence
- Constraint precedence
- Timeline, playback, interpolation and events
- Onion skinning and mirrored animation tools
- Undo/Redo and animation JSON import/export

Do NOT rebuild working systems.

## Goal

Create the read-only foundation for converting IK-driven motion into authored bone keyframes.

This phase must NOT modify authored animation data.

### 1. Inspect existing IK evaluation

Review:
- Existing IK solver and constraints
- Animated IK target evaluator
- Bone/local/world transform conventions
- Constraint execution order
- Animation blending and layers
- Existing ghost-pose sampling infrastructure

Reuse existing runtime evaluation logic.

Do not introduce a second IK solver.

### 2. IK bake sampling API

Create a pure or isolated sampling API conceptually like:

```ts
sampleIKBake(
  animation,
  rig,
  constraintIds,
  sampleTimes
): IKBakeSampleResult
```

Use existing types and conventions.

Each sample must capture the final solved transforms of bones controlled by the selected IK constraints.

Preserve bone-local transform information required for later keyframe generation.

### 3. Read-only evaluation

Sampling must NOT:
- Modify source or working animation
- Modify the rig or bind pose
- Move the editor playhead
- Advance playback
- Fire animation events
- Add history entries
- Mark animation dirty

Use an isolated evaluation context where necessary.

### 4. Bake scope

For the initial implementation, support baking selected IK constraints over the **entire animation duration**.

Do not implement arbitrary partial-range baking yet.

This avoids introducing ambiguous behavior at the boundaries between baked and procedural IK.

### 5. Sampling times

Default to sampling at the animation's authored FPS.

Include:
- Time 0
- Each sampled frame
- The exact animation end time

Support an explicit sampling FPS override in the underlying API.

Do not quantize the source animation or permanently alter key times.

### 6. Constraint validation

Before sampling, verify:
- Selected constraints exist
- Their driven bones are identifiable
- The current animation can be evaluated
- No unsupported competing constraint owns those bones
- Target coordinates and transforms are valid

Report unsupported combinations rather than silently producing incorrect results.

### 7. Determinism

Repeated sampling of identical inputs must produce identical results within floating-point tolerance.

Reject or report nondeterministic dependencies on external gameplay state.

### 8. Tests

Cover:
- Single arm IK
- Leg IK
- Multiple sample times
- Stepped and smooth interpolation
- Animated influence
- Unreachable targets
- Local transform correctness
- Constraint precedence
- Deterministic sampling
- No animation-event dispatch
- No source/working mutation
- No changes to editor time/history

### 9. Do NOT implement

- Keyframe generation
- Authored animation mutations
- IK deactivation
- React Bake UI
- Partial-range baking
- New IK algorithms

### 10. Verification

Run and fix failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

- Existing IK evaluation can be sampled safely
- Samples contain the required solved bone transforms
- Sampling is deterministic for supported inputs
- Unsupported constraints are reported
- No authored data or editor state changes
- All required commands pass

## Final report

Describe:
1. Sampling architecture and APIs
2. Constraint validation
3. Sampling time policy
4. Transform representation
5. Files changed
6. Tests
7. Command results
8. Deferred work

Do not claim completion unless all required commands pass.
