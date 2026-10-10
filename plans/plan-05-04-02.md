# Paper Puppeteer Engine — v0.5.4.2
## Pose Mirroring Core

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.4.1**

Bone Symmetry Mapping is implemented.

The engine now has validated, bidirectional left/right bone mappings.

Do not rebuild the mapping system.

Technology stack:
- TypeScript
- Phaser
- React for editor UI
- Vite
- npm
- strict TypeScript
- ES modules

Keep mathematical pose operations pure and independent of React/Phaser where practical.

---

## Goal

Implement **v0.5.4.2 — Pose Mirroring Core**.

The engine must be able to generate a mirrored version of an evaluated pose using the established bone symmetry mapping.

This phase implements the mathematical and data-model foundation.

Do NOT write animation keyframes or build the final React UI yet.

## 1. Mirror directions

Support three conceptual operations:

```ts
type MirrorDirection =
  | "left-to-right"
  | "right-to-left"
  | "swap";
```

Semantics:

**Left-to-right**
- Read original left-side transforms
- Calculate corresponding right-side transforms
- Preserve left-side transforms

**Right-to-left**
- Reverse the direction

**Swap**
- Reflect left-side values onto right-side bones
- Reflect right-side values onto left-side bones
- Calculate both sides from the same original snapshot

Never let the first half of a swap overwrite data needed by the second half.

## 2. Reflection coordinate system

Define character mirroring relative to the rig's canonical facing and symmetry axis.

For an appropriate character-local vertical reflection:

```text
X → -X
Y →  Y
```

However, do NOT assume that simply negating every bone's local X and rotation is correct for all rigs.

Inspect existing:
- Bone local transforms
- Rest/bind pose
- Parent-child hierarchy
- Bone rotation conventions
- Scale conventions
- Facing/mirroring utilities

The reflection algorithm must respect the actual transform model.

## 3. Rest-pose-relative transforms

Prefer mirrored pose calculations relative to corresponding bones' bind/rest transforms.

For example:

```text
Left arm rest transform
+
Left arm animated change
↓
Mirror animated change
↓
Apply relative to right arm rest transform
```

This avoids incorrectly copying absolute left-side joint positions into the right-side skeleton.

Where world/character-space reflection and local-transform conversion are needed, reuse existing transformation utilities.

Do not derive local transforms from screen coordinates.

## 4. Supported transform properties

Support the bone-transform properties already understood by the animation evaluator.

Typical properties may include:

```text
x
y
rotation
scaleX
scaleY
```

Use actual existing schema types.

Respect rotation units and shortest-path rotation conventions.

Do not introduce negative scales merely to simulate sprite mirroring.

Handle supported nonuniform scales correctly where possible.

If a transform configuration cannot be mirrored reliably with the current representation, report that limitation instead of silently producing an invalid pose.

## 5. Hierarchical correctness

Test mirrored transforms for nested bones.

Example:

```text
leftUpperArm
  └── leftForearm
       └── leftHand

rightUpperArm
  └── rightForearm
       └── rightHand
```

Mirrored local transforms must produce anatomically corresponding motion on the other side.

Do not accidentally double-apply parent rotations or offsets.

## 6. Pure pose operation

Introduce an operation conceptually like:

```ts
mirrorPose(
  pose,
  rig,
  symmetryMapping,
  direction
): Pose
```

Adjust signature/naming to existing architecture.

Requirements:
- No mutation of source pose
- No mutation of rig
- No animation-definition mutations
- Deterministic output
- No event dispatch
- No gameplay side effects

## 7. Missing/unpaired bones

Leave unpaired bones unchanged.

Do not automatically modify centerline bones, root translation or puppet facing.

If a required mapped transform cannot be evaluated, return structured errors.

## 8. IK safety

Mirror authored pose transforms, not final IK-corrected results.

Preserve:

```text
authored pose
↓
mirror operation
↓
optional ordinary IK evaluation for preview
```

Do not bake IK into pose data.

Existing IK constraints must remain untouched.

## 9. Weapons and attachments

Do not mirror artwork or reassign attachments in this milestone.

Bones can move into mirrored poses while:
- Slots remain attached to their normal bones
- Attachment mappings stay unchanged
- Weapon ownership stays unchanged

Do not automatically move a weapon from one hand slot to another.

A separate future feature may explicitly handle mirrored attachment ownership.

## 10. Testing

Add tests for:
- Left-to-right pose mirroring
- Right-to-left
- Swap
- Rotation mirroring
- Local translation mirroring
- Supported scale behavior
- Parent/child hierarchy
- Nonzero rest rotations
- Nonzero rest offsets
- Unpaired bones
- Invalid mapping
- Input immutability
- Determinism
- Round-trip mirror consistency for supported symmetric rigs

Compare expected transforms and world-space results with floating-point tolerance.

## 11. Do NOT implement

- Keyframe creation
- Mirrored animation tracks
- Timeline selection operations
- React mirror toolbar
- Automatic IK target mirroring
- Attachment/weapon hand switching
- Sprite mirroring
- Joint position editing

## 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix every failure.

## Definition of done

- Pure pose mirroring exists
- Three directions are supported
- Rig hierarchy/rest pose conventions are respected
- Mirrored local transforms are correct for supported configurations
- Unpaired bones are unchanged
- Authored data remains immutable
- No IK output is baked
- Tests, typecheck and build pass

## Final report

Describe:
1. Mirror math and coordinate conventions
2. Rest-pose handling
3. Hierarchical transform behavior
4. Supported/unsupported cases
5. Files and APIs changed
6. Tests
7. Verification results
8. Deferred functionality

Do not claim completion unless all required commands pass.
