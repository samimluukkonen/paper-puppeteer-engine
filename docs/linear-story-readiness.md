# v1.6.6 — Linear story integration and production hardening

Verification date: 2026-11-03. Desktop macOS x86_64, Node 24.22.1, installed headless Chrome. Tests run sequentially with one worker per runner. Browser checks remain local-only.

## Readiness verdict

**Automated v1.6 integration gates pass for the exercised desktop workflow; human artist acceptance remains pending.** All normal unit tests, release checks, 32 focused story/dialogue browser scenarios and the 16-case editor sample passed. The animation pixel check also passed six repeated runs after compositor normalization. No publication or deployment is part of this milestone.

## Supported workflow and contracts

| Area                       | Contract and evidence                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story data model           | Existing version-1 `StoryDefinition`: stable story ID/name, ordered entry IDs, source scene asset references and optional cut/fade arrival transitions. Scenes retain format version 2; character/animation formats are unchanged. No schema migration or gameplay state is introduced.                                                                                                                 |
| Sequencing                 | `StoryPlayer` retains one exclusive scene session, prepares current/next resources, discards loading/boundary excess delta and gives repeated references fresh playback identities. The synthetic acceptance story contains Forest Arrival, Samurai Encounter and Sword Demonstration; this content exists only in tests.                                                                               |
| Dialogue progression       | Timed lines run normally. Advance-required lines remain visible at their start until one command consumes one line. Time-zero/end holds and same-time exchanges use stable Line ID ordering. Stop/restart reset consumption. Reentrant commands cannot consume a successor inside one advance call.                                                                                                     |
| Clock ownership            | The host supplies one Phaser frame delta. `SceneRunner` clamps the cinematic clock at holds: choreography, movement/root motion, camera, fades, future scene cues and animation events freeze. Waiting time is discarded on resume. A two-minute simulated hold plus a partial idle cycle verifies the boundary.                                                                                        |
| Idle and audio             | Sparse Actor idle overlays use a hold-local clock, ignore root displacement/events and restore the cinematic pose on advance. Only explicitly authored Music/Ambience hold loops continue; ordinary scene audio pauses. The acceptance film overlaps ambience and sword SFX before its response hold. Scene handoffs stop scene-owned voices.                                                           |
| Deterministic seeking      | Mixed forward/backward/same-position seeks compare against fresh samples of packaged root motion, IK, mesh corrections, camera, transitions and dialogue. Seeking emits no new external cues, animation events or sounds, creates no interactive hold, and leaves authored data unchanged. Resuming after a seek considers holds at/before that sample passed for that preview pass.                    |
| Story Editor               | Existing Project Workspace Story Sequence supports create/rename, ordered source references, duplicate/remove, arrival settings, diagnostics and preview. Project Undo/Redo owns sequence changes; scene history owns dialogue/idle changes. No additional view header or inspector layout is introduced.                                                                                               |
| Player and input           | Standalone viewer and editor preview reuse `DialogueKeyboardInput`. Focus, typing/native controls, modifiers, IME and repeat guards preserve one line per deliberate press. Repeated keydowns across a handoff cannot consume the next scene’s opening line. Separate deliberate presses are intentionally accepted without a debounce delay.                                                           |
| Transitions and loading    | Synchronous stop/disposal from host transition rendering now cancels the remaining handoff operation and releases detached next-scene preparation. Overlay/load failures remain observable. Restarted editor previews tick while an obsolete load settles; late loads/tick failures/audio unlocks cannot replace or poison the new preview. Teardown releases the source even if player cleanup throws. |
| Export/import and recovery | Project ZIPs are editable backups; story ZIPs are portable runtime handoffs with shared binaries. Three-scene project export/draft recovery tests retain mesh rigs, animations/root motion and reusable choreography/templates. Browser reload/recovery and project reimport retain story ordering and fades. Standalone acceptance loads the generated story ZIP through the actual package adapter.   |
| Source isolation           | Sequence commands and preview preserve source scenes and shared rigs/skins/animations/root motion/mesh attachments. Dialogue edits replace the intended scene document while other scenes and reusable templates retain their snapshots. Current playback owns detached source snapshots.                                                                                                               |

## APIs and files changed

Public API signatures and authored schemas are retained. `StoryPlayer.start/update` add cancellation/error guards around presentation callbacks. `StoryPreviewScene` uses generation-scoped ticks, abort-aware attachment and session-scoped audio completion; it is exported only from its internal editor module for lifecycle tests, not from the engine package.

