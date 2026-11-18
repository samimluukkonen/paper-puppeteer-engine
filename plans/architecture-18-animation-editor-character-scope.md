# Architecture candidate 18 — One per-character scope for the animation editor's bindings

Continue developing Paper Puppeteer Engine.

Source: codebase-design scan of the whole repo on 2026-11-18 (measured at `7dd916e`).

## Problem

`src/devtools/animation-editor/main.tsx` wires about 20 controllers and subscriptions to each loaded character. Each one appears in three lists kept by hand:

| List | Where | What it does |
| --- | --- | --- |
| Ready | `onReady` callback, `main.tsx:311-469` | binds each controller to the new `AnimationEditorState`, and stores each subscription's release in its own `let releaseX` variable |
| Failure | `onError` callback, `main.tsx:471-499` | unbinds each controller and calls each `releaseX` |
| Teardown | returned unmount function, `main.tsx:626-676` | disposes each controller and calls each `releaseX` again |

The lists already disagree. The failure list skips two bindings the ready list makes:

- `releaseProject` (`projectContext.bindCharacter(…)`, `main.tsx:319-329`). Its guard closure keeps reading the failed load's `state.hasPendingAnimationEdits` and `editorScene.rigEditor`.
- `detachAutosave` (standalone mode, `main.tsx:458`). The `LocalAutosave` stays attached. Its 500 ms poll calls `editorScene.packageSnapshot()`, which throws `No character is loaded.` once the scene's catch has cleared `definition`. So the status line shows that message as a storage error, and the heartbeat keeps renewing the storage lease for the previous draft key every 5 s.

**The failure path is reachable after a successful ready.** `AnimationEditorScene.loadCharacter` calls `this.onReady(state, id)` inside its `try` (`AnimationEditorScene.ts:760`). If anything after that throws — the `EnvironmentPreviewCamera` constructor (`:762-769`), or `main.tsx`'s own ready callback part-way through — the catch runs and calls `this.onError(…)` (`:814`). Main then runs its failure list against bindings the ready list already made.

Every new per-character controller must be added to all three lists. Nothing checks that it was.

## Goal

A character's bindings are opened in one place and released in one place. The failure path and teardown can't drift from the ready path, because neither has its own list.

## What to build

1. **A small `Scope` module in `src/devtools/shared/scope.ts`.**
   - `add(release: () => void): void` registers a release.
   - `close(): void` runs the releases in reverse order, once. If several throw, it keeps going and rethrows them as one `AggregateError`. A second `close()` does nothing.
   - `add` after `close` runs the release immediately, so a late async bind can't leak.

   `DisposableStack` is not available: `tsconfig.json` targets `ES2022`. Keep the interface that small. Don't add `use`/`adopt` variants unless a call site needs one.

   Node-only tests in `tests/scope.test.ts` cover: reverse order, close once, `add` after close, and aggregated errors.
2. **One character scope in `main.tsx`.**
   - Hold `let characterScope: Scope | undefined`. At the top of the ready callback, close the previous scope and open a new one.
   - Register every per-character binding with it: each controller's `unbind`, each `releaseX` subscription, `detachAutosave`, `releaseProject`, `previewPreferences.dispose`, and the project-mode `groundGuide.bind` (released with `groundGuide.bind(null)`).
   - Delete the `let releaseX` variables that exist only to be released later.
3. **Failure and teardown close the scope.**
   - The failure callback closes the character scope. Then it does the failure-only work: `projectContext?.characterLoadFailed()`, `rigWorkspace.showError(message)`, `timeline.showError(message)` and `guides.refresh()`.
   - Teardown closes the character scope first. Then it disposes the page-lifetime controllers (those constructed at module scope or once per mount, `main.tsx:90-113` and `:283-300`) as it does today.

   Page-lifetime controllers may also move into a second, mount-level `Scope` if that removes the teardown list. That part is optional: the teardown list has no failure-path twin.
4. **Regression test.** Make the scene's ready callback throw after `onReady` (for example by making the environment camera throw). Assert that the autosave is detached, so no `No character is loaded.` status is published after the next poll, and that `projectContext.bindCharacter`'s release ran. Put it with the existing `tests/animationEditorSceneLifecycle.test.ts` mocks if they fit, otherwise in a new file.

## Out of scope

- `AnimationEditorScene` has the same shape inside it. `releasePreview` (`create()`, `AnimationEditorScene.ts:179-…`), the `loadCharacter` catch (`:770-812`) and `disposePreview` (`:158-230`) each tear down overlays, handles and layers by hand. Leave them unless the main-side scope lands cleanly. If it does, record the scene-side split as a follow-up candidate here; don't fold it into this plan.
- The rig editor and scene editor mains are 2 and 44 lines and have no equivalent lists.

## Constraints

- Behaviour-preserving, except for the two fixed leaks above.
- Controllers keep their `bind`/`unbind`/`dispose` methods. The scope calls them; it doesn't replace them.
- Keep release order sensible: subscriptions registered later are released first. This matches reverse-order `close`.
- Changelog entry goes under Unreleased as a plain "Fix …" bullet, matching the existing entries: a failed animation-editor character load no longer leaves local autosave polling the previous character, or the project's character guard bound.

## Verification

- `npm run check`, `npm run test` (sequential, one worker), `npm run build:demo`.
- New `tests/scope.test.ts` and the failure-path regression test pass.
- Locally, optionally: the animation editor browser specs still pass with `PLAYWRIGHT_CHANNEL=chrome`.

## Acceptance

- `main.tsx`'s failure callback has no per-controller `unbind` or `releaseX` calls; it closes the character scope.
- No `let releaseX` variable remains whose only job is to be released by a later list.
- A throw after `onReady` leaves no autosave poll or project character binding behind (test).
- Full test suite passes.

## Recorded decisions

- **The scope lifecycle lives in `src/devtools/animation-editor/characterScope.ts`, not as a bare `let characterScope` in `main.tsx`.** `characterScope(open, failed)` returns `{ ready, failed, close }`. `ready` closes the previous scope and opens a new one. `failed` closes the scope, then runs the failure-only work in a `finally`. `main.tsx` passes `ready`/`failed` straight to `AnimationEditorScene` and calls `close()` first in teardown. This gives the regression test a seam: `tests/animationEditorCharacterScope.test.ts` drives the real scene with a throwing `EnvironmentPreviewCamera` through the same lifecycle `main.tsx` uses. `main.tsx` itself still has no unit test, so its registrations are checked by review and the browser specs.
- **`stateOwner` is cleared by the scope.** It registers first, so it is released last, and only clears when it still holds this character's state. That replaces the separate `stateOwner = undefined` lines in the failure and teardown paths.
- **A re-ready now unbinds every controller before rebinding.** Most `bind()` methods already call `unbind()` first. The rest (`PackageController`, `MirrorToolsController`, the inspectors, retiming) take the same unbind→bind path a retry after a failed load already took.
- **A first load that fails before any ready no longer calls `unbind()` on never-bound controllers.** Each controller's initial snapshot equals its unbound one, so the UI is unchanged.
- **Teardown in project mode now also runs `groundGuide.bind(null)`.** It comes from the scope; `GroundGuideWorkspace.bind` never writes preferences.
- **The page-lifetime teardown list stays as it is.** The optional mount-level `Scope` was not adopted, because that list has no failure-path twin.
- **Follow-up candidate (not in this plan): a scene-side scope.** `AnimationEditorScene` keeps three hand-kept lists: `releasePreview` in `create()`, the `loadCharacter` catch and `disposePreview`. Each tears down overlays, handles and layers. The same `Scope` could own one per-load scope there.
