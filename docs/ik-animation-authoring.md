# Production IK animation authoring

[All guides](../README.md#guides)

Milestone **v0.5.5.5** (package `0.5.5-5`) completes IK animation authoring. The editor stores sparse target and influence keys; the runtime uses the existing two-bone solver after evaluating ordinary bone animation. Exported files work directly with CharacterLoader and Puppet. IK output never becomes bone keys implicitly.

## Animate a character reaching for an object

1. Open the character in Animation Editor. Its rig must already define a hand IK constraint; Demo Puppet includes `rightArmIK`.
2. Select `IK: rightArmIK` in the timeline. Disable **IK preview (fixed targets)** so the authored target controls the arm.
3. Move the playhead to **0.0 s**.
4. Drag the hand crosshair to the starting position, or enter X/Y in the IK inspector. For Demo Puppet, try X `22`, Y `-42`.
5. Click **Set Target Key** to commit both coordinates in one history operation.
6. Move to **0.5 s**.
7. Drag the hand target toward the object. For Demo Puppet, try X `-8`, Y `-22`.
8. Click **Set Target Key** again. Releasing a drag only retains a temporary draft; it does not write keys.
9. Check the animation's interpolation and playback settings. Format 1 supports linear interpolation (explicit or implicit); choose Smooth playback for continuous movement or Stepped with an FPS for held poses. These use the same runtime sampler as bone keys. Per-key easing is unavailable.
10. Play the animation. The crosshair shows the requested target; an unreachable target stays visible beyond the arm's reach while the solver clamps the hand.
11. Tune **Influence** and use its **Set Key** button. `0` preserves the authored bone pose, `0.5` blends each solved rotation halfway from the authored rotation, and `1` applies the full solution. Partial influence generally leaves the hand short of the crosshair.
12. Download `animation.json`. Put it in the character package's animations directory and reference it from `character.json`.

Scrubbing, selection changes, playback and Undo/Redo cancel temporary drafts. Numeric property commits author just that channel; **Set Target Key** authors X and Y together and preserves a separate influence draft. Export includes committed data only.

## Targets, coordinates and bone motion

Bone keys describe local transforms relative to a bone's parent. IK X/Y keys describe an **absolute point in the outer puppet container's local space**, before outer placement, facing and camera projection. They are independent channels in `ikTracks[constraintName]`; `mix` is influence in `[0, 1]`. Times in JSON and engine APIs are milliseconds; the editor displays seconds.

Camera zoom/pan, puppet translation/rotation/scale, facing and enclosing containers are removed by the existing affine conversion when dragging. Facing reflects the preview through placement without rewriting keys. Direct target mirroring is deferred. Bone mirroring preserves IK tracks and samples authored bone transforms before IK.

At each runtime presentation pass, the previous IK rotations are restored, bone clips/layers and pose presets are evaluated, then priority-ordered constraints solve. Both upper-arm and forearm rotation keys supply the base for influence blending. The source clip, rig, bind pose and authored pose exports remain unchanged. Repeated `PosePipeline.syncIK()` calls restore this base before solving again.

Missing X/Y use the current end contact point, including endpoint offsets and preceding constraints. A track containing only influence keys can affect an existing runtime target, but cannot invent a target position. No tracks, empty placeholders and no constraints preserve ordinary bone playback.

IK authoring stores the requested target for runtime solving. [IK baking](react-ik-baking.md) explicitly creates ordinary bone rotation keys from solved poses and deactivates selected constraints for that clip through the React panel or [programmatic commit](ik-bake-commit.md). [Fidelity reports](ik-bake-hardening.md) compare key-time and between-key motion. Baking never occurs implicitly during playback, export, mirroring or onion-skin sampling.

## Ownership, blending and developer diagnostics

Position precedence is **installed provider → explicit runtime world target → animated target**. A provider returning no target still owns the constraint and leaves it inactive. Provider influence and explicit runtime mix overrides precede animated influence. Enabled state, bend, offset and priority remain runtime/rig settings. See the [runtime contract](ik-animation-runtime.md#target-precedence) for releasing overrides.

This preserves hand targets, procedural foot planting, primary weapon targets and mandatory secondary/two-handed weapon providers. Give dependent chains explicit priorities. Constraints run in ascending priority and registration order for ties, projecting each changed branch before later providers read attachments. Multiple constraints writing the same root/middle rotations are sequential corrections, not independent simultaneous goals; the later correction wins according to its mix. Separate the chains, disable one owner, or deliberately configure priority. There is no simultaneous competing-target solver in this milestone.

The inspector reports why direct manipulation is disabled for provider/runtime ownership, disabled constraints, singular placement/chain/parent transforms, and unsupported nonuniform scale inside the chain root. Availability reads current transforms so restoring scale can release the restriction immediately. Outer/enclosing affine transforms remain supported. Runtime callers can inspect `constraint.status` (`inactive`, `solved`, `clamped`, `singular-transform`, `unsupported-scale`) and `targetOwnership`. No warning is emitted every frame.

Crossfades and layers use existing player clocks, masks and weights. IK masks select a constraint through its **root bone**. Sparse layers retain unauthored underlying channels; fading toward a clip with no IK releases target ownership and solver influence. Interrupted fades retain held sparse ownership. Completion holds the endpoint, restart samples zero, and loop boundaries follow existing clock wrapping. Stepped playback quantizes targets and fade progress alongside bone motion. Inspection and scrubbing dispatch no events; normal playback retains its event semantics.

## Timeline operation matrix

| Operation                                                             | IK support in v0.5.5                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Create/update X/Y/mix                                                 | Numeric Set Key; Set Target Key commits X/Y together                                           |
| Delete                                                                | Property Delete Key, selected marker Delete/Backspace, toolbar Delete Keys                     |
| Move/snapping                                                         | Selected marker arrows; Shift for ten steps; existing frame/FPS snapping and duration clamping |
| Collision                                                             | Replace the destination channel, retain sparse sibling channels                                |
| Undo/Redo                                                             | One document transaction per commit/move/delete; selection reconciles with restored keys       |
| Multi-selection, marquee/range, group movement                        | Unavailable for IK                                                                             |
| Copy/paste, duplicate                                                 | Unavailable for IK; selecting IK disables bone clipboard commands                              |
| Pointer movement of timeline markers, previous/next IK key navigation | Unavailable for IK; use arrow movement and playhead scrubbing                                  |
| Interpolation                                                         | Existing clip-level linear declaration and Smooth/Stepped playback; no per-key override        |

The generic batch selection, movement and clipboard infrastructure currently uses bone IDs and transform properties. IK has distinct constraint IDs and x/y/mix references. Extending the shared typed infrastructure is deferred; no parallel batch editor or synthetic bone IDs are introduced. Bone multi-selection, clipboard, grouping and mirroring retain their existing behavior.

## Ghosts, compatibility and serialization

Onion skins remain read-only **authored bone poses before IK**, matching v0.5.3. Their renderer has no solver, animation player or event dispatch. They intentionally do not show the IK-corrected hand. Sampling/rendering ghosts never changes active targets, channels, providers or solved rotations. Bone mirror previews use the same pre-IK contract.

Animation file format remains **version 1** with optional IK tracks. Earlier format-1 files without tracks continue to work; missing or other version numbers fail with the existing validation policy. Duration must be positive: zero-duration animation imports/construction fail before creating render resources. Finite negative X/Y are valid positions; negative time, nonfinite coordinates, out-of-range influence and unknown constraints are rejected. Failed imports preserve working data and history.

Serialization preserves bone keys, independent IK channels, interpolation/playback metadata and JSON events. Repeated export/import stabilizes canonical output and produces the same evaluated motion. Screen positions, selected handles, pointer state, temporary drafts, React state and Phaser objects are excluded. The production test loads `characters/demo/character.json`, `rig.json` and `animations/reach.json` through CharacterLoader, then plays it with Puppet using the rig's constraints and no editor conversion.

## Performance, lifecycle and regression coverage

No new clock, solver pass, animation state machine or per-frame constraint rebuild is introduced. Immutable compiled tracks and bounded per-layer samples remain shared; the inspector uses isolated private joints and the existing solver. The gizmo owns one reusable Graphics object. Onion skins retain their six-instance render pool. A deterministic stress regression exercises two animated chains, rapid scrubbing, six ghosts, and playback speeds `0.25`, `1`, `2`: after warmup it creates no images/containers, and active preview updates run one constraint pass while ghost updates run none. This verifies allocation/pass bounds, not GPU FPS.

Preview disposal releases its subscription, player, held animation/drafts and IK source. Gizmo disposal cancels pointer gestures, unregisters scene/browser handlers and destroys graphics once. Both are idempotent; repeated cleanup of an old preview cannot clear its replacement. Disposed handles ignore late input/render calls. Scene shutdown, character replacement and route teardown use the existing ownership order.

Automated coverage combines `ikAnimationProduction.test.ts` with the existing IK data/runtime/editor/gizmo suites and the full rig, animation and runtime regression suite. It covers validation, target/influence sampling, layered/crossfade precedence, source immutability, bone/IK blending, history, coordinate conversion/facing, round trips/CharacterLoader, older files, event isolation, onion skins/mirroring and cleanup. Local browser checks remain outside CI.

Changed implementation files are `AnimationEditorPreview.ts` (safe subscription/player/source cleanup), `AnimationEditorIKHandles.ts` (current-transform diagnostics and safe graphics/input cleanup), and `editorMarkup.tsx` (artist Help). `ikAnimationProduction.test.ts` and `animationEditorIKHandles.test.ts` add 15 regressions. Package manifests advance to `0.5.5-5`; README, changelog and editor/developer/IK guides link the completed workflow. Public engine APIs and schemas are unchanged.

Verification on **2026-10-12**:

| Required check                                        | Result                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run typecheck`                                   | Passed                                                                      |
| `npm run test`                                        | 1,833 passed; 32 existing skipped tests, 110 passed test files              |
| `npm run build`                                       | Passed: demo, library, TypeScript declarations and built Node `/core` check |
| Formatting, lint, package version, `git diff --check` | Passed                                                                      |

Local Chrome verification covered **72 scenarios** across development and production: IK inspector/handles/runtime, mirroring, onion skins, animation production workflows and Rig Editor. The main run passed 70; two development walkthroughs exceeded their existing 30-second limits. Both passed on a targeted retry with `--timeout=120000` (31.1 s and 30.1 s), without implementation or assertion changes. All 36 production scenarios passed in the main run. Browser tests and browser installation remain outside CI.

The targeted retry command was:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationIKAuthoring.spec.ts tests/browser/rigEditor.spec.ts --project=development --timeout=120000 --grep 'React IK inspector authors|exported, original and imported reloads'
```

Human manual UI walkthrough: not performed. Captured automated browser screenshots were visually reviewed, including the IK inspector, target crosshair and expanded channel markers.

Deferred: generic IK batch/clipboard operations, React Bake controls, advanced target mirroring, new solver types, full IK rig creation GUI, physics/ragdolls, mesh deformation, scene choreography, sprite import/replacement and Animation Editor Rig-Tweak mode.
