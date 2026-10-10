# Onion-skin production hardening — v0.5.3.4

Package SemVer: `0.5.3-4`. This phase completes the v0.5.3 onion-skin milestone without adding authored formats or major features. See the [artist guide](animation-editor.md#onion-skinning-while-authoring) for controls and an arm-swing refinement workflow.

## Implementation and architecture

Ghost sampling continues to use `getCompiledPreviewClip()`, `ClipPoseBuffer` and runtime playback quantization. The preview compilation removes events and disables runtime looping; the editor clock owns loops. Complete detached local poses fill unkeyed properties from the immutable rig bind pose. The runtime retains nearest values before/after property keys and shortest-path rotation interpolation. The format supports linear interpolation; smooth/stepped are playback sampling modes. The Animation Editor previews one selected working clip and exposes no layer/mask configuration; ghost sampling does not copy gameplay layer state.

The existing render-only `AnimationEditorGhostLayer` owns at most six instances. Each instance has bones and a `PuppetRenderer`, with no player, IK solver, input or gameplay event listeners. Current textures, sprite frames, origins, offsets, skins, slot transforms/depth, visibility and render order come from the active artwork. Ghost roots follow the active root's parent, translation, rotation, scale, facing and alpha. Nested nonuniform scales retain the engine's affine projection conventions. Multiple attachment slots on the same bone are supported. Arbitrary host-attached GameObjects are still not cloned.

## Working-copy synchronization and playback

Working snapshot identity, continuous playhead time, counts and spacing invalidate the layer's neighboring samples. Edits create immutable snapshots; there is no source-animation fallback. Tests cover key creation/update/removal, selected deletion, single/group movement, drag preview/commit, copy/paste, duplication, interpolation declaration, authored mode/FPS, Undo/Redo, invalid and valid import, revert and animation selection. Ghost matrices are compared with independently sampled runtime Puppets, rather than another ghost-rendering path.

Native settings update immediately and do not rebuild the workspace DOM. Appearance-only changes reuse sampled poses. Scene-frame notifications coalesce into one projection per visible ghost. Navigation, scrubbing and frame snapping retain the normal editor clock. A paired enabled/disabled preview regression verifies identical clocks, active bone poses, JSON and event crossings through speed changes, playback, pause, restart, looping and scrubbing. Existing timeline/controller regressions cover scrolling, ruler coordinates, selection and zoom.

## Cache and resource lifecycle

The earlier sampler retained only its last evaluated time. Cycling through six neighbors evicted each preceding pose, so scrubs within a held stepped frame repeated six runtime evaluations. It now uses an eight-time LRU keyed by runtime-quantized milliseconds within each immutable snapshot/rig sampler. Entries own detached sparse transforms because `ClipPoseBuffer` mutates its buffer. The cache includes room for the six neighbors and inspector queries; it never caches mutable or shallow-frozen caller data across API calls. Weak snapshot/rig keys allow unused samplers to be collected. Returned maps and transforms remain detached and writable without affecting subsequent samples.

A deterministic regression verifies six initial evaluations, zero additional evaluations across four scrubs within the same stepped frames, detached outputs, eviction after more than eight times, snapshot changes, Undo/Redo and rig isolation. Counts/spacing and FPS changes continue through the existing invalidation path. Artwork and root placement synchronize each frame without invalidating authored local poses.

Disabling onion skinning clears the layer's samples and hidden instances' sample references while retaining render objects for reuse. Zero counts, animation changes, boundaries and a hidden active preview also release unused instance samples. Reenabling reapplies current samples. Disposal is idempotent and destroys ghost containers/images, clears the pool/cache references and unsubscribes before active-puppet destruction. Tests exercise shutdown, late loads after shutdown, failure in the ready callback, scene restart and notifications from a released state. The character picker and route lifecycle destroy the old scene; no ghost UI or renderer is added to the Rig Editor. Textures remain owned by Phaser.

## IK, facing and authored-data isolation

Ghosts represent authored poses before temporary inspector drafts and procedural IK. The settings panel now states this limitation. Turning fixed-target IK on may change the active arm/leg while ghosts retain authored motion; disabling IK makes the authoring comparison direct. Ghost sampling never calls IK target providers or mutates active bone poses. Facing is copied through the active root transform, including reflection with nonuniform scale and nested placement. No IK baking is attempted.

Sampling and rendering never advance the clock or dispatch events. Toggle/count/spacing/tint/opacity changes, scrubbing, interpolation changes, import and refresh remain silent; normal active playback events remain unchanged. Export bytes are identical with ghosts enabled/disabled, and normal JSON import/revert remains valid. Tests retain source-animation, rig and character-definition snapshots, dirty/history state and existing Undo/Redo. Onion preferences stay scene-only; schemas and animation, rig and character serialization APIs are unchanged.

## Performance findings

`animationOnionSkinningPerformance.test.ts` exercises a 60-second animation with 32 tracked bones, 121 keys per bone, 32 primary sprites and 96 attachment slots (three per bone). One and three ghosts per direction each perform 240 rapid nonsequential scrubs, 240 playback frames and 20 disable/enable cycles. After the initial pool allocation there are zero new images, containers or texture-existence checks. The pool remains bounded and all retained roots are destroyed on disposal. These assertions run normally without timing thresholds.

For optional CPU diagnostics:

```bash
VITE_PROFILE=1 npx vitest run tests/animationOnionSkinningPerformance.test.ts --silent=false --reporter=verbose
```

One local Node 24.19.0 run measured:

| Ghosts per direction | Playback mode   | ms/scrub | ms/playback frame |
| -------------------- | --------------- | -------- | ----------------- |
| 1                    | Smooth          | 1.225    | 0.579             |
| 1                    | Stepped, 10 FPS | 0.430    | 0.170             |
| 3                    | Smooth          | 0.810    | 0.842             |
| 3                    | Stepped, 10 FPS | 0.697    | 0.456             |

These single-run CPU diagnostics include active preview/state notifications and mocked affine rendering. JIT warmup and machine load affect comparisons; they exclude browser/GPU costs and are not FPS guarantees or a controlled before/after benchmark. Cache evaluation counts and object allocation bounds provide deterministic evidence for the changes. No timing throttling or new optimization subsystem was introduced.

## Files and APIs

Changed `animationValues.ts` (bounded internal evaluation cache), `AnimationEditorGhostLayer.ts` (hidden sample release), and `editorMarkup.tsx` (authored-pose/IK hint). Public sampling signatures and engine APIs remain unchanged. Expanded `ghostPoseSampling.test.ts`, `animationEditorGhostLayer.test.ts`, `animationEditorScene.test.ts`, `animationEditorKeyframes.test.ts` and the local `animationOnionSkinning.spec.ts`; allowed 60 seconds for the existing sixteen-capture `animationProductionWorkflow.spec.ts` round-trip cases; added `animationOnionSkinningPerformance.test.ts`. Updated package/lock version, changelog, README, artist/development documentation and historical ghost guide links.

## Verification

| Command                 | Result                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck`     | PASS — exit 0                                                                       |
| `npm run test`          | PASS — exit 0; 94 files passed, 3 skipped; 1,493 tests passed, 28 skipped           |
| `npm run build`         | PASS — exit 0; demo and library bundles, declarations and Node `/core` verification |
| `npm run check`         | PASS — exit 0; formatting, lint and typecheck                                       |
| `npm run check:version` | PASS — exit 0; `0.5.3-4` is valid SemVer                                            |

`PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationOnionSkinning.spec.ts --output=/private/tmp/ppe-onion-artifacts --reporter=line` passed all 6 cases (59.8 seconds) against development and production. A single-worker run selected 24 representative cases from `rigEditor.spec.ts`, `animationGroupMovement.spec.ts`, `animationWorkspace.spec.ts`, `animationInterpolation.spec.ts` and `animationProductionWorkflow.spec.ts` across both projects. It passed 22 cases; the two development sixteen-capture cases exhausted their former 30-second deadline. Trace review showed matching completed comparisons, with the deadline interrupting another capture. Those cases now allow 60 seconds, with all assertions retained; production equivalents passed during the representative run.

`PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationProductionWorkflow.spec.ts --project=development --grep 'rendered poses at keys' --reporter=line` then passed both affected cases (exit 0; 29.7 seconds). Together, 30 distinct browser scenarios were verified. The complete 280-case browser suite was not completed: a four-worker attempt was stopped after timeouts, and verification continued with single-worker focused scenarios. Browser smoke tests remain local-only; CI and browser installation steps are unchanged.

Screenshot review inspected the production six-ghost canvas, mirrored walk pose and narrow-screen settings panel: the active puppet remains opaque, neighboring artwork follows the pose/facing, and the count/spacing/opacity/color controls and authored-pose IK hint are visible. A human artist session was not performed. Local browser scenarios save screenshots and cover both development and production base paths. Rig Editor regressions include selection, dragging, origins/offsets, slots, IK, history and export; Animation Editor regressions include playback, timeline, keys/groups, clipboard, snapping, interpolation, events, history, validation and import/export.

## Deferred work

Mirrored pose/key copying, symmetry mappings, IK target authoring/baking, direct ghost manipulation, mesh deformation, physics, choreography, sprite import/replacement and Animation Editor Rig-Tweak mode remain deferred. The existing format still has no per-key interpolation or advanced curves. No gameplay-layer ghost composition or arbitrary attached-GameObject cloning was added.
