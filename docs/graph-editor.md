# Animation Graph Editor — v1.1.2.2

See [Advanced animation workflow](advanced-animation-workflow.md) for poses, variations, cleanup and saving together. **Feature Guide → Animation Editor → Editing Bézier Handles** provides a focused five-step tour alongside the existing Graph Editor tour. It reveals actual controls without selecting keys or authoring curves.

Open an animation, select a bone or IK constraint, then click **Graph Editor** beside Timeline. The same button returns to the timeline. Playback, current time, selected tracks/keys, inspectors, document, Undo/Redo and export remain shared.

Choose a property: bone Translation X/Y, Rotation, Scale X/Y; or IK target X/Y and IK influence (`mix`). Empty properties explain how to set keys with the existing property inspector. Select a point to inspect its key, drag it to edit time/value, or use **Key time (s)**, **Value**, **Apply key**. Graph time edits reject collisions and crossing neighbors instead of replacing keys. Only the selected channel changes, including when other properties share its sparse row. Delete removes the shared selection; Left/Right moves the primary graph key one authored frame (ten with Shift), preserving neighbor order. Native text input shortcuts keep their normal behavior.

**Interpolation** controls the selected key's outgoing segment. Auto removes its override and inherits the clip's linear default; Linear, Stepped and Bézier create explicit overrides. The final key has no outgoing segment. Bézier shows outgoing/incoming tangent points and guide lines. Drag them, or expand the initially collapsed **Tangent precision** section for numeric coordinates. **Reset handles** places horizontal endpoint tangents at time fractions 1/3 and 2/3. Controls use normalized segment time/progress in [0, 1], with `control1.x <= control2.x`; pointer edits clamp to these bounds, and invalid numeric edits report an error without changing the document. Constant-value segments remain constant for every progress curve; numeric progress controls remain available.

Wheel zooms around the pointer in both axes, middle-button drag pans, and **Fit graph** / F restores the complete property range. Graph zoom buttons use the center as anchor. Resize preserves visible time/value bounds. These operations never author keys. Frame snapping uses the existing timeline Snap/Frames settings and authored FPS, with Shift bypass. Clicking or dragging the empty plot scrubs the shared playhead.

## Feature Guide

Open **Feature Guide → Animation Editor → Graph Editor** for a seven-step explanation covering the view switch, supported properties, curve/playhead coordinates, outgoing interpolation, Bézier tangents, key precision and navigation/preview/export. A selected animation is required; bone/IK selection and authored keys are optional so the tour can explain empty states. Steps reveal the actual controls and tangent disclosure without authoring keys, selecting tracks or changing curves. Timeline tours reveal the timeline again when needed. Exit the tour before performing the described edits.

## Coordinates and runtime evaluation

Authored times remain milliseconds. Graph labels and inputs use seconds. SVG/pointer coordinates are CSS pixels, with a 64 px left and 16 px top plot origin. Time increases rightward; values increase upward. Forward/inverse conversion lives in `graphEditor.ts`. Padding fits negative, small, large and constant ranges independently of authored data.

Rotation stays in authored radians and uses degrees in the UI, matching the existing inspector. Graph display keys accumulate the runtime's `shortestRotationDelta`; sampled displayed values interpolate this continuous equivalent of the authored angles. This avoids a display-only jump at ±180°. Precision fields retain the original authored angle (including full turns); dragging applies a value delta to that original angle.

The graph calls the runtime `sampleProperty` evaluator on projected sparse property keys and applies `quantizePlaybackTime` for authored stepped playback. Sampling includes key/frame boundaries and their left-hand samples so holds render as steps. Bézier time inversion is the engine's existing evaluator. The graph introduces no easing implementation or serialized format. It draws the evaluated property, before IK changes bone transforms.

## Ownership and history

`GraphEditorPanel.tsx` supplies stable React controls/SVG hosts. `GraphEditorController.ts` owns SVG drawing, view bounds, pointer capture and listeners. `TimelineController` binds, renders and disposes that adapter with its existing session. Ordinary playback notifications update only the playhead line; they do not rebuild SVG curves or introduce React frame subscriptions.

`AnimationEditorState.beginGraphEdit`, `previewGraphEdit`, `commitGraphEdit`, `cancelGraphEdit` and `editGraphKey` coordinate the gesture. Every provisional snapshot passes `validateEditedAnimation`. `previewAnimation` exposes it to the existing Phaser preview and property inspectors, while `workingAnimation`, export and saved checkpoints retain committed data. `hasPendingAnimationEdits` prevents autosave/package capture of the gesture. Release commits through the existing immutable document/history boundary once. Escape, pointer cancellation, capture loss, blur, session/selection navigation, mode change, Undo/Redo and adapter teardown discard the preview. Invalid numeric edits never enter history. Runtime curve formats and legacy animations remain compatible.

## Verification

Unit regressions cover channel availability, runtime curve agreement, stepped sampling, rotation wrapping, sparse channel isolation, neighbor/collision rejection, normalized/crossing handle constraints, invalid previews, shared selection/history, actual Puppet live preview, IK evaluation, serialization, coordinate round trips, zoom/pan, resize dimensions and lifecycle teardown/remount. Local desktop Playwright workflows exercise actual controls, tangent drags, Escape, Undo/Redo, download/reload, timeline synchronization, keyboard editing, empty properties, zoom/pan, resizing and playback SVG reuse. Browser tests remain local-only.

