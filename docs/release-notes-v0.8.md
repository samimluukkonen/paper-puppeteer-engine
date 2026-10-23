# v0.8 Actor and choreography release report

Historical verification report: the standalone `examples/` application has since been removed. Its commands and results below describe the recorded release, rather than the current checkout. See the [runtime integration guide](runtime-integration.md) for current usage.

[All guides](../README.md#guides) · [Production guide](choreography-production.md) · [Actor API](actors.md) · [Choreography API](choreography-sequences.md)

Candidate: **0.8.6**. Verification date: **2026-10-18**.

## Readiness

v0.8 is **release-ready against the specified automated gates**. No unresolved release-blocking regression remains. All 450 original desktop browser cases were accounted for across the full audit and corrective fresh-process reruns. The latest release command and packed consumer checks passed. Manual UI/runtime acceptance was not performed. This is local release preparation; npm publication, tags, pushes and remote releases were not performed.

## Architecture and public API audit

`Puppet` retains ownership of placement, playback clocks, queues, layers, event dispatch, IK, attachments and Phaser scene subscriptions. Actor is an optional facade: fixed instance ID and ownership, frozen local/world position snapshots, direct placement, delta-driven movement and mapped locomotion, one-time facing, animation/state forwarding and lifetime cancellation. It adds no evaluator, dispatcher or scene subscription. Root and `/runtime` export the same classes. Dependency graph checks keep all engine modules independent of editors and React, and verify Puppet never imports Actor or choreography.

`ChoreographySequence` runs typed ordered steps over a single Actor, preflights before side effects and claims its Puppet exclusively while active. `Choreography` registers Actors, prepares lazy typed plans and composes sequence/parallel groups. A barrier succeeds only after every child succeeds. The first observed unsuccessful branch cancels owned siblings, preserves the cause and awaits cleanup. Contexts own no Actors. Both runners are single-run and cache their promise/result. Stored sequence instructions are cleared after settlement or pre-run disposal/cancellation, releasing captured cue closures and look targets; the public `actor` binding remains intentionally retained. Pre-run cancellation/disposal results are frozen consistently with ordinary settlement.

| Surface                    | Public APIs                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Construction and ownership | `Actor`, `ActorOptions`, `ActorPuppetOwnership`, `id`, `puppet`, `puppetOwnership`, `isDisposed`, `disposalSignal`, `dispose()`                                |
| Placement and movement     | `ActorPosition`, `position`, `worldPosition`, `setPosition()`, `moveTo()`, `walkTo()`, `cancelMovement()`, locomotion/options/snapshot/result types            |
| Facing and appearance      | `lookAt()`, `setFacing()`, `faceLeft()`, `faceRight()`, `facingDirection`, skin/attachment forwarding                                                          |
| Animation policy           | `play()`, `playAndWait()`, `waitForPlayback()`, `stop()`, pause/resume, `currentAnimation`, `isPlaying`, `currentState`, `setState()`, `playAction()`          |
| Single Actor scripting     | `ChoreographySequence`, typed steps/options/results; fluent move/walk/look/face/animation/wait/cue, `run()`, `cancel()`, `dispose()`                           |
| Multiple Actors            | `Choreography`, registration/lookup, `actor()`, `sequence()`, `parallel()`, typed plans/results, `run()`, `cancel()`, `dispose()`, `ChoreographyConflictError` |

Existing Puppet APIs and version-1 authored formats remain compatible. Direct `walkTo()` now rejects nonboolean `faceMovement` before interrupting current movement, matching script validation. There are no new character/story conventions in the engine.

## Movement, facing and outcomes

Movement is direct point-to-point motion, not collision-aware navigation. Destinations use parent coordinates; speed uses world units per second. Tests cover constant speed, diagonal travel, varied delta partitions, exact clamped arrival, zero-distance and repeated requests, external placement, interruption, animation/scene pause, transformed parents and disposal. `lookAt` mirrors the entire Puppet based on horizontal world position once; it cannot track, rotate a head or aim. Optional walking auto-facing shares that policy.

Direct Actor validation errors reject/throw. Scripts resolve `completed`, `interrupted`, `cancelled`, `disposed` or `failed`, preserving step progress and original failures. External playback replacements retain authority; a walk can continue moving with external animation. Script cancellation stops only its current owned movement/playback/wait, preserves replacements and unrelated layers, and settles during pause without requiring another frame. Deliberately paused/looping playback and scenes without ticks remain pending by design. Runtime notification errors still report through existing synchronous update/notification boundaries.

## Runtime and lifecycle verification

The exported standalone package supplies real `idle`, `walk`, `attack`, `recover`, authored `reach` IK, and `baked` IK clips. The reusable scene loads two instances, starts idle, walks at different speeds, waits at a barrier, faces both, plays ordered responses, returns idle and disposes on every exit. Setup preflights clip names, handles shutdown/failed loads, and cleans partially constructed resources. The standalone browser page supports repeated runs, cancellation and game destruction.

Production regressions compare live/baked IK bone poses and full world matrices with direct Puppet playback under a rotated, nonuniformly scaled parent, skin switching and left facing. Queue/state/action/crossfade and exact-instance await integration use the existing playback system. Authored events are observed once. Existing suites retain CharacterLoader, Puppet-only, async, layers, queues, states, skin/attachment, rig/animation authoring, sprite replacement, new-character, IK authoring/baking and package export coverage.

Twenty cycles with four Actors exercise normal completion, cancellation, disposal and external playback. Checks assert no remaining movement/update, destroy, lifecycle or pending-wait listeners, no scene update/shutdown subscriptions, destroyed container children and reacquirable claims. Sample completion/cancellation/shutdown also clears the registry. These are deterministic reference/object/listener assertions, not a browser heap or garbage-collection proof. Public Actor and sequence handles intentionally retain their bound Puppet/Actor; callers must drop handles. Shared textures remain host-owned until all users finish or the game is destroyed.

## Performance

Local CPU diagnostics on **macOS x64, Node 24.19.0**, using real sample Puppet animation/IK/render projection with a minimal scene, exclude browser rendering, GPU and React. Each workload warms 200 frames, then reports the median of seven 300-frame batches; update delta is 16 ms. Timings are observations without pass/fail thresholds or invented FPS. Walking travels continuously; crossfades switch base animation every ten updates during movement; IK workloads activate arm and leg targets during movement.

Command: `VITE_PROFILE=1 npx vitest run tests/choreography.profile.test.ts --maxWorkers=1 --reporter=verbose` — **12 passed**.

| Actors | Idle ms/frame | Concurrent walk ms/frame | Walk + crossfades ms/frame | Walk + active IK ms/frame |
| ------ | ------------: | -----------------------: | -------------------------: | ------------------------: |
| 1      |        0.0416 |                   0.0531 |                     0.0726 |                    0.0720 |
| 2      |        0.0593 |                   0.0817 |                     0.1821 |                    0.1272 |
| 12     |        0.3557 |                   0.5235 |                     0.8043 |                    0.7640 |

Movement previously created and froze two temporary position points per nonterminal frame. It now reads scalar coordinates; public snapshots remain frozen. Animation still evaluates once per Puppet update. Movement synchronizes pose after placement so world-target IK and render matrices observe the new transform; this adds a synchronization after the animation's own pose synchronization, without a second playback clock/evaluation. No claim is made that this CPU profile measures end-to-end frame rate or proves zero allocations throughout Puppet/Phaser.

## Command results

| Command                                                                                                                               | Result                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check:release`                                                                                                               | **Exit 0** on the final tree: formatting, lint, typecheck, version consistency, unit/integration tests, demo/library builds and isolated package checks.                                                                                             |
| `npm run typecheck`                                                                                                                   | **Exit 0**, including the final release command and standalone consumer.                                                                                                                                                                             |
| `npm run test`                                                                                                                        | **Exit 0**: 173 files passed, 5 optional files skipped; **3,046 tests passed, 56 optional tests skipped**.                                                                                                                                           |
| `npm run build`                                                                                                                       | **Exit 0**: demo, library/declarations and Node entry-point checks.                                                                                                                                                                                  |
| `npm run test:package`                                                                                                                | **Exit 0**: packed public declarations, both runtime examples, documentation links, Node compatibility, editor exclusion, **2 consumer integration tests**, standalone typecheck/build.                                                              |
| `npm run check`                                                                                                                       | **Exit 0**: formatting, lint and typecheck, with no lint warnings.                                                                                                                                                                                   |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- --timeout=120000 --workers=4 --trace=off`                                          | Full audit: **413 passed, 32 failed, 5 did not run**. The failures identified stale test fixtures, timing budgets and setup/visibility assumptions; these were corrected.                                                                            |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test --last-failed --workers=2 --trace=retain-on-failure --timeout=180000`                  | Fresh correction batches verified **19**, then **17** additional cases. Remaining/interrupted cases stayed in the rerun selection; the final residual case was checked separately below.                                                             |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test --last-failed --workers=1 --trace=retain-on-failure --timeout=180000`                  | **Exit 0**: the final residual new-skeleton IK case passed. **413 + 19 + 17 + 1 = 450** successful original desktop cases across the audit/reruns; no unresolved or unrun cases remain.                                                              |
| `PPE_PACKAGE_BROWSER=1 PLAYWRIGHT_CHANNEL=chrome npm run test:package` with `PPE_WORKFLOW_CHARACTER_DIR` set to the production export | **Exit 0**: **5 browser tests passed**, none skipped, including repeated two-Actor scenes, walk cancellation, shutdown, Puppet-only controls and the exact production editor ZIP playing baked motion/events/skin in an independent packed consumer. |
| `VITE_PROFILE=1 npx vitest run tests/choreography.profile.test.ts --maxWorkers=1 --reporter=verbose`                                  | **Exit 0**: **12 measurement cases passed**; actual CPU results above.                                                                                                                                                                               |

The handoff uses the ZIP produced by the production `tests/browser/releaseWorkflow.spec.ts` scenario, extracted outside the checkout before browser output cleanup. To reproduce it, set `PPE_WORKFLOW_CHARACTER_DIR` to that extracted directory and use the consumer command above.

Normal unit skips are opt-in performance diagnostics, not failed tests. Vite reports dependency `use client` directive and large-chunk warnings while building; these do not fail builds. Local browser servers require permission to bind localhost in the execution sandbox; verification used installed Chrome. The local harness now allows 180 seconds per ordinary workflow and 15 seconds per assertion; existing specialized workflow budgets remain explicit. These are test budgets, not runtime performance claims.

Browser fixture corrections preserve existing bone selection when editing across clips, close Clip Settings before opening the bone hierarchy, account for clipped endpoint grab offsets, derive rig projection from actual canvas dimensions, and respect pixel-dependent snap ranges/summary grouping. New-character workflows wait for editor readiness; collapsed-section spacing checks measure visible cards after layout. Previously phone-sized workspace cases now use desktop window sizes. No editor layout changes were needed; inspector sections still start collapsed. Browser checks remain local-only.

## Manual verification

No human visual or interactive acceptance pass was performed. Browser results refer only to automated desktop Playwright checks. No mobile validation or CI browser installation/testing was added.

## Changed files and limitations

Runtime changes are limited to `ActorMovement.ts` validation/scalar coordinate reads and `ChoreographySequence.ts` releasing stored commands and freezing early terminal results. The reusable `src/examples/choreography.ts` has a checked standalone copy and desktop browser entry. New integration/profile/browser tests, corrected export/drag smoke helpers, local browser timing budgets, public boundary checks, package example compilation, guides, changelog and package/lock/standalone version metadata complete the change.

There is no navigation, physics, root motion, continuous gaze, dialogue/camera/branching, visual scene timeline or serialized choreography format. Async cues are unsupported. Parallel Actor/Puppet overlap is conservatively rejected even if timed steps might not overlap. A moving parent can add world displacement; collapsed transforms cannot support motion/facing. No catch-up delta passes across promise boundaries. Multiple borrowed wrappers should not issue competing direct movement commands. Host notification exceptions retain existing synchronous error semantics. Textures are shared host resources, and retained public handles intentionally keep their bound objects accessible.

## v0.9 considerations

Build host dialogue/sound/camera adapters over typed actions and outcomes. Define cancellation handoff and ownership before accepting asynchronous host work. Preserve one playback clock and exact-instance outcomes. Introduce any authored scene schema or navigation adapter separately, with explicit coordinate and conflict policies; preserve editor/runtime separation and Puppet-only consumers. Profile realistic browser scenes before choosing performance budgets. Keep browser checks local and dependency audits manual or push/PR-triggered according to repository policy.
