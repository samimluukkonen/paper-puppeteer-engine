# Paper Puppeteer Engine — v0.5.6.3
## Atomic IK Bake & Constraint Deactivation

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.6.2**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

Already implemented:
- Read-only IK pose sampling
- Bone keyframe generation
- Bake planning and fidelity comparison
- Existing animation mutation APIs
- Working-copy isolation
- Undo/Redo
- Validation and serialization

Do NOT rebuild these systems.

## Goal

Implement a complete, atomic authored IK baking operation.

The operation must:
1. Validate a bake plan
2. Write generated bone keys
3. Prevent the baked IK constraint from being reapplied during playback of the resulting animation
4. Preserve unrelated animation data
5. Support exact Undo/Redo

### 1. Critical constraint deactivation

Baking is NOT complete if the IK solver continues modifying the same baked limb during playback.

For this initial version, bake the entire selected animation clip.

After baking, selected IK constraints must no longer override the generated bone motion for that animation.

Do not globally disable or delete rig constraints.

Other animations must continue using the rig's IK normally.

Inspect the existing runtime and animation schema for a suitable per-animation constraint override.

If none exists, add the smallest backward-compatible representation required.

Preserve old animation behavior when the new field is absent.

### 2. Avoid double IK

Before commit:

```text
Authored bone pose
      ↓
Animated IK
      ↓
Final pose
```

After bake:

```text
Baked bone keyframes
      ↓
Selected IK constraint skipped
      ↓
Final pose
```

Unrelated IK constraints must continue to work according to existing precedence.

### 3. Atomic commit

Create a centralized operation conceptually like:

```ts
commitIKBake(
  workingAnimation,
  bakePlan
): BakeCommitResult
```

Use existing controller/history patterns.

If validation fails, change nothing.

Do not partially create keys or disable constraints.

### 4. Existing bone keys

For the full-clip bake, replace authored keys only on properties explicitly produced by the bake plan.

Preserve:
- Unaffected bones
- Unaffected properties
- Animation events
- Duration
- FPS
- Unrelated IK tracks/constraints
- Other animation metadata

Do not merge old and baked keys into conflicting duplicate-time data.

Use existing sorting and normalization rules.

### 5. Baked IK tracks

Preserve original authored IK information in the Undo snapshot.

Committed output must clearly indicate the selected constraints are deactivated for that animation.

Avoid leaving misleading active target animation that silently competes with baked bone keys.

Do not mutate the global rig to achieve this.

### 6. Undo/Redo

One bake operation must create ONE history entry.

Example:

```text
Bake IK
    ↓
Bone keys created
IK disabled for this animation
    ↓
Undo
    ↓
Original bone keys restored
Original IK animation restored
Original constraint behavior restored
```

Redo must restore the exact baked result.

### 7. Dirty state

Commit:
- Marks animation dirty

Preview:
- Does not mark dirty

Undo to baseline:
- Follows existing clean-checkpoint semantics

### 8. Validation and export

The baked animation must pass existing validation.

Update serializer, parser and version handling if the constraint-override format changed.

Ensure the exported animation contains all data needed to preserve baked behavior in production runtime.

No editor-only flags should be required during playback.

### 9. Tests

Cover:
- Atomic successful bake
- Atomic failure
- Correct keys created
- Existing keys replaced appropriately
- Selected constraint deactivated
- Unrelated IK constraints unaffected
- Other animations unaffected
- Undo restores original data
- Redo restores baked data
- No double IK
- Runtime playback after bake
- Serialization round-trip
- Source animation immutability

### 10. Do NOT implement

- React Bake UI
- Partial-range baking
- Automatic key reduction
- Editing rig constraints
- New IK algorithms
- Physics

### 11. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

- Bake plan commits atomically
- Correct bone keys are authored
- Baked IK does not run again over the same motion
- Unrelated constraints remain intact
- One Undo restores original animation exactly
- Redo works
- Exported result preserves intended runtime behavior
- Required commands pass

## Final report

Describe:
1. Commit architecture
2. Constraint deactivation mechanism
3. Backward compatibility
4. Key replacement policy
5. History behavior
6. Files/APIs changed
7. Tests and verification
8. Deferred work

Do not claim completion unless all commands pass.
