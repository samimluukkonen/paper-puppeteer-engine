# v1.3 audiovisual integration and hardening

[All guides](../README.md#guides) · [Creating an Audiovisual Scene](creating-an-audiovisual-scene.md)

## Readiness verdict

**Ready for the private v1.3 audiovisual workflow within the documented browser/backend limits.** Strict TypeScript, lint/formatting, all 3,852 normal unit tests, builds, the packed standalone consumer and both local performance diagnostics pass. All 98 selected development/production browser cases have passing final results: 78 passed in the initial matrix, and the 20 affected cases passed after correcting inspector-tab navigation assumptions in the tests. No application regression remained in these checks. A human listening assessment and independent artist acceptance session remain unperformed; automated interaction and screenshot inspection are identified separately below.

## Architecture and synchronization

| Area                   | Implementation and contract                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio assets           | Existing project registrations own stable IDs, names, categories, portable paths and optional decoded duration. Original WAV/MP3/OGG binaries stay in project storage and packages. `AudioAssetLoader` validates content, shares decodes by SHA-256, supports retry/cancellation and caps decoded resources at 128 MiB per loader.                                                                               |
| Timeline and scheduler | Optional scene-format-2 `audioAssets`, `audioTracks` and finite `audioClips` preserve source offsets, volume, loops and fades. `getActiveAudioClipsAtTime` evaluates half-open intervals. `SceneAudioController` reconciles one owned voice per active clip with the authoritative scene time.                                                                                                                   |
| Shared time            | `SceneRunner` owns the millisecond clock. Actor actions, animation/root translation, camera keys/cuts, fades, audio and dialogue sample that clock. Web Audio consumes seconds at its backend boundary; its elapsed counter detects drift, rather than advancing scene state. Speed affects scene delta and audio rate together.                                                                                 |
| Transport              | Pause and passive seeking stop voices. Seek reconstructs isolated Actors with gameplay events/cues suppressed; resume starts only active clips at their current source positions. Restart begins a fresh playback/cue pass. Stop, completion, scene switching and disposal release voices. Pending editor Play requests are invalidated by newer transport commands.                                             |
| Dialogue               | `SceneDialogueCommands` authors immutable lines through scene history. Speaker references use scene-local Actor IDs, with optional label override or narration. Validation rejects overlapping intervals and dangling speakers/voice references. `getDialogueAtTime` is pure; `SceneDialogueOverlay` renders safe-area text above fades independently of camera motion. A host may supply `SceneDialogueTarget`. |
| Cues                   | The existing named `SceneRunner.onCue` dispatches only during playback. Seek consumes crossings without notification, while Restart permits a new pass. Dialogue voice IDs and audio IDs in cue payloads are metadata; authored sound has one timeline owner. Hosts must avoid independently duplicating it in cue handlers.                                                                                     |

No authored format, public method signature or major subsystem was introduced. Browser audio nodes, decoded buffers, render objects, preview preferences and Blob URLs remain outside serialized scene data.

## Changes in this milestone

`AudioAssetLoader.clear()` now invalidates its cache and attempts every decoded-resource release after an audition stop failure. `dispose()` also attempts backend disposal after resource failures, preserving all cleanup errors. Web Audio audition stops disconnect nodes in a `finally` block. Regression coverage injects both stop and resource-disposal failures and checks that a cleared loader can decode again and disposal remains idempotent.

The Scene dialogue inspector now accurately describes subtitle playback, paused display, silent scrubbing and Stop behavior.

Four Scene Explain tours use the existing guide registry and anchors: **Importing Audio**, **Audio Timeline**, **Creating Dialogue**, and **Audio and Scene Timing**. They require only an open scene, reveal collapsed controls, and preserve authored data, selected items, history, transport and preview state. Importing Audio explains the round trip through Project Workspace; the existing Project audio tour highlights the actual external library controls. Tours never load files, unlock audio or start playback.

## Persistence and complete workflow

The expanded local `cinematicWorkflow.spec.ts` authors a scene through visible UI controls: project audio import; layered PNG backgrounds/foregrounds; two Actors and placement; walking choreography; a fixture-supplied attack with authored root keys; music, ambience, overlapping swing/impact effects; source trimming, gain and fades; two Unicode/Japanese dialogue lines; a timed cue; camera pan/close-up/cut and scene fades. The test exercises authored Undo/Redo, Play/Pause, repeated backward/forward seeks, IndexedDB autosave/recovery, standalone scene ZIP download, complete project ZIP export/reimport and a separate Phaser runtime consumer.

The portable package is validated independently. Assertions compare speaker references, text, source offsets, fades, volume, Actor data, camera and layer data. Project import checks all four original audio binaries remain present. The standalone consumer uses a real button gesture for browser audio unlock and real Web Audio decoding/nodes; passive seeks start no sound or cues. Playback resumes the active mix and teardown checks all owned voices stopped, decoded/disposed byte counts matched, the context was disposed, textures returned to baseline and no GameObjects remained.

Existing unit/integration tests retain exact subtitle/audio boundaries, adjacent/overlapping dialogue rejection, speaker deletion guards, optional narration, missing assets, codec failures, browser restrictions, clip looping/trimming/fades, mute/speed changes, stale asynchronous decode cancellation, cue suppression, scene import/export and autosave history coverage. The milestone adds failure-path cleanup tests and empty/populated preservation coverage for the focused guides.

## Regression matrix

| Surface            | Automated coverage                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rig Editor         | Existing rig structure/joint editing, artwork, IK and contact-marker unit suites and local browser workflows                                                 |
| Animation Editor   | Existing keyframe/Graph Editor, Pose Library, root-motion, Environment Preview, IK and transfer regressions                                                  |
| Scene Editor       | Actor placement/choreography, root-motion ownership, layers/parallax, camera keys/cuts/fades, audio, dialogue and cues; integrated recovery/runtime workflow |
| Project Workspace  | Binary validation/dependencies, audio management, Undo/Redo, autosave/recovery and portable ZIP round trips                                                  |
| Standalone runtime | Existing Node/package consumer checks plus the local independent Phaser/Web Audio scene consumer                                                             |

## Performance and resource measurements

Run `PLAYWRIGHT_CHANNEL=chrome npm run profile:scene` separately from browser tests. The local harness measures 2 or 5 real 16-bone Phaser Actors with IK, 10 or 510 actions, three 2048 × 1024 background/foreground textures, camera animation and 60 camera edits. It adds a three-minute music source, a short source shared by ambience and four effects, six concurrent clips, fades, source trims, Unicode dialogue, forty rapid seeks and twenty Restart/update/Stop cycles. PCM fixtures are silent, with real browser decode and node-allocation costs.

Measured locally on macOS 12.7.6 x64, Node 24.22.1 and installed Chrome, using the command above (exit 0). Each workload used six audio clips and three large artwork textures:

| Actors / actions | Audio decode (ms) | 60 updates (ms) | 40 rapid seeks (ms) | 20 Restart/update/Stop cycles (ms) | 60 camera edits (ms) | Scene ZIP export (ms) |
| ---------------- | ----------------: | --------------: | ------------------: | ---------------------------------: | -------------------: | --------------------: |
| 2 / 4            |             871.4 |           159.0 |               231.4 |                              239.4 |               1083.2 |                 396.1 |
| 5 / 10           |             522.1 |           170.3 |               388.4 |                              370.1 |               1148.3 |                 473.5 |
| 5 / 510          |             485.0 |           253.5 |              6416.4 |                             2163.0 |               4796.3 |                 812.0 |

All workloads peaked at six simultaneous voices and decoded/released exactly **32,104,800 bytes** (30.62 MiB; browser resampling affects decoded size). Started/stopped voice counts were **126/126**, **126/126** and **128/128**, with zero remaining handles and one disposed backend context in each workload. The dense run required two extra drift reconciliations while advancing synthetic scene deltas. Actor construction/disposal counts matched at cleanup: **174/174**, **435/435**, **435/435**. All textures/GameObjects/listeners returned to their checked baselines. Sixty clock updates produced **zero authored-row mutations** and **zero depth-sort requests** in every workload. ZIP sizes were 8,214,014, 8,215,820 and 8,279,932 bytes.

Individual ordinary seeks took 5.8–9.0 ms. Dense seeks to nonzero positions took 95.7–199.5 ms (zero took 6.7 ms), reflecting deterministic reconstruction across hundreds of cue boundaries. This is a demonstrated existing density cost, documented for authors rather than hidden behind a new seeking model. No speculative optimization was added. Values use explicit synthetic scene deltas and synchronous React updates. They exclude normal frame pacing/GPU rendering and are diagnostics rather than timing gates or sample-accuracy/listening measurements.

Every workload checks Actor disposal, GameObject/shutdown-listener counts, texture cleanup and unchanged source assets. Audio instrumentation checks zero retained playback handles, equal started/stopped voices, equal decoded/disposed bytes and one disposed backend context after each workload. Browser scene switching and project recovery/export tests cover the associated object-URL and subscription lifecycle through existing owners.

The separate `PLAYWRIGHT_CHANNEL=chrome npm run profile:project` diagnostic also passed (exit 0). It used five 16-bone characters with 256 additional keys each, three scenes with five Actors, two audio clips and Unicode dialogue per scene, and 8,026,288 encoded audio bytes including the three-minute source. The complete ZIP contained 82 files and 8,277,048 bytes. Across three runs:

| Operation                                  | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) |
| ------------------------------------------ | ---------: | ---------: | ---------: |
| Project export / ZIP                       |      419.9 |      405.3 |      449.4 |
| Project import, including audio decoding   |     1000.2 |      781.5 |      849.3 |
| Package preparation and IndexedDB autosave |      452.3 |      451.6 |      471.7 |
| IndexedDB recovery and project import      |      855.3 |      867.3 |      809.6 |

