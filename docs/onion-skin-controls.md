# Multi-ghost onion skinning — v0.5.3.3

The [v0.5.3.4 production hardening](animation-editor-onion-skinning-verification.md) completes this milestone with bounded pose reuse, pooled-reference cleanup, expanded regressions and an [artist workflow](animation-editor.md#onion-skinning-while-authoring). The results and deferred items below describe the historical phase.

Package SemVer: `0.5.3-3`. Enable **Onion Skinning** above the Animation Editor preview, then open **Onion settings**. Configure 0–3 previous poses, 0–3 next poses, spacing of 1–5 authored frames, independent opacity sliders (0.05–0.6), and native previous/next color inputs. Zero hides a direction; both counts can be zero. Defaults retain one pose each, one-frame spacing, 0.22 opacity, cool previous `#65a9ed` and warm next `#f0a15d`. Opacity is uniform within each direction; no distance falloff is applied.

## Settings and state ownership

`OnionSkinSettings` has `enabled`, `previousCount`, `nextCount`, `frameSpacing`, `previousOpacity`, `nextOpacity`, `previousTint` and `nextTint`. Defaults and updates are frozen snapshots. `updateOnionSkinSettings(current, patch)` clamps finite values to control bounds, rounds integer counts/spacing/RGB, and retains current values for omitted or nonfinite inputs. Enable accepts only a boolean.

`AnimationEditorScene.getOnionSkinSettings()` and `setOnionSkinSettings(patch)` own these transient preferences. `setOnionSkinning(enabled)` remains compatible. Settings chosen during asynchronous loading apply before the ready callback, survive animation switches in the scene, and reset on a new editor session. They are absent from `AnimationDefinition`, JSON, document transactions, Undo/Redo, dirty tracking and draft recovery. No schema or engine library APIs changed.

## Multiple authored samples

The existing `GhostSamplingSettings` adds optional `previousCount` and `nextCount`, each defaulting to one. `getGhostSampleTimes()` and `state.sampleGhostPoses()` return previous then next samples, nearest first in each direction. Pure sampling rejects invalid counts or spacing with an empty array; artist inputs use the bounded settings normalization above.

For each direction, sample times are `currentTime ± index * frameSpacing / fps`, with index from one through the configured count. FPS is authored stepped FPS or the shared 10 FPS fallback for smooth clips; the existing explicit sampling FPS override remains available. At time 1.0 s, 10 FPS and spacing two, three previous times are 0.8, 0.6 and 0.4 s, and two next times are 1.2 and 1.4 s. The editor clock remains continuous, independent of the render loop. Runtime stepped evaluation still determines the resulting authored pose.

Out-of-range offsets disappear rather than wrapping or repeating edge poses. Arithmetic roundoff at exact endpoints is normalized, and representationally duplicate times are omitted. Pose evaluation continues through the existing read-only working-copy sampler, without duplicated animation evaluation, clocks, events, IK or active-puppet writes.

## Rendering and synchronization

`AnimationEditorGhostLayer.setSettings(patch)` drives at most six lazy `GhostInstance`s keyed by direction and distance. Invisible directions, invalid boundaries and a hidden active preview allocate no new instances. Previously allocated instances hide and remain available for reuse; repeated scrubbing, playback, count/spacing changes, skin changes and toggles retain the pool. Each contains only bones and the existing affine renderer, sharing loaded textures. No additional Puppet, AnimationPlayer or texture loads are created. Disposal destroys every retained instance and unsubscribes before the active Puppet is released.

Farther ghosts render behind nearer ghosts, and all six render behind the active puppet. Opacity multiplies source root alpha; tint copies appearance into each ghost renderer. Active artwork, alpha, source textures, pose, IK and playback remain authoritative and untouched.

Working snapshot, continuous time, counts and spacing invalidate sampling. Opacity/tint changes reuse sampled poses; unchanged idle frames reuse pose objects and bone transforms. Appearance and placement synchronize each scene frame, so skins, sprite frames, attachments, hierarchy visibility, facing and transforms follow the active preview. State notifications within a playback frame coalesce into one projection per visible ghost. Scrubbing, key edits/movement, Undo/Redo, interpolation, FPS and animation switching refresh immediately. The active clock and Phaser rendering are never throttled to authored FPS.

## Changed files and APIs

- New `onionSkinSettings.ts` and `OnionSkinControlsController.ts` supply settings normalization and abortable native input bindings.
- Extended `ghostPoseSampling.ts`, the state sampling API comments, `AnimationEditorGhostLayer.ts` and `AnimationEditorScene.ts`.
- Updated `editorMarkup.tsx`, `main.tsx` and `style.css` with an accessible, compact disclosure panel. React remains the existing shell owner; no UI framework was introduced.
- Added settings/control unit tests and extended sampling, renderer, scene and local browser tests.
- Updated package/lock version, changelog, README and editor/development/ghost guides. Animation schemas and CI are unchanged.

## Verification

Unit coverage checks multiple times at spacing 1/2/5, continuous off-frame time, zero/max/independent counts, boundary omission, invalid counts/spacing, opacity/RGB bounds and nonfinite normalization. Full sampled affine poses are compared against reference Puppets for all six ghosts. Renderer tests check pool/texture reuse, six-ghost frame coalescing, immediate appearance changes without resampling, skins, key movement, interpolation/FPS, history, animation switches and disposal. State-isolation tests exercise six samples while paused, playing and scrubbing, preserving authored/source snapshots, clock, active IK/pose, events, dirty state and existing Undo/Redo. Native input tests check immediate updates and listener cleanup.

Local browser scenarios compare on/off, one/six/both/previous-only/next-only/neither images, exercise spacing 1/2/5, opacity endpoints and tint changes, scrub and play, edit authored FPS/interpolation, move keys with Undo/Redo, check animation switching and clean history, and capture wide and narrow layouts. Browser checks remain local-only.

Verified locally on 2026-10-10:

| Command                                                                                      | Result                                                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run typecheck`                                                                          | PASS — strict TypeScript                                          |
| `npm run test`                                                                               | PASS — 93 files passed, 3 skipped; 1,479 tests passed, 28 skipped |
| `npm run build`                                                                              | PASS — demo, library, declarations and Node core verification     |
| `npm run lint`                                                                               | PASS                                                              |
| `npm run format:check`                                                                       | PASS                                                              |
| `npm run check:version`                                                                      | PASS — `0.5.3-3`                                                  |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationOnionSkinning.spec.ts` | PASS — four local development/production scenarios                |
| `git diff --check`                                                                           | PASS                                                              |

The expanded artist workflow was rerun with the browser command above and `--grep 'artist controls'`: both development and production passed after adding FPS/interpolation/key-history checks.

Manual visual inspection of generated Chrome screenshots confirmed three cool/warm offsets on each side, an unchanged opaque active puppet, low/high opacity with custom colors, and a usable panel at 620px viewport width. Interaction verification used the local browser scenarios above rather than a separate human click-through. Skin switching is covered by renderer tests using the real appearance-copy path; the Animation Editor has no skin picker.

## Deferred to v0.5.3.4

Cross-animation onion skinning, ghost editing/manipulation/key creation, read-only procedural IK ghosts or baking, motion trails, mirrored pose copying, scene choreography and mesh deformation remain deferred. Persistent preference storage, opacity falloff and advanced color management are outside this phase.