## Changed files and APIs

| Files                                                                                                           | Responsibility                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GraphEditorPanel.tsx`, `GraphEditorController.ts`, `graphEditor.ts`                                            | Stable React controls, SVG/gesture lifecycle, property projection, runtime samples, validated sparse edits and coordinate/view helpers.             |
| `AnimationEditorState.ts`                                                                                       | Graph gesture APIs, pending-edit ownership, provisional `previewAnimation`, one commit through existing history and shared selection.               |
| `AnimationEditorPreview.ts`, `BoneInspectorController.ts`, `IKInspectorController.ts`                           | Observe the provisional evaluator for immediate Phaser and inspector feedback.                                                                      |
| `TimelineController.ts`, `editorMarkup.tsx`, `style.css`                                                        | Bind/dispose graph with the existing editor and expose the desktop timeline/graph view switch.                                                      |
| `graphGuideTargets.ts`, shared `guides/animationGuides.ts` and `guides/anchors.ts`                              | Register the seven-step Feature Guide and stable real-control targets, reveal graph/timeline views safely and release target providers on teardown. |
| `interpolation.ts`, `interpolationPresentation.ts`                                                              | Keep the legacy selection inspector read-only and direct artists to Graph Editor.                                                                   |
| `tests/graphEditor.test.ts`, `tests/graphEditorLifecycle.test.ts`, `tests/browser/animationGraphEditor.spec.ts` | Runtime/data/history/preview, React/controller cleanup and local desktop workflow regressions.                                                      |

Runtime interpolation APIs, authored schemas and serialization versions are unchanged. The changelog entry is under SemVer heading `1.1.2-2`; README and animation guides link to this workflow.

## Actual verification — 2026-10-23

| Exact command                                                                                                                           | Result                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                     | Exit 0; no TypeScript errors. Also repeated successfully by `check` and `build`.                                                                                        |
| `npm run test`                                                                                                                          | Final standalone run: exit 0; 192 files passed, 5 skipped; 3,393 tests passed, 46 skipped (29.95 s).                                                                    |
| `npm run build`                                                                                                                         | Exit 0; authoring application, library, declarations and renderer-independent consumer checks passed. Vite emitted the existing Lucide `use client` directive warnings. |
| `npm run check`                                                                                                                         | Exit 0; formatting, lint and typecheck passed.                                                                                                                          |
| `npx vitest run tests/graphEditor.test.ts tests/graphEditorLifecycle.test.ts`                                                           | Exit 0; 29 new unit/lifecycle tests passed.                                                                                                                             |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGraphEditor.spec.ts tests/browser/animationInterpolation.spec.ts` | Exit 0; all 18 local desktop scenarios passed across development and production (3.7 min). Includes 8 Graph Editor scenarios.                                           |
| `git diff --check`                                                                                                                      | Exit 0.                                                                                                                                                                 |

The bundled Playwright browser was unavailable, so local browser verification used the installed Chrome. Running the full unit suite concurrently with browser/build work exposed an existing 5-second timeout in the large-scene autosave fingerprint regression; that file passed independently, and the final full run above passed after browser work ended. No timeout or CI changes were made.

Actual interaction checks were automated in the real React/Phaser editor: select bone/IK tracks, change interpolation, drag tangents with live held-pose feedback, cancel with Escape, move keys with frame snapping, edit precision values, reject key collisions and invalid handles/influence, Undo/Redo, download/reload, switch views, resize, zoom/pan and run playback without rebuilding SVG curves. The exported Bézier controls survived reload and remained visible in timeline metadata. The generated desktop Graph Editor screenshot was visually inspected. A separate hands-on artist session following the forearm checklist was not performed.

### Feature Guide follow-up

The seven-step Graph Editor tour is registered in the shared Animation Editor catalog. Its view-aware target adapters preserve authored data, selection, temporary inspector edits, playhead and history while revealing graph controls; subsequent timeline steps reveal the timeline again. Empty/unselected clips remain supported, and missing animations show the existing creation prerequisite. The older Interpolation tour now explains property curves.

Follow-up verification: `npm run typecheck`, `npm run check`, `npm run build` and `git diff --check` passed. `npm run test` passed with 193 files passed, 5 skipped; 3,395 tests passed, 46 skipped (29.44 s). `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGraphGuide.spec.ts tests/browser/animationGraphEditor.spec.ts` passed all 14 desktop scenarios across development and production (2.0 min), covering real-control reveal, Back/Finish/Escape/focus, selection/draft/history preservation, switching back to a Timeline tour, prerequisites and the existing graph editing workflows. Browser checks remain local-only.

A final `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGraphGuide.spec.ts` run passed all 6 development/production scenarios (1.0 min), including explicit spotlight-to-control alignment checks. The production tangent-precision tour screenshot was visually reviewed: the highlighted real inputs and adjacent guide card were visible and separate, and the temporary inspector value remained intact.
