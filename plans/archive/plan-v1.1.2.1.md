# Paper Puppeteer Engine — v1.1.2.1
## Animation Curve Foundation

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.1.1**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing animation functionality includes:
- Bone transform keyframes
- Interpolation
- Timeline editing
- IK target animation
- Animation layers and crossfades
- Mirroring
- Serialization and validation
- Undo/Redo

Do not rewrite the animation evaluator.

## Goal

Prepare a reliable curve-evaluation and data foundation for a future visual Graph Editor.

A Graph Editor should let artists control how animated properties change between keyframes.

For example, a sword arm may accelerate slowly, move rapidly and decelerate before stopping.

This phase focuses on data, curve evaluation and compatibility. The visual UI comes in v1.1.2.2.

## 1. Inspect existing interpolation

Find the actual interpolation system.

Identify:
- Supported interpolation modes
- Bone translation and rotation channels
- Scale channels
- IK target position/influence channels
- Current easing definitions
- Timeline keyframe structures
- Runtime evaluation functions
- Schema/versioning rules

Do not assume cubic Bézier interpolation is missing.

If curves already exist, reuse their model and focus on missing functionality.

## 2. Property curve representation

Design a typed way to evaluate supported animated properties independently.

Examples:
- Bone X/Y
- Bone rotation
- Bone scale
- IK target X/Y
- IK influence

Reuse existing tracks/keyframes where possible.

Do not duplicate the underlying animation data into a separate graph-only representation.

## 3. Cubic Bézier support

If not already available, introduce a backwards-compatible cubic Bézier interpolation mode for suitable numeric property segments.

Requirements:
- Two handles per segment or equivalent curve representation
- Deterministic evaluation
- Validated finite values
- Strictly ordered keyframe times
- Monotonic time-axis mapping for a single-valued curve
- Stable behavior at segment endpoints
- Safe degenerate-handle handling

Use the established time/value coordinate conventions.

Do not introduce a third-party animation evaluator unless genuinely necessary.

## 4. Rotation

Handle angular interpolation carefully.

Existing shortest-path rotation behavior must remain correct.

Do not interpolate wrapped degree/radian values in a way that creates unintended full rotations.

If the graph exposes unwrapped values or explicit multi-turn rotation, document that distinction and preserve existing authored meaning.

## 5. Compatibility

Preserve existing:
- Stepped interpolation
- Linear interpolation
- Smooth/eased interpolation
- Runtime playback
- Exported animations
- Mirroring
- Animation layers
- IK baking

Existing animations must load and evaluate equivalently.

Do not change default interpolation behavior silently.

## 6. Data format

If a schema extension is necessary:
- Make it optional where possible.
- Follow existing format version conventions.
- Validate all curve controls.
- Preserve old animation fixtures.
- Keep serialization deterministic.

Do not add editor viewport or graph-selection state to animation JSON.

## 7. Evaluator ownership

The runtime animation evaluator remains authoritative.

Graph previews in the next phase must reuse the same evaluation logic.

Do not build a separate interpolation engine in React.

## 8. Tests

Cover:
- Linear
- Stepped
- Existing smooth behavior
- Bézier endpoints
- Bézier midpoint
- Invalid handles
- Duplicate key times
- Zero-duration segments
- Rotation wrapping
- Negative values
- Scale values
- IK influence
- Serialization
- Backward compatibility
- Deterministic evaluation

Use numeric tolerances appropriate to the project.

## 9. Out of scope

Do not implement:
- Graph Editor UI
- Tangent dragging
- Motion cleanup
- Animation retargeting
- New animation layers
- Scene timeline changes

## 10. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The animation system supports reliable, compatible evaluation of the interpolation curves needed by a visual Graph Editor, without changing old animations or creating duplicate evaluation logic.

## Final report

Provide current/added interpolation types, data format changes, rotation semantics, API changes, tests, files changed and exact verification results.
