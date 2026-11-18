# Architecture candidate 19 — Small items: rig inspector attribute escaping, per-frame allocation trial

Continue developing Paper Puppeteer Engine.

Source: codebase-design scan of the whole repo on 2026-11-18 (measured at `7dd916e`). These are two independent, small items. Each can land as its own commit.

## Problem

1. **The rig inspector writes an unescaped value into `innerHTML`.** `numberRows` in `src/devtools/rig-editor/InspectorController.ts:52-68` builds `<input … value="${displayed}" … placeholder="${fallback}">`, and `InspectorController.ts:162-187` assigns the result to `inspector.innerHTML`. Labels and ids go through `escapeHtml`, but `displayed` and `fallback` don't. Today this is safe only because `schemas/rig.schema.json` forces bone, slot, sprite and attachment fields to be numbers, and `fallback` comes from constants. If a field's validation ever loosens, or a non-validated draft path reaches the inspector, a string value becomes markup.
2. **`AnimationPlayer.update` allocates on every frame.** `src/engine/AnimationPlayer.ts:871-935` runs per puppet per frame. For each playing layer it spreads the whole `AnimationState` twice (`{ ...state, time: state.unwrappedTime }`, `:890` and `:903`), only for `advanceAnimationTime` to read `time`, `speed` and `clip` (`src/engine/animationTimeline.ts:63-70`). It also creates a new `AnimationEventBudget`, two arrays and two closures for `finishPoseChange`. Pose evaluation itself already reuses buffers (`AnimationLayerEvaluator.evaluateLayer`). The extra cost is unmeasured, and may not matter outside scenes with many actors.

## What to build

1. **Escape every interpolated attribute in `numberRows`.** Pass `displayed` and `fallback` through `escapeHtml`, as `label` already is. A full rewrite to `createElement` is not needed: the surrounding markup is static.

   Add a unit test that renders the inspector for a bone whose field holds a string such as `'"><img src=x onerror=alert(1)>'` (bypassing validation in the test), and asserts that no `img` element appears and that the input's `value` is the literal string.
2. **Measure, then trim the per-frame allocations.**
   1. Run `VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose` (one worker) twice at the starting commit and record the medians.
   2. Replace the two state spreads with a clock object that carries only `time`, `speed` and `clip`, or with an `advanceAnimationTime` overload that takes the start time. Reuse one `AnimationEventBudget` per player if `addCrossings` can be reset safely; otherwise leave it.
   3. Run the profile twice again.

   Keep the change only if both runs show a clear improvement (more than run-to-run noise) with the full suite green. Otherwise revert it and record the timings under "Recorded decisions", as architecture-17 did for `isolate: false`.

## Constraints

- Item 1 is a hardening change with no visible effect on valid rigs.
- Item 2 is behaviour-preserving: event firing order, root-motion displacement and completion notifications must not change. `tests/perFrame.profile.test.ts` has no thresholds; don't add any.
- `npm run build:lib` (`scripts/check-core.mjs`) stays green.
- Changelog under Unreleased, as plain bullets matching the existing entries (there are no Fixed/Security subheadings): one for item 1, and one for item 2 only if it is kept.

## Verification

- `npm run check`, `npm run test` (sequential, one worker), `npm run build:lib`.
- New inspector escaping test passes.
- For item 2: before and after profile medians recorded here.

## Acceptance

- No value reaches the rig inspector's `innerHTML` without `escapeHtml`.
- The allocation trial's result is recorded with timings, kept or reverted.
- Full test suite passes.

## Recorded decisions

- **Item 1 (kept):** `numberRows` now passes `value`, `placeholder`, `data-scope` and `data-field` through `escapeHtml`. The derived rotation label is built with `format()`, which always yields a numeric string. No DOM parser is installed (the vitest environment is `node`), so the test in `tests/rigEditorControllerLifecycle.test.ts` checks the markup assigned to the stub inspector host: after stripping well-formed double-quoted attribute values, no `<img` tag may remain, and the decoded `value` attribute of the `x` input must equal the payload. The test failed before the fix and passes after it.
- **Item 2 (reverted, 2026-11-19, measured at `8c3738f`):** The trial added an optional `from` start-time parameter to `advanceAnimationTime`, replacing all three `{ ...state, time: state.unwrappedTime }` spreads (`update` ×2, `advance` ×1). It also reused one `AnimationEventBudget` per player through a new `reset()`. The `events`/`completions` arrays and the `finishPoseChange` closures were left alone, because the arrays escape into notification dispatch. Profile medians in µs/frame (`VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose`, one worker, two runs each):

  | Scenario | Before 1 | Before 2 | After 1 | After 2 |
  | --- | ---: | ---: | ---: | ---: |
  | 32 tracked bones, base animation | 51.85 | 48.25 | 56.83 | 52.15 |
  | 32 tracked bones, three layers with fades | 142.86 | 137.43 | 135.90 | 145.99 |
  | 8 IK channel tracks, 1 smooth layers | 39.05 | 36.06 | 38.95 | 39.15 |
  | 8 IK channel tracks, 3 smooth layers | 178.12 | 178.75 | 172.72 | 174.81 |
  | 8 IK channel tracks, 1 stepped layers | 21.87 | 25.68 | 22.38 | 22.99 |
  | 8 IK channel tracks, 3 stepped layers | 58.94 | 59.37 | 58.27 | 61.97 |
  | Dense 128-key base animation | 62.86 | 62.47 | 62.27 | 61.93 |
  | Dense 128-key three layers with fades | 187.22 | 188.37 | 185.20 | 186.58 |
  | Dense 128-key nonsequential scrubbing | 33.92 | 34.29 | 34.45 | 41.86 |
  | Dense 512-key base animation | 64.07 | 65.35 | 65.40 | 64.40 |
  | Dense 512-key three layers with fades | 210.18 | 215.17 | 207.00 | 209.93 |
  | Dense 512-key nonsequential scrubbing | 48.96 | 52.11 | 49.97 | 51.96 |
  | 36 bones, 1 active / 12 inactive IK | 11.67 | 12.27 | 11.28 | 12.16 |

  Run-to-run noise reaches about 8–20% on the same code (for example 21.87 vs 25.68, and 34.45 vs 41.86). No scenario improved consistently by more than that, and a few got slower, so the trial was reverted and no changelog entry was added. The per-update allocations are a handful of small, short-lived objects; next to pose evaluation (tens to hundreds of µs per frame), they don't show up at this profile's resolution. Revisit only if a many-actor profile shows GC pressure from `AnimationPlayer.update`.
