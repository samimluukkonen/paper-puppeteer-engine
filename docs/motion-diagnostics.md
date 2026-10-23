# Motion cleanup and diagnostics

Open **Animation Editor → Tools → Motion Diagnostics**, then choose **Run diagnostics**. Analysis is manual and read-only. Findings are possible issues, including intentional fast attacks or stepped transitions. **Inspect** uses the existing timeline selection, expands the affected row and seeks its authored key.

Choose candidate property keys, then **Preview Cleanup**. Scrub the comparison time and switch **Before / After** to evaluate both versions on the normal Phaser preview canvas. The authored playhead, events, exports and history stay unchanged. The preview lists maximum local deviation per changed channel. **Cancel preview**, Escape, closing the panel or navigation restores the authored preview. **Apply Cleanup** rebuilds and revalidates the selected batch against the current source and commits one Undo transaction. Analysis runs again after applying. Undo/Redo restores the complete authored snapshot.

## Methods and defaults

The implementation reuses `compileValidatedClip`, `sampleProperty`, shortest-path radian rotation, and the existing runtime canvas evaluator. It examines sparse bone and IK channels with their actual millisecond key spacing. Each segment has sixteen equal-time sampling intervals for estimating peak speed through interpolation curves. This is a deterministic heuristic, not an exhaustive search for Bézier extrema. Diagnostics describe local authored channels; they do not infer world-space defects or diagnose solved IK residuals. Smooth/stepped playback settings remain unchanged; raw channel analysis also checks motion between held playback frames.

| Heuristic                | Default                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| Large rotation change    | Greater than π/2 rad (90°)                                                     |
| Rapid rotation           | Greater than 4π rad/s (720°/s)                                                 |
| Large X or Y translation | Greater than 100 artwork units per segment                                     |
| Rapid X or Y translation | Greater than 1,000 units/s                                                     |
| Sudden speed increase    | Greater than 4× previous segment peak, whose speed exceeds rapid threshold / 4 |
| Suspicious interpolation | Change of outgoing mode; nonconstant stepped discontinuity                     |

These values and cleanup tolerances are configurable in the initially collapsed **Heuristics and tolerances** section. Threshold equality is not flagged. Translation checks each axis independently. Rotation comparisons use the runtime's shortest angular delta, including wraparound.

## Cleanup safety and deviation

Cleanup only proposes interior bone property keys on entirely linear channels. First and last property keys, event-time keys (within the shared 1e-6 ms authoring tolerance), channels containing any stepped or Bézier controls, all IK target/mix channels, all transforms of IK chains and their ancestors, and every rotation channel in a clip with baked IK suppression are protected. This policy also protects disabled rig chains. It deliberately leaves some redundant keys in place. Sparse sibling properties, events/payloads, playback settings, curves and constraint suppression remain intact.

Default maximum absolute deviations are **0.01 local units** for X/Y, **0.001 radians** for rotation and **0.0001** for scale. Rotation error is measured modulo a turn. Greedy proposals compare each cumulative removal against the original channel. Preview and Apply independently verify the entire selected batch against the original using every original knot and sixteen subdivisions per original segment. For piecewise-linear scalar channels, knot errors bound the between-knot difference; the subdivisions additionally check angular branch behavior. Comparisons cover continuous raw interpolation, so stepped playback samples remain within the same tolerances. These are local property bounds, not world-space endpoint-distance promises.

Applying uses `removeBonePropertyKeyframes` followed by the existing document validation/history boundary. The report and preview never enter authored JSON. Inputs are neither mutated nor frozen. A changed selection can have different combined error, so preview/apply reject an unsafe subset rather than trusting earlier per-candidate numbers.

Issue detection is linear in authored segment count, with fixed sixteen-interval sampling. The more expensive greedy cleanup search is limited to channels with at most **256 property keys**; denser channels are explicitly reported as skipped for cleanup while issue detection still runs. Analysis is cached by immutable document/session/rig and settings; ordinary clock updates do not repeat it.

## IK and contacts

The rig already has bone-local foot contact points and ground measurement tools. It has no authored planted-contact time intervals. Automatic contact-drift detection is deferred; use the existing read-only ground/contact measurements. Cleanup adds no solver, foot planting, locking or automatic correction. Protecting IK chains, ancestors, target channels and baking metadata avoids changing solver inputs.

## Implementation and verification

Editor-only APIs live in `motionDiagnostics.ts`: `diagnoseMotion`, `previewMotionCleanup`, `MotionDiagnosticOptions`, `MotionReport` and `CleanupPreview`. `MotionDiagnosticsController` owns cached reports and selected proposals; `MotionDiagnosticsPanel` provides the compact Tools disclosure. `AnimationEditorState.previewCleanup`, `cancelCleanupPreview` and `applyMotionCleanup` bridge the existing preview and document owners. Runtime public exports and authored schemas are unchanged.

Unit coverage includes abrupt/smooth motion, threshold boundaries, evaluated Bézier speed, stepped transitions, rotation wraparound/full turns, linear redundancy, property tolerances, cumulative-error rejection, source ownership, IK/baking, events, previews, stale sessions, timeline inspection, Undo/Redo and JSON export/import. Local desktop Playwright coverage exercises a walking fixture with a redundant middle key, before/after canvas equality, cancellation/Escape, explicit Apply, Undo/Redo, export/reload and an intentionally fast attack. Browser tests remain local-only.

Verification on 2026-10-23:

| Command                                                                                 | Result                                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run check`                                                                         | Passed: formatting, lint and typecheck; exit 0                               |
| `npm run typecheck`                                                                     | Passed; exit 0                                                               |
| `npm run test`                                                                          | 195 files passed, 5 skipped; 3,435 tests passed, 46 skipped; 30.21 s; exit 0 |
| `npm run build`                                                                         | Demo, library, declarations and Node core checks passed; exit 0              |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/motionDiagnostics.spec.ts` | 4 passed across development/production; 43.6 s; exit 0                       |

The walking fixture's before/after canvas comparison has zero differing decoded pixels. The build emits two Lucide `use client` directive warnings. Browser verification used installed Chrome because the Playwright browser bundle was absent; no browser installation or CI changes were added.
