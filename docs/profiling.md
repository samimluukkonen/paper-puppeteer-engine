# Performance profiling

[All guides](../README.md#guides) · [Development guide](development.md#checks-and-profiling)

Use the Node version and dependencies described in the development guide. All profiles below are local diagnostics: CPU fixtures exclude browser/GPU costs, browser profiles include layout, and neither uses pass/fail timing thresholds. Normal unit runs skip optional measurements. Browser profiling remains excluded from CI.

The [v0.7 runtime controller report](runtime-controller-readiness.md#cleanup-and-performance) documents `VITE_PROFILE=1 npx vitest run tests/runtimeController.profile.test.ts --reporter=verbose`: one/twenty Puppets, continuous state changes, FIFO, crossfades, active IK and repeated async operations. Run it separately from browser suites for CPU observations without GPU costs or timing thresholds.

The [v0.8 Actor report](release-notes-v0.8.md#performance) records `VITE_PROFILE=1 npx vitest run tests/choreography.profile.test.ts --maxWorkers=1 --reporter=verbose`: one/two/twelve Actors, idle, concurrent walks, repeated crossfades during movement and active IK. Run it separately from other suites; CPU fixtures exclude browser/GPU work and have no timing thresholds.

Measurements below record earlier implementation comparisons on individual machines. They explain the corresponding changes and are not performance baselines for the current checkout. Rerun the commands to measure your workload and hardware.

For root-motion hardening, run `VITE_PROFILE=1 npx vitest run tests/rootMotion.profile.test.ts --maxWorkers=1 --reporter=verbose` separately from other suites. It measures normal/root playback, 1,001 root keys, twenty looping moving scene Actors, Graph Editor commits and rapid scrubbing. The [root-motion report](root-motion-hardening.md) records observations and scope; the minimal Phaser scene excludes GPU and browser layout costs.

The [v0.6.5 release report](release-readiness.md#performance-observations) records current candidate observations for small/complex characters, multiple Puppets, dense timelines, onion skinning, IK, scrubbing and replacement decoding. Run CPU and browser diagnostics separately, without other test suites competing for the machine. The repeated package/runtime lifetime diagnostic is also available with `VITE_PROFILE=1 npx vitest run tests/releaseReadiness.test.ts --maxWorkers=1 --reporter=verbose`; ordinary runs still assert object/listener cleanup without timing thresholds.

## Project and scene production baseline

Run these sequentially, separately from tests:

```bash
PLAYWRIGHT_CHANNEL=chrome npm run profile:project
PLAYWRIGHT_CHANNEL=chrome npm run profile:scene
PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline -- --workflow
```

`profile:project` opens the desktop workspace shell, fetches actual shipped character metadata/artwork, and creates five distinct characters sharing artwork, each with an extra 256-key clip, plus three five-Actor scenes. It reports three samples of complete project ZIP export, ZIP decode/import, package construction plus IndexedDB Blob/hash/transaction autosave, and digest-checked recovery/import. It checks authored character/scene equivalence and discards its own diagnostic draft in `finally`. Fetch/package timings exclude texture decode; the existing artwork workflow reports browser image decoding separately. Timings are observations, with no thresholds or claim about arbitrary project sizes.

`profile:scene` uses real Phaser artwork, two/five Actors, concurrent movement/animation and optional 500 cue markers; it checks Actor/GameObject/shutdown-listener cleanup. Sixty explicit updates measure CPU/UI work, not rendered FPS. The [v1.0.5 report](personal-production-readiness.md) records current measurements and workload limits.

## Animation, layers, IK, and demo presentation

To isolate animated IK channel evaluation, run
`VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts -t '8 IK channel tracks' --reporter=verbose`.
Four workloads compare smooth and 10 FPS stepped sampling, with one layer or three masked layers
including partial weights and fades. They measure channel composition through `AnimationPlayer`,
excluding constraint solving and presentation.

Run the optional CPU frame profile with `VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose`. It reports warmed medians for base animation, layered fades, dense scrubbing, IK channel composition and active/inactive IK constraints. The lightweight scene excludes browser rendering and GPU costs; timings vary by machine and are not test thresholds. Normal test runs skip these measurements. Engine Demo presentation workloads have been removed.

### Historical frame measurements

One local run of the earlier full-sync correction path on Node 24.19.0 measured the following. Sync counts include warmup:

| Katana workload           | Left: µs/frame | Right: µs/frame | Left: mean/max syncs | Right: mean/max syncs |
| ------------------------- | -------------: | --------------: | -------------------: | --------------------: |
| Steady reachable grip     |          93.04 |           64.51 |             1.00 / 1 |              1.00 / 1 |
| Out-of-reach target sweep |         230.99 |          120.66 |            5.73 / 25 |              2.92 / 8 |
| Head crossing sweep       |          79.76 |           77.25 |             1.02 / 2 |              1.39 / 3 |
| Upper-body grip           |          82.71 |           74.18 |             1.00 / 1 |              1.00 / 1 |

The correction loops can dominate out-of-reach frames. The former demo performed one full `syncPose()` per frame, then uses `syncIK()` for target corrections, restoring and projecting only affected IK joints. It defers debug overlays until the final corrected pose and caches render order to skip depth updates/sorting when the order is already applied. The three correction loops remain bounded at 24, 6, and 12 passes, while full synchronizations remain at one. The former demo profile selected the default skin so body silhouette checks run against the visible cutouts. That profile reported both kinds of passes and debug refreshes. These demo workloads are historical and are no longer part of the current profile.

Grip correction also reuses transformed head, torso, pelvis, and leg corners within each solve. These passes change arm targets while the body pose and leg targets stay fixed; the next frame rebuilds the cache to reflect animation, placement, facing, and skin changes. Corrections stop when floating-point rounding can no longer move the target, while useful corrections retain the existing iteration limits. Both arms' reach limits are recovered, and body clearance is checked again after smoothing so those adjustments cannot move the rear grip through a cutout.

A local comparison against `89c64e6` on Node 24.19.0, x86_64, used the same scene fixture and seven batches of 2,000 frames after 1,000 warmup frames. Median CPU times in microseconds per frame:

| Scenario                                            | Before |  After |
| --------------------------------------------------- | -----: | -----: |
| 32 tracked bones, base animation                    |  56.61 |  40.65 |
| 32 tracked bones, three layers with fades           | 170.53 | 114.17 |
| 36 bones, one active and 12 inactive IK constraints |  41.19 |  10.37 |

Animation evaluation reuses working poses, clip buffers, and controlled-property sets. IK reuses rotation snapshots and synchronizes each changed bone into its descendant render branches before later target providers run. Inactive constraints still update their status without adding projection passes.

## Rig editor overlays

The rig editor caches unchanged overlay geometry and labels, redrawing after edits, selection/visibility changes, camera changes, or preview invalidation. Run `VITE_PROFILE=1 npx vitest run tests/rigEditorOverlay.test.ts --reporter=verbose` to compare cached idle frames with forced redraws. This profile uses 33 joints and a minimal scene, excluding browser/GPU costs, and reports timings without performance thresholds.

## Renderer scaling

### Editor texture batching

Run `PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline -- --textures` locally (or omit the channel for installed Playwright Chromium). The diagnostic compares the original `maxTextures: 1` configuration with `createEditorGame` using Phaser's default. Phaser 4.2.1 clamps that default to the smaller of 16 and the GPU's `MAX_TEXTURE_IMAGE_UNITS`; no editor-specific compatibility requirement for the old restriction was found.

Fresh desktop pages load the shipped demo puppet's separate images and render one or five stationary Puppets, including both facings. Each workload warms 60 frames and reports the median of five 120-frame batches. The diagnostic counts actual renderer draw submissions, rejects browser/WebGL errors or blank output, and requires identical SHA-256 pixel hashes between configurations. It remains local-only, outside CI, with no timing thresholds.

One local headless Chrome 150.0.7871.125 run on 2026-10-31 selected 16 textures:

| Puppets | Draw calls/frame: limit 1 | Draw calls/frame: default | Render submission ms/frame: limit 1 | Render submission ms/frame: default |
| ------- | ------------------------: | ------------------------: | ----------------------------------: | ----------------------------------: |
| 1       |                        15 |                         1 |                                0.35 |                                0.15 |
| 5       |                        75 |                         1 |                                1.02 |                                1.22 |

Both workloads rendered byte-identical pixels. Sharing the 15 artwork textures lets all five Puppets fit in one batch. Timings cover synchronous render traversal and driver submission, exclude animation/UI work and explicit GPU completion waits, and can include driver backpressure. The five-Puppet timing did not improve in this run; fewer draw calls alone do not establish an FPS or GPU-time improvement.

### Puppet hierarchy scaling

Profile renderer scaling separately from animation and IK:

```bash
VITE_PROFILE=1 npx vitest run tests/puppetRenderer.profile.test.ts --reporter=verbose
```

The profile compares 32- and 128-bone chains with a leaf slot, chains with artwork on every bone, and shallow rigs with a leaf slot. It reports actual container/transform-copy allocations and warmed CPU synchronization medians, excluding browser/GPU costs. Timings are diagnostic and have no test thresholds.

Bones without authored sprites allocate an independent render branch only when `attach()` needs a prop mount. Each sprite, slot, or prop branch uses two transform containers to represent its complete affine transform, including shear, reflection, and singular scales. The renderer composes skeleton matrices in parent order once per full synchronization. Partial IK synchronization recomposes only the changed bone's subtree, preserving unrelated unpublished edits and making descendant mounts current before later target providers run. Creating a lazy mount publishes current source transforms to the renderer before attaching the prop, so subsequent partial updates retain that same ancestor state. The mount uses the current draw order immediately.

| Workload           | Bones | Previous transform copies | Current transform factors | Previous containers | Current containers |
| ------------------ | ----: | ------------------------: | ------------------------: | ------------------: | -----------------: |
| Chain, leaf slot   |    32 |                        32 |                         2 |                  68 |                 37 |
| Chain, leaf slot   |   128 |                       128 |                         2 |                 260 |                133 |
| Chain, all sprites |    32 |                       528 |                        64 |                 594 |                 98 |
| Chain, all sprites |   128 |                     8,256 |                       256 |               8,514 |                386 |

Container counts include the source skeleton and fixture root. Each additional prop mount allocates two transform containers once and reuses them thereafter. Dense artwork now requires linear storage and synchronization work. One local CPU profile measured the 128-bone dense chain at about 26 microseconds per synchronization, versus about 459 microseconds before this change; timings vary by machine. Sparse rigs still traverse their skeleton during full synchronization, so their CPU cost depends on bone count even with only one drawable.

## Dense animation playback and scrubbing

To profile dense animation playback and nonsequential scrubbing, run:

```bash
VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose -t dense
```

The profiles cover 32 tracked bones with two properties per track, 128 or 512 keys, base playback, three layers with fades, and backward/forward scrubbing. Property sampling uses binary search without a mutable cursor. A local comparison of warmed CPU medians (microseconds per frame, excluding browser/GPU costs) measured:

| 512-key workload        | Linear scan | Binary search |
| ----------------------- | ----------: | ------------: |
| Base animation          |      156.72 |         47.22 |
| Three layers with fades |      656.91 |        155.48 |
| Nonsequential scrubbing |      135.47 |         33.35 |

These are diagnostic measurements from one machine, not CI timing thresholds. The two-key control profiles remain available by omitting `-t dense`.

## Timeline DOM work

Profile timeline DOM work locally with `PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline` (or omit the channel to use installed Playwright Chromium). The script starts a temporary local Vite server, opens three fresh browser pages with 512 keys on each of the sample rig's 16 bones, and reports collapsed summary counts plus synchronous expansion/collapse costs including layout. It closes the browser and server afterward. This is a local diagnostic, excluded from CI; timings are observations without pass/fail thresholds.

Collapsed summaries combine timestamps within each seven-pixel interval at the current zoom. Expanded property keys and event markers retain their separate identities and exact authored times. Zooming or resizing rebuilds the summaries from authored data. One local Chrome comparison measured:

| Collapsed summaries | DOM elements | Median expand: ms | Median collapse: ms |
| ------------------- | -----------: | ----------------: | ------------------: |
| One per timestamp   |        8,192 |              58.0 |                17.5 |
| Grouped by pixels   |        2,608 |              56.9 |                11.5 |

The comparison used a 1440×900 viewport and a 1142-pixel timeline. Expansion still creates all individual property markers, so this change primarily reduces collapsed DOM size and collapse work. These measurements include browser layout and vary by machine and run.

Summaries reuse unchanged immutable track arrays. Edits to another track or playback metadata retain their summary calculations; changed duration, width, or expansion state rebuilds the affected summaries.

## Dense editor authoring

For v1.1 integration measurements, run these separately from browser/regression suites:

```bash
VITE_PROFILE=1 npx vitest run tests/advancedAuthoring.profile.test.ts --maxWorkers=1 --reporter=verbose
PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline -- --advanced
```

The CPU fixture uses 33 bones, 128 keys with X/Y per bone (8,448 property keys), two clips and 250 full poses. It measures clock notifications, library filtering/compatibility, graph zoom/pan plus runtime sampling, validated curve-drag proposals, switching, diagnostics and clock playback. The browser fixture uses the shipped 16-bone rig with 128 keys per bone (4,096 property keys), 200 full poses and actual Phaser/SVG/React controls. Three fresh desktop pages measure wheel zoom including synchronous layout, pan/curve-drag/search/switch/diagnostics through the next animation frame, observed playback frame intervals and SVG drawing mutations. Browser input timings include protocol/scheduling overhead; they are observations, not pure handler costs or FPS guarantees. See [v1.1 assessment](advanced-animation-readiness.md) for measured results and limits. No timing thresholds or CI browser jobs are added.

Profile dense editor authoring with `VITE_PROFILE=1 npx vitest run tests/animationAuthoring.profile.test.ts --reporter=verbose`. It measures one property-key edit plus inspector sampling on 33 bones with 512 keys per track, using five warmed batches of ten edits. An earlier local comparison measured 242 ms/edit before validation reuse and 164 ms/edit afterward; these CPU measurements exclude DOM and GPU work and are diagnostic, not CI thresholds.

## Onion-skin sampling and rendering

Run `VITE_PROFILE=1 npx vitest run tests/animationOnionSkinningPerformance.test.ts --silent=false --reporter=verbose` for local CPU diagnostics with one or three ghosts per direction. The workload uses 32 tracked bones, 96 attachment slots, a 60-second animation, nonsequential scrubbing and normal playback in smooth/stepped modes. Normal tests assert bounded pooling and no new images, containers or texture checks after initial allocation; optional timings have no thresholds and exclude GPU/browser costs. See [production verification](animation-editor-onion-skinning-verification.md#performance-findings) for workload details and one local measurement.

## Dense editor workflow

Run `PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline -- --workflow` locally (or omit the channel for installed Playwright Chromium). The diagnostic uses three fresh 1440×900 pages, extends the shipped rig to 32 bones and loads a 12.7-second smooth clip with 128 rows and three properties per bone, two three-channel IK tracks and 128 JSON events. That is 12,288 bone-property keys plus 768 IK-property keys. The original `profile:timeline` summary/expansion diagnostic remains available without `--workflow`.

The workflow measures synchronous root expansion, 64 additive key selections, property search, zoom and 30 ruler scrubs, including layout. Real pointer input exercises group dragging and Escape cancellation; event-to-next-animation-frame samples include browser scheduling. Separate 30-frame playback samples with onion skinning off/on record observed frame intervals and timeline-track DOM mutations. These are local browser observations, not pure handler CPU times or GPU-independent benchmarks, and have no CI timing thresholds.

One local headless Chrome run measured these medians across three pages:

| Interaction                                       | Median (ms) |
| ------------------------------------------------- | ----------: |
| Expand root (384 property markers)                |        19.9 |
| Add 64 keys to selection, total                   |        88.7 |
| Search rotation (opens matching property groups)  |       265.2 |
| Zoom one step                                     |        39.7 |
| Ruler scrub, per change                           |         2.5 |
| Pointer move to next frame (hover and group drag) |         8.0 |
| Observed playback frame interval                  |        23.3 |
| Observed frame interval with onion skins          |        23.9 |

Playback caused **zero timeline-track DOM mutations** in all six off/on samples. These intervals are not a promise of a particular frame rate. Search opens many groups and still builds their individual property markers; dense filtering has a noticeable one-time cost, and expanding every track can cost more. No virtualized timeline was introduced. Use filters and selective expansion for large clips; rerun the diagnostic for your hardware and animation. See [the milestone verification](animation-editor-ux-verification.md) for lifecycle, React synchronization and regression coverage.

The v0.6.3 workflow diagnostic also measures synchronous active-skin changes and a generated 256×256 PNG replacement. Artwork decode includes asynchronous browser scheduling; preview/apply includes synchronous layout. All authored domains remain separate during the measurement. Run the profile without other browser suites for meaningful observations on your machine; there are no timing thresholds.

## Scene Editor

Run `PLAYWRIGHT_CHANNEL=chrome npm run profile:scene` locally. This reuses the timeline profiler’s localhost Vite lifecycle and loads `tests/browser/sceneProfileHarness.tsx` only through the development server; the harness is excluded from shipped entry points. It measures two/five real Phaser Actors, simultaneous movement and looping animation, two active IK constraints per 16-bone character, and a 510-action timeline. Sixty explicit updates and five forward/backward seeks include synchronous React work through a Profiler. It checks Actor disposal, GameObject and shutdown-listener counts, and unchanged source character metadata. Values exclude normal frame pacing/GPU rendering and are observations, not thresholds.

The [v0.9 readiness report](scene-editor-readiness.md#performance-observations) records a before/after comparison for separating playback subscriptions from the authored timeline tree. Dense seeks still simulate action boundaries and reconstruct Actors; their latency scales with source assets and prior actions. Run profiles separately from browser suites to avoid competing workloads.

The v1.2.6 scene diagnostic also loads three 2048 × 1024 artwork textures in fixed, 0.2 and 1.2 parallax layers, pans/zooms the camera, measures sixty camera-key edits with timeline rendering, and exports a scene ZIP. It records depth-sort requests during sixty clock samples and checks private artwork texture cleanup. [Cinematic integration results](cinematic-scene-readiness.md) record measurements and limitations.

The v1.3.6 workload adds a three-minute mono PCM source, a short effect source, music/ambience and four overlapping effects (six concurrent clips), fades, source trims and Unicode dialogue. It measures real browser decoding, forty rapid passive seeks and twenty Restart/update/Stop cycles. A wrapper around the real Web Audio backend counts voices, decoded/disposed bytes and context disposal, and verifies complete cleanup between workloads. PCM is silent so the diagnostic does not make noise. The synthetic scene deltas exclude normal frame pacing and are not a listening or sample-accuracy test; browser integration checks exercise user-action audio unlock and transport separately. Export includes the long music binary. See [audiovisual integration results](audiovisual-scene-readiness.md).

The v1.3.6 project diagnostic (`PLAYWRIGHT_CHANNEL=chrome npm run profile:project`) also includes two audio assets, including the three-minute source, plus audio clips and Unicode dialogue in all three scenes. It measures project export/import and IndexedDB autosave/recovery, compares original/imported audio bytes and authored data, and retains the existing five-character/three-scene workload. Measurements are recorded in the same [audiovisual integration report](audiovisual-scene-readiness.md).

## Mesh deformation

The v1.4.6 profiles use 4-, 144- and 1,024-vertex meshes with one/eight mixed rigid-and-mesh instances. Run them sequentially, separately from ordinary browser suites:

```bash
VITE_PROFILE=1 npx vitest run tests/meshProduction.profile.test.ts --maxWorkers=1 --silent=false
VITE_PROFILE=1 PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/meshRuntime.spec.ts --grep 'local mesh CPU' --project=production --workers=1
```

The Node profile uses affine scene doubles and separates reusable-buffer vertex updates from IK/skinning during seeking and playback. The native WebGL profile measures Phaser CPU render submission across painted frames, seek/playback and SceneRunner updates with owned Actors. It checks retained geometry buffers and released GameObjects/textures between workloads. Numeric XYUV payload estimates exclude object overhead, bind caches and textures; GPU completion and total heap usage are not measured. Neither profile sets timing thresholds. See [mesh production readiness](mesh-production-readiness.md) for observations and workload boundaries.

## Reusable animation and scene assets

Run `VITE_PROFILE=1 npx vitest run tests/reusableAssets.profile.test.ts --maxWorkers=1 --reporter=verbose` separately from other suites. The opt-in workload measures 10,000 derived library rows, collision-heavy variation naming, 2,001-key transfer to four rig proportions, rapid document switching, eight 144-vertex mesh Actors, repeated choreography insertion and project export/import. It uses renderer doubles, excludes DOM/GPU/texture timing and has no performance thresholds. The [v1.5.6 report](reusable-assets-readiness.md#10-performance-findings) records exact workloads, measurements and the naming improvement.
