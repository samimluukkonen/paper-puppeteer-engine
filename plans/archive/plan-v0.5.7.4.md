# Paper Puppeteer Engine — v0.5.7.4
## Bulk Keyframe Retiming

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.7.3**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

Existing systems include:
- Keyframe multi-selection
- Marquee and range selection
- Group movement
- Copy/paste and duplication
- Undo/Redo
- Animation validation
- Timeline snapping
- IK target keyframes
- Interpolation editing

Do not replace these systems.

## Goal

Implement **v0.5.7.4 — Bulk Keyframe Retiming**.

Allow the artist to proportionally compress or expand the timing of selected keyframes.

Example:

```text
Original key times:
0.0, 0.5, 1.0

Time scale 0.5:
0.0, 0.25, 0.5

Time scale 1.5:
0.0, 0.75, 1.5
```

Do not alter authored transform values.

### 1. Pure retiming operation

Create a reusable, testable API conceptually like:

```ts
retimeSelectedKeys(
  animation,
  selectedKeys,
  options
): RetimeResult
```

Reuse existing keyframe references, mutation helpers, collision policy and validation.

Do not implement retiming through raw DOM array modifications.

### 2. Scale factor

Support a positive time-scaling factor.

Examples:
- 0.5x
- 0.75x
- 1.25x
- 1.5x
- 2x

Reject zero, negative, NaN and Infinity.

Reversing animation order is out of scope.

### 3. Anchor

Support:
- Earliest selected key
- Current playhead time

Retiming formula conceptually:

```ts
newTime =
  anchorTime + (oldTime - anchorTime) * scale;
```

Use the existing time normalization/tolerance conventions.

Do not alter underlying animation FPS.

### 4. Preserve authored values

Retiming changes key times only.

Preserve:
- Transform values
- Bone/property identity
- Interpolation metadata
- IK key values where supported
- Other unrelated animation data

Do not recompute values from the evaluated puppet pose.

### 5. Property and track support

Use the established typed keyframe selection model.

Support ordinary bone-transform keys.

Support IK target/influence keys where the generic mutation infrastructure can do so safely.

Do not silently treat IK target keys as normal bone keys.

For the initial implementation, animation events may remain excluded from bulk retiming. If so, clearly show that they are unaffected.

Do not accidentally shift event markers.

### 6. Duration policy

Do not silently expand animation duration.

For this initial version, if the proposed retiming places keys outside valid animation bounds, reject the entire operation with a useful explanation.

Avoid per-key clamping because it destroys relative timing.

### 7. Collision policy

The operation must be atomic.

Check the complete proposed destination before committing.

Do not treat keys' own original positions as external collisions.

Use established collision rules for unselected destination keys.

If the operation is invalid:
- Commit nothing
- Keep working animation unchanged
- Create no history entry

### 8. Snapping

Keep time scaling mathematically consistent.

Do not individually snap every resulting key by default, since that would distort proportional timing.

Optional snapping may be added only if a clear, documented group-retiming policy preserves the intended result.

### 9. React retiming panel

Add a compact UI for selected keyframes.

Example:

```text
RETIME SELECTED KEYS

Selected keys: 12

Scale: [ 0.75x ]

Anchor:
(o) First selected time
( ) Playhead

[ Preview ] [ Apply ]
```

Use actual selection counts.

### 10. Non-destructive preview

Prefer showing the proposed key positions before commit.

Preview must not:
- Modify authored data
- Dirty the animation
- Add Undo history
- Dispatch events

Use existing transient drag/preview conventions where possible.

If a full marker preview adds substantial complexity, a numerical before/after preview is acceptable.

### 11. Undo/Redo

One retiming operation must create ONE Undo history entry.

Undo must restore exact original key times.

Redo must reproduce the retimed result.

### 12. Selection

After commit:
- Updated keys remain selected
- Primary selection remains coherent
- Timeline markers refresh
- Preview re-evaluates

Do not leave dangling references to old key times.

### 13. Tests

Test:
- Compression
- Expansion
- Earliest-key anchor
- Playhead anchor
- Multiple tracks
- IK keys where supported
- Zero-length time span
- Invalid factor
- Bounds rejection
- Collision atomicity
- Interpolation preservation
- Selection reconciliation
- Undo/Redo
- Source immutability

### 14. Manual verification

Create/select several keys across multiple bone tracks.

1. Compress to 0.5x.
2. Undo.
3. Expand to 1.5x.
4. Test playhead anchor.
5. Test a destination collision.
6. Test duration overflow.
7. Confirm rejected operations change nothing.
8. Preview resulting animation.
9. Test Undo/Redo.
10. Verify animation events remain unaffected under the chosen policy.

### 15. Do NOT implement

- Reverse-time keyframes
- Adaptive keyframe reduction
- Automatic easing changes
- Automatic event retiming
- Motion-path editing
- New IK solvers
- Scene choreography

### 16. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Selected keys can be proportionally retimed
- Compression and expansion work
- Anchoring works
- Values/interpolation remain unchanged
- Existing collision policy remains valid
- Invalid operations are atomic failures
- One Undo restores the original timing
- Selection stays coherent
- Playback and JSON export remain compatible
- Tests, typecheck and build pass

## Final report

Provide:
1. Retiming algorithm
2. React UI workflow
3. Supported keyframe types
4. Anchor and duration policies
5. Collision/atomicity behavior
6. Files/APIs changed
7. Tests
8. Manual verification
9. Exact command results
10. Deferred features

Do not claim completion unless all commands pass.
