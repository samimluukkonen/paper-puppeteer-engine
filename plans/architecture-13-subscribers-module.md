# Architecture candidate 13 — One `Subscribers` module for devtools notifications

Continue developing Paper Puppeteer Engine.

Source: codebase-design scan of the whole repo on 2026-11-17 (measured at `64f7e6e`). This plan fixes two bugs and removes about 25 hand-written copies of the same listener code.

## Problem

About 25 devtools modules each write their own listener code: `new Set<() => void>()`, `subscribe`, a private `notify()`, often a `revision` counter with `getSnapshot`, and `listeners.clear()` on dispose. They do this with **three different error policies**:

| Policy | Files |
|---|---|
| **Report**: isolate each listener, then `reportError` (`notifySubscribers` in `src/devtools/shared/subscriberNotifications.ts`) | 13: `AttachmentController`, `LocalAutosave`, `ArtworkController`, `LocalDraftStore`, `PackageController`, `ProjectWorkspace`, `SceneImageRegistry`, `SceneCharacterRegistry`, `PoseLibraryController`, `SceneEditorPlayback`, `SceneEditorNotifications`, `AnimationLibraryController`, `MotionDiagnosticsController` |
| **Rethrow**: isolate, then `throwNotificationErrors` back into the caller | 9: `GroundGuideWorkspace`, `GuideController`, `RigTweakController`, `AnimationEditSession`, `NewAnimationController`, `AnimationVariationController`, `MirrorToolsController`, `KeyframeRetimingController`, `IKBakeController` (some through `dispatchListeners`) |
| **None**: a bare `for (const listener of …) listener()` | 4: `EnvironmentPreviewController.ts:46`, `IKInspectorController.ts:161`, `MotionPreviewController.ts:47`, `FootContactGroundController.ts:47` |

Bugs this causes:

1. **No isolation (the four "None" files).** One listener that throws skips every later listener and turns a successful edit into a thrown error. `IKInspectorController` and `FootContactGroundController` also loop over the live Set, so a listener that subscribes or unsubscribes during delivery changes who gets this notification. Every other module snapshots the Set first, which the engine's `dispatchListeners` documents as "callback mutations affect only subsequent notifications".
2. **Rethrow where report was meant.** `GroundGuideWorkspace.notify()` (`:70-80`) rethrows listener errors into whoever changed the ground guide, so a broken UI subscriber makes a valid guide edit look failed. That contradicts the documented purpose of `notifySubscribers`: "without turning successful document/resource operations into failed edits". Check each of the other rethrow modules the same way, see What to build 3.

`AnimationEditSession` is a deliberate exception. It collects listener errors and passes them to its own `reportError` dependency after reconciling previews (see `tests/animationEditSession.test.ts`). That is a real second error policy, not drift.

Removing the hand-written copies loses nothing: each one restates the same handful of lines. The behaviour that differs, the error policy, is the part that should be a deliberate, named choice.

## Goal

One small module owns subscribing, delivery ordering, error isolation and the revision counter. Each owner picks its error policy by name. No devtools module outside it holds a listener Set.

## What to build

1. **`Subscribers` in `src/devtools/shared/subscriberNotifications.ts`.** Keep `notifySubscribers` as a thin wrapper, or remove it once all callers have migrated.
   ```ts
   class Subscribers {
     constructor(options: { label: string; onError?: 'report' | 'collect' });
     readonly subscribe: (listener: () => void) => () => void; // stable arrow for useSyncExternalStore
     readonly getSnapshot: () => number;                      // the revision
     notify(): unknown[];  // bumps the revision, delivers to a snapshot of the listeners,
                           // 'report' (default) → reportError and returns []; 'collect' → returns the errors
     clear(): void;
   }
   ```
   Delivery uses the engine's `dispatchListeners`, so the snapshot and isolation rules are the engine's. The `report` path keeps today's `reportError` → `queueMicrotask` fallback.
2. **Migrate every listener-owning devtools module** in the table above to a `Subscribers` field. Keep each module's public `subscribe`/`getSnapshot` names and signatures, so React `useSyncExternalStore` call sites don't change. If a module exposes its revision under another name (for example `revision`), delegate to `getSnapshot`.
3. **Choose each module's error policy explicitly:**
   - The four "None" modules and `GroundGuideWorkspace` use `report`. This is the bug fix.
   - `AnimationEditSession` uses `collect` and keeps passing the errors to `deps.reportError`.
   - For each remaining rethrow module, use `report` unless a test or caller depends on the throw. If one does, use `collect`, rethrow at that call site, and record the reason under "Recorded decisions" below.
4. **Enforce it.** Add a lint check (an `oxlint` restricted-syntax rule if one fits, otherwise a small `scripts/` check run by `npm run lint`). It fails on `new Set<() => void>()` in `src/devtools/**` outside `subscriberNotifications.ts`. The engine (`src/engine`) is out of scope: `Puppet` and `AnimationPlayer` have their own typed listener sets and lifecycle rules.

## Constraints

- No behaviour change apart from the error-policy fixes in item 3.
- Keep the public `subscribe`/`getSnapshot` shapes. React views must not re-render more or less often than before.
- Changelog entry goes under Unreleased (a "Fixed" line for the isolation bugs).

## Verification

- `npm run check` (format, lint including the new rule, typecheck)
- `npm run test` (sequential, one worker)
- New unit tests for `Subscribers`:
  - a throwing listener doesn't stop the others;
  - `report` calls `reportError` and `notify()` returns `[]`;
  - `collect` returns the errors and doesn't report them;
  - a listener added during delivery is first notified on the next `notify()`;
  - a listener removed during delivery still receives the current notification;
  - `getSnapshot` increments once per `notify()`;
  - `clear()` drops every listener.
- One regression test per formerly unisolated module (`EnvironmentPreviewController`, `IKInspectorController`, `MotionPreviewController`, `FootContactGroundController`) and for `GroundGuideWorkspace`: the edit succeeds and later listeners still run when the first listener throws.

## Acceptance

- `grep -rn "new Set<() => void>()" src/devtools` finds only `subscriberNotifications.ts`, and lint enforces it.
- No devtools module loops over listeners by hand.
- Every module that uses `collect` has a recorded reason.
- Full test suite passes.

## Recorded decisions

- `AnimationEditSession` uses `collect` and rethrows at its call site (`throwNotificationErrors`). The Problem section above was inaccurate: the session never passed listener errors to `deps.reportError` (that dependency reports failed edits only); it rethrew them. `AnimationEditorState` callers depend on the throw: `play()`, `restart()` and `advancePlayback()` merge subscriber failures with animation-event failures into one `AggregateError`, and `setPreviewLoop()` rethrows (`tests/animationEditorEventPlayback.test.ts`, `tests/animationEditorState.test.ts`).
- `GuideController` uses `collect` and rethrows at its call site, because `tests/guideController.test.ts` asserts that `exit()` throws a subscriber failure after finishing the transition and notifying the remaining subscribers.
- `RigTweakController`, `NewAnimationController`, `AnimationVariationController`, `MirrorToolsController`, `KeyframeRetimingController` and `IKBakeController` use `report`: only React views subscribe to them, and no test or caller depends on the throw.
- `notifySubscribers` is removed; its tests moved to `tests/subscribers.test.ts`.
- The lint check is `scripts/check-subscribers.mjs` (run by `npm run lint`), because oxlint 1.90 has no `no-restricted-syntax` rule. It also rejects a hand-written `for (const listener of …)` loop.
