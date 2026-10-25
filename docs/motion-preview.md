# Animation preview displacement

[All guides](../README.md#guides)

Open **Feature Guide → Animation Editor → Preview Displacement** for a seven-step tour of exclusive movement modes, timed world positions, interpolation, synchronized playback, the path overlay and reset/saving. It works with a selected empty clip and no preview points or background image. The tour reveals controls without changing displacement settings, animation data, playhead or history.

Open **Preview displacement** in Animation Editor's inspector. It starts collapsed and the default mode is **Authored Root Motion**. Enable **Environment Preview** and select/import a background to judge motion against static world artwork.

Use **Add position point** at the current playhead time, enter time in seconds and X/Y offsets, then **Apply point**. If that time already has a point, Add uses the midpoint of the largest available interval. Points sort by time; duplicate times, negative times and nonfinite values are rejected. Each point can be removed. Points beyond the clip's current duration remain available if it is lengthened; playback samples only the active duration. Reset clears points and restores Authored Root Motion.

**Use Preview-Only Displacement** selects the temporary trajectory instead of authored root translation. Unchecking returns to Authored Root Motion. The Root Motion inspector also offers **No World Displacement**, which suppresses both outer translation sources while retaining skeletal translation and IK. These mutually exclusive modes cannot move the character twice. Settings, root loop behavior and **Loop preview** belong to each clip in project editor preferences. Local recovery drafts and project ZIPs preserve them and artwork; production animation/character exports exclude preferences. Legacy enabled trajectories restore in Preview-Only Displacement mode.

Offsets are world pixels from the current preview origin (default `(380, 435)`; left-drag empty background to reposition the character): positive X right, positive Y down. Negative X can preview a backward step; negative Y can preview a jump. Facing and puppet scale affect the skeleton while the world trajectory retains its direction and distance. Choose the appropriate X sign for forward motion in the intended facing direction.

| Motion                              | Points: seconds → (X, Y)                                 |
| ----------------------------------- | -------------------------------------------------------- |
| Sword cut with a short forward step | 0 → (0, 0), 0.30 → (0, 0), 0.55 → (45, 0), 1 → (45, 0)   |
| Jump with forward travel            | 0 → (0, 0), 0.5 → (40, -100), 1 → (80, 0)                |
| Walk cycle                          | 0 → (0, 0), clip end → (chosen distance, 0)              |
| Dodge and return                    | 0 → (0, 0), 0.3 → (-40, 20), 0.6 → (-40, 20), 1 → (0, 0) |

Linear interpolation provides variable segment speeds and stationary intervals. Stepped interpolation holds each point until the next point's exact time. Both hold first/last offsets outside the point range. **Show preview trajectory** draws an independent spatial guide; repeated positions overlap. Looping returns to the clip's initial displacement each cycle.

The [Environment Preview camera](animation-environment-preview.md) offers Fixed and Follow Character modes on the same sampled time. Fixed shows travel across the background; Follow adds displacement to the configured world center. Neither mode changes world artwork, pose, facing, IK or trajectory data. Looping always resets to the configured beginning; continuous multi-cycle travel is unavailable.

## Transform and time ownership

Animation tracks target bone-local `Joint.pose` values, including root translation. `AnimationEditorPreview` samples them through the existing `AnimationPlayer`, then installs them on the Puppet before the normal preset/IK/render synchronization. Root bone keys keep their original semantics.

`Puppet.container` owns preview placement, scale and facing independently of bone tracks. Runtime `Actor`/`ActorMovement` also place this outer container; scene choreography has its own clock and Actor instances. Animation Editor uses a standalone Puppet with `autoUpdate: false`, without Actor movement or choreography. Displacement sets its outer position to `CHARACTER_PREVIEW_ORIGIN + session placement offset + evaluated displacement` before IK/rendering. It never accumulates deltas, extracts root motion or invokes movement commands. Rig and Rig Tweak modes restore the origin. Rig replacement reuses the fixed origin to avoid adding displacement twice.

`MotionPreviewSettings` contains immutable, sorted `PreviewPositionKey` values (`time` in animation milliseconds, `offsetX`, `offsetY`), `enabled`, `interpolation` and `showTrajectory`. `MotionPreviewController` stores these outside authored documents, one set per clip. React subscribes to changed clip/settings facts without rebuilding numeric forms on playback ticks.

`evaluatePreviewDisplacement` is stateless and reuses engine `evaluateCurveProgress` and `interpolateNumber`. Pose and displacement share `motionPreviewSampleTime`: both consume `previewTimeMilliseconds`, quantize stepped playback with the existing engine utility and retain exact clip endpoints. This includes playback, arbitrary scrubbing and temporary variation/cleanup preview times. There is no independent clock or asynchronous movement. Seeking to a time yields the same offset regardless of the previous seek.

`MotionPreviewLayer` owns independent Phaser graphics above artwork and the puppet. IK, bone picking, selection overlays and foot contacts use the displaced Puppet's actual world transform. Existing optional IK preview providers follow canonical Puppet space. Displacement does not lock feet or author IK keys. Temporal onion skins retain their existing comparison at the active preview placement.

## Verification

`tests/motionPreview.test.ts` covers disabled/empty paths, forward/backward/sideways motion, jumps, stationary/return segments, endpoint holding, stepped boundaries, deterministic seeks, invalid numbers, root translation, facing, scale, IK, playback speed/loop/scrub, clip switching, rig mode, history/source immutability and overlay disposal. The bundled walk additionally requires exactly equal local poses and world bone positions after repeated arbitrary seeks and after disabling displacement, in both facings.

Local desktop `tests/browser/animationMotionPreview.spec.ts` scenarios exercise a sword-cut fixture with an authored root step, a skeletal jump fixture and the bundled walk against static imported artwork. They compare enabled/disabled and repeated-seek canvas renders in both facings, play clips, retain separate clip settings, reset and verify identical exports. Decoded pixel comparisons allow one color level of GPU antialiasing variation; runtime transform comparisons remain exact. Run after building:

```bash
npx playwright test tests/browser/animationMotionPreview.spec.ts --workers=1
```

These scripted acceptance checks remain local-only. Artistic assessment of production animations remains a human review.

Implementation verification results:

| Check                                                                                                    | Result                                                                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                      | Passed                                                                    |
| `npm run test -- --maxWorkers=1`                                                                         | 3,555 passed; 47 skipped                                                  |
| `npx vitest run tests/motionPreview.test.ts --maxWorkers=1`                                              | 16 passed, including the subsequently added exact bundled-walk regression |
| `npm run check`                                                                                          | Formatting, lint and typecheck passed                                     |
| `npm run build`                                                                                          | Application, library, declarations and Node entry checks passed           |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationMotionPreview.spec.ts --workers=1` | All 6 development/production desktop cases passed                         |

The Feature Guide also passed 34 focused unit regressions (`animationGuides`, `guideRegistry`, `guideController`, `guideTargets`) and all four local Chrome cases in `tests/browser/animationMotionPreviewGuide.spec.ts`. Empty and configured trajectories resolved every target in development and production while preserving settings, playhead, playback, history availability and authored JSON through navigation, restart and exit.

Captured sword-cut, jump, walk and guide screenshots were also inspected locally. Chrome was used because the matching Playwright bundled browser was unavailable. Test runners used one worker and ran sequentially.

## Implementation files

- `src/devtools/animation-editor/motionPreview.ts`: trajectory types, validation, sample-time adapter and pure evaluation.
- `MotionPreviewController.ts`, `MotionPreviewPanel.tsx`, `MotionPreviewLayer.ts` in the same directory: clip/session ownership, collapsed numerical controls and independent viewport graphics.
- `AnimationEditorPreview.ts`, `AnimationEditorScene.ts`: placement before IK, shared sampled pose time, rig replacement and shutdown cleanup.
- `main.tsx`, `editorMarkup.tsx`, `style.css` in the same directory: workspace lifecycle, inspector wiring and existing desktop styling.
- `tests/motionPreview.test.ts`, `tests/browser/animationMotionPreview.spec.ts`: numerical, runtime and local browser regressions.
- `src/devtools/shared/guides/animationGuides.ts`, `anchors.ts`, `tests/animationGuides.test.ts`, `tests/guideRegistry.test.ts`, `tests/browser/animationMotionPreviewGuide.spec.ts`: seven-step Feature Guide, stable controls and guide regressions for empty/configured trajectories.
- `README.md`, `CHANGELOG.md`, this guide: workflow, architecture and milestone notes. Package and lockfile versions remain at the already higher `1.2.6`.

## Copy preview travel into authored root motion

Choose **Preview Copy to Root Motion** to evaluate a detached proposal through the existing pose, IK, ground and camera pipeline. Scrub or play it before applying. **Apply Copy — Replace Root Keys** explicitly replaces all existing root keys in one animation Undo transaction; **Cancel copy preview** restores the previous movement mode. Preview points are retained after cancellation and successful application. Undo/Redo restores the original/copied root keys without changing skeletal or IK tracks. Passive preview and export never commit the proposal.

Conversion inserts start/end samples and preserves clipped segments, endpoint holds and Linear/Stepped interpolation. World offsets are inverted through the current facing, scale and rotation exactly once. Paths must begin at (0, 0): root motion subtracts its initial sample, so a nonzero initial world offset cannot be represented faithfully by root keys alone. Singular placement and facing/scale changes before commit require a new preview. Editing, switching clips/rigs, leaving Animation mode or disposing the preview invalidates a pending copy.
