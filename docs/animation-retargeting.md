# Animation retargeting — v1.5.3-1

[All guides](../README.md#guides) · [Rig compatibility and bone mapping](rig-compatibility.md)

`retargetAnimation` creates a detached target-compatible animation from an explicit current bone map. It is a synchronous, pure engine service exported by `paper-puppeteer-engine/core` and the runtime/root entries; its contracts are also available from `/data`. It does not register clips, edit rigs, update mappings, save assets or add editor controls. The visual workflow belongs to v1.5.3.2.

## Calling the service

Use stable character-owned rig identities, authored rig definitions and a reviewed `RigBoneMapping`. Matching bone names alone are insufficient. The service validates the map's identities, revisions, uniqueness, root correspondence and direct parents. A partial map must remain connected to the root. Stale maps must be reviewed and approved again through the existing mapping workflow.

```ts
import { retargetAnimation, serializeAnimationDefinition } from 'paper-puppeteer-engine/core';

const result = retargetAnimation({
  sourceAnimation: sourceClip,
  sourceRig: { id: sourceCharacter.id, rig: sourceCharacter.rig },
  targetRig: { id: targetCharacter.id, rig: targetCharacter.rig },
  boneMapping: reviewedMapping,
  options: {
    name: 'target-sword-cut',
    translation: 'scale-by-bone',
    // Optional: callers identify anatomy explicitly; omit for generic skeletons.
    pelvis: { sourceBoneIds: ['pelvis'], translation: 'scale-by-character' },
    rootMotion: 'preserve',
    ik: 'fk-only',
  },
});

// Show diagnostics and skippedTracks to the caller before accepting the result.
if (result.animation) {
  const json = serializeAnimationDefinition(
    { version: 1, ...result.animation },
    targetCharacter.rig,
  );
  // The application decides whether to register or save json.
}
```

`animation` is `null` on invalid options, rigs, source data, mappings or nonfinite conversion results. Successful results include `diagnostics`, `compatibilityWarnings` and `skippedTracks` with a kind, source ID and reason. Warnings allow a result with omissions; they do not promise identical end-effector positions or foot contact. `characterSizeRatio` is present only when a selected policy uses it. Choose a suitable new `name` yourself; the service generates no random IDs and does not check an application asset registry for collisions.

## Transform math and coordinate spaces

The runtime uses +X right, +Y down and radians with positive clockwise rotation. A local matrix is `T(x,y) R(rotation) diag(scaleX,scaleY)`, composed after its parent matrix. Animation FK keys are **absolute local poses**, not deltas. Source and target rest transforms come from the existing `Rig` constructor, including its normalization of explicit parent lengths into effective child offsets. Sprite sizes do not define skeleton lengths.

For source rest transform `S`, target rest transform `T`, authored channel value `v` and translation multiplier `k`, conversion is:

| Channel         | Target value                    | Space and meaning                                                                                       |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Rotation        | `T.rotation + (v - S.rotation)` | Relative angular motion about the corresponding local joint; target bind orientation supplies the base. |
| Translation X/Y | `T.axis + (v - S.axis) * k`     | Motion relative to rest in the corresponding **parent-local axes**.                                     |
| Scale X/Y       | `v * (T.axis / S.axis)`         | Unitless animated scale relative to each rig's rest scale.                                              |

Each bone is converted independently; the existing evaluator composes the target parent/child transforms. A missing channel stays missing and therefore uses the target's own rest value. Unmapped source tracks are omitted with diagnostics. Extra target branches keep their rest pose. The operation preserves local motion semantics; it does not solve for identical world trajectories, rotate translation curves into another coordinate basis, or adjust skeleton geometry. Review animations when rest joint-offset directions or orientations differ substantially.

Mapped rest scales must be nonzero, with matching signs on each axis. Matching reflected rest poses are supported. A changed rest reflection returns an explicit error; automatic left/right limb swapping or mirror conversion is outside this service. Already authored mirrored FK clips can be transferred using an appropriate explicit map and the same rest-relative rules. Actor facing is an external transform applied once by the runtime, after these canonical coordinates. The service neither reads nor bakes facing into the clip.

## Translation policies

`translation` defaults to `scale-by-bone`. For each non-root bone with keyed X/Y, `k` is the target/source ratio of effective local rest-offset lengths: `hypot(T.x,T.y) / hypot(S.x,S.y)`. This ratio is specific to that bone and is applied to its translation delta only. `preserve-delta` uses `k = 1`. If either offset is no greater than `1e-8` rig units or has a nonfinite norm, use `k = 1` and emit `degenerate-bone-length`; no zero division occurs. Rest offsets still change to the target's values.

The skeletal root uses `k = 1` by default, independently of the local policy. `pelvis.sourceBoneIds` optionally identifies mapped pelvis/body-motion tracks, including the skeletal root if appropriate. Those tracks override the local policy: `preserve-delta` uses 1; `scale-by-character` uses the character ratio below. The service makes no anatomy assumptions or automatic pelvis selection.

Character size is the sum of corresponding nonzero effective rest-edge lengths in **puppet space**, including ancestor rotation and scale. Only mapped edges whose lengths both exceed `1e-8` contribute; extra branches and root placement do not. The target sum divided by the source sum defines one deterministic character ratio for pelvis and root-motion policies. Empty/degenerate geometry, nonfinite mapped edge lengths, overflowing sums or a nonpositive/nonfinite ratio fail the operation when that ratio is required. This is a documented size heuristic, not an anatomical height estimate.

Ratios outside `[0.25, 4]` produce `unusual-proportions`. They remain unchanged rather than clamped. Different limb proportions, parent scales and rest directions can change arcs and contacts; this phase offers no physics correction, automatic foot locking or exact foot planting.

## Root motion

`options.rootMotion` is required; select exactly one policy per operation:

| Policy               | Result                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `preserve`           | Copy source animation-local displacement values and curves.                                 |
| `scale-by-character` | Multiply both root offset channels by the character ratio; preserve sparse rows and curves. |
| `omit`               | Remove root motion and report it in `skippedTracks`.                                        |

Root motion is Actor displacement in animation-local units, before placement/facing/Actor scale. It is never extracted from, added to or subtracted from skeletal root/pelvis tracks. Both kinds of source-authored movement remain separate; the service does not repair a source clip that already duplicated displacement. Runtime hosts still select their normal `ignore`/`apply` playback policy and own Actor movement exactly once.

## Interpolation, timing and rotation wrap

All conversions are affine on each independent channel. No resampling or cross-channel mixing is required. Key times, sparse channel membership, outgoing linear/stepped/Bézier controls, terminal controls, duration, loop and smooth/stepped playback settings survive unchanged. The result uses the existing `compileClip`/`evaluateClip` evaluator and serialization formats.

Rotations are never normalized on conversion. Adding the same rest offset to a whole channel preserves its angular representatives and the evaluator's shortest-arc interpolation, including wrap crossings. The current format has no separate explicit multi-turn segment flag: numeric values differing by complete turns still use the existing shortest-arc evaluator. The service does not reinterpret those values as spins or add unsupported turn semantics.

Only floating-point rounding is introduced; identical rest channels and unit multipliers preserve the original numbers exactly. Regression samples compare affine-converted evaluator output at endpoints, arbitrary times and stepped boundaries to 10 decimal places for ordinary fixture magnitudes (absolute tolerance about `1e-10`). This is a test tolerance, not a guaranteed bound for extreme magnitudes. Existing Bézier time inversion remains unchanged at 52 bisection iterations. Nonfinite converted values fail target validation.

## IK and mesh corrections

`fk-only` is the only accepted IK policy and is the default. All source `ikTracks` (including mix channels) and source `disabledIKConstraints` references are omitted and reported. Source IK is not evaluated, including rig default targets; bake it into FK with the existing IK baking workflow first if its solved motion is needed. The returned clip suppresses **all target constraints** by their target names, including constraints with runtime providers or default targets, so they cannot override the transferred FK. No source-specific constraint ID is silently preserved. The target rig remains unchanged. Mapped IK target transfer is not implemented in this phase.

Mesh correction keys contain source attachment/vertex IDs and offsets in the source bind basis. They transfer only when source/target **entire effective rig revision fingerprints match** and the bone map is complete identity correspondence. This deliberately conservative check verifies the same attachment IDs, vertex order/topology/coordinates/UVs, dimensions, weights, bind transforms and slot/skin basis. Stable character identities may differ if their full effective rig data is identical. Matching vertex counts, attachment names or topology alone do not qualify. Different or unverified meshes are omitted with `mesh-omitted` diagnostics. Target bone-weighted skinning continues to work with the transferred FK; no target rig or mesh is edited.

## Ownership, events and determinism

The service accepts serializable authored clip data and reuses strict source/target validation. Non-JSON runtime event objects (functions, class instances, Maps, cycles, etc.) are rejected rather than shared. Duration, library labels/descriptions/tags, interpolation, playback settings and event order/times/names/JSON payloads survive. All nested clip data is detached and returned unfrozen for independent editing. Source animation, both rigs and the saved mapping remain unchanged, including when validation fails.

Event payloads are opaque application data and are copied without remapping. Any event with a payload produces `event-payload-unmapped` for caller review, since bone, mesh, foot marker, constraint or asset references may still identify the source. There is no generic application-reference remapper.

Bone tracks and omitted-track processing use stable ID order; target IK suppression uses sorted target names. Identical inputs and options produce equivalent animation content, diagnostics and serialization. No clocks, random values, renderer state or global mutable caches participate.

## Verification

`tests/animationRetargeting.test.ts` covers identical/renamed rigs, rest orientations and proportions, hierarchy composition, Actor facing, rest reflections, angular wraps and turn representatives, sparse Bézier/stepped sampling, local/pelvis/root policies, effective lengths, degenerate geometry, IK omission/suppression, mesh preservation/omission, events, partial/invalid/stale maps, detached edits, deterministic output and authored JSON round trips.

Run `npm run typecheck`, `npm run test` and `npm run build`. Vitest uses the repository's single-worker, sequential configuration. No browser or UI workflow is needed for this engine-only milestone.
