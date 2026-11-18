# Architecture candidate 11 — Animation editor facade shrink (follow-up to architecture-01)

Continue developing Paper Puppeteer Engine.

Source: review of `plans/architecture-01-edit-transaction-module.md` on 2026-11-17 (follow-up 3). Revised on 2026-11-18 after a codebase-design review, re-measured at `7dd916e`. `AnimationEditorState.ts` has not changed since `274637f`.

Architecture-01 step 2, "re-express `AnimationEditorState`'s public surface as domain operations", was skipped in `9e31538`. Follow-ups 1 and 2 (`d7561f3`, `274637f`) moved the transaction ordering fully into `AnimationEditSession` but left the facade's size unchanged.

## Problem

`src/devtools/animation-editor/AnimationEditorState.ts` is a shallow facade. Delete most of its members and nothing is lost except a repeated guard → batch → delegate ritual.

| Measure | Count |
|---|---|
| Lines | 1671 |
| Methods and accessors | 256 (242 public, 14 private) |
| `batchNotifications(` wrappers | 80 |
| `animationAuthoringEnabled` references | 67 (61 are `if (!this.animationAuthoringEnabled) return …;` guards) |

Facade members whose body references exactly one sub-module (rough script count, private members included): `document` 29, `ik` 28, `rootMotion` 26, `selection` 20, `keyframes` 19, `events` 18, `previews` 15, `deformation` 15, `playback` 12, `playbackController` 10, `selectionCommands` 7, `graphGestures` 6, `playbackCommands` 2. Ten members reference several modules, and 39 reference none.

Two more problems:

- **The facade still runs its own transactions.** Five paths call the private `installWorkingAnimation` → `session.install` instead of `session.commit`:
  - `applyLibraryPose` (~L376-399)
  - `setAuthoredInterpolation` (~L1297-1309)
  - `replaceWorkingAnimation` (~L1463-1474)
  - `commitIKBake` (~L1477-1496)
  - `setLibraryMetadata` (~L1545-1556)

  `applyLibraryPose` pauses by hand. That is the same ordering duplication architecture-01 removed from the command modules.
- **Every consumer depends on the whole facade.** 58 fields are typed `state: AnimationEditorState`, across 33 files.

## Goal

Make the command modules the public domain API, reached through a few typed domain handles on the facade. Define the guard and the notification batch once, in the session. Shrink the facade to session lifecycle, document and clip selection, cross-domain composition, and the handles.

## What to build

### 1. Session-owned guard and batch

Add one session operation, `run<R>(denied: R, command: () => R): R`. It returns `denied` when authoring is disabled and otherwise runs `command` inside `batch`. Command modules use it for operations the facade guards today. Operations the facade does not guard today keep plain `batch` (or no wrapper, if the facade has none).

The guards are not uniform today, and the refactor must keep them as they are:

- `cancelKeyframeDrag`, `cancelIKEdit`, `selectIKConstraint` and `setTimelineIKExpanded` are batched but **not** guarded. Cancels must still run when authoring is off.
- `copySelectedKeyframes` is neither guarded nor batched.

Before moving a domain, check whether its guards matter. `commit` already applies the guard, so a facade guard only changes behaviour when the module does something before `commit`: `beginGesture`, `cancelActiveDrags`, drag previews, selection changes. A member whose only effect is one `commit` can drop the guard rather than move it. Record each one dropped in the phase's commit message.

Node-only tests in `tests/animationEditSession.test.ts`:

- `run` returns `denied` without running the command when authoring is disabled.
- Nested `run` and `batch` calls publish exactly one notification.
- An unguarded `batch` path still runs when authoring is disabled.

### 2. Facade transactions through `commit`

Move the five `installWorkingAnimation` paths onto `session.commit`. Then delete `installWorkingAnimation` and `AnimationEditSession.install`. Nothing else calls `session.install`; imports do not use it.

Known differences between today's paths and `commit`. Keep each path's behaviour, or list the alignment in the commit message and changelog:

- **`applyLibraryPose`:** the facade's `pause()` only calls `playbackController.pause()`. `commit` with `pause: true` also ends scrubbing. Either accept that pose apply now ends a scrub (an alignment to list) or pass `pause: false` and keep the explicit pause. Move `previews.clearPose()` into the `after` hook so it still runs after pausing and before the install.
- **`setAuthoredInterpolation`:**
  - It swallows exceptions (`catch { return false }`). `commit` reports edit errors through `document.reportError` and notifies, so the user would see a new error. Keep the silent behaviour by catching inside the edit and returning `undefined`.
  - When nothing changes (`next === this.working`), it returns `true` without installing. Through `commit`, returning `working` would clear the transform draft, re-seek and notify. Returning `undefined` would return `false`. Keep the no-op check before `commit`, inside a `run`, so it still returns `true` without side effects. Do not change `commit`'s return contract for this.
