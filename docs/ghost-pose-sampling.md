# Ghost pose sampling foundation — v0.5.3.1

The [v0.5.3.4 production hardening](animation-editor-onion-skinning-verification.md) completes this milestone with bounded pose reuse, pooled-reference cleanup, expanded regressions and an [artist workflow](animation-editor.md#onion-skinning-while-authoring). The results and deferred items below describe the historical phase.

The [v0.5.3.3 extension](onion-skin-controls.md) adds optional `previousCount` / `nextCount` (0–3, default one) and bounds `frameSpacing` to 1–5. Samples remain previous then next, nearest first within each direction; all pose evaluation and state isolation below still apply. The original single-neighbor API calls retain their behavior.

Package SemVer: `0.5.3-1`. This phase implements data sampling for future onion skinning. React continues to own the existing workspace UI, Phaser owns rendering, and this phase adds no components, controls, overlays or dependencies.

## Architecture and APIs

`ghostPoseSampling.ts` provides pure time calculation and pose orchestration, with no React, Phaser or DOM imports. `AnimationEditorState` calls it with the active working snapshot and its continuous editor clock. There is no source-animation fallback or separate timeline representation.

```ts
const pose = state.sampleGhostPose(0.537); // AnimationPose | undefined; seconds
const ghosts = state.sampleGhostPoses(); // GhostPoseSample[]; previous then next
const farther = state.sampleGhostPoses({ frameSpacing: 2 });
```

Each `GhostPoseSample` contains `time` in seconds, `direction: 'previous' | 'next'`, and `pose` in the existing `AnimationPose` type. The map contains all five absolute local transform properties for every rig bone, including untracked bones. The rig supplies hierarchy, resolved bone lengths, artwork and slots; later rendering also needs presentation settings such as skin, placement and facing. Samples are detached maps and transform objects, so later evaluation or caller edits cannot overwrite held samples or authored data.

Pure APIs:

- `getGhostSampleTimes(currentTime, duration, settings?)`: seconds in/out; at most one previous and one next time.
- `sampleGhostPose(animation, rig, timeSeconds)`: complete arbitrary-time authored pose, or `undefined` for missing animation/rig, invalid time or invalid/zero duration.
- `sampleGhostPoses(animation, rig, currentTime, settings?)`: complete neighboring samples; missing animation/rig or invalid sampling settings produce an empty array.
- `getEvaluatedAnimationPose(animation, rig, timeMs)`: complete pose through the existing editor evaluator; milliseconds in, invalid targets/authored data throw through existing validation.

The full-pose API extends `AnimationValueSampler` in `animationValues.ts`. It shares `getCompiledPreviewClip()`, `ClipPoseBuffer`, runtime property interpolation, shortest-path rotations, and runtime playback quantization with existing inspector queries. Fully frozen working snapshots share immutable compilation and cached evaluation; mutable external inputs are validated and compiled afresh. Compilation creates an event-free, nonlooping preview clip, preserving authored playback/interpolation settings. No `AnimationPlayer`, Puppet or IK context is constructed by ghost sampling, and no pose is applied to the active Puppet.

## FPS, times and boundaries

Default spacing is one authored stepped frame (`1 / playback.fps` seconds). Smooth clips and clips without FPS use the existing `DEFAULT_KEYFRAME_FPS = 10`, matching the engine's 8–12 FPS aesthetic. An optional `fps` overrides spacing only; the pose still follows authored playback settings. Absent FPS uses authored FPS when available; explicitly invalid, nonfinite or nonpositive FPS falls back to 10. Valid fractional and runtime FPS outside editor control bounds are supported.

`frameSpacing` defaults to one and accepts positive safe integer frame counts. Invalid counts produce no neighbors. Unrepresentable/infinite intervals and intervals too small to distinguish neighboring times safely produce no duplicate current-time samples.

Neighbors offset the exact continuous time; they do not snap it to a frame. At 10 FPS and time 0.5 s, neighbors are 0.4 and 0.6 s. At 0.537 s they are 0.437 and 0.637 s. Smooth poses evaluate continuously; stepped poses hold at authored frame boundaries. The exact animation endpoint is retained even when off-frame and even when the authored clip or editor preview loops.

Out-of-range neighbors are omitted, never wrapped or clamped into duplicate poses. Only floating-point arithmetic roundoff at an endpoint is normalized to that endpoint. At zero only the next neighbor is eligible; at duration only the previous neighbor is eligible. Short clips may have one or no eligible neighbors. Invalid playhead/duration inputs and zero-duration clips have no neighbors. The existing animation schema still rejects authored zero-duration files; this helper policy does not change that format.

## IK and state isolation

Samples represent authored animation before editor transform drafts, persistent pose presets, procedural IK, facing and render projection. They include partial-track bind-pose fallbacks and local hierarchy data, not world-space IK output. IK is neither solved nor baked. A future read-only IK adapter can consume the detached pose and rig in an isolated context before handing it to a renderer; no new solver interface is needed in this phase.

Sampling does not modify the working/source animation, playhead, playback/scrub state, pending event delivery, selection, drafts, validation, Undo/Redo history, dirty state, active Puppet pose, or IK state. It sends no editor notifications or animation events and creates no keys.

## Files and tests

Created `src/devtools/animation-editor/ghostPoseSampling.ts`, `tests/ghostPoseSampling.test.ts` and this guide. Changed `animationValues.ts` for complete poses, `AnimationEditorState.ts` for working-copy APIs, the React wording in `plans/plan-05-03-01.md`, `docs/animation-editor.md`, `CHANGELOG.md`, and the package/lockfile version.

The new suite covers previous/next times, continuous off-frame times, authored/fractional/invalid FPS, optional frame spacing, start/end/short/zero-duration boundaries, missing data, numeric precision extremes, full partial-track/hierarchical poses, resolved lengths, shortest-path rotations, smooth/stepped runtime equivalence, exact endpoints, mutable input freshness, deterministic detached snapshots, active working-copy edits, and state/event/Puppet/IK isolation during paused, playing and scrubbing sessions. It also verifies normal animation events still fire afterward.

## Verification

All required commands passed with exit code 0:

| Command             | Result                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck` | PASS — strict `tsc --noEmit`                                                                   |
| `npm run test`      | PASS — 90 files passed, 3 skipped; 1,451 tests passed, 28 skipped; 37 new ghost-sampling tests |
| `npm run build`     | PASS — typecheck, demo build, library build, declarations and built `/core` Node verification  |

`npm run lint`, `npm run format:check`, `npm run check:version` and `git diff --check` also passed. Skipped tests are the existing opt-in performance profiles. Browser tests were not needed for this nonvisual change; browser smoke tests remain local-only and CI is unchanged.

## Deferred to v0.5.3.2

Ghost rendering, translucent overlays, onion-skin toolbar/settings UI, visible ghost counts, colors/tints, looping visualization and renderer integration remain deferred. Onion-skin export, new authored keyframes, IK baking, physics and choreography remain outside this phase.
