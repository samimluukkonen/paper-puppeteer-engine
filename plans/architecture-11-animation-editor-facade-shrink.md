# Architecture candidate 11 — Animation editor facade shrink (follow-up to architecture-01)

Continue developing Paper Puppeteer Engine.

Source: review of `plans/architecture-01-edit-transaction-module.md` on 2026-11-17 (follow-up 3). Architecture-01 step 2, "re-express `AnimationEditorState`'s public surface as domain operations", was skipped in `9e31538`. Follow-ups 1 and 2 (`d7561f3`, `274637f`) moved the transaction ordering fully into `AnimationEditSession` but left the facade's size unchanged.

## Problem

`src/devtools/animation-editor/AnimationEditorState.ts` is still a shallow god-facade (measured at `274637f`):

| Measure | Count |
|---|---|
| Lines | 1671 |
| Methods and accessors | 256 (242 public, 14 private) |
| `batchNotifications(` wrappers | 80 |
| `animationAuthoringEnabled` references | 67 (61 are `if (!this.animationAuthoringEnabled) return …;` guards) |

Most public members are 1–4 line pass-throughs into a sub-module, wrapped in the same guard → batch → delegate ritual. Delegations by sub-module: `selection` 36, `document` 36, `ik` 29, `rootMotion` 27, `previews` 24, `keyframes` 22, `events` 20, `deformation` 18, `selectionCommands` 14, `playbackController` 12, `graphGestures` 7.

Two more problems:

- **The facade still runs its own transactions.** Five paths call the private `installWorkingAnimation` → `session.install` directly instead of `session.commit`: bone-pose apply (`pause()` + `previews.clearPose()` + install, ~L390-398), interpolation (~L1298-1304), inspected input (~L1466-1472), cleanup with issues (~L1486-1494) and the library edit (~L1548-1554). Some pause by hand, which is the same ordering duplication architecture-01 removed from the command modules.
- **Every consumer depends on the whole facade.** 58 controller fields are typed `state: AnimationEditorState`, so any member removal touches the full surface, and controllers cannot be tested against a narrower contract.

## Goal

Make the command modules the public domain API, reached through a small number of domain handles on the facade. Move guards and batching into the session so they exist once. Shrink the facade to session lifecycle, document/clip selection, and those handles.

## What to build

1. **Session-owned guard and batch.** Add one session operation, for example `run<R>(denied: R, command: () => R): R`, that applies the authoring guard and the notification batch. Command modules wrap their public operations in it. The facade stops restating `if (!this.animationAuthoringEnabled) return …; return this.batchNotifications(() => …)`. Cover it with node-only tests in `tests/animationEditSession.test.ts` (guard returns `denied` without running the command; nested runs publish once).
2. **Facade transactions through `commit`.** Move the five facade `installWorkingAnimation` paths onto `session.commit`, using `pause: false` where the path does not pause today. Then remove `installWorkingAnimation`, and remove `install` from the session if nothing else needs it (imports may still; keep it only for those).
3. **Domain handles.** Expose the existing command modules as readonly public handles: `state.keyframes`, `state.events`, `state.ik`, `state.deformation`, `state.rootMotion`, `state.graph`, `state.previews`, `state.playback`. Move each module's public operations and read-only getters off the facade onto its handle. Keep the cross-module rules the facade adds today (for example, `beginKeyframeDrag` cancelling the event drag first, or `pasteKeyframes` refusing while an IK constraint is selected) in the owning module, reached through session dependencies, not in a facade wrapper.
4. **Narrow controller dependencies.** As each domain moves, retype the controllers that use only that domain to take its handle (or a `Pick` of the facade plus that handle) instead of the whole `AnimationEditorState`.

## Phases

Ship each phase as its own commit, with the full suite green. Order: largest delegation count first, to shrink the facade fastest, with the session operation first because everything depends on it.

1. Session `run` + facade transactions through `commit` (items 1–2).
2. IK (29 delegations).
3. Root motion (27).
4. Previews (24).
5. Keyframes and keyframe selection (22 + the keyframe part of `selectionCommands`).
6. Events (20).
7. Deformation (18).
8. Graph gestures and playback (7 + 12).

Per phase: move the operations, update callers, retype the controllers that now need only the handle, and record the facade measures from the Problem table in the commit message.

## Constraints

- Refactor only: observable editor behaviour must not change. Where a facade path skipped a step that `commit` takes, as architecture-01 follow-up 1 found, list the alignment in the phase's commit message and changelog entry.
- Leave the `AnimationEditorState` constructor (`rig, animations, options`) unchanged, so the 247 test constructions in 88 files need no edits.
- Test churn comes from call sites: about 4,960 `state.method(…)` / `editor.method(…)` calls in `tests/`. Those updates must be mechanical (`state.moveSelectedKeyframe(…)` → `state.keyframes.moveSelectedKeyframe(…)`). Do them with a scripted rename per phase. Keep the script out of the repo unless it is reused, and do not hand-edit test logic.
- Keep `AnimationEditorDocument` and `AnimationEditSession` as the only owners of history and transaction ordering; the handles must not install directly.
- Follow the code style in `src/devtools/animation-editor/`; run `npm run check:fix`.

## Verification

- `npm run typecheck`
- `npm run test` (vitest, sequential, one worker; do not run test commands concurrently or add workers, per AGENTS.md)
- New node-only session tests for `run` (guard, batch, nesting).
- The architecture-01 grep check must still find nothing:

```sh
grep -nE "\.(pause|endScrub|install)\(" src/devtools/animation-editor/AnimationEditor*Commands.ts \
  src/devtools/animation-editor/AnimationEditorGraphGestures.ts \
  src/devtools/animation-editor/AnimationEditorRootMotion.ts
```

## Acceptance

Measured with the same commands as the Problem table, after the final phase:

```sh
F=src/devtools/animation-editor/AnimationEditorState.ts
grep -cE '^  (get |set )?[a-zA-Z_]+(<[^>]*>)?\(' $F          # methods and accessors
grep -cE '^  private (get |set )?[a-zA-Z_]+(<[^>]*>)?\(' $F  # private subset
grep -c 'batchNotifications(' $F
grep -cE 'if \(!this\.animationAuthoringEnabled\) return' $F
```

- Fewer than 120 public facade members (from 242).
- Fewer than 20 `batchNotifications(` wrappers (from 80).
- Fewer than 10 authoring-guard early returns in the facade (from 61); guards live in the session's `run`.
- No facade path calls `session.install` for an authored edit; `installWorkingAnimation` is gone.
- At least half of the 58 `state: AnimationEditorState` controller fields are narrowed to a domain handle or a `Pick`.
- All existing tests pass with mechanical updates only.