- **`replaceWorkingAnimation` and `setLibraryMetadata`:** when `document.inspect` rejects the input, they notify and return `false`. Inside the edit, call `notify` (it is deferred by the batch) and return `undefined`.
- **`commitIKBake`:**
  - It reports `result.issues` on failure. It also reports them after a successful install, because install clears `document.issues`. Keep both: report on failure inside the edit, and report again after `commit` returns `true`.
- **Pause default:** today none of these paths pause except `applyLibraryPose`. Pass `pause: false` to the other four.
- **Draft cancelling:** `commit` cancels active drags before computing the edit. `install` cancelled them after. This only matters if a path reads drag or draft state while computing its snapshot. Check each path, and list any that does.

### 3. Domain handles

Expose each command module as a readonly public handle with a **typed interface**, not the raw class. Each handle leaves out the reset methods only the facade may call:

| Handle | Backing module | Leave out |
|---|---|---|
| `state.ik` | `AnimationEditorIKCommands` | — |
| `state.rootMotion` | `AnimationEditorRootMotion` | — |
| `state.previews` | `AnimationEditorPreviewCommands` | `reset`, `clearPose` |
| `state.keyframes` | `AnimationEditorKeyframeCommands` | `resetSession` |
| `state.events` | `AnimationEditorEventCommands` | `resetSession` |
| `state.deformation` | `AnimationEditorDeformationCommands` | — |
| `state.graph` | `AnimationEditorGraphGestures` | — |
| `state.playback` | `AnimationEditorPlaybackController` + `AnimationEditorPlaybackCommands` | `reset` and anything `resetAnimationSession` calls |

`state.playback` collides with today's private `playback` field (the `AnimationEditorPlayback` clock). Rename the private field to `clock` in phase 8, before adding the handle. Check every module for other facade-only members (anything called only from `resetAnimationSession`, the constructor or `createAnimationSession`) and add them to the "Leave out" column. Use `Omit<Module, …>` or an exported interface in the module file, whichever is shorter.

Keep the current member names (`state.ik.setIKPropertyKeyframe`, not `state.ik.setPropertyKeyframe`) so the test update stays a mechanical rename. Shorter names can come in a later plan.

### 4. Classify before you move

Many facade members are not pure forwards. Renaming them mechanically would change behaviour. For each domain, before renaming, sort every facade member that touches the module into one of three groups:

- **Pure forward:** an optional guard, an optional batch, then `return this.<module>.<same member>(same args)` with the same defaults. Move it to the handle and rename call sites with the script.
- **Cross-module rule:** the facade adds behaviour. Move the rule into the owning module, reached through session dependencies, then treat the member as a pure forward. Known cases:
  - `beginKeyframeDrag` cancels the event drag first.
  - `pasteKeyframes` and `duplicateSelectedKeyframes` refuse while an IK constraint is selected.
  - `selectIKConstraint` and `selectIKKeyframe` clear the root selection first. The session's `selectKeyframe` and `selectEvent` already do this through `clearRootSelection`, so reuse that.
  - `selectedIKTargetValues`: the facade version reads `previewAnimation` at `previewTimeMilliseconds` while a graph edit or IK preview is active. The module version reads only `working`. Give the IK module read access to the preview state through a dependency, or keep this getter on the facade.
- **Facade-owned:** the member composes several domains and stays on the facade. Known cases: `previewAnimation`, `timelineSnapGuide`, `setTimelineSnapSettings`, `setKeyframeSnapMode`, `nudgeSelectedKeyframe`, `cancelActiveDrags` (~L848), `resetAnimationSession`.

The rename script renames only pure forwards. Every member in the other two groups gets a decision recorded in the commit message.

### 5. Narrow controller dependencies where it comes for free

Tests construct a real `AnimationEditorState`, and nothing else implements it, so a narrower type adds no test benefit today. Its value is showing what each controller depends on. Narrow a controller only when a phase leaves it using just one handle plus a few facade members. Type it then as the handle, or as `Pick<AnimationEditorState, …> & { ik: … }`. Don't narrow the large consumers (`TimelineSessionController` uses 45 distinct members, `TimelineInputController` 28, `TimelineController` 26), and don't set a quota.

## Phases

Ship each phase as its own commit, with the full suite green. The session operation comes first because everything depends on it. After that, the order follows the number of members to move. `document` and `selection` stay on the facade and are out of scope; see Non-goals.

