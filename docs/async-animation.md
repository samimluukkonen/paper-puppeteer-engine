# Async animation — v0.7.4

[All guides](../README.md#guides)

`Puppet` and renderer-independent `AnimationPlayer` expose `playAndWait(name, options?)` and `waitForPlayback(options?)`. Both return `Promise<PlaybackWaitResult>`. They observe the existing playback-instance lifecycle: there is no timer, clock polling, second queue or animation evaluator.

```ts
for (const animation of ['draw-weapon', 'attack', 'sheath-weapon']) {
  const result = await puppet.playAndWait(animation);
  if (result.status !== 'completed') break;
}
```

The registered clip names come from your character. Playback still advances through the host's normal updates. `await` does not drive the player. Pausing or setting global/clip speed to zero holds a finite playback and its waits until resumed, cancelled or otherwise terminated.

## API and results

`PlayAndWaitOptions` extends `PlayAnimationOptions`: `fadeDuration`, `speed`, `restart`, `layer`, `loop`, and optional `signal: AbortSignal`. Starting playback is synchronous; the result is delivered by a promise. As with `play()`, it restarts by default, clears pending base requests when playing the base channel, synchronizes the pose before callbacks, and leaves unrelated overlay layers alone. A crossfade interrupts the outgoing instance immediately. Completion means reaching the new clip's endpoint, even if its visual fade lasts longer.

`WaitForPlaybackOptions` has optional `layer` (default `base`) and `signal`. It observes the current instance without restarting playback, changing state-controller ownership or clearing the queue. It does not follow replacements or future queued requests. Multiple independent waits can observe the same instance. If the layer holds a terminal instance, its existing outcome resolves immediately. A missing selected instance rejects with an explanation.

`PlaybackWaitResult` is a discriminated union reusing the existing `PlaybackOutcome` values:

| `status`      | Meaning                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `completed`   | The finite clip reached its endpoint naturally.                                                              |
| `interrupted` | Another play/restart/replacement took over this instance's layer. Same-name replay counts as a new instance. |
| `stopped`     | Existing stop, base queue stop, layer clear or all-layer clear terminated playback.                          |
| `disposed`    | Player disposal or Puppet destruction terminated the active instance.                                        |
| `cancelled`   | This wait was aborted while playback was still live.                                                         |

Every lifecycle outcome includes a detached `playback: PlaybackStatus` snapshot with the exact `playbackId`, clip, layer, elapsed time, duration, loop flag and lifecycle status. A cancelled wait also includes the snapshot when an instance was selected; its playback status can still be `playing` or `paused`. Aborting before selection returns `{ status: 'cancelled' }` without a snapshot.

Unknown animations, invalid playback options, attempts to start on a disposed player, and indefinite loop requests reject the promise. Listener/host-hook failures during the synchronous start reject too, unless a terminal result has already settled it. Playback committed before a callback error remains selected, matching ordinary `play()` behavior. Runtime update/callback failures still propagate from those runtime calls; committed completion can settle its wait even if another listener throws.

Each wait binds before start callbacks to the exact selected instance, removes its lifecycle and abort listeners on settlement, and settles at most once. Reentrant callbacks, same-name replay and delayed old notifications cannot settle a newer instance's request. Natural completion uses ordinary lifecycle delivery; promise continuations run after the synchronous runtime call and its existing queue/state processing. Disposal also drains pending waits from their committed lifecycle outcomes before dropping state references. This covers destruction from an end marker that suppresses an otherwise pending completion notification, without relabeling an already completed or interrupted instance.

## Cancellation

```ts
const controller = new AbortController();
const resultPromise = puppet.playAndWait('attack', { signal: controller.signal });
controller.abort();
const result = await resultPromise; // status: 'cancelled' while the animation keeps playing
```

Cancellation releases only that wait. It does not stop playback, discard queues, affect other waits, or cancel a state controller's action return. Use existing `stop()`, `stopQueue()` or `clearLayer()` separately when playback itself should end; waiting callers then receive `stopped`.

An already-aborted signal takes precedence over validation and skips playback entirely, preserving current playback and queued requests. The same policy applies to `waitForPlayback()`. Once an instance has committed a terminal lifecycle outcome, abort/disposal preserves that outcome, including abort from its endpoint marker. Later aborts cannot change a settled result.

## Loop policy

An active indefinitely looping instance cannot complete naturally. `playAndWait()` rejects it before interrupting playback or clearing queues, with an error explaining how to use `playAndWait(name, { loop: false })` for one pass or ordinary `play()` for indefinite playback. Explicit `loop: true` on a finite authored clip rejects too. The override is instance-local and does not mutate the registered clip.

`restart: false` uses the existing matching instance, including its actual loop flag, speed and elapsed time. Supplying `loop: false` with `restart: false` cannot turn an already selected loop into a one-shot: omit `restart: false` to start a new finite instance. A held terminal instance, including a stopped loop, can be observed without waiting.

Finite repeat counts are not supported by the existing player and are not introduced here. Zero-duration clips remain invalid in authored and compiled registration; attempting to await an unregistered rejected clip reports an unknown animation rather than starting a hanging request.

## Queues and state actions

There is no second queue. Existing FIFO completion, replacement and cancellation rules remain authoritative. Use `waitForPlayback()` after a queued instance becomes selected to observe it. When a preceding wait completes, the queue may already have selected its successor; the result still identifies the preceding instance. `playAndWait()` uses ordinary `play()` and therefore clears pending base requests. There is no promise for a request that has not started.

```ts
states.playAction('attack');
const result = await puppet.waitForPlayback({ signal });
if (result.status === 'completed') {
  // The existing controller owns its return; inspect currentState/currentAction as needed.
}
```

The state controller retains its single existing settled-lifecycle subscription and playback-ID guards. A wait adds one removable subscription for its own instance. Cancellation leaves the controller's action/return policy running; interruption invalidates its old intent. Pending FIFO requests keep priority over automatic returns. Direct `playAndWait()` takes control exactly like direct `play()`. Async continuations must compare `result.playback.playbackId` against the current playback ID before issuing changes that depend on that instance still being selected; natural completion alone does not imply current ownership.

## Changed files and verification

- `src/engine/AnimationPlayer.ts`: awaitable playback, current-instance waits, finite-loop preflight, instance binding and disposal cleanup.
- `src/engine/PlaybackLifecycle.ts`: `PlaybackWaitResult`, reusing `PlaybackOutcome` and `PlaybackStatus`.
- `src/engine/Puppet.ts`: synchronized public delegates. `src/engine/core.ts` exports both option types and the result; `/runtime` and the package root inherit those exports. `/data` and authored formats are unchanged.
- `tests/asyncAnimation.test.ts`: deterministic updates and promises for completion, interruptions, stop/cancellation, pre-abort, disposal, unknown/invalid inputs, infinite loops, simultaneous waits, layer isolation, same-name replay, rejected zero duration, callback reentrancy/errors, cleanup, FIFO and state integration, and Puppet rendering/destruction. No real-time sleeps.
- `scripts/check-core.mjs`: built `/core` async playback, cancellation and loop rejection in plain Node, without Phaser globals.
- Package version, lockfile and standalone tarball reference advance to `0.7.4`; changelog, README and playback/runtime/queue/state guides document the contract.

Verification on 2026-10-16:

| Command                 | Exact result                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | Passed, exit 0: `tsc --noEmit`.                                                                                                                               |
| `npm run test`          | Passed, exit 0: 150 test files passed, 3 skipped; 2,654 tests passed, 32 skipped (2,686 total). Includes 40 new async API cases.                              |
| `npm run build`         | Passed, exit 0: typecheck, demo build (2,233 transformed modules), library build (60 transformed modules), declarations and the plain Node built-entry check. |
| `npm run format:check`  | Passed, exit 0.                                                                                                                                               |
| `npm run lint`          | Passed, exit 0.                                                                                                                                               |
| `npm run check:version` | Passed, exit 0: package, lockfile, standalone tarball and changelog agree on `0.7.4`.                                                                         |

The demo build emitted two `MODULE_LEVEL_DIRECTIVE` warnings for `lucide-react`'s `use client` directives; both builds succeeded. Browser smoke tests were not run for this runtime/API milestone and remain local-only. No CI browser steps, audit schedules, dependencies or authored formats changed.

Deferred: optional animation-event waits, promises for future queued requests, finite repeat counts, new state-controller async action methods, movement/targeting, scene timelines, camera choreography, gameplay scheduling and network synchronization.
