# Paper Puppeteer Engine — v0.5.6.4
## React IK Baking UI

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.6.3**

Technology stack:
- React
- TypeScript (strict)
- Phaser
- Vite
- npm
- ES modules

The engine now supports:
- IK bake sampling
- Bone keyframe generation
- Bake planning and validation
- Atomic bake commits
- Per-animation baked-IK deactivation
- Undo/Redo

Do NOT rewrite these systems.

## Goal

Create an artist-friendly IK baking workflow in the existing React Animation Editor.

Implement:
1. IK Bake panel
2. Constraint selection
3. Sampling FPS control
4. Bake preview
5. Pre-commit summary
6. Bake action
7. Validation feedback
8. Undo integration

### 1. React Bake panel

Integrate into the existing Animation Editor.

Conceptual UI:

```text
IK BAKING

Constraint:
[x] leftHandIK
[ ] rightHandIK
[ ] leftFootIK

Bake range:
Entire animation

Sampling:
[10 FPS]

Output:
Bone transform keyframes

[ Preview Bake ]
[ Bake IK ]
```

Use actual constraints available in the loaded rig.

Match existing editor UI conventions.

### 2. Constraint selection

Allow selecting one or more bake-compatible IK constraints.

Clearly show:
- Which constraints will be baked
- Which bones will receive keys
- Which constraints will be deactivated for this animation

Do not silently select unrelated constraints.

### 3. Bake options

Initially expose:
- Constraint selection
- Sampling FPS
- Supported output interpolation mode

Keep the bake range fixed to the full animation for this milestone.

Do not build partial-range editing.

### 4. Preview

The artist must be able to inspect the proposed baked result before committing.

Prefer a non-destructive preview mode using existing sampling and pose-rendering infrastructure.

Preview should compare:
- Original IK-driven animation
- Proposed baked bone animation

Do not create keys or dirty animation during preview.

If feasible, allow scrubbing through both results.

Reuse the existing evaluator.

### 5. Bake summary

Before commit, show a concise summary such as:

```text
Constraint: leftHandIK
Affected bones: 2
Generated keys: 22
Existing keys to replace: 5
Sampling FPS: 10
Constraint disabled after bake: Yes
```

Values must come from the actual bake plan.

Do not invent counts.

### 6. Validation feedback

Display clear errors for:
- Missing IK constraint
- Unsupported constraint ownership
- Invalid sampling FPS
- Missing bone references
- Non-deterministic input
- Invalid generated animation
- Unsupported overlapping constraints

Disable Bake when the plan is invalid.

### 7. Commit action

Pressing Bake must:
- Pause playback
- Invoke existing atomic commit API
- Update working animation
- Refresh timeline
- Refresh puppet preview
- Mark dirty
- Create one Undo operation

Do not duplicate mutation logic inside React components.

### 8. Undo

The artist should be able to:

```text
Bake IK
    ↓
Inspect result
    ↓
Undo
    ↓
Original IK animation restored
```

Reuse existing Animation Editor history.

### 9. React/Phaser state ownership

React components should reflect existing editor controller state.

Do not create competing authoritative states for:
- Animation data
- Playback time
- IK constraints
- Selected bones
- History

Clean up previews and subscriptions when changing animations or closing the editor.

### 10. Tests

Cover:
- Constraint selection
- Validation feedback
- FPS option
- Preview non-mutation
- Summary accuracy
- Correct commit invocation
- Undo behavior
- Editor state synchronization
- Source immutability
- React unmount cleanup

### 11. Manual verification

Use a character with animated hand IK.

1. Open Animation Editor.
2. Select an IK-enabled animation.
3. Open Bake panel.
4. Select hand IK.
5. Choose sampling FPS.
6. Preview bake.
7. Scrub through result.
8. Review generated-key summary.
9. Commit.
10. Inspect new bone tracks.
11. Play animation.
12. Undo.
13. Confirm original IK returns.

Repeat with leg IK where supported.

### 12. Do NOT implement

- Partial-range baking
- Automatic keyframe reduction
- IK solver configuration UI
- Mirrored IK baking
- Animation retargeting
- Physics

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

- React Bake panel exists
- Constraints can be selected
- Sampling options work
- Preview is non-destructive
- Artist sees affected bones and key counts
- Bake commits through existing API
- Undo restores original IK animation
- Timeline and playback update correctly
- No React/Phaser lifecycle leaks
- Required commands pass

## Final report

Provide:
1. React components added
2. Bake workflow
3. Preview behavior
4. Validation and summary
5. History integration
6. Files/APIs changed
7. Tests and manual verification
8. Command results
9. Deferred features

Do not claim completion unless all commands pass.