0. **Dry count (no code change).** For each domain in phases 2–8, classify the facade members as described in item 4, and add the table to this plan. If phases 2–8 would move fewer than about 125 public members, lower the public-member target under Acceptance before phase 2. The rough count above gives about 139 candidates, which leaves little slack.
   **Phase 0 result (2026-11-18, at `7dd916e`).** Phases 2–8 move 145 public members, so the 120 target stands. Measurement note: the first Acceptance grep does not match `private` lines, so its 256 is the 255 public members plus the constructor, not the public and private members together. The facade starts at 255 public members and 14 private ones, and 255 − 145 = 110 stays under 120. "Wrapper" is the facade's wrapper today: G = authoring guard, B = batch. "Module" is what the module does after the move: `run` (guard + batch), `batch`, or nothing. "Dropped" means the facade guard was redundant because the member's only effect is one `commit`.

   | Phase | Handle | Pure forwards | Cross-module rules moved into the module | Facade-owned (stay) |
   |---|---|---|---|---|
   | 2 | `ik` (29) | 26. `run`: `beginIKEdit`, `setTemporaryIKProperty`, `beginIKTargetDrag`, `previewIKTargetDrag`, `endIKTargetDrag`. `batch`: `cancelIKEdit`, `cancelIKTargetDrag`, `setTimelineIKExpanded`, `setIKManipulationDisabledReason`. Guard dropped: `commitIKProperty`, `setIKPropertyKeyframe`, `deleteIKPropertyKey`, `removeIKPropertyKeyframe`, `deleteSelectedIKKeyframe`, `moveSelectedIKKeyframe`, `nudgeSelectedIKKeyframe`, `commitIKTarget`. The rest are reads. | `selectIKConstraint`, `selectIKKeyframe` (clear root selection through a new `clearRootSelection` action). `selectedIKTargetValues` (reads the preview through an injected `ikPreview` dependency; internal commits keep reading `working`). | — |
   | 3 | `rootMotion` (26) | 26: 5 accessor pairs, 5 getters, 11 methods. The facade adds no wrapper. | — | `clearRootSelection` (private), `previewElapsedTimeMilliseconds` |
   | 4 | `keyframes` (18) | 13. Reads: `keyframeClipboard`, `keyframeDrag`, `keyframeSnapMode`, `keyframeFPS`, `previewKeyframeRetiming`. `run`: `previewKeyframeDrag`, `commitKeyframeDrag`, `retimeSelectedKeyframes`. `batch`: `cancelKeyframeDrag`. Guard dropped: `moveSelectedKeyframe`, `setBonePropertyKeyframe`, `removeBonePropertyKeyframe`. `copySelectedKeyframes`: no wrapper. | `beginKeyframeDrag` (cancels the event drag through an injected `cancelEventDrag`, `run`). `pasteKeyframes`, `duplicateSelectedKeyframes` (refuse while an IK constraint is selected, `run`). `mirrorCurrentPoseToKeys`, `mirrorSelectedKeyframes` (read the facade's symmetry mapping through an injected `symmetry`, `run`). | `nudgeSelectedKeyframe`, `deleteSelectedKeyframes`, `deleteSelectedKeyframe` (dispatch by selection kind, like `deleteTimelineSelection`), `setKeyframeSnapMode`, `setTimelineSnapSettings`, `timelineSnapGuide` |
   | 5 | `events` (20) | 20, counting `selectAnimationEvent` (forwards to `session.selectEvent`) and `eventTimelineTrack` (an event read with no module). `run`: `createAnimationEvent`, `pasteEvent`, `duplicateSelectedEvent`, `setSelectedEventDataJson`, `beginEventDrag`, `previewEventDrag`, `commitEventDrag`. `batch`: `cancelEventDrag`, plus `moveSelectedEvent` and `nudgeSelectedEvent` (guard dropped; the batch keeps the commit and the seek in one notification). Guard dropped: `addAnimationEvent`, `updateAnimationEvent`, `removeAnimationEvent`, `deleteSelectedEvent`. | — | — |
   | 6 | `previews` (14) | 14. The facade adds no wrapper. | — | `previewAnimation`, `applyLibraryPose`, `saveCurrentPose` |
   | 7 | `deformation` (16) | 16, counting `getAdjacentDeformationKey` (a deformation read with no module). The five deformation selection fields (`deformationSelected`, `selectedMeshId`, …) move into the module too. | — | `copyTimelineSelection`, `pasteTimelineClipboard`, `duplicateTimelineSelection` (the private `copyDeformationKey` and `pasteDeformationKey` stay hidden from the handle) |
   | 8 | `graph` (6), `playback` (16) | Graph: 6, no wrapper. Playback: 13, counting the 4 clock reads `isPlaying`, `previewLoop`, `playbackSpeed`, `isScrubbing`. `run`: `setAuthoredFPS`, `setAuthoredPlaybackMode`, `beginScrub`. `play`, `togglePlayback`, `restart` and `advancePlayback` check `authoringEnabled` but are **not** batched, because a batch would defer the pose notification until after the animation events have been dispatched. | `play`, `togglePlayback` (cancel the cleanup preview through an injected `cancelCleanupPreview`). `beginScrub` (cancels active drags through the session). `AnimationEditorPlaybackCommands` folds into `AnimationEditorPlaybackController`, so one object backs the handle. | `setCurrentTime`, `currentTime`, `currentTimeMilliseconds` (the shared clock every domain reads) |

   Keyframe selection (`selectKeyframe`, `selectKeyframes`, `selectKeyframeMarquee`, `clearKeyframeSelection`, `getAdjacentKeyframe`, `selectAdjacentKeyframe`) stays on the facade with the selection model (see Non-goals). Each of these members clears root, deformation or IK selection, or dispatches by selection kind. So the "keyframe part of `selectionCommands`" in phase 4 moves nothing.

   Facade-only members left out of the handles: `previews` hides `reset`, `clearPose`, `reconcile`, `trajectoryAnimation`, `cleanupAnimation`, `variationAnimation` and `hasIKPreview`. `rootMotion`, `deformation` and `graph` each hide `previewAnimation`. `deformation` also hides `copyDeformationKey` and `pasteDeformationKey`. `keyframes` and `events` hide `resetSession`. `playback` hides `setCurrentTime` and `setCurrentTimeMilliseconds`.

1. Session `run`, the five facade transactions through `commit`, `installWorkingAnimation` and `session.install` removed (items 1–2).
2. IK.
3. Root motion.
4. Keyframes, plus the keyframe part of `selectionCommands`.
5. Events.
6. Previews.
7. Deformation.
8. Graph gestures and playback (rename the private `playback` clock field to `clock` first).

For each phase:

1. Classify the members.
2. Move the cross-module rules into their modules.
3. Move the pure forwards to the handle.
4. Run the rename script on `src/` and `tests/`.
5. Narrow any controller that now qualifies.
6. Record the Problem-table measures and the classification decisions in the commit message.

## Non-goals

- Moving `document` or `selection` members (about 49 together). The facade keeps document and clip lifecycle and the selection model. A later plan can decide whether those become handles.
- Renaming members to drop the domain prefix (for example `ik.setIKPropertyKeyframe` → `ik.setPropertyKeyframe`).
- Introducing fakes or a second implementation of the facade for controller tests.

## Constraints

- Refactor only: observable editor behaviour must not change. Where a path skipped a step that `commit` takes, or a guard is dropped as redundant, list it in the phase's commit message and changelog entry.
- Leave the `AnimationEditorState` constructor (`rig, animations, options`) unchanged, so the 247 test constructions need no edits.
- Test churn comes from call sites: about 4,960 `state.method(…)` / `editor.method(…)` calls in `tests/`. Update them with a scripted rename per phase, driven by that phase's pure-forward list (`state.moveSelectedKeyframe(…)` → `state.keyframes.moveSelectedKeyframe(…)`). Keep the script out of the repo unless it is reused. Do not hand-edit test logic. If a test needs more than a rename, the member was not a pure forward; reclassify it.
- `AnimationEditorDocument` and `AnimationEditSession` stay the only owners of history and transaction ordering. Handles never install directly.
- Follow the code style in `src/devtools/animation-editor/`, and run `npm run check:fix`.

## Verification

- `npm run typecheck`
- `npm run test` (vitest, sequential, one worker; do not run test commands concurrently or add workers, per AGENTS.md)
- The new node-only session tests for `run` (guard, batch, nesting, unguarded path).
- The architecture-01 grep check must still find nothing:

```sh
grep -nE "\.(pause|endScrub|install)\(" src/devtools/animation-editor/AnimationEditor*Commands.ts \
  src/devtools/animation-editor/AnimationEditorGraphGestures.ts \
  src/devtools/animation-editor/AnimationEditorRootMotion.ts
```

- After phase 1, this must also find nothing:

```sh
grep -nE "installWorkingAnimation|session\.install\(" src/devtools/animation-editor/
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

- Fewer than 120 public facade members (from 242), or the target set in phase 0.
- Fewer than 20 `batchNotifications(` wrappers (from 80).
- Fewer than 10 authoring-guard early returns in the facade (from 61). Guards live in the session's `run`, or are dropped where `commit` already guards.
- `installWorkingAnimation` and `AnimationEditSession.install` are gone. Every authored edit goes through `commit`.
- Every handle is typed so that it leaves out its module's facade-only reset methods.
- Every cross-module rule from item 4 lives in its owning module or is recorded as facade-owned.
- All existing tests pass with mechanical renames only.
