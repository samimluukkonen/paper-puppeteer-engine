# Paper Puppeteer Engine — v1.5.2
## Rig Compatibility & Bone Mapping

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.5.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing engine systems:
- Hierarchical rig definitions
- Stable bone IDs
- FK and IK
- Bone rest/bind poses
- Root motion
- Foot contact markers
- Rigid and mesh attachments
- Deformation animation
- Animation Library
- Project dependency validation

## Goal

Create the compatibility and bone-mapping foundation needed to reuse animations between different character rigs.

Example:

A sword-cut animation authored for one samurai should be transferable to another samurai with a similar skeleton, even if the rigs have different bone IDs or proportions.

This milestone does NOT perform animation retargeting yet.

## 1. Inspect rig architecture

Identify:
- Bone hierarchy and IDs
- Bone local transforms
- Rest/bind pose
- Coordinate systems
- Bone length/orientation
- FK/IK chain definitions
- Facing and mirroring
- Skin/mesh bindings
- Animation track references

Do not assume every rig has humanoid anatomy.

## 2. Rig compatibility analysis

Create a pure comparison service.

Conceptually:

```ts
analyzeRigCompatibility(
  sourceRig,
  targetRig
): RigCompatibilityReport
```

Use actual project types.

Report:
- Matching bones
- Missing bones
- Extra bones
- Different parent hierarchies
- Rest-pose differences
- Orientation differences
- Proportion differences
- Missing IK chains
- Mesh/deformation incompatibilities

Compatibility must be grounded in actual rig structure, not merely matching display names.

## 3. Compatibility levels

Distinguish useful cases:

**Exact / shared rig**
- Same compatible rig identity and structure.
- Animation can usually be reused directly.

**Mappable rig**
- Different rig but a valid explicit bone correspondence exists.
- Retargeting may be possible.

**Partially compatible**
- Some tracks can be transferred; others require skipping or manual correction.

**Incompatible**
- Critical structure cannot be mapped safely.

Use clear diagnostics.

Do not claim two rigs are compatible solely because they both resemble humanoids.

## 4. Bone mapping model

Introduce reusable mappings between a source rig and a target rig.

Conceptually:

```ts
interface BoneMappingEntry {
  sourceBoneId: string;
  targetBoneId: string;
}

interface RigBoneMapping {
  sourceRigId: string;
  targetRigId: string;
  entries: BoneMappingEntry[];
}
```

Adapt to actual schemas.

Use stable identities and include compatibility/version information as appropriate.

Do not rely on display names as persistent identifiers.

## 5. Automatic mapping suggestions

Suggest likely matches using existing:
- Bone names
- Parent relationships
- Hierarchy position
- Optional semantic metadata

Treat suggestions as proposals.

Do not silently apply ambiguous mappings.

Require confirmation when different plausible matches exist.

## 6. Mapping editor

Add a compact React comparison UI.

Example:

SOURCE BONE       TARGET BONE

pelvis            pelvis
upper_arm_L       leftUpperArm
forearm_L         leftForearm
hand_L            leftHand

[Auto Suggest] [Validate] [Save Mapping]

Support:
- Choosing source and target rigs
- Reviewing suggested correspondences
- Editing mappings
- Removing mappings
- Highlighting missing/ambiguous bones
- Saving a validated mapping

Reuse existing rig-selection components.

## 7. Mapping validity

Validate:
- Existing source/target bone IDs
- No unintended duplicate target mappings
- Parent-child consistency
- Hierarchy compatibility
- Unsupported chain structure
- Stale rig revisions

If a source or target rig changes, revalidate saved mappings.

Do not silently use outdated maps.

## 8. IK and mesh compatibility

Analyze IK constraints separately from ordinary bone correspondence.

A target character may have:
- Different IK chain lengths
- Different IK constraint IDs
- Missing targets
- Different foot contact markers

Do not assume mapping bones automatically maps every IK track.

For v1.4 mesh deformation:
- Bone mapping is not equivalent to vertex mapping.
- Different mesh topology cannot safely share vertex correction tracks.
- Report unsupported deformation-track transfer explicitly.

## 9. Persistence

Store approved rig mappings as project authoring metadata/assets.

Mappings must:
- Be reusable
- Survive autosave
- Survive export/import
- Reference stable rig identities
- Avoid storing mutable editor objects

## 10. Tests

Cover:
- Identical rigs
- Equivalent rigs with different IDs
- Different proportions
- Missing bones
- Extra bones
- Hierarchy mismatch
- Ambiguous matches
- IK differences
- Mesh topology mismatch
- Stale mapping
- Mapping serialization
- Backward compatibility

## 11. Out of scope

Do not:
- Transform animation keys
- Implement automatic retargeting
- Rewrite rigs
- Modify bone rest poses
- Regenerate IK constraints
- Retarget deformable meshes
- Introduce humanoid-only assumptions

## 12. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Use actual repository scripts and fix failures.

## Definition of done

The engine can compare two rigs, propose and validate bone mappings, and report whether animation retargeting is possible or partially supported.

## Final report

Describe compatibility rules, bone mapping, UI, persistence, unsupported cases, files changed, tests and exact results.
