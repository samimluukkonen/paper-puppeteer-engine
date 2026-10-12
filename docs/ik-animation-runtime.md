# Runtime IK animation evaluation

[All guides](../README.md#guides)

Milestone **v0.5.5.2** (package `0.5.5-2`) evaluates the [IK animation data model](ik-animation-data.md) through the existing two-bone constraint solver. File formats remain version 1. React owns no target interpolation or solver mathematics.

## Runtime architecture and APIs

`compileClip` and editor preview compilation prepare immutable `CompiledIKTrack` property maps alongside bone tracks. `evaluateIKClip(compiled, timeMilliseconds)` uses the existing `sampleProperty` interpolator and returns an immutable sparse `IKAnimationPose`. The main and `/core` entry points export both APIs and their types; `/core` remains usable without Phaser or browser globals. `evaluateClip` continues to return the authored bone pose only.

`AnimationPlayer.ikAnimation` exposes the most recently evaluated target state, including `x`, `y`, and `mix` channel values and ownership weights. Fully authored channels have weight 1. A fade or partial layer can leave a fraction unowned; the constraint resolves that fraction against its current fallback. Evaluated state stays outside the animation definition and never changes keyframes, static constraint targets, rig settings, bind poses, or pose export.

The player reuses immutable IK samples and layer results while their sampled times, fade weights,
underlying channels, masks, and layer weights stay unchanged. Each layer retains only its latest
source/target samples and blend results, so stepped playback avoids repeated pose allocations without
building a cache of the whole timeline. Previously returned poses remain unchanged when playback advances.
Procedural endpoint fallback and the constraint solver still run each presentation pass.

The target evaluator reads the player's existing layer states and transition clocks. It has no independent clock, playback state machine, or event dispatch. `Puppet` supplies its player's channels to the pose controller. `Puppet.setIKAnimationSource(source | undefined)` lets the Animation Editor supply its separate working-copy preview player or read-only `ikAnimation` channel source; passing `undefined` restores the puppet's normal player. The editor releases this override on disposal, and facing or repeated IK passes use the held preview state. The scene retains authored rig constraints and their enabled defaults; optional fixed-target preview chains are merged only when their names are absent from the rig. The existing fixed-target toggle is an explicit provider override, and switching it off restores authored constraint defaults.

## Constraint update order

The existing dependency order remains:

1. Restore the previous pre-IK pose, then evaluate authored bone animation and layers.
2. Evaluate target channels using the same clip times and fade weights.
3. Apply existing host adjustments and active pose presets; synchronize bone and attachment transforms.
4. Run constraints by ascending priority, retaining registration order for ties. Resolve each target immediately before its constraint. Project each solved branch so later constraints/providers see updated descendants and attachments.
5. Finish rendering and refresh overlays.

The demo keeps its presentation order: authored layers/layout, hand configuration, foot planting targets/body placement, initial weapon placement, priority-ordered primary arm then secondary weapon provider then legs, foot visual rotation, grip correction passes, and final overlays. Corrective `syncIK()` passes reuse the held target channels without advancing animation. No arbitrary reordering or additional solver is introduced.

## Coordinates and sparse defaults

Authored `x`/`y` are absolute positions in the **outer puppet container's local space**. At solve time the full outer world matrix converts the point with `localToWorld`; the existing `worldToParent`/`worldToLocal` adapter removes the chain parent's transform. Translation, facing, scale, enclosing containers, and rotated bone parents therefore act through the established affine utilities. Later nested constraints resolve against transforms updated by earlier constraints.

X and Y are independent. An omitted coordinate, or an unowned fraction during a fade, uses the current pre-constraint end contact point in puppet-local space, including `endOffset`. This is evaluated after earlier constraints, without storing a fallback key. Singular placement or parent transforms preserve the existing singular diagnostic; unsupported internal nonuniform chain scaling and unreachable target clamping retain the existing solver behavior.

Rig definitions currently supply enabled state, bend, mix, chain, offset, and priority; they have **no default target position field**. Without an animation position or explicit runtime target/provider, the constraint remains inactive. Mix-only animation can influence an existing ordinary runtime target but does not create a position target.

## Target precedence

| Channel/settings                | Resolution, highest priority first                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enabled, bend, offset, priority | Existing runtime constraint settings, initialized from the rig; animation never enables or disables a constraint.                                                             |
| Position                        | `setTargetProvider` while installed; otherwise explicit world `target`/`setTarget`/`setIKTarget`; otherwise composed animation coordinates with current end contact fallback. |
| Mix                             | Installed provider's configured mix; otherwise explicit runtime `constraint.mix` assignment; otherwise composed animated mix with the configured static/rig mix fallback.     |

A provider returning `undefined` retains ownership and leaves that constraint inactive; it never falls back to animation. This protects mandatory secondary weapon grips. Foot planting already writes runtime world targets, mix, and enabled state, so its ownership survives conflicting generic tracks. An ordinary world target overrides only position; influence keys still apply until mix is explicitly assigned.

`constraint.target = undefined` clears the ordinary position and provider override. `setTargetProvider(undefined)` removes the provider and restores the previous ordinary point, if one exists. `constraint.clearMixOverride()` returns influence ownership to animation while retaining the current configured mix as its fallback. Setting a target clears its provider, preserving existing API semantics.

No IK tracks, empty placeholders, or omitted channels change enabled state or install overrides. Old animations retain their existing static/manual targets, foot planting, and weapon behavior.

## Blending and playback

Channels blend independently in layer insertion order with the existing layer weights. Bone masks select an IK chain when they include its **root bone**; including only the hand/end bone does not select the chain. Sparse upper layers retain underlying target channels they do not author.

Crossfades evaluate both source and destination clips at their existing player times and use the same fade progress as bone animation. Channels absent on one side resolve toward underlying layer ownership, then the current endpoint/static mix fallback. When animated position ownership fades away entirely, normal authored bone control resumes. Position ownership also weights solver influence while fading to/from an absent target, avoiding a residual constraint after the fade. Interrupted fades snapshot only the layer's owned channels and weights, so subsequent fades begin at the held evaluation.

Smooth interpolation samples continuous time. Stepped playback quantizes each clip and its fade weight using the existing FPS logic; scene rendering continues normally. Nonlooping completion holds the exact authored endpoint. Stop/pause retain evaluated targets, restart reevaluates time zero, and clearing a layer releases its target ownership. Clearing all layers or resetting the pose clears evaluated target channels.

`AnimationPlayer.sample` and `Puppet.sampleAnimation` keep their existing **base-clip-only** semantics, including during fades/layers: raw interpolation by default, or playback timing with `{ mode: 'playback' }`. Sampling clamps time, leaves clocks untouched, and dispatches no events or completion notifications. Animation Editor playback and scrubbing use its sole editor clock and the same playback-aware base sampling. Onion skins and authored pose tools remain pre-IK bone samples.

## Changed files

| Files                                                                                                    | Change                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/AnimationClip.ts`, `core.ts`                                                                 | Compiled IK ownership/validation/cache and public `CompiledIKTrack`/`evaluateIKClip` exports.                            |
| `src/engine/ik/AnimationIKPose.ts`, `AnimationLayerEvaluator.ts`, `AnimationPlayer.ts`                   | Sparse channel interpolation/blending on existing clocks, transition snapshots, and `ikAnimation` state.                 |
| `src/engine/ik/TwoBoneIKConstraint.ts`, `ik/types.ts`, `Puppet.ts`, `PuppetPoseController.ts`            | Target/influence precedence, affine adapters, `clearMixOverride`, `setIKAnimationSource`, and per-constraint resolution. |
| `src/devtools/animation-editor/AnimationEditorPreview.ts`, `AnimationEditorScene.ts`                     | Working-copy channels, authored rig constraint registration, and fixed-preview override release.                         |
| `tests/ikAnimationRuntime.test.ts`, `animationEditorScene.test.ts`, `browser/ikAnimationRuntime.spec.ts` | Runtime, scene, and local browser regressions.                                                                           |
| `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, IK/animation guides                    | Package milestone and runtime documentation.                                                                             |

## Verification and deferred work

The runtime regression suite covers A/B/C arm targets, sparse interpolation, influence including zero, partial and masked layers, ordinary and procedural ownership, mixed and interrupted crossfades, stepped playback and fades, completion/restart, unreachable targets, singular transforms, translated/scaled/reflected placement, rotated/enclosing parents, endpoint offsets, dependent weapon providers/nested chains, old clips, external compiled ownership/validation, source immutability, and event-free editor scrub/playback.

Local browser checks remain local-only; see the [development guide](development.md#local-browser-checks). Required release checks are `npm run typecheck`, `npm run test`, and `npm run build`.

Verification on 2026-10-11:

- `npm run typecheck`, `npm run test`, and `npm run build` passed; the full unit suite reported **1,715 passed / 28 skipped**, including 20 new runtime/scene regressions. Demo/library builds and the built Node `/core` check passed.
- Formatting, lint, package version validation, and `git diff --check` passed.
- Twenty selected local Chrome scenarios across development and production passed, including the new authored-target editor scenario in both builds. Two interrupted checks passed on rerun after code/build output stabilized. Browser checks remain outside CI.
- A dedicated real Phaser scene was visually inspected at 0, 500, and 1,000 ms. With placement `(320, 200)` and scale 2, local A `(60, 60)`, B `(30, 80)`, and C `(-40, 70)` reached world `(440, 320)`, `(380, 360)`, and `(240, 340)`. All were solved with bend direction 1. Normal scene playback advanced, full influence reached the target, zero influence restored authored rotation, facing reflected the target, and source data remained unchanged.
- The existing demo walkthrough checked foot planting on/off, mirrored feet, and weapon hand IK controls. Controller regressions also verified procedural foot targets and mandatory secondary grip ownership against conflicting generic animation keys.

See [React IK authoring](react-ik-authoring.md) for the implemented timeline and inspector and [visual IK targets](visual-ik-targets.md) for draggable handles. [Atomic IK baking](ik-bake-commit.md) adds clip-local deactivation, with [React controls](react-ik-baking.md) and [production fidelity checks](ik-bake-hardening.md). Target mirroring UI, new solvers and physics remain deferred.
