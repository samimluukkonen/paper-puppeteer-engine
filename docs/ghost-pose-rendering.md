# Ghost pose rendering — v0.5.3.2

The [v0.5.3.3 extension](onion-skin-controls.md) adds a six-instance pool, configurable counts/spacing/opacity/tints and a compact settings panel while retaining this rendering foundation.

Package SemVer: `0.5.3-2`. Enable **Onion Skinning** above the Animation Editor canvas to see one previous and one next pose. The checkbox starts off, stays in scene memory, and never enters animation JSON, dirty tracking, history or draft recovery.

## Architecture and transforms

`AnimationEditorGhostLayer` subscribes to the working editor state and calls the existing `state.sampleGhostPoses()` API. Each lazy render-only instance contains `Bone` objects and a `PuppetRenderer`; it has no Puppet, AnimationPlayer, clock, event dispatch, IK constraints or input handlers. The existing sampler and animation evaluator are unchanged.

Complete sampled local poses populate a separate bone hierarchy. The existing renderer composes the hierarchy and projects each draw branch through its two affine factors, retaining nested rotations, nonuniform/reflected/singular scales and shear. Ghost roots follow the active puppet's position, rotation, scale, facing and parent container. Sprite origins, offsets and attachment transforms remain separate from bone pivots.

`Puppet.copyAppearanceTo(renderer, tint)` delegates to `PuppetRenderer.copyAppearanceFrom(source, tint)` for compatible renderers using the same rig. It copies current bone sprites and selected slot images, texture/frame, origin, local transform, visibility and alpha. Runtime slot transforms, bone render order and actual slot depths also follow the source, including cleared depth overrides. Loaded textures are shared. Skin/frame changes update existing images; empty attachments release their images. No assets are copied into animation data. Arbitrary host-attached Phaser GameObjects are not cloned; the Animation Editor has no such gameplay props.

## Layering and synchronization

Previous ghosts use cool `0x65a9ed`; next ghosts use warm `0xf0a15d`. Both use 22% of the source root alpha and sit two/one depth units behind the active puppet. The active puppet keeps its normal colors and opacity. All ghost objects are non-interactive and selection continues to use only the active skeleton.

Working-snapshot identity and continuous time invalidate sampling. Scrubs, playback, key edits, undo/redo, interpolation and authored FPS changes therefore update ghosts immediately. Unchanged selection/status notifications and idle frames reuse the sampled poses. Each scene frame also synchronizes artwork and placement so skin, attachment, sprite-frame, visibility, slot-layout and facing changes need no authored edit. Facing controls synchronize immediately. The normal editor clock alone advances playback.

Sampling spacing follows the v0.5.3.1 policy: one authored stepped frame, otherwise the shared 10 FPS fallback. Neighbors outside the animation disappear without wrapping; short clips can have neither neighbor. Changing or clearing animation hides obsolete poses.

## IK and lifecycle

Ghosts show authored poses before procedural IK and temporary inspector drafts. Read-only procedural IK sampling is not supported. Rendering never captures the active puppet's corrected pose or invokes `preparePose()` / `syncPose()` on it, and never bakes IK.

No ghost objects are allocated until a valid enabled sample exists. Disabling hides the retained objects and clears sampled snapshots; reenabling reuses them. Animation switches reuse the same rig and render branches. Scene shutdown, loading failure or editor disposal unsubscribe the layer, destroy all ghost containers/images and clear cached snapshots. Ghosts are disposed before the active puppet; textures remain owned by Phaser's texture manager.

## Files and APIs

- Added `src/devtools/animation-editor/AnimationEditorGhostLayer.ts` and `tests/animationEditorGhostLayer.test.ts`.
- Added `AnimationEditorScene.setOnionSkinning()`, scene frame synchronization and cleanup.
- Added the React checkbox in `editorMarkup.tsx` and its abortable change listener in `main.tsx`.
- Added the reusable appearance-copy APIs in `Puppet.ts` and `PuppetRenderer.ts`; no animation format or sampling API changed.
- Extended scene tests and the affine scene test helper; added local-only `tests/browser/animationOnionSkinning.spec.ts`.
- Updated package/lock versions, changelog, artist/developer guides and this verification record.

## Verification

Automated renderer/controller tests cover full affine pose alignment against separately sampled reference Puppets, arm/leg divergence, image origins, translucency and depth, current artwork/frame/skin selection, slot transforms/depth reset, reflected placement/facing, parent containers, hidden artwork and attachment removal. They check allocation reuse, start/end/short/missing animation visibility, toggle reuse, scrubs/playback/key edits/undo/FPS/interpolation synchronization and disposal. They also verify active pose/IK, event delivery, clock, authored JSON, dirty state and history remain untouched. Scene tests cover preferences chosen during loading and shutdown cleanup.

The local Chrome browser scenario compares canvas images with onion skinning on/off, checks both facings, scrubbing, start/end, playback, bone inspector selection and clean dirty state, and saves screenshots for visual inspection. Browser tests remain local-only; no browser CI changes are included.

Verified locally on 2026-10-10:

| Command                                                                                      | Result                                                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run typecheck`                                                                          | PASS                                                              |
| `npm run test`                                                                               | PASS — 91 files passed, 3 skipped; 1,456 tests passed, 28 skipped |
| `npm run build`                                                                              | PASS — demo, library/declarations and Node `/core` verification   |
| `npm run check`                                                                              | PASS — formatting, type-aware lint and typecheck                  |
| `npm run check:version`                                                                      | PASS — `0.5.3-2`                                                  |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationOnionSkinning.spec.ts` | PASS — development and production, 2 tests                        |
| `git diff --check`                                                                           | PASS                                                              |

Visual inspection of the production screenshots confirmed current/previous/next alignment, separate arm and leg positions, translucent artwork behind the active puppet, both facings and single-neighbor start/end poses. Screenshots are local artifacts under `test-results/animationOnionSkinning-*/`. Skin switching, nested affine transforms, sprite origins and depth changes were verified by automated renderer tests; no separate human-driven browser session was performed.

One existing sketch grip test exceeded its five-second timeout while the browser and unit suites ran concurrently. Running the required `npm run test` command again with the browser closed passed the full suite; no timeout settings or unrelated gameplay code changed.

## Deferred

More ghosts, adjustable opacity/tints/spacing, ghost authoring/export, procedural IK ghosts/baking and mirrored-animation tools remain outside this milestone. Existing unavailable per-key interpolation editing is unchanged.