The shared guide registry adds `project-story-export` and `scene-dialogue-advancement`; `project-story-sequence` is titled **Creating a Story**. The existing **Idle Animation & Audio During Dialogue Holds** tour remains the fourth workflow. Guides use existing targets and reveal controls without authoring or playing. The [artist guide](creating-a-linear-story.md), Story Editor guide, Feature Guide documentation, README links, package guide-presence check, changelog and package/lockfile version metadata are updated to 1.6.6.

New tests include the shared `linearStoryFixture`, packaged cinematic/seek acceptance, editor preview lifecycle, project guide browser coverage, richer story source-isolation/recovery cases and transition reentrancy/failure cases. Browser standalone instrumentation records export, preparation, activation and runner update cost; the existing Story Sequence browser workflow now uses three scenes and actual browser recovery.

## Regression matrix

| Surface          | Automated coverage                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rig Editor       | Full normal unit suite: rig authoring, FK/IK, mesh geometry/skinning, skins, foot markers and editor history. Representative local browser rig workflow is included in the command results below.                                                                                                                                                  |
| Animation Editor | Full normal unit suite: timeline, root motion, graph channels, Environment Preview, variations, retargeting and mesh deformation. Representative browser animation/retargeting workflows are included below.                                                                                                                                       |
| Scene Editor     | Runner/action clocks, camera, fades, audio policies, dialogue boundaries, cues, deterministic scrubbing, authoring history and disposal; local browser scene/root-motion/hold workflows.                                                                                                                                                           |
| Story Editor     | Ordering/history, repeated source references, diagnostics, preview/restart/stop, silent source isolation, project ZIPs/drafts and browser reload recovery.                                                                                                                                                                                         |
| Standalone       | React-free ZIP consumer with real Phaser mesh rendering, 2048×1024 background, animated camera, concurrent audio, held input, fades, completion and texture/audio/listener cleanup. Existing focus/Space/audio activation/repeated mounting checks are retained. Packed consumer checks exercise public imports/declarations and browser bundling. |

## Performance

The representative browser workload uses three scenes, one/two Actors, a shared 144-vertex weighted mesh with IK and sparse deformation, shared 2048×1024 background, root travel, camera animation, overlapping scene audio and hold-local ambience, repeated keydown input and scene switching. The synthetic audio is a test tone; it is not a sound-design review.

Measurements are recorded in the `story-performance.json` browser attachment. Export includes scene/character dependency validation and ZIP encoding; preparation includes texture/audio acquisition; activation includes runtime construction. Runner update timings exclude GPU submission and are affected by browser tracing. These observations are diagnostics, not FPS guarantees, heap certification or benchmark thresholds. No speculative performance rewrite is justified by this small workload; current/next lease bounds remain covered by the existing preparation tests.

| Observation                          |             Development |              Production |
| ------------------------------------ | ----------------------: | ----------------------: |
| Story export + ZIP encoding          |                719.3 ms |                520.1 ms |
| Scene preparation, entries 1 / 2 / 3 |   98.6 / 12.6 / 61.8 ms |  102.8 / 12.3 / 23.1 ms |
| Scene activation, entries 1 / 2 / 3  |   53.1 / 31.8 / 12.3 ms |   52.7 / 26.3 / 15.7 ms |
| Runner update samples                |                     248 |                     270 |
| Median runner update                 |                  0.4 ms |                  0.4 ms |
| 95th-percentile runner update        |                  1.2 ms |                  1.0 ms |
| Decoded / released audio             | 176,400 / 176,400 bytes | 176,400 / 176,400 bytes |

Raw observations are retained in `docs/research/linear-story/measurements.json` in the repository; research artifacts are excluded from the installed runtime package. The workload found no sustained update-cost issue requiring an additional optimization. Cancellation hardening prevents blocked restarted previews and releases obsolete preparation instead of retaining it through the next playback pass.

## Exact command results

