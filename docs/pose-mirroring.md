# Pose mirroring core

[All guides](../README.md#guides)

Milestone v0.5.4.2, package version `0.5.4-2`, adds pure authored-pose reflection using the established [bone symmetry mapping](bone-symmetry-mapping.md). It adds no keyframes, editor UI or runtime effects.

## API and ownership

[poseMirroring.ts](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/src/devtools/shared/poseMirroring.ts) exports `MirrorDirection`, `PoseMirrorIssueCode`, `PoseMirrorIssue`, `PoseMirrorResult` and `mirrorPose(pose, rig, mapping, direction)`. It uses existing `AnimationPose` and `JointTransform` types, accepts a readonly map of complete or sparse local transforms and depends on no React, Phaser or DOM runtime. The API stays beside the editor-only mapping; package engine exports and external schemas are unchanged. In v0.5.4.3, the optional fifth argument `{ sourceBoneIds }` scopes reflection to specified sources; invalid/unpaired/wrong-side sources produce `invalid-source` errors. Full mapping validation still applies.

```ts
import { getEvaluatedAnimationPose } from '../src/devtools/animation-editor/animationValues.js';
import { mirrorPose } from '../src/devtools/shared/poseMirroring.js';

const authored = getEvaluatedAnimationPose(animation, rig, timeMs);
const result = mirrorPose(authored, rig, mapping, 'swap');
if (result.success) {
  const mirrored = result.pose;
  // Consume this detached snapshot in a future preview or authoring operation.
} else {
  // Present result.issues. result.pose is null; no partial result is exposed.
}
```

Left-to-right reads the original left bones and replaces only corresponding right entries; right-to-left reverses this. Swap calculates both directions from the same original map. Missing source entries/properties resolve from the rig bind pose, as they do during ordinary animation evaluation. Every mirrored destination receives all five transform properties. Original source and unpaired entries retain their values and sparse shape, including root transforms. The output map and every transform object are detached, so editing the result cannot modify input or evaluator caches. No input is mutated or frozen, and no state notification or animation event is dispatched.

## Coordinate and bind conventions

The engine stores absolute local `x`, `y`, rotation in radians and unitless `scaleX`, `scaleY`. Joint matrices follow `T(x, y) R(rotation) diag(scaleX, scaleY)`. Shared [affineMath.ts](../src/engine/affineMath.ts) conversion and composition now also serve the renderer; inverse conversion reuses `worldToLocal`.

Reflection is `F = diag(-1, 1)` in canonical character bind space: X changes sign and Y is preserved. Puppet placement, camera/screen coordinates and the outer facing container never enter the calculation. The axis is defined by the bind pose and follows preserved centerline animation; an animated torso/root rotation or translation is carried normally rather than being copied into each limb's mirrored delta.

Bind transforms come from the validated `Rig`, including its resolved child offsets when a parent defines an explicit bone length. Each destination keeps its own rest offset and rest axes, so asymmetric offsets, bone lengths and rest rotations are preserved.

For a source/destination pair, let `Bs` and `Bt` be their parent bind matrices' linear parts in character space. Let `Ls`, `Ls0` and `Lt0` be source pose, source bind and target bind local linear matrices. Then:

```text
C = inverse(Bt) F Bs
translationTarget = translationTargetBind + C (translationSource - translationSourceBind)
Delta = Ls inverse(Ls0)
linearTarget = C Delta inverse(C) Lt0
```

Only animated translation changes are reflected. Parent-frame translations are deliberately excluded from `C`: joint offsets already belong to the corresponding target rest position. Linear conjugation reflects the source's animated rotation/scale change before applying it to the destination bind axes. Nonzero rest rotations and differing parent frames therefore affect the calculation; simply negating local X and rotation would be incorrect for general rigs.

On a symmetric aligned rig, the formulas reduce to reflected translation deltas, negated rotation deltas and per-axis scale ratios applied to the destination rest scales. Rotations use the evaluator's shortest-path delta around the target bind rotation, including its negative half-turn tie. Whole-turn counts are not retained; round trips preserve equivalent orientations.

## Hierarchy and supported transforms

The existing mapping validator remains authoritative. Structural validation must pass for this exact rig instance. Parents must be mapped counterparts or the same unpaired parent; existing `ancestor-pair` and `parent-mismatch` mapping warnings become errors for this operation. Root/descendant pairing consequently fails. Mapping data and its original warning policy are unchanged.

Bind matrices are composed parent-first. Every destination local change is calculated independently from the original snapshot and bind parent frames. Normal hierarchy composition then applies parent motion once. The algorithm does not derive child transforms from already mirrored world poses. Symmetric nested rigs reproduce reflected world joint positions and axes even when ancestor composition contains shear from nonuniform scales.

Supported configurations include finite translations/rotations, nonzero uniform scales, representable nonuniform scales, and existing negative bind axes whose animated signs stay unchanged. Target axis signs always come from the target bind pose; reflection never introduces a negative scale to flip artwork. Different rest frames can exchange scale axes. Nonuniform changes in oblique or differently scaled frames may require local shear, which the five-property joint representation cannot store. Such configurations fail instead of approximating an invalid pose.

## Structured limitations

Diagnostics include stable `code`, `severity: 'error'`, `message` and `boneIds`; mapping diagnostics also retain their paths and pair indexes. Failures return `success: false`, `pose: null` and frozen issues, even if another pair or the first half of a swap could succeed.

| Code                    | Meaning                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Existing symmetry codes | Mapping validation failure or incompatible parent/ancestor relationships.                                                          |
| `invalid-direction`     | An untyped caller supplied an unknown operation.                                                                                   |
| `invalid-transform`     | A required source transform contains a nonfinite or undefined property.                                                            |
| `singular-transform`    | A mapped bind scale is zero, a required bind frame is noninvertible/unreliable, or reflected axes collapse at available precision. |
| `unsupported-scale`     | A source scale collapses to zero or changes sign relative to its bind axis.                                                        |
| `unsupported-shear`     | Destination local axes cannot be represented by one rotation and two signed scales.                                                |
| `non-finite-result`     | Finite input calculations exceed available numeric precision/range.                                                                |

Inversion uses the existing axis-relative determinant tolerance of `1e-12`; decomposition checks normalized axis orthogonality with tolerance `1e-9`. Unread/unpaired pose values are retained unchanged. Compatibility is checked for the requested direction, so a bad original destination value can be replaced by a valid source in a one-way operation, while swap also validates it as a source.

## IK, appearance and deferred work

Pass authored poses from `getEvaluatedAnimationPose` or pure clip evaluation before ordinary IK. The operation does not inspect live Puppet joints or run IK, and a plain pose map carries no provenance that could identify already corrected values. Callers must supply the authored snapshot. Optional preview IK runs afterwards using the existing constraints without changing this output.

Slots remain attached to their normal bones, attachments and skins retain their assignments, and weapons retain their hand ownership. Bone motion does not mirror artwork. Root translation, centerline bones and facing are preserved.

[Mirrored keyframe authoring](mirrored-keyframe-authoring.md) now provides explicit current-pose and selected-key commands. [React mapping/mirror controls](react-mirroring-tools.md) and the [hardening regression](mirroring-hardening-verification.md) are complete. Automatic IK target mirroring, IK baking, sprite flipping, attachment/weapon hand switching and joint position editing remain deferred.

## Verification

[poseMirroring.test.ts](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/tests/poseMirroring.test.ts) covers all three directions, snapshot swap, sparse/bind fallback, shortest-path rotations, rest offsets and rotations, scale ratios and axis exchange, existing signed bind axes, nested world positions and axes, explicit bone lengths, preserved centerline motion, invalid mappings, hierarchy limitations, nonfinite/singular/overflow inputs, unsupported shear/sign changes, input/output ownership, determinism, pair order, round trips and shipped animation sampling before IK. Comparisons use floating-point tolerances.

Verification on October 11, 2026:

- `npm run typecheck`: passed.
- `npm run test`: passed; 1,579 tests passed and 28 optional profiling tests skipped, across 98 passing and 3 skipped files. This milestone adds 37 pose mirroring tests.
- `npm run build`: passed, including demo/library output, declarations and the plain Node `/core` check.
- `npm run format:check`, `npm run lint`, `npm run check:version` and `git diff --check`: passed.

The first full-suite run hit the existing sketch rear-grip test's five-second timeout, previously recorded in the mapping milestone. The subsequent standalone full-suite run passed without changing its timeout or test.

Browser checks are unnecessary for this mathematical milestone and remain local-only by repository policy.
