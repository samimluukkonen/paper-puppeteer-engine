# Architecture candidate 07 — Runner-owned ownership watch instead of a module global

Continue developing Paper Puppeteer Engine.

Source: architecture review 2026-11-14 (candidate 7). Re-rated after verification on 2026-11-17: **Low priority, worth doing only in the shape below.** The current global is correct and conservative; the cost is coupling, not correctness.

## Problem

`src/engine/ownershipRevision.ts` is a module-global `let revision = 0`. `AnimationPlayer` (~10 call sites: play/stop/pause/stopQueue/clearAllLayers/restart/abort/dispose…) and `ActorMovement` (4 call sites) call `invalidateOwnership()`. `SceneRunner.checkOwnership()` (`SceneRunner.ts:620-650`) compares `getOwnershipRevision()` with `checkedOwnershipRevision` and, on any change, re-checks the scene's own `rootMotionActors`, `activeMoves` and `activeAnimations`.

What the global actually costs:

- **Cross-runner coupling.** Any puppet anywhere (an editor preview, an unrelated runtime puppet, a second runner) bumps the revision and makes every runner rescan. Results stay correct, but the extra scans are wasted work.
- **No injectable seam.** `AnimationPlayer` and `ActorMovement` reach a hidden module dependency, so tests can't observe or isolate invalidation per runner.

What it does **not** cost (claims in the original draft that don't hold):

- Scans are not over "all actors": they only cover scene-owned entries, and only after a bump.
- Tests are not order-dependent: a foreign bump can only cause an extra scan, never a missed one.
- The idle-sync path (`d6cf43c`) does not use this revision; it already has its own per-puppet `poseRevision` in `Puppet.ts`.

## Rejected approach: per-owner revisions that the runner polls

A `WeakMap<owner, number>` with `ownershipRevisionOf(owner)` makes the runner read every owner's revision on each check. `checkOwnership()` runs after **every** actor update (`SceneRunner.ts:608-613`), so that is O(N²) per frame. That is exactly what `669b80c` removed, and its test `ownership checking stays linear for %s concurrent Actors` would fail. Polling one owner's revision also costs about as much as rescanning that owner (two status reads), so targeted polling saves nothing.

`Puppet.claimMovementTranslation` is not a model to generalize either: it is a mutual-exclusion lease, not change notification.

## Goal

Invalidation reaches only the runner that owns the affected actor. `checkOwnership()` stays O(1) while nothing changes, with no module-global mutable state.

## What to build

1. **`OwnershipWatch` module** (internal, `src/engine/ownershipWatch.ts`), one instance per `SceneRunner`:

   ```ts
   export interface OwnershipWatch {
     /** Called by an attached player/movement whenever ownership may have changed. */
     invalidate(): void;
     /** Monotonic; changes only through invalidate(). */
     readonly revision: number;
   }
   export function createOwnershipWatch(): OwnershipWatch;
   ```

   Document in its interface the invariant now in `ownershipRevision.ts`: invalidation must be conservative (a callback can change any actor), and clock advances and natural completions must **not** invalidate.

2. **Inject it; don't import it.** `AnimationPlayer` and `ActorMovement` each get `attachOwnershipWatch(watch: OwnershipWatch | undefined): void`. Every current `invalidateOwnership()` call becomes `this.ownershipWatch?.invalidate()`. Expose one entry point on `Actor`, internal or `@internal`, that attaches to both its `posePipeline.player` and its `movement`.

3. **SceneRunner owns the lifecycle.**
   - It creates the watch in the constructor and attaches it to every instance when actors are built.
   - It detaches in `release()` (so a disposed or reused puppet stops reporting to a stale runner), including on the failure/halt cleanup paths.
   - `checkOwnership()` compares `this.watch.revision` with `checkedOwnershipRevision`.
   - Keep the `checkedOwnershipRevision = -1` resets in `atBoundary()` and `release()`: authored actions change ownership without any runtime command, so those paths must still force a scan.

4. **Delete `ownershipRevision.ts`** once every call site is migrated.

5. **Optional, only if profiling justifies it:** the watch records the ids of the actors that changed, so `checkOwnership()` checks only those entries (O(changed) instead of O(owned)). Don't build this without a measurement.

## Edge cases to decide and test

- `AnimationPlayer.dispose()` invalidates. Disposal during a scene must still reach the runner (the watch is still attached); disposal after `release()` must not.
- Cross-actor callbacks: actor B's `onUpdate` stops actor A's player → A's player bumps A's runner's watch. That keeps immediate detection working, as now.
- An actor attached to a second runner: the last attach wins, and `release()` only detaches if its own watch is still the one attached (compare identity, like the movement lease release).
- The watch must not be attached to puppets outside a scene. Standalone runtime use pays nothing.

## Constraints

- Behaviour-preserving: interruption decisions and their timing in scene playback must be identical.
- No changes to public runtime API docs unless something becomes public; the attach method is internal.
- `npm run check:fix` for style.

## Verification

- `npm run typecheck`, `npm run check`
- `npm run test` (sequential, one worker, per AGENTS.md).
- These must pass **unchanged**: `ownership checking stays linear for %s concurrent Actors`, `$operation from another Actor detects ownership loss immediately`, and `%s of a held completed clip from another Actor interrupts before later cues` (`tests/sceneRunner.test.ts`), plus `tests/sceneRootMotion.test.ts`.
- New tests:
  - Invalidating a puppet that runner R does not own causes no ownership scan in R (spy on `getPlaybackStatus`/`movementStatus` reads).
  - Two concurrent runners: commands on runner A's actors cause no scans in runner B.
  - After `release()`, commands on a former actor (including `dispose()`) don't touch the old runner's watch.
  - An actor re-attached to a new runner reports only to the new one.

## Acceptance

- No module-global mutable revision counter remains in `src/engine` (`grep -rn "^let " src/engine` shows none related to ownership).
- `AnimationPlayer` and `ActorMovement` receive their invalidation sink through injection.
- The existing linear-checking and cross-actor interruption tests pass unchanged; the new isolation tests pass.
- Full suite passes.