| Command                                   | Result                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check:release`                   | Exit 0. Runs the following gates sequentially.                                                                                          |
| `npm run format:check`                    | Pass: 1,097 matched files at release-check time.                                                                                        |
| `npm run lint`                            | Pass, no findings.                                                                                                                      |
| `npm run typecheck`                       | Pass; also run by build.                                                                                                                |
| `npm run check:version`                   | Pass: package, lockfile and changelog agree on 1.6.6.                                                                                   |
| `npm run test`                            | Pass: 258 files, 4,395 tests; 9 files / 60 existing optional tests skipped. Duration 173.02 s.                                          |
| `npm run build`                           | Pass: authoring application, library, declarations and Node core checks. Existing Lucide `use client` bundler warnings remain nonfatal. |
| `npm run test:package`                    | Pass: offline isolated packed install, guide/link checks, Node entry points, declarations, runtime sample and browser bundling.         |
| Local Playwright story/dialogue/guides    | Pass: 32 scenarios across development and production, one worker, 3.8 min.                                                              |
| Local Playwright editor regression sample | Pass: 16 scenarios across development and production, one worker, 3.0 min.                                                              |

Earlier exploratory failures are not passing gates: the initial sandbox browser attempt could not bind localhost, and an initial new test assumed an audio-unlock button would exist even when Chrome had already unlocked audio. The assertion now accepts either permitted browser state. An obsolete browser run was interrupted before rerunning final checks. The first full unit run exposed a detached next-preparation lease on reentrant cancellation; both handoff timings now pass after the fix. Source-isolation assertions compare reusable-library data rather than incidental object identity across project validation. The representative Animation Editor check also exposed compositor noise at the rounded canvas border: decoded captures differed at three border pixels by one color level, with identical pose pixels. It now uses the existing production workflow’s border normalization during capture and flushes renders before baselines; clock, pause and exact pose comparisons remain intact.

The focused browser command was:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/standaloneStoryPlayer.spec.ts tests/browser/storySequence.spec.ts tests/browser/storyGuides.spec.ts tests/browser/sceneDialogueGuide.spec.ts tests/browser/sceneDialogueHoldPresentation.spec.ts --workers=1
```

The representative editor command, including another persisted performance observation of the story fixture, was:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/rigEditor.spec.ts tests/browser/animationEditor.spec.ts tests/browser/sceneEditor.spec.ts tests/browser/sceneRootMotion.spec.ts tests/browser/animationRetargeting.spec.ts tests/browser/characterVariants.spec.ts tests/browser/standaloneStoryPlayer.spec.ts --grep 'numeric inputs retain precision|play, pause, resume|two-character encounter|two-Actor root-motion|visual retargeting|cancel before and after preview|character variants|three-scene cinematic' --workers=1
```

The affected animation pixel check was also repeated independently:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEditor.spec.ts --grep 'play, pause, resume' --repeat-each=3 --workers=1
```

Result: exit 0, six passes, 1.3 min. All final browser commands used one worker and no retries. The story fixture is intentionally exercised in both the focused and representative commands; the results are not 48 distinct test cases.

## Actual manual verification and limits

The complete browser inventory was not rerun; the commands above cover the integrated story workflow and a representative editor sample. All normal unit tests were run. No hands-on artist session or listening review has been performed. Automated browser navigation, canvas screenshots and native Web Audio checks are automated verification. Human acceptance still requires playing an artist’s complete three-scene film, reviewing dialogue readability/pacing, listening to audio synchronization and confirming the final exported standalone experience.

The acceptance fixture reuses an existing compatible animation across Actors. Actual visual retargeting has separate existing unit/browser coverage; the synthetic fixture does not pretend a retargeting operation occurred during playback. Its backgrounds/characters are diagnostic artwork, not finished forest/samurai art. Large production projects, maximum-complexity meshes and very long films need their own measurements. Portable ZIP metadata/bytes are validated as a whole at open; only current/next runtime resources are prepared. Backward seeks still reconstruct Actors; there is no new historical checkpoint system. Browser audio activation remains permission-dependent, music does not span scene sessions continuously, and there is no standalone upload view in the authoring application.

## Recommended v1.7 priorities

1. Complete the two-person artist acceptance film and resolve concrete pacing, readability and sound feedback.
2. Profile that film’s real assets and longer sequences; optimize only observed export, texture, decode or scene-switching costs.
3. If backward scrubbing is a measured bottleneck, define a complete Actor restore contract before adding historical checkpoints.
4. Improve the standalone host’s packaging/loading ergonomics while retaining linear progression, explicit resource ownership and desktop scope.

Branching, dialogue choices, controlled characters, combat, quests, inventory, gameplay scripting and collaboration remain outside scope.
