# Architecture candidate 04 — attachLocalAutosave lifecycle module

Continue developing Paper Puppeteer Engine.

Source: architecture review 2026-11-14 (candidate 4, rated Strong). Revised 2026-11-17 after checking against the code.

## Problem

Three editors hand-wire the same `LocalAutosave` lifecycle: `start()`, a change subscription, a 500 ms `setInterval(update)`, `pagehide` → `suspend()`, `pageshow` → `start()`, `visibilitychange` (hidden) → `flush()`, and teardown that reverses all of it and calls `dispose()`.

| View | Construction | Lifecycle wiring | Drift |
| --- | --- | --- | --- |
| `src/devtools/scene-editor/SceneEditorView.tsx` | `:69-74` (`useState`, `undefined` in project context) | `:75-99` (`useEffect`) | Subscribes to `document.subscribe` **and** polls. |
| `src/devtools/project/ProjectView.tsx` | `:187-214` (`addProject`: construct, `workspace.subscribe`, `start()`) | `:128-160` (one effect for all sessions) | One set of listeners and one poll iterate every session; per-session `releaseAutosave` + `dispose()` on unmount. Sessions are only added, never closed individually. |
| `src/devtools/animation-editor/main.tsx` | `:425-459` (only outside project context) | `:297-308` (page-lifetime listeners), `:314-317` (dispose on character reload), `:627-631` (teardown) | No subscription: ~5 call sites push `autosave?.update()` by hand. The instance is **replaced** on every character load while the listeners stay registered for the page lifetime. |

All three poll at 500 ms and all pass `localDrafts` as storage.

## Goal

One deep module next to `LocalAutosave` owns the attach/detach lifecycle. Each view constructs its `LocalAutosave` as today and makes one call to attach it.

## Interface

Add to `src/devtools/shared/autosave/LocalAutosave.ts`:

```ts
export interface PageLifecycleEvents {
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
    readonly visibilityState: DocumentVisibilityState;
  };
}

/** Runs an autosave until the returned detach is called. Detach takes ownership: it disposes the autosave. */
export function attachLocalAutosave(
  autosave: LocalAutosave,
  options?: {
    /** Change notifications from the authored document. Omit when the caller pushes update() itself. */
    subscribe?: (listener: () => void) => () => void;
    /** Defaults to globalThis.window / globalThis.document. Injected by tests (vitest runs in `node`). */
    page?: PageLifecycleEvents;
  },
): () => void;
```

Behaviour behind the interface:

- On attach: `autosave.start()`, subscribe with `autosave.update` (if given), start a 500 ms poll of `autosave.update` (module constant `AUTOSAVE_POLL_MS`), and register `pagehide` → `suspend()`, `pageshow` → `start()`, `visibilitychange` → `flush()` when `visibilityState === 'hidden'`.
- On detach: clear the poll, unsubscribe, remove all three listeners, then `autosave.dispose()`. Calling detach a second time does nothing.

Design notes:

- The function **takes an existing instance** rather than constructing one. Callers still need the instance for `exported()`, `<LocalDraftControls autosave>` (`subscribe`/`getSnapshot`/`retry`/`discard`) and the animation editor's manual `update()` calls. This also keeps SceneEditorView's `useState` construction without an extra render.
- It returns only `detach`. `suspend`/`flush`/`start` are driven by page events inside the module, so callers have no reason to call them.
- Storage is not an option here; it is already a `LocalAutosave` constructor argument, and `DraftStorage` stays the seam for storage (`LocalDraftStore` / test `MemoryStorage`).
- `page` is the new seam: the browser globals and a test fake are its two adapters. No clock injection: `LocalAutosave` uses global timers and tests already use `vi.useFakeTimers()`.
- The poll interval is a constant, not an option: every call site uses 500 ms.

## What to build

1. Implement `attachLocalAutosave` and `PageLifecycleEvents` in `LocalAutosave.ts`. `LocalAutosave`, `AutosaveSource`, `DraftStorage` and `LocalDraftStore` stay unchanged.
2. **SceneEditorView**: replace the effect at `:75-99` with
   `useEffect(() => (autosave ? attachLocalAutosave(autosave, { subscribe: document.subscribe }) : undefined), [autosave, document]);`
   Leave the separate playback `pagehide`/`visibilitychange` effect (`:58-68`) alone; it is not autosave.