Original/imported audio bytes and authored character/scene data matched. Workspace shell initialization took 1579.3 ms; initial character metadata/artwork loading took 51.3/101.9 ms. Resource counters describe owned-handle/buffer release, not a browser garbage-collector heap measurement.

## Files and APIs

- Runtime: `src/engine/AudioAssetLoader.ts`; existing `AudioAssetLoader.clear/dispose` and Web Audio audition cleanup, with no signature changes.
- Authoring: `src/devtools/scene-editor/SceneDialogueInspector.tsx`; accurate playback help, no new view/header/style implementation.
- Guides: `src/devtools/shared/guides/sceneGuides.ts`; four focused entries, existing prerequisites and spotlight preparation.
- Tests: `tests/audioAssets.test.ts`, `tests/sceneAudioPlayback.test.ts`, `tests/sceneGuides.test.ts`, `tests/browser/sceneAudioGuide.spec.ts`, `tests/browser/sceneDialogueGuide.spec.ts`, `tests/browser/cinematicWorkflow.spec.ts`, `tests/browser/cinematicRuntimeHarness.ts`, and the shared `tests/browser/trackedAudioBackend.ts` instrumentation. Existing `footContactProductionWorkflow.spec.ts` and `personalProductionWorkflow.spec.ts` now explicitly reveal inspector tabs after commands/selection switch them.
- Profiling: `tests/browser/sceneProfileHarness.tsx`, `tests/browser/projectProfileHarness.ts`, `scripts/profile-scene-workflow.mjs`; real audio resource accounting and audiovisual project data added to the existing local diagnostics.
- Documentation/version: artist walkthrough, this report, guide/architecture/profiling references, README, CHANGELOG and synchronized package/lockfile metadata at 1.3.6.

