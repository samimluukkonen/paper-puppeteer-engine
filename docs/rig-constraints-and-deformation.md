# Rig constraints and deformation preparation — v1.4.1

[All guides](../README.md#guides) · [Artist IK workflow](rig-ik-editor.md)

This audit describes the implemented system and an optional future mesh boundary. v1.4.1 improves presentation of the existing two-bone solver. It adds no mesh data, rendering, weights, skinning, constraint graph or format migration.

## Actual repository baseline

The pre-change package version was `1.3.6`, with additional work recorded under Unreleased. Inspection after v1.2.6 finds audio asset import/preview, scene audio tracks/clips and Web Audio scheduling, dialogue authoring/evaluation/subtitles, audio/dialogue Feature Guides and integrated audiovisual workflow tests. These live in the scene/audio engine modules, Scene Editor, package/recovery code and corresponding unit/browser suites. Their presence is evidence of specific implemented features, rather than a claim that every earlier v1.3 proposal is complete. See the [audiovisual integration report](audiovisual-scene-readiness.md) for that milestone's limits.

The rig already supports validated constraint creation/editing/removal, default-target handles, explicit bend, enable/mix/priority/endpoint edits, live dependency guards, grouped history, export/import and the shared Rig Tweak panel. Animation target channels, isolated sampling/baking, bind-relative mirroring, rigid sprite skins/replacement, root motion and foot contact markers also predate this change. There is no mesh attachment representation or mesh evaluator to extend today.

## Data, identity and rest pose

| Concern                | Current owner and contract                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored skeleton      | `RigDefinition` in `src/engine/types.ts`; bone `id` and constraint `name` are stable string identities. Animations, poses, slots, markers and host references use those identities.                                                                                                                |
| Validation/indexes     | `Rig`, Zod schemas and `checkRigReferences` check unique IDs, one connected acyclic hierarchy, references, finite transforms and directly connected IK triples. `Rig.bones` is immutable and parent ordered.                                                                                       |
| Effective rest offsets | `Rig.computeBonePosition` normalizes a child's authored offset to the parent's explicit `length`; a missing/zero direction falls back to +Y. Explicit length is independent of image size. Use the validated `Rig`, rather than raw JSON offsets, for bind matrices.                               |
| Bind and live pose     | `Joint.bindPose` is a frozen, complete bone-local transform. `Joint.pose` is a separate mutable copy. Defaults are translation/rotation zero, scale one. `Joint.reset()` restores bind data. `Bone` adds Phaser projection without changing this model.                                            |
| Rig editing            | `RigEditorState.workingCopy` holds immutable authored snapshots. Preview projection and topology reconstruction apply effective offsets; exported bone data does not contain solved joint rotations. A new/rest-edited rig gets new runtime joints.                                                |
| Constraint storage     | Optional `rig.ik` entries contain the three bone IDs, optional end-local offset, rig-local target, signed bend, influence, enabled flag and priority. Runtime targets/providers/status are separate and never serialized.                                                                          |
| History/persistence    | `RigEditorState` and `SnapshotHistory` own bounded history, grouped target gestures, independent rig/skin checkpoints and recovery. `rigSerialization` preserves exact IK numbers. Character/project packages and browser drafts retain authored data, never Phaser objects or solver diagnostics. |

There is no separate authored inverse-bind matrix or mesh bind-pose asset. The skeleton's validated rest transforms are the current rest-pose source of truth. Editing the rest pose is an authored rig change, not an animation or constraint output.

## Coordinates and transforms

Coordinates use +X right and +Y down; positive angles are clockwise on an unreflected canvas. Angles are radians and scale is unitless. A bone pivot is its container origin. Image origins are independent normalized 0–1 texture coordinates; image offsets/scales do not change joint pivots or logical bone lengths. Slot and attachment transforms compose after their owning bone. Foot markers use bone-local units; attachment sole contacts use normalized image coordinates.

`affineMath.transformToAffine` uses column-vector convention:

```text
L = T(x, y) R(rotation) diag(scaleX, scaleY)
x' = a*x + c*y + tx
y' = b*x + d*y + ty
B_root = L_root
B_child = B_parent * L_child
worldPoint = hostAncestors * puppetPlacement * B_bone * localPoint
```

The matrices above become rest matrices when composed from `bindPose`, and evaluated matrices when composed from `pose`. Nonuniform rotated ancestors can introduce shear: adding angles/scales is insufficient. `composeAffine` and `worldToLocal` preserve the full affine transform. Singular inverses are unavailable; solver adapters accept finite nonsingular ancestors with zero relative tolerance, while editor gestures retain their protective tolerance.

Facing reflects the puppet container's X scale. Host placement, root-motion displacement and enclosing containers stay outside the skeleton's rig-local matrices. Camera pan/zoom is another presentation transform. Rig target dragging first converts pointer/camera coordinates to world, then inverts the full puppet world matrix. Default and animated IK targets are rig local; explicit runtime targets/provider results are world coordinates. The solver converts a world target to the start bone's **parent** coordinates. `endOffset` stays in end-bone local coordinates.

## Deterministic evaluation order

1. **Restore the previous pass and establish authored FK.** `Puppet.preparePose` / `PuppetPoseController.preparePose` remove held IK rotations and temporary pose overlays. `AnimationPlayer` evaluates sparse bone tracks and layers against bind/control ownership; untracked externally authored transforms retain their established semantics. Root-motion application updates puppet placement before pose synchronization. Do not replace this with an unconditional bind reset.
2. **Resolve animation and IK channel state.** `AnimationLayerEvaluator` produces bone transforms and separate layered IK X/Y/mix/disabled channels. `PuppetPoseController.syncPose` then applies any persistent pose preset, synchronizes bone containers and projects rigid render branches. Animation Editor preview uses the same runtime APIs with its detached playback state and temporary drafts.
3. **Evaluate constraints.** `getOrderedConstraints` refills from Map registration order and stably sorts ascending numeric priority on every pass. Equal priorities retain registration order, including after runtime priority changes. `rig.ik` array order supplies initial registration order; extra runtime constraints follow their own registration. Each provider runs immediately before its constraint, after earlier solves. Explicit provider/runtime position owns the target; otherwise animation channels blend over the default target or current FK endpoint. Providers own influence; explicit mix overrides suppress animation mix. Enabled flags and clip/layer suppression still apply.
4. **Expose final evaluated transforms.** `TwoBoneIKConstraint.apply` changes only start/middle rotations using the existing law-of-cosines solver and nearest-angle influence blend. The end bone's own rotation is retained. After each solve, the changed bone/render branches update so later providers can read descendant attachments. `IKPoseState` captures the pre-IK rotations once and records final results; repeated sync restores the baseline before solving, preventing partial-mix drift. `IsolatedIKSampler` follows the same priority/order and invalidates its affine cache between constraints without React, Phaser, clocks or events.
5. **Future deformation boundary.** After the last constraint and its final world-matrix composition, a future renderer-independent deformation evaluator can consume the final rig-local matrices. Phaser would upload its output before drawing. Keep the existing intermediate rigid projection because providers may read those mounts; inserting mesh evaluation must not reorder constraints, rerun providers or feed deformed vertices back into IK.

The solver accepts reflected axes and arbitrary nonsingular affine ancestors, but requires equal absolute X/Y scale **inside the rotating start bone**. Zero scale reports `singular-transform`; unequal absolute start scales report `unsupported-scale`. Reachability uses the two effective segment lengths and includes both too-far and too-close targets. Unreachable input remains authored; only the output pose clamps. A reachable target can still have endpoint error with partial influence or a later overlapping constraint.

## Constraint-authoring improvements

The existing inspector and canvas now expose the solver result as Reachable, Unreachable target, Inactive, Cannot solve, Unsupported scale, Disabled or Solver off, with actionable inspector guidance. These describe the current evaluated target; when a host owns it, the separate ownership message explains why the default-target handle cannot be dragged. Requested default coordinates remain visible.

Selecting a chain labels Start, Middle and End with bone IDs, retaining the target crosshair and endpoint link. A constant-screen-size signed-turn arrow at the middle joint uses the start bone's actual affine basis, so facing/reflection and rotated/off-axis links change the indicator correctly. Labels state the authored sign as well as direction. Overlay caching includes live chain matrices and solver feedback, allowing host/preview changes to redraw without authored mutations.

Creation can infer a sign once from the current pose; the authoring API stores that explicit `1` or `-1`. Existing definitions with no bend field use the solver's established `+1` default. The selector now says so, instead of implying continuous pose inference. Selecting either sign updates only the existing `bendDirection` field through ordinary rig history. There is no second pole target or inferred runtime bend state.

Chain selectors offer directly connected triples. The validated model boundary still rejects missing/disconnected bones and invalid parameters atomically; the controller shows the actual error in the panel while retaining the previous working copy, runtime and history. Dependency messages protect IDs, chains and endpoint offsets referenced by animations, baked metadata or hosts. Targets, bend, mix, enable and priority remain editable. Numeric edits commit on blur/Enter; target drags commit one Undo entry and cancel on Escape/blur/deactivation. Selection/preview/inspector reveal stays outside authored history.

Rig Tweak mounts the same `RigIKPanel`, `AttachmentController` and `RigEditor`, with the animation preview paused and independently owned animation history. It benefits from the same status/labels/bend controls. Neither this change nor future mesh preparation should create animation keys from rig-default edits.

## Optional deformation design (proposed, not implemented)

| Extension point     | Proposed responsibility                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attachment schema   | Extend the attachment family with an explicit mesh variant in a future versioned format. Preserve today's implicit sprite records as rigid sprites. A slot still selects an attachment by stable ID and skins still map slots to IDs/null. Do not reinterpret existing images as meshes.                                                                                                |
| Bind geometry       | A mesh definition owns immutable mesh-local bind vertices, UVs, triangle indices and a bind attachment-to-rig matrix derived from the validated bone/slot/attachment rest placement. Specify axes, units and texture-origin conversion explicitly.                                                                                                                                      |
| Bone influences     | Store stable bone IDs with finite nonnegative weights per vertex. Validate references, vertex/triangle budgets, bounded influence count and normalized nonzero sums before allocation. Compile IDs into indexes only in runtime caches. Reject singular bind transforms with a useful error.                                                                                            |
| Compiled bind data  | A renderer-independent compiler owns immutable validated bind positions, indexed influences and inverse rest matrices. Cache by immutable rig/mesh identity; sharing between puppets is safe. Rest-pose edits invalidate/recompile this cache through an explicit rebind operation.                                                                                                     |
| Runtime state       | Each puppet owns mutable evaluated bone matrices, palettes and deformed vertex buffers, independently of authored arrays and other puppets. Reuse buffers; never install deformed vertices in document history, recovery or exports.                                                                                                                                                    |
| Evaluation          | A pure engine module consumes compiled bind data and **final post-constraint** matrices and writes rig-local deformed positions. It has no React or Phaser imports and runs for isolated tooling as well as runtime.                                                                                                                                                                    |
| Phaser rendering    | Add a renderer adapter beside `PuppetRenderer`'s sprite branches, using the same slot visibility, skin selection, draw ordering and texture ownership. Upload the already evaluated rig-local vertices under the puppet render root; do not apply the owning bone transform a second time.                                                                                              |
| Loading and editing | `CharacterLoader` continues bounded metadata I/O, with validation/compilation in `CharacterDefinition`/engine modules and textures owned by the host. Future editor commands build detached mesh proposals and install one validated snapshot through the existing document/history boundary. Package/recovery/workload budgets must explicitly cover the new data before accepting it. |

For a concrete future linear-blend convention, let `v` be an attachment-local bind vertex, `A_bind` its attachment-to-rig bind matrix, `B_i` the influencing bone's bind matrix in rig space, and `C_i` its final evaluated matrix in rig space:

```text
v_rig = sum_i weight_i * (C_i * inverse(B_i) * A_bind * v)
v_world = puppetWorld * v_rig
```

Weights sum to one. At rest `C_i = B_i`, so vertices return to `A_bind * v`. With one influence, the result matches an equivalent rigid attachment under that bone. Puppet facing, host scale and root motion apply once through `puppetWorld`; cameras apply later. Full affine matrices retain shear/reflection. UVs and bind vertices remain immutable.

The mesh bind placement already includes rest slot/attachment offsets. Its render branch must therefore bypass the ordinary current bone/slot mount. A first mesh design should treat that bind placement as fixed; changing it requires explicit rebind. Supporting independent animated/runtime slot offsets on meshes needs a separately specified local-delta contract and compatibility tests, rather than silently applying the sprite mount twice. Existing sprite slot transforms remain unchanged. Mesh-specific mirroring and artwork replacement/rebinding also need explicit authoring semantics before implementation; existing rigid commands retain their current behavior.

Implementation should first add versioned data/validation and pure bind/evaluation tests, then an opt-in Phaser adapter, then authoring tools. Required future invariants include exact rest reconstruction, one-weight rigid equivalence, bind-change invalidation, final-IK consumption, reflection/shear/root-motion behavior, independent puppet buffers, stable skin/draw selection, replacement texture UV policy and complete teardown. Geometry generation, weight painting, cloth, runtime skinning and a general constraint graph remain outside v1.4.1.

## Verification coverage

Changed files:

| Area                     | Files                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constraint presentation  | `src/devtools/rig-editor/RigIKPanel.tsx`, `RigEditor.ts`, `RigEditorOverlay.ts`, new `rigIKFeedback.ts` and `rigIKBendArrow.ts` in the same directory |
| Existing Feature Guide   | `src/devtools/shared/guides/rigGuides.ts`                                                                                                             |
| Regressions              | `tests/rigIKEditor.test.ts`, new `tests/rigIKFeedback.test.ts`, `tests/browser/rigIKEditor.spec.ts`                                                   |
| Documentation            | New `docs/rig-constraints-and-deformation.md`, `docs/rig-ik-editor.md`, `docs/development.md`, `README.md`                                            |
| Version/release metadata | `package.json`, `package-lock.json`, `CHANGELOG.md`                                                                                                   |

`rigIKEditor.test.ts` covers creation/editing/dragging, rejection feedback, history, legacy omitted bend defaults, reflected bend changes, serialization without diagnostics, immutable bind transforms, repeated-solve stability, disabled/off preview and host/transform status changes. `rigIKFeedback.test.ts` covers every existing solver status and projected arrows under reflection/nonuniform affine scale. `rigEditorOverlay.test.ts` retains idle-cache/lifecycle coverage. Existing IK math/constraint, authored-data, bake, mirroring, skins, replacement, marker, root-motion and compatibility suites provide regression coverage without changing their runtime algorithms.

The local `rigIKEditor.spec.ts` browser workflow covers the React/Phaser target controls, unreachable warnings, explicit bend history, exports/reloads and shared Rig Tweak authoring. Browser tests remain local-only with one worker. See [development checks](development.md#checks-and-profiling) for commands.

### Executed results

All test commands ran sequentially with one worker per runner.

| Command                                                                                       | Result                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                               | Passed formatting, lint and `npm run typecheck`; repeated successfully after updating browser assertions for the existing inspector tabs.                     |
| `npm run check:version`                                                                       | Passed: package, lockfile and changelog agree on SemVer `1.4.1`.                                                                                              |
| `npm test`                                                                                    | Passed: 220 files passed, 7 skipped; 3,861 tests passed, 53 skipped (3,914 total).                                                                            |
| `npm run build`                                                                               | Passed: TypeScript, application bundle, library bundle/declarations and Node core/serialization/data checks.                                                  |
| `npm run test:package`                                                                        | Passed: isolated packed consumer, packaged documentation links, Node entry points, public declarations, runtime example, compatibility and browser isolation. |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/rigIKEditor.spec.ts --workers=1` | Passed: all 4 scenarios across development and production, including Rig Tweak, package runtime preview and the new diagnostics/bend checks.                  |

Local browser execution required permission to bind localhost outside the filesystem sandbox. Bundled Chromium was unavailable, so the successful run used installed Google Chrome as documented in the development guide. The first Chrome run identified stale pre-tab Animation inspector assertions in the existing new-character workflow; these now verify initial tab visibility, selection reveal and draft preservation across collapse/expand. The build emitted two non-fatal Lucide `use client` directive warnings; browser tools emitted non-fatal color-environment warnings. Desktop screenshot inspection confirmed readable role/status labels and the bend indicator.
