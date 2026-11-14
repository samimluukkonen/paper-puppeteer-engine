# Architecture candidate 01 — Edit-transaction module behind AnimationEditorState

Continue developing Paper Puppeteer Engine.

Source: architecture review 2026-11-14 (candidate 1, rated Strong).

## Problem

`src/devtools/animation-editor/AnimationEditorState.ts` (1746 lines, the hottest file in the repo at 58 commits) is a shallow god-facade: ~274 public members, ~83 `batchNotifications(() => …)` wrappers, ~63 `animationAuthoringEnabled` guards. Nearly every method is a 1–3 line pass-through to one of the sub-modules wrapped in the same ritual: guard → batch → delegate. The real invariant — the mutation transaction ordering — is restated in six command modules (`AnimationEditorKeyframeCommands.ts`, `AnimationEditorEventCommands.ts`, `AnimationEditorIKCommands.ts`, `AnimationEditorDeformationCommands.ts`, `AnimationEditorGraphGestures.ts`, `AnimationEditorPreviewCommands.ts`), each repeating: `cancelTimelineDrag() → playback.pause() → endScrub() → actions.updateTime(time) → actions.install(freezeData(next), …) → notify()`, plus a ~115-line constructor wiring block (`AnimationEditorState.ts:430-545`) hand-wiring each module's private `*Actions` interface. A missed step in one copy is a silent runtime bug.

## Goal

Introduce a deep edit-transaction module that owns the ordering once, and shrink the facade's interface from ~274 atoms to domain operations. Make the transaction ordering unit-testable without a DOM.

## What to build

1. A new module (e.g. `AnimationEditSession.ts` in `src/devtools/animation-editor/`) with a small interface, roughly:
   - `commit(edit: (working, rig) => next, opts?: { retainDraft, selectedKeys }): boolean`
   - plus a drag-lifecycle owner (begin / preview / commit / cancel) if the four-phase drag protocol in the six `*Commands`/`GraphGestures` modules does not collapse into `commit` cleanly.
   - Internally it owns, once and privately: cancel active drags → pause playback → endScrub → updateTime → install (freeze + history entry) → batch-notify.
2. Re-express `AnimationEditorState`'s public surface as domain operations (`moveSelectedKeys`, `commitIKDrag`, `applyMirror`, …) that delegate to the session, instead of per-sub-module atoms. Remove the permanent stub `setSelectedKeyframeInterpolation` (`AnimationEditorState.ts:1357`, always returns `false`) or implement it.
3. Collapse the six private `*Actions` interfaces into one shared actions shape; shrink the constructor wiring accordingly.
4. Keep `AnimationEditorDocument` (validated snapshots, history) as-is — it is already a deep module; the session installs through it.

## Constraints

- Do not change observable editor behaviour; this is a refactor. Existing tests in `tests/animationEditor*.test.ts` must pass unmodified or with mechanical updates only.
- New ordering-invariant tests go against the new module's interface directly (pure, no Phaser, no DOM — vitest runs in `environment: 'node'`).
- Follow the existing code style in `src/devtools/animation-editor/`; run `npm run check:fix`.

## Verification

- `npm run typecheck`
- `npm run test` (vitest, sequential — one worker; do not run test commands concurrently or add workers, per AGENTS.md)
- New unit tests for the transaction module covering: ordering, one history entry per command, batch notification, cancel-drag on commit, guard behaviour.

## Acceptance

- Facade public member count drops substantially (target: domain operations, not ~274 atoms).
- The 6-step ordering exists in exactly one place.
- All existing animation editor tests pass; new tests cover the ordering without DOM/Phaser setup.
