# v0.5.2.6.2 — Interpolation UI

## Implemented

The schema-compatible portion of `plans/plan-05-02-06-02.md`: a compact selected-key interpolation inspector, a separately scoped clip declaration editor, outgoing/terminal marker indicators and native titles, existing preview/history integration, and controller/runtime/browser regression coverage. Package version is `0.5.2-6.2`.

The plan's full definition of done is **not satisfied**: v0.5.2.6.1 only supports clip-wide `linear` interpolation and explicitly rejects selected-key mutations. Smooth/stepped are authored playback sample-timing modes, not interpolation modes. Per-key changes, successful batch interpolation changes, mixed modes and stepped-vs-smooth authored marker shapes cannot be implemented while preserving those APIs/schema. This implementation exposes that capability boundary safely rather than serializing unsupported metadata or changing unrelated segments through a selection action.

## Interpolation UI behavior

**Selected key interpolation** shows **Linear** for a valid outgoing selection and is disabled with a clip-inheritance explanation. With no animation or no selection it shows **—** and explains what to select. A terminal key, single-key property, or selection containing any terminal key shows **—** and explains the missing outgoing segment. Missing-key state has its own explanation. These states use `state.selectedInterpolation` and the existing selection-query policy; UI code does not inspect raw key arrays.

Available modes are derived from the authoritative Zod interpolation literal, currently only `linear`. Smooth/stepped remain in the existing Mode/FPS controls. No new interpolation shortcuts are added while key mutations are unavailable.

**Clip interpolation** is explicitly scoped to the whole animation. **Linear** adds the optional declaration; **Default (Linear)** removes it. Both evaluate identically. The control uses `state.setAuthoredInterpolation()` and is disabled when no animation is selected. It never interprets key selection as permission to mutate the clip. Invalid/programmatic values restore the held value. Opening a dropdown has no mutation handler.

## Mixed-selection behavior

Version 1 cannot author mixed interpolation, and the existing selection type has no mixed variant. Multiple outgoing keys across bones/properties report inherited Linear. Any unavailable member makes the whole selection unavailable, matching the centralized query API. Unavailable selection changes cannot create history or alter the clip. Mixed authored modes and edits of just the applicable members remain dependent on a future model/API extension.

## Timeline marker behavior

Filled diamonds identify outgoing Linear segments; hollow diamonds identify keys without outgoing segments. Selected keys retain their color and selection ring; the primary keeps its stronger outline. The button hit area, time position and keyboard semantics remain unchanged. `data-interpolation` and native titles derive from `state.getSegmentInterpolation(ref)`, independent of playback sampling.

Titles contain `bone.property`, editor time in seconds, value, and either **Linear (inherited from clip)** or **Unavailable (no outgoing segment)**. Metadata-only changes and Undo/Redo refresh interpolation presentation even when track rows are reused. Surviving marker buttons remain stable. Playback-only notifications do not query marker interpolation again; the selected-key inspector similarly caches queries by immutable working animation and selection identity.

## Preview/runtime integration

No evaluator, compiler, playback path or interpolation math is added. The existing authored setter installs a working snapshot, and `AnimationEditorPreview`'s subscription recompiles/resamples at the existing current time. Preview tests verify immediate resampling on declaration edits, Undo and Redo, unchanged selection/time, and subsequent playback through the existing runtime.

Rotation keys at 0 and 1 second are sampled at 0, 0.25, 0.5, 0.75 and 1 second. Smooth sampling follows the existing linear/shortest-path evaluator. With stepped playback at 1 FPS, the initial rotation holds until the exact final pose. This is FPS quantization of the clip, not an authored per-key stepped segment. Other FPS values retain their existing intermediate sampled poses. Default/explicit Linear declaration changes have no pose difference.

## History/dirty behavior

One changed clip declaration invokes one centralized setter, installs one authored snapshot, records one history entry and produces one state notification. Queries, selections, dropdown focus, invalid changes and metadata no-ops stay clean and preserve redo/drafts. Returning to the implicit default restores the clean baseline when no other data changed.

Tests preserve authored track identity, key times/values, current time, selected keys, primary key, bone/property context and immutable caller/source animation. Undo/Redo updates both controls through the existing subscription. There is no per-key loop of mutation calls.

## Files changed

