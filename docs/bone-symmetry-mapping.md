# Bone symmetry mapping

[All guides](../README.md#guides)

Milestone v0.5.4.1, package version `0.5.4-1`, introduces editor-only bone relationships. It provides automatic pairing candidates, manual overrides, bidirectional lookup and structured validation. It does not calculate mirrored poses or write keyframes.

## Architecture and APIs

The pure [boneSymmetry.ts](../src/devtools/shared/boneSymmetry.ts) module uses the existing renderer-independent `Rig`, immutable editor data helpers and readonly map utility. It requires no React, DOM or Phaser runtime and adds no dependencies or public engine exports.

- `BoneSymmetryPair` contains `leftBoneId` and `rightBoneId`.
- `BoneSymmetryMappingData` contains readonly `pairs`, ready for future editor-side persistence.
- `BoneSymmetryMapping` adds the associated `rig`, sorted `unpairedBoneIds` and `getMirroredBoneId(boneId): string | null`.
- `inferBoneSymmetryPairs(rig, manualPairs?)` returns frozen candidate pairs and diagnostics; it never installs them.
- `createBoneSymmetryMapping(rig, { manualPairs?, automaticCandidates? })` returns a discriminated success/failure result, a mapping on success, and diagnostics in both cases. Automatic pairing is optional; the default mapping is empty.
- `validateBoneSymmetryMapping(rig, dataOrMapping)` returns frozen structured diagnostics without changing its inputs.

Construction owns and freezes pair copies. A single private readonly index contains both directions derived from the same validated pairs. Lookup is constant-time and returns `null` for unpaired and unknown bones. Unpaired bones include ordinary centerline IDs such as `root`, `pelvis`, `torso` and `head`; the mapping makes no changes to root translation or facing.

Manual pairs reserve both of their bone IDs. When explicitly accepting automatic candidates, construction removes every candidate touching a manually reserved ID. Manual pairs may use any IDs accepted by the existing rig validator, regardless of their naming convention. Conflicting manual assignments fail validation rather than overwriting each other.

```ts
import {
  createBoneSymmetryMapping,
  inferBoneSymmetryPairs,
} from '../src/devtools/shared/boneSymmetry.js';

const manualPairs = [{ leftBoneId: 'artistArm17', rightBoneId: 'artistArm28' }];
const candidates = inferBoneSymmetryPairs(rig, manualPairs);
// Present candidates.issues to the caller; ambiguous groups have no proposed pair.
// Accept the remaining candidates explicitly when appropriate for the editor workflow.
const result = createBoneSymmetryMapping(rig, {
  manualPairs,
  automaticCandidates: candidates.pairs,
});
if (result.success) {
  result.mapping.getMirroredBoneId('artistArm17'); // 'artistArm28'
  result.mapping.getMirroredBoneId('artistArm28'); // 'artistArm17'
  state.setSymmetryMapping(result.mapping);
}
// Present result.issues too, including advisory hierarchy compatibility warnings.
```

## Automatic pairing rules

Inference tokenizes IDs at camel/Pascal-case boundaries and underscore, dot, hyphen or whitespace separators. Full `left` / `right` tokens are case-insensitive; single-letter side tokens are uppercase `L` / `R`. Non-side tokens compare case-insensitively. Exactly one side token and at least one other token are required, and side position and remaining tokens must correspond.

Supported examples:

| Left           | Right           |
| -------------- | --------------- |
| `leftArm`      | `rightArm`      |
| `LeftArm`      | `RightArm`      |
| `arm_L`        | `arm_R`         |
| `arm.left`     | `arm.right`     |
| `L_Arm`        | `R_Arm`         |
| `upperLeftArm` | `upperRightArm` |

`brightArm`, `Leftover` and lowercase `leftarm` have no full side token and remain unpaired. Bare `left` / `right` IDs and names without a counterpart also remain unpaired. Multiple side tokens, such as `leftArm_R`, produce an `ambiguous-name` warning. Case/delimiter aliases can create several possible partners, for example `leftArm`, `rightArm` and `RightArm`; inference reports `ambiguous-match` and excludes the entire ambiguous group. Passing a manual pair to inference reserves its IDs before grouping, allowing manual resolution of that ambiguity.

Candidate pairs, unpaired IDs and inference diagnostics have deterministic order independent of rig bone ordering. Manual and explicitly supplied candidate order is retained during construction so validation pair indexes identify the supplied entries.

## Validation

`BoneSymmetryIssue` extends the existing validation issue shape with a stable `code`, `boneIds` and optional `pairIndex`. Pair diagnostics include a `pairs[index]` path. Inference warnings stay with the candidate result; construction diagnostics describe the accepted pairs.

| Code                 | Severity | Meaning                                                                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `rig-mismatch`       | Error    | A bound mapping belongs to another rig session, or the editor has no rig.                                               |
| `missing-bone`       | Error    | A pair references an absent bone.                                                                                       |
| `self-pair`          | Error    | Both sides reference the same bone.                                                                                     |
| `duplicate-pair`     | Error    | The same pair appears more than once.                                                                                   |
| `multiple-partners`  | Error    | A bone is assigned to several partners, including cross-side conflicts.                                                 |
| `invalid-reciprocal` | Error    | A repeated pair reverses its left/right orientation, or a supplied bound lookup disagrees with its authoritative pairs. |
| `ambiguous-name`     | Warning  | An automatic name contains multiple side tokens. No candidate is emitted.                                               |
| `ambiguous-match`    | Warning  | An automatic name group has multiple left or right members. No candidate is emitted.                                    |
| `ancestor-pair`      | Warning  | One paired bone is an ancestor of the other.                                                                            |
| `parent-mismatch`    | Warning  | The paired parents do not correspond through the mapping or share the same unpaired centerline parent.                  |

Structural errors prevent construction and expose no usable lookup. Hierarchy checks run only after structural validation passes. Different bind offsets, rotations or lengths do not reject a mapping: this milestone checks relationships, while future pose math must determine transform compatibility. Hierarchy warnings permit manual mappings on asymmetrical rigs while making potential limitations explicit.

## Session lifecycle

[AnimationEditorState](../src/devtools/animation-editor/AnimationEditorState.ts) initializes an empty mapping for its rig and exposes `symmetryMapping`, `symmetryValidationIssues`, `getMirroredBoneId()` and `setSymmetryMapping()`.

Assignment validates rig identity and pairs, owns a fresh mapping snapshot and sends one existing state notification. Failure preserves the prior mapping and reports separate symmetry diagnostics. Mapping changes do not alter source/working animations, transforms, time, selection, playback, drafts, animation validation, dirty tracking, Undo/Redo or animation event delivery. Preferences survive clip switching, animation import and export reload in the same rig session.

Mappings use exact `Rig` object identity. Even another rig with identical bone IDs cannot receive a foreign bound mapping. A rig reload starts with an empty mapping; reusing data requires explicit construction against the new rig, which validates the pairs again. Future persistence should store only `{ pairs }` with appropriate editor rig identity metadata, then validate and rebind it on load. The live rig reference and lookup are not a persistence format.

Production runtime, external schemas, bone/joint data, artwork, sprite origins, hierarchy, slots, attachments, skins and authored animation JSON are unchanged.

## Verification and deferred work

The pure and editor-session regressions cover naming conventions, unsafe substring avoidance, ambiguities, manual precedence, arbitrary IDs, reciprocal lookup, invalid pairs, unpaired bones, hierarchy warnings, deterministic results, immutable inputs, shipped rig preservation, rig identity, animation serialization, playback/event silence and history preservation.

Verification on October 11, 2026:

- `npm run typecheck`: passed.
- `npm run test`: passed; 1,542 tests passed and 28 optional profiling tests skipped, across 97 passing and 3 skipped files. This milestone adds 39 tests in `tests/boneSymmetry.test.ts` and `tests/animationEditorSymmetry.test.ts`.
- `npm run build`: passed, including demo/library output, declarations and the plain Node `/core` check.
- `npm run format:check`, `npm run lint`, `npm run check:version` and `git diff --check`: passed.

One repeat suite run alongside the build hit the existing sketch grip test's five-second timeout. The final standalone full-suite run passed without changing that test or its timeout.

Browser checks are unnecessary for this data-only milestone; no browser CI steps are added.

Deferred: pose reflection, keyframe/timeline mirroring, React mapping/preview tools, mapping persistence, sprite flipping, joint modification, IK target mirroring/baking, and attachment/weapon reassignment.
