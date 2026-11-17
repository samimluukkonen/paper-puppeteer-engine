# Architecture candidate 06 — Typed guide-step factory + static anchor contract

Continue developing Paper Puppeteer Engine.

Source: architecture review 2026-11-14 (candidate 6, rated Worth exploring). Revised 2026-11-17 after review against the code.

## Problem

All guide code lives in `src/devtools/shared/guides/`.

1. **Swappable arguments.** Four guide files each define a local positional `step()` helper with two different all-string orders: `animationGuides.ts` and `rigGuides.ts` use `step(id, title, description, targetId)`; `sceneGuides.ts` and `projectGuides.ts` use `step(id, title, targetId, description)` (~390 calls in total). Swapping `description` and `targetId` compiles cleanly and only fails at runtime (`GuideTargets.resolve` → null → "Target unavailable").
2. **Untyped target ids.** `GuideTargetId` in `types.ts` is `string`, so a guide step can name any string, not just a key of the anchor contract `GUIDE_TARGETS` in `anchors.ts` (211 keys).
3. **Missing anchors are only caught per editor.** ~50 view files must each set `data-guide-id={GUIDE_TARGETS.x}`. `GuideTargets.findElement` (`GuideTargets.ts:124-131`) returns `null` on zero or duplicate matches. Only per-editor render tests (e.g. `tests/animationGroundGuide.test.ts:327`, `tests/sceneGuides.test.ts:109`) notice when a view drops an anchor, and only for the states those tests render.

## Goal

A swapped argument or an unknown target is a compile error. A guide target that no view renders fails one shared test. A duplicate anchor is loud in development instead of silently disabling a step.

## Rejected approach: mount-time registration

The first draft proposed registering DOM anchors via `GuideTargets.registerGeometry(id, el)` on mount. Do not do this:

- `registerGeometry` takes a `GuideGeometryProvider`, not an element. A registered provider also owns `resolve`/`reveal` for its id, which bypasses the DOM reveal path (tab reveal, `<details>` opening, inspector drawer, menu closing, scrolling). Spotlight behaviour would change.
- Registering on mount cannot detect a *missing* anchor. A view that never mounts never registers, and many anchors render only in particular states. Detection would still happen at runtime in the browser.
- Throwing on duplicates at mount would crash an editor over a guide-only problem.
- `registerGeometry` has no production caller today. Do not build on it in this plan.

## What to build

### 1. Typed target ids

In `types.ts`, narrow the target type to the anchor contract:

```ts
import type { GUIDE_TARGETS } from './anchors.js';
export type GuideTargetId = (typeof GUIDE_TARGETS)[keyof typeof GUIDE_TARGETS];
```

This applies to `GuideStep.targetId`, `practice.targetId`, and the `GuideTargetResolver` / `GuideTargets` methods. If it breaks the `registerGeometry` / `GuideGeometryProvider` signatures or tests that pass arbitrary strings to `GuideTargets`, keep those on `string` with a separate type (e.g. `GuideAnchorId` for guide data, `string` for the resolver). Choose whichever produces the smaller diff, and record the choice in the changelog entry.

### 2. One object-arg factory

Add `guideStep` to `types.ts` (or a sibling `step.ts` re-exported from `index.ts`):

```ts
export const guideStep = (step: GuideStep): GuideStep => ({ preparation: 'reveal-target', ...step });
```

- It accepts the full `GuideStep` union, including the 5 `try-it` steps in `animationGuides.ts`.
- **Preserve `mode` exactly.** The animation and rig helpers set `mode: 'explain'`; the scene and project helpers leave it out. `tests/animationGuides.test.ts:240` and `:313` assert `step.mode === 'explain'`. In `animationGuides.ts` and `rigGuides.ts`, keep a one-line local wrapper `const step = (s: GuideStep) => guideStep({ mode: 'explain', ...s })`. Scene and project call `guideStep` directly.
- Delete all four positional `step()` helpers. Migrate every call to object arguments. A script codemod is fine; review the diff for swapped fields before committing.
- The exported guide data must be deep-equal to before the migration. Verify it once: serialize `getGuides()` (or the four arrays) to JSON before and after, and diff the two. Do not commit the snapshot.

### 3. Static anchor contract test

Add `tests/guideAnchorContract.test.ts`, a pure source and data test with no rendering:

- Collect every `targetId` and `practice.targetId` from all registered guides (through the registry's public listing).
- Map each value back to its `GUIDE_TARGETS` key.
- Read every `.ts`/`.tsx` file under `src/` outside `src/devtools/shared/guides/`. Collect anchor references matching `\b(GUIDE_TARGETS|targets)\.(\w+)\b`. Those are the aliases views use today. If grep turns up any other alias, add it.
- **Fail** for any guide target whose key no view file references. The message names the guide, the step and the key.
- **Fail** for any `GUIDE_TARGETS` key that neither a guide nor a view references (a dead anchor). If existing dead keys make this noisy, delete them in this plan. Don't add an allowlist.
- Include a self-check: running the scan against a fixture string without the reference must fail. This proves the regex can't pass vacuously.

### 4. Loud duplicates in development

In `GuideTargets.findElement`, keep returning `null` for duplicate matches. Also log `console.error` once per id when `matches.length > 1` and `import.meta.env.DEV` is true, naming the id. Add a case for this to `tests/guideTargets.test.ts`.

### Keep

The per-editor render tests (`tests/*Guide*.test.ts` assertions that a rendered panel contains each step's `data-guide-id` exactly once). They cover state-dependent rendering and duplicates, which the static test cannot. Don't delete them. Where one only repeats the "key is referenced somewhere" check, you may simplify it.

## Constraints

- Guide behaviour must be identical: same spotlight targets, same ordering, same prereq chains, same `mode` and `preparation` values.
- Do not change `GuideController`/`GuideRegistry` validation logic. Change only types where the narrowed `GuideTargetId` flows through.
- Do not change `GuideTargets` resolve/reveal behaviour. The only addition there is the dev-only duplicate log.
- `npm run check:fix` for style.

## Verification

- `npm run typecheck`, `npm run check`
- `npm run test` (sequential, one worker, per AGENTS.md). All `tests/*uide*.test.ts` must pass, plus the new contract test.
- Before/after JSON diff of the guide data shows no changes (step 2).
- Manual negative checks, reverted afterwards:
  - Swap `title` and `targetId` in one guide step → typecheck fails.
  - Use `targetId: T.sceneNew + 'x'` or a literal string → typecheck fails.
  - Remove one `data-guide-id={GUIDE_TARGETS.x}` from a view → the contract test fails with that guide, step and key.

## Acceptance

- No positional `step(id, title, string, string)` helpers or calls remain in any guide file.
- `GuideStep.targetId` only accepts `GUIDE_TARGETS` values.
- A guide target that no view references fails the contract test, not the browser.
- Duplicate anchors log a dev error naming the id.
- Full suite passes.
