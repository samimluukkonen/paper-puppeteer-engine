# Paper Puppeteer Engine — v1.5.3.1
## Animation Retargeting Engine

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.5.2**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Implemented:
- Animation Library
- Rig compatibility analysis
- Bone mapping
- FK/IK animation
- Root motion
- Animation interpolation and curves
- Mesh deformation and corrective keys
- Animation import/export

## Goal

Implement an animation retargeting service that transfers compatible motion from one character rig to another.

For example, a sword-cut animation can be adapted from one samurai character to another with different body proportions.

The original animation and both rigs must remain unchanged.

This phase focuses on retargeting math, data conversion and validation.

The visual workflow comes in v1.5.3.2.

## 1. Inspect animation representation

Review:
- FK animation tracks
- Bone local transforms
- Source/target rest poses
- Rotation conventions
- Translation and scale channels
- Interpolation curves
- IK target animation
- Root motion
- Facing/mirroring
- Animation events
- Mesh deformation tracks

Reuse the existing evaluator and keyframe formats.

## 2. Retargeting API

Implement a pure or isolated service equivalent to:

```ts
retargetAnimation({
  sourceAnimation,
  sourceRig,
  targetRig,
  boneMapping,
  options
}): RetargetResult
```

Use actual project types.

The result should contain:
- A new target-compatible animation
- Diagnostics
- Skipped or unsupported tracks
- Compatibility warnings

Do not register/save the result automatically.

## 3. Rotation retargeting

Retarget rotation relative to the source rest pose.

Account for target rest-pose orientation.

Do not blindly copy absolute local rotation values when source and target bones have different bind orientations.

Preserve intended angular interpolation and explicit multi-turn semantics where supported.

Test facing and mirror behavior carefully.

## 4. Translation retargeting

Handle translation based on the semantics of each bone track.

Distinguish:
- Local skeletal translation
- Pelvis movement
- Root-motion Actor displacement
- IK target position

Do not apply one generic scale ratio to every animated channel.

Where proportional scaling is needed, derive it from validated source/target rig geometry.

Avoid dividing by zero-length bones.

Use documented handling for unusually different proportions.

## 5. Keyframe interpolation

Preserve:
- Key times
- Supported interpolation types
- Bézier data
- Step transitions
- Animation duration

Where transform conversion requires evaluating or resampling a curve, document numerical tolerances and use the existing evaluator.

Do not silently flatten all interpolation to linear.

## 6. IK policy

IK retargeting requires special care.

Support an explicit conservative policy:

**FK-only transfer**
- Transfer compatible FK motion.
- Do not transfer unsupported IK target tracks.
- Report omitted IK data.

Optionally support mapped IK targets when:
- Source/target chains are valid
- Constraint semantics match
- Target-space conversion is well-defined

Do not silently preserve source-rig-specific IK target IDs.

Do not claim exact foot planting on differently proportioned rigs.

## 7. Root motion

Retarget root motion separately from skeletal translation.

Provide an explicit policy, such as:
- Preserve source displacement values
- Scale displacement using a defined character-size ratio
- Omit root motion

Use one selected policy per retargeting operation.

Never double-apply pelvis movement or root displacement.

## 8. Mesh deformation tracks

v1.4 supports corrective mesh deformation keys.

These are potentially tied to source mesh vertex IDs and bind geometry.

Do NOT blindly transfer corrective vertex keys to another rig.

Initially:
- Preserve only when the target uses a verified compatible mesh identity/topology and coordinate basis.
- Otherwise omit with a clear diagnostic.

Bone-weighted target mesh deformation will still work through the target's own skinning setup.

## 9. Animation metadata and events

Preserve compatible:
- Duration
- Events/cues
- Playback settings
- Authored animation metadata

Do not remap application-specific event payloads unless there is a defined mapping policy.

Flag references that remain source-specific.

## 10. Immutability

Never mutate:
- Source animation
- Source rig
- Target rig
- Saved bone mapping

Return a new independently editable animation.

## 11. Determinism

Retargeting the same input with the same options must produce equivalent animation content, excluding intentionally assigned new asset IDs.

Use stable ordering and deterministic math.

## 12. Tests

Cover:
- Identical rigs
- Different IDs
- Different bone orientations
- Different proportions
- Parent/child transforms
- Rotation wrap
- Translation scaling
- IK omission/mapping
- Root motion
- Mesh correction omission
- Animation events
- Interpolation fidelity
- Missing bones
- Source immutability
- Serialization
- Deterministic output

## 13. Out of scope

Do not implement:
- Visual preview UI
- Automatic skeleton rebuilding
- AI motion transfer
- Mesh topology retargeting
- Physics correction
- Automatic foot locking
- General motion matching

## 14. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

The engine can create a new animation for a compatible target rig using explicit bone mapping and documented retargeting policies, without changing the source or silently transferring incompatible data.

## Final report

Explain math, coordinate spaces, translation/rotation policies, IK handling, root motion, mesh limitations, files changed, tests and exact results.
