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

## Review 2026-11-17 — follow-ups

Implemented in `9e31538`. `AnimationEditSession.commit()`, the shared `AnimationEditActions` shape, the stub removal and the node-only ordering tests landed. Two acceptance criteria are not met:

- **The facade did not shrink.** `AnimationEditorState.ts` went from 1746 to 1671 lines and from 258 to 256 methods; `batchNotifications(` dropped from 87 to 80 and authoring guards from 68 to 67. Step 2 (domain operations) was skipped.
- **The ordering is not in one place.** About 25 call sites still build parts of the sequence by hand, mostly drag-begin and select-at-time paths. The plan made the drag-lifecycle owner optional, and `AnimationEditActions` still exposes the individual steps, so modules can keep composing them.

### Follow-up 1 — Session primitives for the rest of the sequence

Add to `AnimationEditSession` (and test them in `tests/animationEditSession.test.ts`, node-only):

- `stopPlayback(): void` — pause → end scrub. The one "stop the clock" step; `commit` uses it too.
- `beginGesture(): void` — cancel active drags → `stopPlayback()`. Used by every drag/gesture begin and select-at-time path. It runs inside the caller's batch and leaves the notification to the caller, because every caller changes selection or gesture state after it.

As built, `seekTo(time)` was dropped from the original proposal. Every select-at-time site changes selection between stopping the clock and seeking, and the seek must see the new selection. Root-motion and deformation selection also cancel drags whether or not a time is given, but only stop the clock when one is. So those sites call `beginGesture()` or `stopPlayback()` and then `updateTime` themselves.

Move these call sites onto them:

- `AnimationEditorKeyframeCommands.ts`: `beginKeyframeDrag` (pause/endScrub/updateTime on an already-selected key), `deleteSelectedKeyframes` (manual `playback.pause()` before `editKeyframes`; fold into `commit`).
- `AnimationEditorIKCommands.ts`: `beginIKTargetDrag` and the two other cancel → pause → endScrub blocks (~L188, ~L202).
- `AnimationEditorRootMotion.ts`: root-key selection with time (~L95-103), root drag begin (~L163-165).
- `AnimationEditorGraphGestures.ts`: graph gesture begin (~L41-43).
- `AnimationEditorDeformationCommands.ts`: deformation gesture begin (~L62-64), `setDeformationEditing` (~L156), `selectDeformation` with time (~L182-184).
- `AnimationEditorSelectionCommands.ts`: `prepareSelection` / `selectAnimationEvent`.
- `AnimationEditorPreviewCommands.ts`: the five `state.pause()` calls when previews begin. As built, the four preview starts use `stopPlayback()` (they already require no pending edits, so there are no drags to cancel), and `commitTrajectoryCopy` uses the default `commit` sequence.

Also make modules call playback through the session only, not a mix of `this.playback.pause()`, `this.state.pause()` and `this.session.pause()`.

Small behaviour alignments this causes, all where a site skipped a step the others take: graph-gesture begin and preview starts now also end an active scrub. Deleting keyframes and committing a trajectory copy pause only when the edit installs. Pause and end-scrub now go through the playback controller everywhere, which adds a notification that the outer batch absorbs.

### Follow-up 2 — Stop exposing the steps on the shared interface

After follow-up 1, remove `pause`, `endScrub`, `updateTime`, `updateTimeMilliseconds`, `install` and `cancelActiveDrags` from `AnimationEditActions`. Command modules get only transaction operations (`commit`, `beginGesture`, `seekTo`, `batch`, `notify`, selection helpers). The facade keeps raw access through `AnimationEditSessionDeps`.

Acceptance (grep check):

```sh
grep -nE "\.(pause|endScrub|install)\(" src/devtools/animation-editor/AnimationEditor*Commands.ts \
  src/devtools/animation-editor/AnimationEditorGraphGestures.ts \
  src/devtools/animation-editor/AnimationEditorRootMotion.ts
# expected: no matches
```

`npm run typecheck`, the full animation-editor suite (sequential, one worker) and `npm run check:fix` must stay clean; behaviour must not change.

### Follow-up 3 — Separate plan for shrinking the facade

Step 2 needs its own plan, because it means migrating ~35 controllers and ~246 test constructions of `AnimationEditorState`. That plan should include:

- **A numeric target**, e.g. fewer than 120 public members on `AnimationEditorState` and fewer than 20 `batchNotifications(` wrappers, measured by the same grep counts as above.
- **Phases by domain** (keyframes, events, IK, deformation, root motion, preview), each moving its controllers onto a domain operation or a narrow sub-facade, and each shipped and tested on its own.
- **Guards and batching moved into the session**, not kept as per-method wrappers in the facade.
- **A test-construction helper**, so the ~246 test constructions change mechanically once instead of per file.
