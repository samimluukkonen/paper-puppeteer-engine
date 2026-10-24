# v1.2.6 cinematic scene integration

[All guides](../README.md#guides) · [Creating Your First Cinematic Scene](creating-your-first-cinematic-scene.md)

**Verdict:** v1.2 is ready for the supported private cinematic workflow exercised here. Required non-browser checks pass, and all 104 selected desktop browser cases were verified across the main run and corrected timeline recheck. No data-loss or serious playback regression was observed in that scope. The complete 610-case browser catalog and a separate human artist acceptance session were not completed.

This milestone integrates the existing v1.2 scene composition/camera features. It does not introduce another scene format, clock, renderer or animation subsystem. Verification date: 25 October 2026 (Europe/Helsinki). Verification was performed locally on Node 24.19.0 with installed desktop Chrome, against the development server and production base path. The test results below distinguish automation from manual acceptance.

## Architecture and compatibility

| Concern     | Implemented contract                                                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artwork     | Independent PNG/static WebP scene elements; stable element IDs, asset references and immutable binary registry; project image reuse; authored center, scale, opacity and visibility                                        |
| Layers      | Back-to-front authored arrays, foreground-first inspector; fixed whole-Actor band; bounded depth bands keep artwork below fades and editor overlays; editor-only locks                                                     |
| Parallax    | Shared `parallaxPosition`: authored position plus `(1 - factor) * cameraCenter`; actors remain at factor 1; explicit center compensation matches editor/runtime independent of zoom/output size                            |
| Cameras     | Free editor viewport remains view state. Authored center/zoom defines a fixed 1000 × 700 audience frame; `SceneCameraPreview` saves/restores navigation, `LoadedScene.applyCamera` opts the host into synchronized framing |
| Timeline    | One millisecond `SceneRunner` clock schedules Actor movement/animation and evaluates sparse X/Y/zoom keys using shared property interpolation; Linear, Stepped and bounded Bézier curves; no new character animation owner |
| Cuts        | Existing channels with stepped incoming intervals; capture creates a zero baseline if necessary and one Undo/Redo command; exact boundary belongs to the new shot                                                          |
| Fades       | Pure linear color/opacity evaluation; non-overlapping intervals with final-value holds; one output-frame overlay above artwork/Actors and below guides; no wall-clock tween                                                |
| Seeking     | Fresh isolated Actor contexts reconstruct declarative actions; camera/parallax/fades are sampled directly at time; passive seeking suppresses cues and animation gameplay events                                           |
| Legacy data | Missing artwork/tracks/transitions stay absent; virtual Background/Actors layers, unit parallax, camera center (0,0)/zoom 1, clear overlay; existing choreography, character packages and rig/animation schemas retained   |
| Persistence | Scene JSON stores references; scene ZIP and project ZIP include dependencies; local browser autosave stores a complete recoverable package payload with image binaries; exported files are separate checkpoints            |
| Rendering   | Editors retain smooth filtering and FIT. Optional host nearest filtering, pixel rounding and integer display scaling are documented without forcing pixel art                                                              |

The public camera, transition, scene-loading and package APIs remain unchanged. The runtime image renderer now skips unchanged texture/depth writes. It also releases the shared byte/pixel reservation when private artwork is removed or decoding fails. Reservations use actual private texture keys, so independent renderers cannot undercount identical references or release each other's allocation. Rejected complete-image checks roll back partial charges while retaining any previous valid reservation. Phaser queues a display-list sort on every `setDepth`, even for an identical value; actual depth/order changes still apply immediately.

## Integrated verification

The new public document/package regression authors three artwork elements sharing one binary, ordered parallax layers, two Actors, concurrent movement/animation, pan/zoom keys, a cut and fades. It checks Undo/Redo, retained scene switching, project isolation, full package recovery payloads and standalone export. Existing tests independently cover IndexedDB durability, aborted writes, recovery hashing, legacy definitions, animation events, camera curves and transitions.

The new local desktop workflow creates a project with a shipped character and a scene through actual UI controls, imports sky/mountains/foreground binaries, reorders and configures parallax layers, adds two Actors, schedules movement plus animation, creates camera keys/a cut/fades, previews and seeks repeatedly, and exercises Undo/Redo. It reloads and recovers the browser draft, compares the same canvas frame, exports/reimports the project and compares it again. Its exact downloaded scene ZIP then loads in a separate Phaser game through `SceneLoader.loadPackage`, with no editor dependencies in the consumer bundle. It checks forward/backward boundary samples, full Actor poses, framing, parallax image positions, depth, fade opacity, playback/seek equivalence, stable texture counts and complete disposal.

The guide catalog has twenty-two scene tutorials. Eight focused cinematic entries reuse existing verified workflow steps; the ninth requested topic, Previewing a Scene, already exists. Registry/unit tests and the local guide traversal exercise availability, real unique anchors, empty/populated states, selection/history preservation and missing-selection handling. Tours reveal controls without authoring or playback commands.

## Performance observations

`PLAYWRIGHT_CHANNEL=chrome npm run profile:scene` measures real Phaser objects and React timeline work with two/five Actors, two active IK constraints per 16-bone character, three 2048 × 1024 textures, factors 0/0.2/1.2, animated camera center/zoom and optional 500 cues. Sixty explicit updates and five seeks measure synchronous CPU/UI work; sixty camera-key edits include timeline rendering; ZIP export includes character resource loading. These are local diagnostics, not FPS guarantees or timing thresholds.

A reproduced lifecycle failure rejected a second valid one-pixel image after the first was removed under a one-pixel shared budget. The regression now switches repeatedly without accumulating retired allocations, verifies independent renderers are charged separately, and retries after failed decoding/allocation.

Before the renderer guard, each workload queued **180 artwork depth sorts in 60 updates**. After the guard, all three queued **zero**. This establishes removal of redundant work; noisy end-to-end timings do not establish a frame-rate improvement. Actor/GameObject/shutdown-listener and private artwork texture counts returned to baseline after each workload. Source character metadata remained unchanged. React playback commits belong to clock controls/playhead; camera-key edits deliberately rebuild authored timeline content.

One final local run, performed separately from browser tests:

| Actors / actions | 60 updates (ms) | Five seeks, min–max (ms) | 60 camera edits (ms) | Scene ZIP export (ms) |
| ---------------- | --------------: | -----------------------: | -------------------: | --------------------: |
| 2 / 4            |            97.8 |                  4.7–6.7 |                794.3 |                 386.6 |
| 5 / 10           |           107.8 |                  8.2–9.6 |                753.5 |                 357.4 |
| 5 / 510          |           206.1 |                6.8–193.6 |               3945.3 |                 861.7 |

All workloads recorded zero authored timeline-row mutations during the sixty clock updates. The same shared artwork budget, capped at exactly three decoded images, was successfully reused across all workloads after disposal. Export includes localhost character resource loading and ZIP construction; compressed flat-color fixture images are small despite their decoded pixel dimensions. [Raw measurements](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/docs/research/cinematic-scene/measurements.json) retain the earlier depth-sort observation and final samples. Dense actions remain an observed latency limit; no seek cache or new timeline subsystem was introduced.

## Regression scope and acceptance

| Area               | Automated evidence                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Rig Editor         | Existing bone/joint, IK, foot/contact, sprite-alignment and skin unit/browser suites                                          |
| Animation Editor   | Existing keys, graph/curves, poses, IK, mirroring, onion skins, variations and diagnostics unit/browser suites                |
| Scene Editor       | Existing placement/action, artwork/layers, parallax, camera, keys and cuts/fades suites; new combined cinematic workflow      |
| Project Workspace  | Existing asset validation, switching, package/archive and autosave/recovery suites; new combined cinematic project round trip |
| Standalone runtime | Existing SceneLoader/Runner tests, new independently bundled Phaser consumer and packed-package consumer build                |

The [desktop screenshot](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/docs/research/cinematic-scene/first-cinematic-scene.png) was visually inspected: two separately placed Actors, background/midground/foreground order, opening fade, compact camera controls and shared timeline were visible. No separate human artist acceptance session is claimed. Browser workflows are automation through public UI controls. Screenshot inspection, when recorded below, is a visual review of those automated results, not evidence of unperformed manual editing.

## Files and APIs

- `SceneImageLayer.ts`: avoid unchanged texture/depth calls during camera samples; release private artwork budget reservations during removal/failure/disposal; public API unchanged.
- `characterTextureLimits.ts`: internal idempotent allocation release and atomic complete-image budget checks.
- `SceneCameraPanel.tsx`, scene stylesheet: reuse compact checkbox layout for Camera Key Edit mode and avoid stretched inspector checkboxes.
- `sceneGuides.ts`: focused tutorials derived from existing stable anchors and steps; guide registry IDs remain compatible.
- `cinematicIntegration.test.ts`, `cinematicWorkflow.spec.ts`, `cinematicRuntimeHarness.ts`: combined persistence/history/UI/standalone regressions.
- `sceneImageLayer.test.ts`, `characterTextureLimits.test.ts`, `sceneGuides.test.ts`: renderer work, repeated artwork switching, independent allocations, failure/retry accounting and expanded catalog coverage.
- `sceneEditor.spec.ts`: verify actual Actor lanes instead of a stale total-row count predating the camera/transition rows.
- `sceneProfileHarness.tsx`: cinematic workloads and lifecycle counters; development/local diagnostic only.
- Artist guide, linked camera/scene/guide/profiling documentation, README and this report.
- Package/lockfile version 1.2.6 and its changelog section. No CI browser installation/testing or scheduled dependency audits added.

## Limits and next work

Automatic camera following, advanced shake, scene-to-scene transitions, dialogue, audio timelines, lighting/shaders and physics backgrounds remain unsupported/deferred. Current transitions operate inside one scene. Output aspect remains 10:7; there is no video export, pixel-art scene flag or global editor filtering switch. Hosts own render filtering, their viewport and one runner update per frame.

Seeking reconstructs Actors and simulates preceding action boundaries. Dense cue/action timelines cost more than sparse scenes; there is no seek cache or virtualized timeline. Texture limits protect memory but do not guarantee smooth GPU playback for arbitrary high-resolution content. Custom procedural choreography/callbacks are not deterministic seek inputs. Multiple host cameras need deliberate overlay visibility ownership. Locks, editor navigation, guides, selection and view disclosures are intentionally browser/editor state.

Recommended v1.3 work: collect artist feedback on complete shots, then prioritize measured dense-scene seek/authoring latency and explicit output-format requirements. Add follow/shake/audio only under a separately scoped plan; they are not implicit v1.2 deliverables.

## Recorded commands

The required non-browser commands and standalone profiler pass:

| Command                                           | Result                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                               | Exit 0; also included in release/build verification                                                                         |
| `npm run test`                                    | Exit 0: 203 files passed, 6 skipped; 3,529 tests passed, 47 skipped (optional profiles)                                     |
| `npm run build`                                   | Exit 0: authoring application plus reusable library/declarations; Node entry points verified                                |
| `npm run check`                                   | Exit 0: formatting, lint and authoritative TypeScript checks                                                                |
| `npm run check:version`                           | Exit 0: package/lockfile/changelog agree on 1.2.6                                                                           |
| `npm run test:package`                            | Exit 0: isolated packed install, documentation links, Node APIs, declarations, runtime examples and browser consumer bundle |
| `npm run check:release`                           | Exit 0: the complete non-browser release sequence above                                                                     |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:scene` | Exit 0: all three cinematic workloads, texture budget reuse and cleanup assertions                                          |

The removed standalone examples application has no separate build; the existing packed consumer command builds the maintained runtime examples. Browser checks remain local-only.

The main local browser run covered 104 cases in 13 files across development and production: **102 passed, two failed on the same obsolete three-row timeline assertion** (exit 1, 26.3 minutes). The actual timeline has eight rows after camera and transition integration. The corrected test verifies the two intended Actor action lanes, retaining its full drag/resize/history/animation/cue/serialization assertions. No application behavior was changed for this correction.

The corrected case then passed in both modes: **2 passed**, exit 0, 32.7 seconds. This verifies all **104 distinct selected cases**; the original assertion failures are resolved. Six new unit regressions supplement the existing engine/editor coverage, and the new cinematic browser workflow runs once per server mode.

Reproduce the full selected scope with:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/cinematicWorkflow.spec.ts \
  tests/browser/sceneEditor.spec.ts \
  tests/browser/sceneArtwork.spec.ts \
  tests/browser/cinematicCamera.spec.ts \
  tests/browser/cameraAnimation.spec.ts \
  tests/browser/sceneTransitions.spec.ts \
  tests/browser/sceneGuides.spec.ts \
  tests/browser/sceneTransfer.spec.ts \
  tests/browser/projectWorkspace.spec.ts \
  tests/browser/rigEditor.spec.ts \
  tests/browser/releaseWorkflow.spec.ts \
  tests/browser/characterPackage.spec.ts \
  tests/browser/personalProductionWorkflow.spec.ts
```

Exact successful recheck command:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneEditor.spec.ts --grep 'visual scene timeline edits clips'
```

Full-catalog exploratory runs were interrupted (exit 130), including a slower two-worker attempt; **the entire 610-case browser catalog is not reported as completed**. Final cinematic/cross-editor verification used the repository's single-worker default. No browser checks/installations were added to CI.