3. **ProjectView**: in `addProject`, replace `releaseAutosave: workspace.subscribe(autosave.update)` + `autosave.start()` with `detachAutosave: attachLocalAutosave(autosave, { subscribe: workspace.subscribe })`. Remove the session-iterating poll, `flush`/`leave`/`resume`/`hidden` handlers and their listener registration/removal from the `[editors]` effect. In its cleanup, replace `session.releaseAutosave(); session.autosave.dispose();` with `session.detachAutosave();`. Keep the `beforeunload` guard, transfers abort, and editor disposal as they are. Update the session type accordingly.
4. **Animation editor**: remove `pollAutosave`, `flushLocal`/`leaveLocal`/`resumeLocal`/`hiddenLocal` and their registration/removal. Hold `let detachAutosave: (() => void) | undefined`. On character reload (`:314-317`) and in teardown (`:627-631`) call `detachAutosave?.(); detachAutosave = undefined;` in place of `autosave?.dispose(); clearInterval(pollAutosave);`. After construction (`:457-458`) use `detachAutosave = attachLocalAutosave(autosave);` in place of `start()` + `setInterval`. The manual `autosave?.update()` calls stay.

## Behaviour to preserve

- Same cadence: 500 ms poll, 1000 ms `LocalAutosave` debounce, 5 s heartbeat.
- Same page semantics: `pagehide` suspends and releases the lease, `pageshow` restarts, hidden visibility flushes.
- Same disposal: on unmount (scene, project), on character reload and teardown (animation).
- Project context: Scene and Animation editors still create no local autosave inside a project; ProjectView still runs one autosave per session.
- Small allowed difference: in the animation editor the page listeners now exist only while an autosave is attached rather than for the whole page lifetime. Before, they called `autosave?.…` on `undefined`, so nothing observable changes. In ProjectView each session now registers its own listeners rather than sharing one set; the effect on each session is the same.

## Out of scope

- `src/devtools/shared/DraftRecovery.ts:60-70` has a similar `pagehide`/`beforeunload`/`visibilitychange` pattern for the older JSON drafts. Do not fold it in here.
- No changes to `LocalAutosave` internals, recovery UI, or storage format.

## Tests

New `tests/attachLocalAutosave.test.ts`, using `vi.useFakeTimers()`, a fake `PageLifecycleEvents` (two small `EventTarget`s plus a mutable `visibilityState`), and a `LocalAutosave` over an in-memory `DraftStorage` (reuse or extract the `MemoryStorage` from `tests/localAutosave.test.ts`):

- attach starts the autosave, and a dirty source is saved after poll + debounce without any subscription;
- a `subscribe` notification triggers `update` (saved after debounce, without waiting for the poll);
- `pagehide` suspends (storage `release` called, no save while suspended) and `pageshow` resumes saving;
- `visibilitychange` with `visibilityState === 'hidden'` flushes immediately; `'visible'` does not;
- detach unsubscribes, stops the poll, removes all three listeners (dispatching events afterwards does nothing), and disposes the autosave;
- calling detach twice is safe.

## Constraints

- No browser smoke tests in CI (AGENTS.md); unit tests only.
- Run tests sequentially with one worker (AGENTS.md).
- `npm run check:fix` for style.
- No version number on this plan: changelog entry goes under Unreleased.

## Verification

- `npm run typecheck`, `npm run check`
- `npm run test` — including `tests/localAutosave.test.ts`, `tests/animationDraftRecoveryController.test.ts`, the editor tests and the new `tests/attachLocalAutosave.test.ts`.
- Optional, local only: open the scene editor, animation editor and a project, edit, reload, and confirm the recovery prompt still offers the draft.

## Acceptance

- SceneEditorView, ProjectView and the animation editor contain no autosave `setInterval` or `pagehide`/`pageshow`/`visibilitychange` wiring; each attaches with one `attachLocalAutosave(...)` call and releases with its returned detach.
- The lifecycle is covered by unit tests using injected page events and fake timers.
- Full suite passes.
