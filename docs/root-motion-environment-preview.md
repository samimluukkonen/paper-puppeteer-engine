# Root motion and Environment Preview — v1.1.7.4

[All guides](../README.md#guides) · [Root authoring](root-motion-authoring.md) · [Environment Preview](animation-environment-preview.md)

The existing Environment Preview is fully integrated. Background selection/import, shared image registry, texture cleanup, ground settings, playback controls and Phaser camera are reused. No second preview system or Actor is created. Root Motion and Environment Preview inspectors start collapsed.

| World displacement mode        | Outer character movement                                           | Coordinates                                                    |
| ------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Authored Root Motion (default) | Actual root keys, measured from their first sample                 | Character units transformed once by facing, scale and rotation |
| Preview-Only Displacement      | Temporary position points; authored root translation is suppressed | World pixels, +X right and +Y down                             |
| No World Displacement          | Neither outer translation source                                   | Skeletal translation and IK continue                           |

`worldDisplacement.ts` is the shared absolute evaluator for `AnimationEditorPreview` and `EnvironmentPreviewCamera`. Placement occurs before the usual skeletal sampling and IK solve. Every seek recomputes from data and view settings; it never changes animation keys or fires animation events. The background is a separate world object with scroll factor 1. Ground Y stays fixed. Foot markers use final post-IK world positions and signed ground distance, without asserting contact timing or planted feet.

Fixed camera retains its chosen world center during movement. Follow adds the same evaluated world offset to its configured center, preserving native pan/zoom offsets without applying translation twice. Artwork moves on screen under Follow but its world transform stays fixed. Existing navigation is restored when Environment Preview is disabled or the preview is disposed. Root editing suspends follow synchronization and shows the first cycle for authoring.

Nonlooping clips clamp at their endpoint. Reset loops sample the current local cycle. Continuous authored loops use the existing runtime evaluator with unwrapped elapsed time, adding completed cycles times the end-minus-start displacement. Pause/resume retains travel; Restart and explicit timeline navigation reset travel to cycle zero. Preview-only loops always reset to their first point. Held stepped frames and the exact direct-seek endpoint are preserved. Repeated refreshes do not integrate movement.

Per-clip displacement mode and root loop behavior join the existing optional project/recovery preferences. Old enabled preview paths migrate to Preview-Only Displacement, preventing accidental double travel. Production animation/character exports retain only authored data.

The Preview displacement panel offers **Preview Copy to Root Motion**, then **Apply Copy — Replace Root Keys** or **Cancel copy preview**. A detached proposal can be scrubbed or played before committing; exported animation stays unchanged until Apply. Conversion inverts the current placement affine, retains Linear/Stepped interpolation and clips/holds endpoints. Apply creates one animation history transaction and keeps original preview points; Undo/Redo restores old/new root keys. A nonzero starting preview offset cannot be represented by start-normalized root motion alone, so copying it is explicitly rejected. Singular placement, changed facing/scale/rotation, stale documents and abandoned sessions cannot commit an old proposal.

Implementation changes are concentrated in:

- `worldDisplacement.ts`, `AnimationEditorPreview.ts`, `EnvironmentPreviewCamera.ts`, `AnimationEditorPlayback.ts` and scene wiring: shared evaluation, placement, camera and cycle timing.
- `AnimationEditorState.ts`, `previewTrajectoryCopy.ts`, `MotionPreviewController.ts`: preview proposal, affine conversion, history and preference ownership.
- Root/Motion/Environment panel controls, `RootMotionController.ts`, preference schema and existing Feature Guide text: compact, exclusive controls with backward-compatible saved preferences.
- `environmentPreviewCamera.test.ts`, `animationPreviewPersistence.test.ts`, the scene regression and local browser workflows: movement, camera, loops, IK/markers, copying, history, lifecycle and passive immutability.

The changelog entry is under **1.1.7-4**, below the newer 1.2 milestones. Package and lockfile retain the already higher **1.2.6** version.

## Verification

Verified on 2026-10-25 with Node 24.19.0. Test runners ran sequentially with one worker. The desktop checks use installed Chrome and remain local-only.

| Check                                                                                                                                                                   | Exact result                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test -- --maxWorkers=1`                                                                                                                                            | Exit 0; 210 files passed, 6 skipped; 3,682 tests passed, 47 skipped; 216.16 seconds.                                                                                                  |
| `npm run build`                                                                                                                                                         | Exit 0; application, library, declarations and renderer-independent Node entry checks passed. Existing Lucide `use client` warnings remain.                                           |
| `npm run check`                                                                                                                                                         | Exit 0; formatting, lint and strict TypeScript passed.                                                                                                                                |
| `npm run check:version`                                                                                                                                                 | Exit 0; package, lockfile and changelog agree on retained version 1.2.6.                                                                                                              |
| `git diff --check`                                                                                                                                                      | Exit 0.                                                                                                                                                                               |
| Local Chrome authored-root/authoring run: `npx playwright test tests/browser/animationRootEnvironment.spec.ts tests/browser/animationRootMotion.spec.ts --workers=1`    | Six new authored-world cases passed across development/production; five existing authoring/guide cases passed. The remaining development drag case was corrected and rechecked below. |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationRootMotion.spec.ts --project=development --grep 'root timeline drag' --repeat-each=3 --workers=1` | Exit 0; three consecutive plain runs passed after browser focus/geometry readiness changes, with diagnostics removed; 2.0 minutes.                                                    |

The six new authored Environment Preview desktop cases passed across development and production. They measure the character artwork and a stationary image landmark in logical canvas pixels: an 80-unit sword step, a jump rising 100 units and returning to its root origin, and a walk traveling beyond one cycle. Both Fixed and Follow cameras, exclusive movement modes, repeated forward/backward seeks, passive export immutability and explicit trajectory-copy Undo/Redo are checked. The screenshot measurement allows one logical pixel for rasterization; unit world-coordinate assertions remain exact or use floating-point tolerances.

Across broad and focused runs, all 32 unique desktop cases passed after corrections. The broader run passed all 20 existing environment image, recovery/project packaging, temporary displacement and related Feature Guide cases. Root authoring, its guide and production timeline dragging passed. An intermittent development timeline drag prompted explicit browser focus, settled marker geometry and a fresh position after Escape; diagnostic instrumentation was removed before the final verification. The new suite also exposed Phaser's prototype-backed matrix coefficients, which are now read explicitly and covered by a unit regression.

A captured step/copy preview was inspected for the shared header, compact inspector controls, world artwork, stationary ground and character/root overlays. These are scripted artist workflows; no physics, collision, planted-contact timing, automatic IK changes or scene choreography was introduced.

## Background placement follow-up

Animation Editor now matches Rig Editor: left-dragging empty preview space moves the whole preview character, while middle-dragging pans the camera. Empty space also works with Edit Root Motion enabled; the purple handle continues authoring root keys. A four-pixel movement threshold avoids click jitter. Release outside the canvas, Escape, blur, clip/view changes and disposal end the gesture.

`AnimationEditorState.previewPlacementOffset` stores this session-only view position. `AnimationEditorPreview` adds it to the base origin alongside the selected evaluated travel, and `MotionPreviewLayer` uses the same origin for its guide. The offset survives scrubbing, clip switches, Rig/Animation transitions and rig rebuilds. Rig Editor movement synchronizes back into the shared placement. Authored keys, animation history, production exports, ground and background transforms stay unchanged. Follow continues tracking evaluated animation travel, retaining the manually chosen framing offset.

The focused five-file unit run passed 104 tests. Formatting, lint, typecheck and both builds passed. The local Chrome sword-step workflow passed in development and production (2 cases), now checking real background drags both with and without root editing, fixed artwork, unchanged exports and copied-root Undo/Redo.

Final full regression: `npm test -- --maxWorkers=1` exited 0 with 210 files passed, 6 skipped; 3,690 tests passed, 47 skipped, in 219.46 seconds.
