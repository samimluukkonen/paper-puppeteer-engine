# Animation queues — v0.7.2

[All guides](../README.md#guides)

v0.7.3 [animation states](animation-states.md) use this same base channel. Pending FIFO requests and completion-callback queue additions take precedence over a controller action's automatic return. Queue validation and cancellation behavior below continue to apply.

Puppet and the renderer-independent AnimationPlayer provide a FIFO queue for the ordinary base playback channel. Requests reference registered animation names and contain only playback options. The existing player owns all clocks, lifecycle outcomes, authored events, pose evaluation, layers and crossfades. Queue state does not enter animation files or React.

```ts
import type { AnimationQueueRequest, QueueAnimationOptions } from 'paper-puppeteer-engine/runtime';

const attackOptions: QueueAnimationOptions = { speed: 1.5, fadeDuration: 100 };
puppet.queue('draw-weapon'); // Starts now if the base is idle.
puppet.queue('attack', attackOptions);
puppet.queue('sheath-weapon');

const pending: readonly AnimationQueueRequest[] = puppet.getQueue();
console.log(pending.map((request) => request.name));

puppet.clearQueue(); // Discard pending requests; let the current animation continue.
puppet.stopQueue(); // Also stop the base, retaining its current pose/fade.
puppet.replaceQueue([
  { name: 'attack', options: { fadeDuration: 100 } },
  { name: 'sheath-weapon' },
]); // Interrupt the base and start a new sequence immediately.
```

These types are exported from `/core`, `/runtime` and the package root. Puppet mutation methods return `this` for chaining. AnimationPlayer mutation methods return `void` and accept the same optional preparation/synchronization hooks as its existing play/update methods. Normal Puppet methods supply those hooks automatically; custom hosts using AnimationPlayer directly should supply them on queue/replacement starts and updates when they need host pose synchronization before notifications.

v0.7.4 [async playback](async-animation.md) can observe the active queued instance using `waitForPlayback()`. It resolves for that exact instance even if the FIFO has already advanced. `playAndWait()` follows ordinary `play()` queue-clearing semantics; it does not append. Cancelling a wait leaves the queue untouched. Promises for requests that have not started remain deferred.

## Requests and inspection

`queue(name, options?)` validates the complete request before changing playback or pending requests. Supported options are `speed` (default 1) and `fadeDuration` (default 0 milliseconds), using the existing nonnegative finite-number rules. Each request starts a fresh playback instance, even for repeated names. `restart` and `layer` are unsupported queue options and reject at runtime as well as in typed object literals.

`AnimationQueueRequest` has a readonly `name` and optional readonly `options`. The queue owns normalized, frozen copies of both, so later edits to caller input cannot change scheduling. `getQueue()` returns a new frozen array of frozen requests containing normalized defaults. It includes pending requests only. Use `getPlaybackStatus()` to inspect the active request and its playback ID. Old inspection snapshots stay unchanged as the queue advances. Queries return an empty queue after disposal.

Unknown names, negative/nonfinite values, unsupported options, looping clips and use after disposal throw synchronously. `replaceQueue(requests)` validates and snapshots every entry before replacing any active or pending request. If any entry fails, the existing queue, active identity, clocks and lifecycle remain unchanged. Validation also checks the existing time-zero authored-event budget. A listener error after a successful start does not roll back committed playback; existing listener error aggregation still completes delivery and queue advancement before reporting failures.

## Execution and crossfades

Idle means there is no active base playback instance, or the selected instance has completed or stopped. Queueing while idle starts the oldest request synchronously before the call returns. Starting while globally paused selects the request with a paused status; `resumeAnimation()` releases it. A running or paused nonlooping base clip retains its identity and clock when more requests are appended.

Natural base completion schedules advancement using the existing v0.7.1 lifecycle outcome and captured playback ID. Update delivery order is:

1. Evaluate the endpoint and synchronize the host pose.
2. Deliver authored markers, including endpoint markers.
3. Deliver lifecycle completion and legacy `onAnimationComplete` callbacks for that update.
4. Start the oldest pending request, synchronize its pose, then deliver its `started` event and time-zero authored markers.

Queue additions made during these callbacks wait for the notification boundary. No extra timer or completion detector is used. Pending advancement checks both playback identity and queue revision, so a callback can clear, stop, restart, replace or dispose playback without an obsolete sequence resuming. Existing explicit `play()` calls inside authored/legacy callbacks retain their nested-delivery behavior, described in the [lifecycle guide](playback-lifecycle.md).

A queued `fadeDuration` starts at the previous clip's natural completion. The existing transition evaluator blends from its held final pose to the new advancing clip. There is no pre-end overlap. If the previous clip completed during an unfinished fade, the existing blended-pose snapshot preserves that pose as the next fade source. Fades retain the player's existing real-elapsed-time, pause and stepped-presentation behavior. A first idle request without a selected source has nothing to fade from. `replaceQueue()` can crossfade immediately from a currently active clip using its first request's fade duration.

Each ordinary update starts at most one successor, at time zero. Large deltas complete the current clip at its exact endpoint; excess delta is not transferred to pending requests. This deliberate policy preserves existing endpoint event delivery and bounds queue catch-up without introducing another clock. Global/clip speeds, pause and stepped modes retain the existing player semantics. Explicit speed zero or pause holds the queue until the caller changes or replaces playback; clip speed is fixed for an instance, so use `play()` or `replaceQueue()` with a positive clip speed to release a zero-speed instance.

## Looping and interruption policies

Every indefinitely looping queue request is rejected, including a final request. Queueing behind a currently playing or paused base loop also throws immediately. Stop that loop with `stopQueue()`, replace it with `play()` or `replaceQueue()`, then schedule finite clips. A looping overlay does not block the base queue. There is no loop-count or loop-exit policy in this milestone.

| Operation                                           | Pending requests                             | Base playback                                              | Other layers             |
| --------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| `queue(name, options?)`                             | Append FIFO                                  | Start only when idle                                       | Retain                   |
| `clearQueue()`                                      | Discard                                      | Retain                                                     | Retain                   |
| `stopQueue()`                                       | Discard                                      | Stop/freeze selection and fade                             | Retain                   |
| `replaceQueue(requests)`                            | Replace, after full validation               | Start first request immediately; interrupt active instance | Retain                   |
| `replaceQueue([])`                                  | Discard                                      | Same as `stopQueue()`                                      | Retain                   |
| Successful base `play()`                            | Discard, including matching `restart: false` | Existing play/no-op behavior                               | Retain                   |
| Overlay `play()`, `clearLayer()`, mask/weight edits | Retain                                       | Retain                                                     | Existing behavior        |
| `stop()`                                            | Discard                                      | Freeze                                                     | Freeze all               |
| `restart()`                                         | Discard                                      | New instance at time zero                                  | Restart selected layers  |
| `AnimationPlayer.clearAllLayers()`                  | Discard                                      | Remove selection                                           | Remove all               |
| Puppet pose resets                                  | Discard through existing stop/clear paths    | Existing reset behavior                                    | Existing reset behavior  |
| Player disposal / Puppet destruction                | Release                                      | Dispose active instance                                    | Dispose active instances |

Failed ordinary plays preserve pending requests. Completion remains a single terminal outcome: moving to a queued successor does not relabel the completed clip as interrupted. A replacement before completion emits `interrupted`; stopping an active base emits `stopped`. Clearing pending requests emits no playback events because those requests have never started. Base-only cancellation does not reset overlay masks, weights, clocks or fades. Existing `stop()` continues to stop all layers.

## Verification and deferred work

`tests/animationQueue.test.ts` covers idle/held selection starts, single and multiple requests, FIFO/repeated names, owned inspection snapshots, speed/fade options, loop rejection, invalid/atomic requests, direct-play interruption, clear/stop/restart/replace, endpoint crossfades and interrupted fades, authored/lifecycle/legacy event ordering, reentrant cancellation and enqueueing, listener errors, exact/large deltas, pause/zero speed/stepped presentation, overlays, disposal, synchronized Puppet rendering, cleanup and duplicate-start prevention. Existing lifecycle and animation regressions remain in use.

Verification on 2026-10-16, after the runtime and test changes:

| Command                 | Result                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | Passed, exit 0.                                                                                                                                                            |
| `npm run test`          | Passed, exit 0: 148 files passed, 3 skipped; 2,531 tests passed, 32 skipped. Includes 57 queue tests and 27 existing lifecycle tests. Skips remain opt-in profiling cases. |
| `npm run build`         | Passed, exit 0: demo, library, declarations and Node import checks. Existing `lucide-react` module-level `use client` directive warnings remain.                           |
| `npm run lint`          | Passed, exit 0.                                                                                                                                                            |
| `npm run format:check`  | Passed, exit 0.                                                                                                                                                            |
| `npm run check:version` | Passed, exit 0: package, lockfile, standalone tarball reference and changelog agree on 0.7.2.                                                                              |
| `git diff --check`      | Passed, exit 0.                                                                                                                                                            |

Browser tests, optional profiling and packed-consumer checks were not run. No CI or browser-installation changes were made.

Deferred: per-layer queues, finite loop counts, pre-end blending, queue completion promises, state machines, actor movement and multi-character choreography. Authored version-1 formats and existing IK remain unchanged.