- `src/devtools/animation-editor/interpolationPresentation.ts`: schema-derived mode options, labels and selection availability presentation.
- `src/devtools/animation-editor/InterpolationController.ts`: selection inspector and explicitly scoped clip edits, cache, event cleanup.
- `src/devtools/animation-editor/TimelineController.ts`: controller composition, rendering, rebinding and disposal.
- `src/devtools/animation-editor/TimelineTracksController.ts`: authored segment marker attributes/titles and metadata refresh.
- `src/devtools/animation-editor/editorMarkup.ts`, `style.css`: accessible controls/help/legend and terminal marker appearance.
- `tests/animationEditorInterpolationUI.test.ts`: 15 controller/presentation cases.
- `tests/animationEditorPreview.test.ts`: two runtime preview regression cases.
- `tests/helpers/rigEditorDom.ts`: stored attribute reads/writes for the DOM adapter.
- `tests/browser/animationInterpolation.spec.ts`: three scenarios, each run on development and production base paths.
- `README.md`, `docs/animation-editor.md`, this report: behavior and capability limitations.
- `package.json`, `package-lock.json`: milestone version only.

The supplied plan remains unchanged. No dependencies, engine code, JSON schemas, existing interpolation APIs or selection semantics are changed.

## APIs/types changed

New editor-only exports: `AUTHORED_INTERPOLATION_MODES`, `interpolationLabel(mode)`, `selectedInterpolationControl(selection)` and `InterpolationController(app, getState)` with `render()`/`dispose()`. They consume the existing `Interpolation` and `InterpolationSelectionState` types. No engine/public package APIs or serialized types change.

## Tests

The 15 new controller/presentation cases cover schema-derived options, inherited modes under both sampling modes, no animation/selection, terminal/single keys, multi-track selection, missing-key presentation, unavailable event safety, one logical clip mutation/notification/history entry, source/selection/time preservation, Undo/Redo, dirty/no-op/redo/draft behavior, restoring Default, query caching and rebind/disposal.

Two additional preview cases verify smooth and stepped sampling at the requested scrub times, immediate snapshot resampling on declaration edits/history, subsequent playback and source immutability.

The new browser scenarios cover outgoing/terminal titles and marker attributes, unavailable multi-selection, schema-derived dropdown options, clip edits with selected keys, current time and numeric pose preservation, stable button identity, primary preservation, Undo/Redo, smooth/stepped sampling and playback, and desktop/mobile screenshots. Existing marker and dense-timeline regression scenarios are also included in the targeted browser run. No brittle pixel equality tests are added.

## Manual verification

The requested two-key rotation scrub/playback, cross-property selection and history flows are exercised by Playwright on development and production builds. Desktop marker and mobile timeline screenshots are generated and visually reviewed. A separate hands-on manual browser pass has not been performed.

Per-key smooth/stepped edits and a mixed authored-mode selection cannot be manually verified in the current model. Changing playback Mode/FPS is verified separately and is not reported as key interpolation editing.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 72 files passed, 3 skipped (75 total); 1,200 tests passed, 28 skipped (1,228 total).
- `npm run build`: passed, exit 0; demo/library production builds, TypeScript declarations and Node `/core` smoke check passed.
- `npm run lint`: passed, exit 0.
- `npm run check:version`: passed, exit 0.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationInterpolation.spec.ts tests/browser/animationKeyframeMarkers.spec.ts tests/browser/animationTimelineUpdates.spec.ts`: 16 scenarios exercised on development/production; 14 initially passed. The two failures were a new test's incorrect assumption that additive selection changes the primary key. The assertion was corrected to preserve the editor's existing primary policy. The same command with `--last-failed` passed both corrected scenarios, exit 0 (2 passed). All 16 targeted scenarios are verified. Browser checks required localhost/Chrome access outside the filesystem sandbox; the initial sandbox attempt failed to open port 4173.
- Formatting checks for changed source/tests/documentation/manifest and `git diff --check`: passed, exit 0.

## Deferred to v0.5.2.6.3+

Per-key/per-track interpolation ownership and schema/compiler/runtime support; smooth/stepped interpolation mutation; atomic multi-key edits; mixed-mode selection and corresponding marker shapes. These need an explicit model/API extension before the remaining plan requirements can be met. Curve editing, easing families, Bézier/tangents, event editing, onion skinning, ghost poses, mirrored copying, IK targets and baking remain deferred as requested.