## Verification commands

All test runners use one worker, with commands executed sequentially. Browser tests remain local-only; no CI browser or scheduled-audit steps were added.

| Command                                                   | Result                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                       | Exit 0; strict TypeScript passes, also repeated by check/build.                                                                                                                                                                                                                            |
| `npm run check`                                           | Exit 0; Oxfmt, Oxlint and TypeScript pass.                                                                                                                                                                                                                                                 |
| `npm test`                                                | Exit 0; 219 files passed, 7 skipped; **3,852 tests passed, 53 skipped**, 140.35 seconds. Existing opt-in profile tests remain skipped.                                                                                                                                                     |
| `npm run build`                                           | Exit 0; authoring app, library, declarations and Node core checks pass. Existing Lucide `use client` bundling warnings remain nonfatal. `npm run build:demo` also passed after the final guide wording change.                                                                             |
| `npm run check:version`                                   | Exit 0; package/lockfile 1.3.6 and changelog agree.                                                                                                                                                                                                                                        |
| `npm run test:package`                                    | Exit 0; isolated offline packed install, documentation links, public declarations, Node/runtime examples, compatibility and browser bundling pass.                                                                                                                                         |
| `npx vitest run tests/sceneGuides.test.ts --maxWorkers=1` | Exit 0; all 13 guide tests pass after final wording/test adjustments (1.13 seconds).                                                                                                                                                                                                       |
| Initial browser matrix below                              | Exit 1; **78 passed, 20 failed** in 26.0 minutes. Failures were test navigation assumptions: two older workflows continued using controls after their inspector tab changed, and the four short tours were incorrectly required to reveal Edit despite having no document-command targets. |
| Corrected-case browser command below                      | Exit 0; **all 20 affected cases passed** in 5.3 minutes across development and production. Original JSON, selection/history/preview preservation and zero-audio-start assertions remain intact. All 98 selected cases therefore have passing final results.                                |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:scene`         | Exit 0; three workloads, six concurrent clips, long media and complete resource cleanup, measured above.                                                                                                                                                                                   |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:project`       | Exit 0; three export/import/autosave/recovery samples and binary/data equality, measured above.                                                                                                                                                                                            |
| `git diff --check`                                        | Exit 0.                                                                                                                                                                                                                                                                                    |

