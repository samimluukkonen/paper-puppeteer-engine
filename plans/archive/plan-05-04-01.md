# Paper Puppeteer Engine — v0.5.4.1
## Bone Symmetry Mapping

You are continuing development of my standalone Paper Puppeteer Engine.

**Current completed version: v0.5.3.4**

The engine already supports:
- Hierarchical skeletons, bones and joints
- Slots, attachments and skins
- Two-bone IK and weapon constraints
- Visual Rig Editor
- Visual Animation Editor
- Keyframe authoring and advanced timeline editing
- Animation events and interpolation
- Undo/Redo
- Animation JSON import/export
- Onion skinning and ghost poses

### Technology stack

- TypeScript (strict)
- Phaser
- React for editor UI
- Vite
- npm
- ES modules

Reuse existing React components, hooks, state management and editor conventions.

Keep core rig/animation math independent of React and Phaser wherever practical.

Do not introduce unnecessary dependencies.

---

## Goal

Implement **v0.5.4.1 — Bone Symmetry Mapping**.

Establish a reliable way to identify which bones correspond to each other across the character's left and right sides.

Examples:

```text
leftUpperArm    ↔ rightUpperArm
leftForearm     ↔ rightForearm
leftHand        ↔ rightHand

leftThigh       ↔ rightThigh
leftShin        ↔ rightShin
leftFoot        ↔ rightFoot
```

This milestone introduces the mapping architecture only.

Do NOT implement actual pose or keyframe mirroring yet.

## 1. Symmetry mapping model

Introduce a strictly typed, editor-side symmetry mapping model.

Conceptually:

```ts
interface BoneSymmetryPair {
  leftBoneId: string;
  rightBoneId: string;
}

interface BoneSymmetryMapping {
  pairs: BoneSymmetryPair[];
}
```

Adapt to existing architecture.

Provide efficient helpers such as:

```ts
getMirroredBoneId(
  boneId: string
): string | null;
```

The mapping must be bidirectional.

Do not create an inconsistent second mapping for the opposite direction.

## 2. Automatic bone pairing

Implement optional automatic matching based on conventional names.

Recognize patterns where unambiguous, such as:

```text
leftArm   ↔ rightArm
LeftArm   ↔ RightArm
arm_L     ↔ arm_R
arm.left  ↔ arm.right
L_Arm     ↔ R_Arm
```

Use token-aware matching rather than unsafe substring replacement.

Do not accidentally transform unrelated names.

Automatic pairing should produce candidate mappings.

Do not silently accept ambiguous pairs.

## 3. Manual mapping support

The model must allow manually defining or overriding left/right pairs.

Not every artist uses consistent bone names.

The feature must work with arbitrary bone IDs.

Manual mapping should take precedence over automatically inferred candidates.

A full visual mapping panel belongs to v0.5.4.4.

## 4. Validation

Validate mappings against the current rig.

Detect:
- Missing bone references
- Duplicate pair assignments
- A bone paired with itself
- A bone assigned to several partners
- Ambiguous automatic matches
- Invalid reciprocal mappings
- Incompatible hierarchy relationships relevant to future mirroring

Provide structured validation messages.

Do not reject every asymmetrical rig automatically, but report potential compatibility problems.

## 5. Unpaired bones

Support unpaired bones.

Examples:

```text
root
pelvis
torso
head
```

These should remain unchanged by default.

Do not automatically mirror root translation or character facing.

Later milestones may introduce explicit centerline-bone behavior, but keep the initial policy conservative.

## 6. Rig independence

Symmetry mapping describes bone relationships, not artwork relationships.

Do not modify:
- Bone names/IDs
- Joint positions
- Rig hierarchy
- Sprite origins
- Slot assignments
- Attachments
- Skins

Do not confuse bone symmetry with sprite flipping.

## 7. Mapping lifecycle

A mapping must be associated with the appropriate rig.

Prevent accidentally applying a mapping from one rig to an unrelated rig.

Keep the mapping independent from animation JSON.

Do not change the production runtime or external rig schema merely to store editor mapping metadata.

Prepare the mapping for optional editor-side persistence in a later phase.

## 8. Pure helper APIs

Keep mapping creation, lookup and validation testable without React, DOM or Phaser.

Use existing project utilities where possible.

Avoid `any`, global mutable state and unnecessary abstraction.

## 9. Tests

Add tests for:
- Automatic name matching
- Manual pair overrides
- Bidirectional lookup
- Missing bones
- Duplicate mappings
- Ambiguous names
- Unpaired bones
- Incompatible mappings
- Deterministic results
- Existing rig remains unchanged
- Existing animation remains unchanged

## 10. Do NOT implement

- Mirrored pose calculations
- Mirrored keyframe creation
- Timeline mirror operations
- React mirror toolbar
- Sprite flipping
- Rig joint modifications
- Mirrored IK targets
- IK baking

## 11. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

- Validated left/right bone mapping exists
- Automatic pairing works for supported naming conventions
- Manual overrides are supported by the model
- Bidirectional lookup works
- Ambiguous/invalid mappings are reported
- Unpaired bones are safe
- Runtime and animation data remain unchanged
- Tests, typecheck and build pass

## Final report

Report:
1. Implemented functionality
2. Symmetry mapping architecture
3. Automatic pairing rules
4. Validation rules
5. Files and APIs changed
6. Tests
7. Required command results
8. Deferred features

Do not claim completion unless all required commands pass.
