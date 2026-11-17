# v0.9 Scene Editor production readiness

Historical verification report: the standalone `examples/` application has since been removed. Its commands and results below describe the recorded release, rather than the current checkout. See the [runtime integration guide](runtime-integration.md) for current usage.

[All guides](../README.md#guides) · [Making Your First Scene](making-your-first-scene.md) · [Scene format and APIs](scene-editor.md)

## Readiness verdict

v0.9 is ready for the supported desktop workflow: visually authoring finite, scripted character scenes, previewing and seeking them, exporting/reloading them, and playing the exact exported package through the standalone runtime. The required typecheck, unit tests and builds pass, together with lint/formatting, 122 focused development/production browser cases and packed-consumer verification. No release-blocking defect was observed within that scope. Human artist acceptance was not performed, and the complete 470-case browser catalog was not completed. The limits below remain explicit.

## Architecture and ownership

`SceneEditorDocument` owns immutable per-scene snapshots, selection, saved checkpoints and bounded `SnapshotHistory`. React owns the document commands, dialogs, collapsed inspectors and action timeline. The independent `/scene-editor/` route mounts a single Phaser stage through a layout effect. The stage reconciles independent `Actor`/`Puppet` instances through `SceneActorPreview` and caches immutable character definitions/artwork at the page/game boundary.

`SceneEditorPlayback` owns view-only playhead/status/speed and a separate `SceneRunner`. It binds only after metadata and artwork are available. Preview edits never enter the scene document. Authored changes and scene replacement reset playback; selection changes keep it running. The placement preview and runtime preview intentionally have separate Actors, so runtime positions never replace authored initial placement. Hidden placement instances remain owned until removal or teardown.

Playback subscriptions are now confined to `ScenePlaybackControls`, `SceneTimeInput`, `ScenePlayhead`, error observations and an expanded `ScenePlaybackInspector`. The large authored `SceneTimeline` tree does not subscribe to Phaser frames. Closed runtime inspectors have no playback subscription. No engine module imports React/editor modules.

## Format, scheduling and runtime adapter

Scene format **version 2** remains unchanged. It stores a finite millisecond duration, stable scene/Actor/action IDs, permanent character-manifest references, initial position/facing/skin/animation and declarative animation/move/face/wait/cue actions. Character, rig and animation formats remain version 1. No rigs, IK tracks, skins, attachments, sprite bytes, runtime instances or view preferences are embedded in scene JSON.

Pure `/core` and `/serialization` APIs validate/parse/serialize declarations, resolve referenced character definitions and build/validate scene packages. Optional `SceneLoader` in `/runtime` loads hosted JSON or ZIPs and constructs exclusively owned Actors with `autoUpdate: false`. The host advances its `SceneRunner` once per Phaser frame and disposes the returned lease on replacement/shutdown. `Actor` and `Puppet` remain independently usable.

`SceneRunner` uses one delta clock, sorts starts stably, and splits large deltas at authored starts/ends. Ends release ownership before adjacent starts. Independent Actor clocks receive the same intervals. Animation and position channels may run together; overlapping ownership on one channel and equal-time facing commands for one Actor are rejected. Waits own no channel and do not shift absolute starts. Cues at tied times retain authored array order. Non-looping animations hold their last pose until their scene window ends; later idle must be scheduled explicitly. Scene windows use hard cuts (`fadeDuration: 0`). Runtime crossfading remains covered by the existing Actor/Puppet regression suite, but authored scene crossfades are unsupported.

The timeline uses shared animation-editor time/ruler/snapping utilities, independent scene action selection and grouped gesture history. Drag/resize commits one Undo entry; cancellation restores the prior snapshot and preserves Redo. Numeric values preserve authored precision. Timed actions need a positive duration and must fit within the scene; place the playhead before the endpoint when adding them.

## Seeking, events and interruption

Seeks clamp to the scene duration, pause playback, dispose obsolete runtime contexts, reconstruct initial Actor state and simulate supported declarations to the target. Forward/backward seeks therefore depend on authored data and target time rather than previous playback. Reconstruction suppresses animation gameplay events/completion callbacks and scene cues. Resuming consumes only future events; Restart is a new playback and can deliver cues again. Seeking to the endpoint completes and freezes the scene.

Initial-placement sampling now also sets animation preview mode and explicitly disables crossfades. Changing the selected initial animation cannot dispatch its time-zero gameplay event. This closes the same side-effect boundary for authoring as the runtime seek boundary.

The runner detects active animation/movement interruption, stops its own pending work and preserves newer external owners. Cancellation, completion and disposal settle owned waits; generation checks ignore obsolete movement continuations after seek/restart. Arbitrary callbacks, choreography scripts, state policies and procedural target providers are excluded from deterministic reconstruction.

## Import/export, packages and source isolation

Imports preflight every referenced character, initial/scheduled animation and skin before registering an immutable working copy. Failed/canceled imports retain the previous scene, history and playback source. Dirty replacement needs the existing discard confirmation. A fresh document, including a same-ID import, starts with collapsed inspector disclosures; ordinary authored edits preserve disclosure state. Canonical JSON preserves arrays/numeric values, sorts object keys and ends with a newline. Downloads checkpoint their captured snapshot; clipboard copies do not checkpoint it.

Editor file/paste relative references resolve from the editor page URL; runtime JSON references resolve from its hosted URL. ZIP exports include only referenced characters and required files, deduplicate repeated references, rebase shared assets, and rewrite only a detached export. Runtime ZIP loads have no network fallback and own their temporary image URLs/private texture aliases. Hosted textures remain shared and host-owned. The editor imports JSON; runtime `SceneLoader` and the standalone page also import scene ZIPs.

The complete browser workflow creates two different packages visually, positions Actors, chooses initial animations, schedules movement/walk/facing/cue actions, previews, seeks both ways, retimes, undoes/redoes, exports/reloads JSON and saves the exact scene ZIP for an independently packed consumer handoff. Package regressions check source/working snapshots and binary preservation. None of these operations writes source character files.

## React/Phaser lifecycle

Stage pointer/window listeners use an abort controller; document subscriptions and resize observers are released on shutdown/unmount. Serialized character artwork loading checks liveness after awaits and cancels through the existing loader on scene shutdown. Removed/replaced Actors are disposed; scenes switch without reconstructing the Phaser game. Metadata is page-cached, textures game-cached, and actor disposal never removes shared artwork.

Placement teardown now clears its ownership map before attempting every Actor cleanup and reports failures afterward. Stage shutdown attempts both runtime and placement cleanup even if either throws. Playback disposal clears source/factory/runner references and publishes the disposed state even when underlying cleanup fails. Repeated disposal is safe. The local profile additionally asserts no surviving Actor, GameObject or extra shutdown listener after each workload and unchanged source definitions.

## Performance observations

Command: `PLAYWRIGHT_CHANNEL=chrome npm run profile:scene`. One local before/after run on 2026-10-19 used real Phaser, a shipped 16-bone character with two active IK constraints per Actor, simultaneous straight-line moves and looping walk clips. The dense case adds 500 cue markers. These are synchronous diagnostic CPU/React observations, not wall-clock frame pacing or GPU benchmarks, and they exclude the main stage’s grid/selection overlay work. Cold caches and machine load affect results; timings are not test thresholds.

| Workload              | Before: 60 updates | After: 60 updates | Before: React render time | After: React render time |
| --------------------- | -----------------: | ----------------: | ------------------------: | -----------------------: |
| 2 Actors, 4 actions   |           215.2 ms |           92.6 ms |                  164.8 ms |                  40.2 ms |
| 5 Actors, 10 actions  |           295.9 ms |           81.2 ms |                  230.6 ms |                  33.8 ms |
| 5 Actors, 510 actions |         2,380.4 ms |          181.0 ms |                2,079.0 ms |                  29.7 ms |

React measurements cover the 60 updates plus five seeks (65 commits); update wall times exclude those seeks. Separating clock observations from the authored track tree addresses the measured repeated rendering cost, without changing runtime stepping or throttling the scene clock.

After the change, the five tested seeks took 3.9–6.3 ms for two Actors, 6.5–10.0 ms for five Actors, and 6.1–186.2 ms for the dense scene. Reconstructing dense timelines remains noticeable; no unsupported cache or event shortcuts were added. Larger rigs, decoded artwork, GPU rendering and artist workloads need their own measurements. The diagnostic asserts all created Actors are disposed at cleanup (14/14 for two Actors; 35/35 for each five-Actor workload). A final rerun on 2026-10-20 passed all Actor/GameObject/listener cleanup and source-isolation assertions; its 60-update times were 85.7, 99.7 and 196.0 ms respectively. The before/after table above records the original comparison rather than mixing measurement runs.

## Changed files and APIs

- `SceneActorPreview.ts`, `SceneEditorPlayback.ts`, `SceneStage.tsx`: silent initial pose sampling and complete cleanup under failure.
- `ScenePlaybackControls.tsx`, `SceneTimeline.tsx`, `ScenePlaybackInspector.tsx`: isolated frame subscriptions and lazy runtime observations.
- Scene view/Actor/action panels and `main.tsx`: stable guide anchors, the existing guide host and collapsed disclosures after a fresh same-ID import.
- `shared/guides/sceneGuides.ts`, `scene-editor/sceneGuideHost.ts`, registry/anchor/types; `FeatureGuide.tsx`; guarded character-workspace host/navigation: eight scene tours without cross-workspace data loss.
- Scene unit/browser regressions; `firstScene.spec.ts`; optional standalone exact-ZIP handoff; `sceneProfileHarness.tsx`, profiling scripts and `profile:scene` command.
- First-scene guide, reference/development/profiling/Feature Guide docs, README/changelog and v0.9.6 package/consumer metadata.

No public engine API or authored schema change is required by this hardening milestone.

## Automated checks and actual manual verification

New unit regressions cover initial-pose event isolation, cleanup failures and binding release, replacement character ownership, guide prerequisites/source-history isolation, five concurrent Actors over repeated forward/backward seeks and restart/stop cycles, adjacent hard cuts, and zero-delta/exact-boundary cue behavior. Existing regressions cover scene validation/conflicts, timeline edits/snapping/history, character references, serialization/package round trips, runtime scheduling/cancellation, loader cleanup and the rig/animation/v0.7/v0.8 runtimes.

Local desktop browser scenarios exercise real controls, Phaser, artwork and downloads against development and production builds. These are **automated**, not a claim of human artist/manual verification. No new human visual acceptance session was performed for this milestone. Browser smoke tests remain local-only; no browser CI or scheduled dependency audit was added.

| Exact command                                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                                                                                                                               | Exit 0                                                                                                                                                                     |
| `npm run test`                                                                                                                                                                                                                                                                                    | Exit 0; 184 files passed, 5 skipped; 3,205 tests passed, 56 skipped                                                                                                        |
| `npm run check`                                                                                                                                                                                                                                                                                   | Exit 0; formatting, lint and TypeScript passed                                                                                                                             |
| `npm run check:version`                                                                                                                                                                                                                                                                           | Exit 0; v0.9.6 package, lockfiles, consumer reference and changelog agree                                                                                                  |
| `npm run build`                                                                                                                                                                                                                                                                                   | Exit 0; demo/library builds, declarations and renderer-independent Node checks passed                                                                                      |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneEditor.spec.ts tests/browser/sceneTransfer.spec.ts tests/browser/firstScene.spec.ts tests/browser/sceneGuides.spec.ts tests/browser/featureGuide.spec.ts tests/browser/rigEditor.spec.ts tests/browser/animationEditor.spec.ts` | Exit 0; 122 passed across development and production (15.4 minutes)                                                                                                        |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/firstScene.spec.ts --timeout=90000`                                                                                                                                                                                                  | Exit 0; 2 passed, development and production                                                                                                                               |
| `PPE_WORKFLOW_SCENE_ZIP=/tmp/ppe-v096-first-scene.zip PPE_PACKAGE_BROWSER=1 PLAYWRIGHT_CHANNEL=chrome npm run test:package`                                                                                                                                                                       | Exit 0; packed Node/public API/docs checks, 3 standalone Node tests and standalone builds; 6 browser tests passed, 1 unrelated optional character-artifact handoff skipped |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:scene`                                                                                                                                                                                                                                                 | Exit 0; final 2026-10-20 run passed Actor, GameObject, shutdown-listener and source-isolation assertions for all three workloads                                           |
| `npm run test:package`                                                                                                                                                                                                                                                                            | Exit 0; final 2026-10-20 packed documentation/public API checks, 3 standalone Node tests, typecheck and production consumer builds passed                                  |

The full 470-case browser catalog was not completed for this milestone; browser verification is scoped to the scene, shared-guide and existing rig/animation smoke suites above. The complete native unit suite did run.

Builds retain the existing non-failing Lucide module-directive warnings and the standalone vendor-chunk size warning. No browser installation or browser smoke test was added to CI.

## Limits and recommendations for v1.0

Unsupported: pathfinding/obstacle avoidance, physics-based movement, branching logic, dialogue authoring, camera choreography, timeline-controlled audio, scene crossfades/overlapping base animations, scene-controlled animation layers and scene-level IK authoring. Scenes do not recover automatic drafts or import ZIPs into the editor. Character packages must be exported/hosted before scene authoring. Hosted/editor previews retain the existing texture-key conflict contract: the same key cannot identify different artwork URLs in one game. Use distinct keys for different hosted artwork; runtime ZIP leases already create private aliases. Runtime seeking rebuilds exclusively owned contexts and is not a rollback system for external gameplay state.

For v1.0, prioritize an artist acceptance pass using actual production packages, clear scene save/recovery expectations and asset-path handoff conventions. Measure larger production timelines before considering a seek cache or virtualization. Add future capabilities only when a concrete scene needs them, retaining independent character ownership, explicit channel conflicts and deterministic declaration semantics. Continue local desktop browser checks and packed consumer validation.
