# Playback lifecycle and completion — v0.7.1

[All guides](../README.md#guides)

Puppet and the renderer-independent AnimationPlayer expose the same additive lifecycle API. The existing player still owns every clock, layer, fade, pose and authored event. No independent timer or React dependency is involved.

```ts
import type { PlaybackLifecycleEvent, PlaybackStatus } from 'paper-puppeteer-engine/runtime';

const unsubscribe = puppet.onPlaybackLifecycle((event: PlaybackLifecycleEvent) => {
  console.log(event.playbackId, event.clip, event.layer, event.type, event.status);
});

puppet.play('attack');
const attack: PlaybackStatus | undefined = puppet.getPlaybackStatus(); // Base layer.
const upper = puppet.getPlaybackStatus('upperBody');

// Compare playbackId to correlate outcomes with this specific request.
// Call unsubscribe() when this listener's owner is finished.
```

`PlaybackInstanceId`, `PlaybackOutcome`, `PlaybackState`, `PlaybackStatus` and `PlaybackLifecycleEvent` are exported from `/core`, `/runtime` and the package root. A playback ID is a monotonically increasing number local to its player, unique across that player's layers and restarts. An animation name identifies a registered clip; it does not identify a particular run. Separate players can use the same playback ID.

Snapshots contain `playbackId`, `clip`, `layer`, `status`, `elapsedTime`, `duration` and `loop`. Times are milliseconds. Queries return a detached snapshot, or `undefined` before a layer has played, after it is cleared, and after disposal. Completion and stop retain the selected clip and its terminal status until another start or clear. Interrupted and disposed snapshots arrive through lifecycle events; replaced/removed instances are not retained in a history registry.

## Status and notifications

| Event `type`  | Snapshot `status`     | Meaning                                                                                           |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `started`     | `playing` or `paused` | A new playback instance has been selected. Starting while globally paused retains pause.          |
| `paused`      | `paused`              | Global pause now holds an active instance. Repeated pause calls do not notify again.              |
| `resumed`     | `playing`             | Global pause has been released for an active instance. Repeated resume calls do not notify again. |
| `completed`   | `completed`           | A nonlooping clip reached its authored duration.                                                  |
| `interrupted` | `interrupted`         | A play/restart request replaced an instance that had no terminal outcome.                         |
| `stopped`     | `stopped`             | Explicit stop or layer clearing cancelled an active instance.                                     |
| `disposed`    | `disposed`            | Player disposal or Puppet destruction terminated an active instance.                              |

`playing` is an inspectable status, rather than a notification on every frame. A zero global or clip speed holds timeline advancement but remains `playing`; pause is an explicit separate operation. The legacy `isPlaying` getter retains its existing meaning and can remain true while globally paused. Lifecycle state never enters animation JSON, schemas or authored marker arrays.

Each instance commits at most one terminal outcome. Stopping, replacing, clearing or destroying a completed instance does not change it to another outcome. `resume()`/`resumeAnimation()` releases global pause without reviving stopped/completed instances. A new `play()` or `restart()` is needed to run them again.

Every normal play of the same clip starts a new instance and interrupts the old active one. `play(name, { restart: false })` retains that layer's matching selection, ID, clock and speed, including when already stopped or completed. `restart()` creates new identities for all selected layers, interrupts any active instances, resets their times/fades, and preserves pause, clip/global speeds, masks and weights. Validation failures leave the current identity and lifecycle unchanged.

## Completion, loops and fades

Nonlooping completion uses the existing continuous clock, clamps to exact duration and emits once after final-pose evaluation. Exact endpoints, large deltas, stepped presentation and changes to global/clip speed use the same clock. Paused playback does not advance or complete. Masks and weights affect visual ownership, rather than completion: even a zero-weight or empty-mask layer advances and can complete independently.

The shared runtime/editor schema requires positive duration. Zero-duration authored and externally compiled clips are rejected before registration or playback; they cannot create an instance, interrupt the current one or emit completion. This milestone preserves that existing validation contract and authored format version 1.

Indefinitely looping clips never naturally complete. Their existing time-zero markers, loop crossings, large-delta catch-up and event budgets remain in use. Lifecycle does not introduce a separate loop-iteration event.

A replacement interrupts the outgoing instance when the new play request takes effect, including the beginning of a crossfade. Its copied source clock can continue advancing for visual sampling without delivering authored markers or completion. Replacing an unfinished fade still snapshots its currently blended pose, so the visual blend does not snap. Fade time remains real elapsed time, independent of animation speed, and pause holds the fade. If an incoming nonlooping clip finishes before a longer fade, it completes once at its endpoint while the remaining visual blend can finish afterward.

`stop()` freezes all selected layers and their fades and sends `stopped` only for active instances. `clearLayer(name)` sends the active overlay's stopped outcome and removes the selection. `AnimationPlayer.clearAllLayers()` does the same for all layers. Puppet's existing pose-reset operations retain their stop/clear behavior.

## Delivery and cleanup

Play/restart notifications follow preparation, pose evaluation and host synchronization. Replacement emits the old interruption before the new start; start precedes time-zero authored markers. On update, authored markers retain timeline order and precede lifecycle completion and the legacy `onAnimationComplete` callback. The legacy completion payload remains exactly `{ clip, layer }`. Puppet's play, restart, update and layer-clear paths synchronize transforms, pose presets, IK and rendering before lifecycle delivery.

Requests made inside a lifecycle callback queue their notifications until the current lifecycle boundary finishes. Existing authored-marker and legacy-completion callbacks retain synchronous nested delivery: playing another clip inside a marker can deliver the new clip's start markers before the original update's remaining markers and completion. Each lifecycle event carries its own captured identity and status; a query inside a callback can describe newer playback if an earlier listener has changed it. A completion captured at the endpoint still belongs to the old ID when an end marker starts the same clip again. Lifecycle subscriptions use stable listener snapshots and independent payloads. Removing or adding a listener affects subsequent notifications. Listener errors are reported after remaining delivery; multiple failures produce `AggregateError`.

Disposal is idempotent. It terminates active instances, releases clips, layers, joints and subscriptions, and delivers their captured disposed snapshots. Disposing inside a callback cancels remaining ordinary notifications from the old host, including pending markers/completions; only disposal delivery survives cleanup. No later update can notify stale instances. Subscription cleanup functions remain safe to call after destruction. Puppet cleanup attempts every remaining resource even when a disposal listener throws. Other player commands and new subscriptions reject use after disposal; status queries return `undefined` and updates return `false`.

## Verification and next milestone

`tests/playbackLifecycle.test.ts` covers normal/exact/large-delta completion, repeated starts, no-op plays, pause/resume, speed zero and speed changes, zero-duration rejection, invalid requests, indefinite loops and authored event order, replacement and interrupted fades, target completion before fade end, masked/zero-weight layers, layer clearing, restart, explicit stop, disposal, exactly-once outcomes, removable listeners, payload isolation, reentrant requests, error propagation and Puppet cleanup.

Verification on 2026-10-16, after the final runtime and test changes:

| Command                 | Result                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | Passed, exit 0.                                                                                                                                                                                                           |
| `npm run test`          | Passed, exit 0: 147 files passed, 3 skipped; 2,474 tests passed, 32 skipped. The 27 new lifecycle tests passed; skips are existing opt-in profiling tests.                                                                |
| `npm run build`         | Passed, exit 0: demo, library and TypeScript declarations built; Node import checks for `/core`, `/serialization` and `/data` passed. Demo bundling reported `lucide-react` module-level `use client` directive warnings. |
| `npm run format:check`  | Passed, exit 0.                                                                                                                                                                                                           |
| `npm run lint`          | Passed, exit 0.                                                                                                                                                                                                           |
| `npm run check:version` | Passed, exit 0: package, lockfile, standalone tarball reference and changelog agree on 0.7.1.                                                                                                                             |
| `git diff --check`      | Passed, exit 0.                                                                                                                                                                                                           |

Runtime dependency-boundary tests and the library's core import check continue enforcing React-free runtime and renderer-independent `/core` behavior. Browser tests, optional profiling and packed-consumer checks were not run for this milestone. No CI or browser-installation changes were made.

Animation queues, animation states/state machines, `playAndWait()` and promise-based playback remain deferred to later v0.7 milestones, starting with v0.7.2. Scene choreography, movement helpers and new interpolation/IK systems are outside this change.