Initial local desktop matrix (19 spec files, 98 cases; a selected regression matrix, not all repository browser specs):

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/cinematicWorkflow.spec.ts \
  tests/browser/sceneAudioGuide.spec.ts tests/browser/sceneDialogueGuide.spec.ts \
  tests/browser/sceneAudioPlayback.spec.ts tests/browser/sceneDialoguePlayback.spec.ts \
  tests/browser/sceneAudio.spec.ts tests/browser/sceneDialogue.spec.ts \
  tests/browser/projectAudio.spec.ts tests/browser/projectAudioGuide.spec.ts \
  tests/browser/sceneEditor.spec.ts tests/browser/sceneRootMotion.spec.ts \
  tests/browser/sceneTransitions.spec.ts tests/browser/sceneTransfer.spec.ts \
  tests/browser/cameraAnimation.spec.ts tests/browser/personalProductionWorkflow.spec.ts \
  tests/browser/advancedAuthoring.spec.ts tests/browser/footContactProductionWorkflow.spec.ts \
  tests/browser/animationEnvironmentPreview.spec.ts tests/browser/animationGraphEditor.spec.ts \
  --workers=1
```

Passing rerun of every affected case after rebuilding the production app:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/footContactProductionWorkflow.spec.ts tests/browser/personalProductionWorkflow.spec.ts \
  tests/browser/sceneAudioGuide.spec.ts tests/browser/sceneDialogueGuide.spec.ts \
  --grep 'artist contact workflow|personal production|scene-importing-audio|scene-audio-timeline-basics|scene-audio-scene-timing|scene-creating-dialogue' \
  --workers=1
```

## Actual manual verification

The desktop `audiovisual-dialogue.png` screenshot from the integrated development-browser workflow was inspected: the shared header/navigation, compact controls, initially collapsed transition inspector and audience-frame subtitle backing remain consistent with the animator style. English and Japanese text are readable inside the output safe area against the generated background/foreground artwork. This was visual inspection of an automated capture. No human listening assessment or independent artist acceptance session has been performed, and automated UI actions are not claimed as manual verification.

## Known limitations and next milestone

- Browser codec and autoplay support vary. Audio unlock must originate from a user action; runtime hosts provide their own enable UI. Errors remain actionable and retryable.
- Web Audio decodes complete files; there is no streaming. Long compressed tracks can exceed the decoded budget even below the encoded 10 MiB import limit. Playback speed changes pitch.
- Scheduling follows host updates, with 80 ms drift tolerance and a 250 ms minimum correction interval per voice. A very short clip entirely crossed by a stalled frame is skipped; no sample-accurate/offline audiovisual rendering is promised.
- One subtitle at a time; long text is bounded to twelve wrapped lines and two speaker lines, with scaling for large content. Authors should split long passages and inspect font availability/readability, especially Japanese, at their intended output size.
- Root-motion/action edits and dialogue edits reconstruct playback from the initial state; artwork/camera/audio edits preserve the playhead. Seeking reconstructs Actors and scales with action count and asset complexity.
- Cue notifications require host behavior for gameplay consequences. Dialogue voice references do not synthesize speech, align audio or add branching.

Recommended next milestone: use the integrated workflow for a real artist-authored short scene, listening to the exported runtime at intended output size, and address observed usability/performance issues before expanding features. Voice synthesis, lip sync, branching, recording, spatial audio and online collaboration remain outside v1.3.
