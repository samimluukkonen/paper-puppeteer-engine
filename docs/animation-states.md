# Animation states — v0.7.3

[All guides](../README.md#guides)

`AnimationStateController` maps application state IDs to registered animations on the existing base playback channel. Applications decide when to change state. The controller chooses playback options and transitions; AnimationPlayer still owns every clock, evaluator, crossfade, event, lifecycle outcome and FIFO request. There is no controller update method, second queue, gameplay dependency or React dependency. State configuration is runtime-only and never changes animation, rig or character JSON.

```ts
import { AnimationStateController } from 'paper-puppeteer-engine/runtime';

const controller = new AnimationStateController(puppet, {
  initialState: 'idle',
  defaultFadeDuration: 100, // Milliseconds throughout this API.
  states: {
    idle: { animation: 'idle', loop: true },
    walking: { animation: 'walk', loop: true, options: { speed: 1.2 } },
    running: { animation: 'run', loop: true },
    attack: { animation: 'attack' },
  },
  transitions: {
    idle: { walking: 200 },
    walking: { running: 150 },
    running: { idle: 200 },
    attack: { idle: 100 },
  },
});

controller.setState('walking');
controller.setState('walking'); // Keeps the playback ID, clock and current crossfade.
controller.setState('walking', { restart: true });
controller.setState('idle');
controller.playAction('attack'); // Naturally completes, then returns to idle.

console.log(controller.currentState, controller.currentAction, controller.isActive);
controller.dispose(); // Release the subscription and any pending action return.
```

The class and its types are exported from `/core`, `/runtime` and the package root: `AnimationStateDefinition`, `AnimationStateControllerOptions`, `SetAnimationStateOptions`, `AnimationActionOptions` and `AnimationStateHost`. The structural host contract supports both Puppet and renderer-independent AnimationPlayer. Use Puppet as the host for rendered puppets so its ordinary preparation, IK and render synchronization hooks run. Custom renderer hosts can implement the same structural methods while supplying their own player hooks.

## State and transition configuration

`states` is a record keyed by nonempty state ID. Each value supplies an existing animation name in `animation`, optional boolean `loop`, and optional `options` containing the existing nonnegative finite `speed` and `fadeDuration`. State IDs can differ from animation names, and multiple states can reference the same animation. Omitted loop behavior inherits the registered clip's value. Zero speed explicitly holds playback.

`initialState` is required and starts synchronously after the entire configuration validates. Construction interrupts existing base playback and clears pending requests through ordinary `play()`. State definitions, option objects and transition pairs are copied so later caller mutations cannot change the controller's behavior.

`transitions` contains simple directed pairs: `transitions[fromState][toState] = fadeMilliseconds`. Both endpoints must be defined states. No condition-expression language or graph editor is involved. Fade precedence is:

1. Explicit `playAction` fade override.
2. Configured source/destination pair.
3. Destination state's `options.fadeDuration`.
4. `defaultFadeDuration`.
5. Zero milliseconds.

The source is the controller's current action, or its persistent state. Reclaiming playback after a manual override uses the destination/default fade because the controller no longer owns a source state. The player blends from its actual current pose using the existing crossfade implementation. Replacing an unfinished fade retains the existing blended-pose snapshot behavior. State changes restart a fresh playback instance even when two different state IDs reference the same clip.

`setState(id, { restart? })` returns the controller. Matching persistent-state requests are idempotent while the controller owns playback, including while a temporary action is running or a nonlooping persistent state holds its completed pose. They preserve clocks, fades and pending queue requests. `{ restart: true }` starts that persistent state immediately and cancels a temporary action. After imperative playback takes ownership, an explicit request for even the same remembered state reclaims playback.

## Temporary actions and identity

`playAction(stateId, { returnTo?, speed?, fadeDuration? })` starts a new base instance immediately and returns the controller. It references a defined state, always overrides looping to `false`, and defaults `returnTo` to `currentState`. An explicit return destination becomes the remembered persistent state as soon as the action starts. Action playback overrides take precedence over the action state's speed/fade options.

`currentState` is the remembered persistent state; it stays available while an action or direct playback runs. `currentAction` is the currently owned temporary action ID, or `undefined`. `isActive` reports whether the selected base playback instance belongs to this controller, including a paused instance or held persistent completion. Use the host's `getPlaybackStatus()` for actual animation, elapsed time, loop flag and playback ID.

An action returns only on its own natural completion, after authored endpoint markers, ordinary lifecycle completion listeners, legacy completion callbacks and queue advancement. The return uses ordinary base play and the configured action-to-return-state fade. Large deltas start the return at time zero without transferring overshoot. Pause, zero speed and stepped presentation use the player's existing behavior.

An interrupted or stopped action never returns. A new state request, a replacement action, direct base playback, queue replacement or disposal cancels the old return. There is at most one active action intent, with no action backlog. Repeated `playAction` calls deliberately replace/restart the action; callers wanting idempotence should use `setState`.

## Direct playback, queue and layer policy

The controller uses cooperative ownership. A new imperative base playback instance relinquishes ownership until an explicit `setState` or `playAction`. It never automatically restarts idle over an imperative attack. A matching direct `play(..., { restart: false })` that retains the same playback ID keeps ownership, following the existing no-op contract. Failed direct plays leave ownership intact.

| Operation                                       | Controller behavior                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Direct base `play()` / restart                  | Relinquish ownership; remember persistent state; no automatic return.           |
| Direct base stop                                | Cancel action return and relinquish ownership.                                  |
| Pending queue after action                      | FIFO successor takes control; cancel return, including after the queue drains.  |
| Queue request from endpoint/completion callback | Advance normally before evaluating action return.                               |
| `replaceQueue()`                                | Queue takes control and cancels action return.                                  |
| `clearQueue()` during action                    | Keep the action; it may still naturally return.                                 |
| State/action request that starts playback       | Existing base play clears pending FIFO requests.                                |
| Matching idempotent state request               | Retain action and pending FIFO requests.                                        |
| Overlay play, masks, weights or clearing        | Retain base state/action ownership.                                             |
| Controller disposal                             | Release subscription and action return; retain host playback and pending queue. |

Existing queue loop rejection remains: queue requests cannot reference authored looping clips, and requests behind an actively looping base instance reject. An instance overridden to nonlooping by an action can have finite requests appended behind it. The controller never enqueues a return state or bypasses the queue's validation rules.

All controller playback targets `base`. Existing overlay identities, clocks, masks and weights remain in place. State transitions use normal Puppet animation synchronization and do not replace the rig, reset skins/facing/attachments or recreate IK constraints and target providers.

## Awaiting actions

v0.7.4 adds [async playback waits](async-animation.md). Start an action with `controller.playAction('attack')`, then await `host.waitForPlayback({ signal })`. This observes the owned instance without restarting it. The controller keeps its existing single lifecycle subscription and owns its automatic return. `completed` reports the action's endpoint even if the controller has already returned or a queued successor has started by the time the promise continuation runs. An interrupted action reports `interrupted`; an aborted wait leaves the action and its return policy running. Compare playback IDs before issuing state changes from asynchronous continuations.

## Playback additions and callback order

Puppet and AnimationPlayer expose `hasAnimation(name): boolean`. `isPlaybackStopped(layer = 'base'): boolean` reports an explicitly frozen channel, including a stop requested after its instance already completed; the instance's terminal lifecycle outcome remains `completed`. This distinction lets completion callbacks cancel an automatic return without relabeling a completed instance. `PlayAnimationOptions.loop?: boolean` overrides only the new playback instance, sharing the registered compiled tracks and events. It does not mutate registered clips, other instances or authored data. Restart retains the instance override; a fresh ordinary play without an override uses authored looping. Existing matching `restart: false` requests retain all current instance options.

`onPlaybackLifecycle(listener, { completionPhase: 'settled' })` opts into completion delivery after authored/ordinary lifecycle/legacy callbacks and base queue advancement. Other events retain their existing order; default subscriptions retain immediate completion delivery. This option is typed by `PlaybackLifecycleOptions`. Settled completion carries the completed instance's snapshot, even if the queue already selected another clip. Always compare playback IDs before reacting to it. A FIFO successor is selected and synchronized before settled completion; its `started` notification may still be pending in the existing notification drain.

The controller uses this phase and checks its owned playback ID against current host status and channel freeze before returning. It honors manual playback, queue additions, stops and disposal from ordinary completion callbacks regardless of their registration order. Settled subscribers follow normal listener order; use ordinary completion listeners to decide explicit playback before automatic continuations. Listener errors still finish notification delivery and eligible return/queue advancement before the player reports them.

## Validation and lifecycle

Unknown/empty state IDs, missing animation references, invalid initial states, nonboolean loop/restart values, unsupported playback fields and negative/nonfinite speeds or fade durations reject synchronously. Transition endpoints must exist and present transition values must be finite nonnegative numbers. Configuration validation finishes before subscription or playback mutation. Invalid requests preserve current playback, persistent/action identity and pending queue. A player preflight failure, including its authored-event budget, restores the previous controller intent. Errors thrown by listeners after successful playback do not roll back committed state.

`dispose()` is idempotent, unsubscribes, clears owned configuration/action intent, releases its host reference, and leaves host playback untouched. `isDisposed` exposes controller disposal; further mutation calls throw. Disposing the host while it emits a playback disposal outcome also disposes the controller. Applications should still dispose controllers as part of their own lifecycle, including when the host has only already-completed/stopped selections and consequently emits no new terminal event. Disposed controllers ignore callbacks retained in an in-progress listener snapshot and cannot resurrect playback.

## Verification and deferred functionality

The [state controller tests](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/tests/animationStateController.test.ts) cover initial selection, deterministic state identity, repeated requests/restarts, transition timing and interrupted fades, owned configuration, invalid states/references/options, natural action returns and return destinations, interruptions, imperative playback, queue priority and callback enqueueing, pause/speed/stepping, large deltas, reentrant starts, listener failures, event-budget rollback, disposal, synchronized Puppet rendering, masked overlays, IK targets, skins/facing and loop override isolation. Existing queue/lifecycle suites remain regression coverage. The library's plain Node `/core` build check also constructs a controller and completes an action return without Phaser or React.

Verification on 2026-10-16, after the final runtime and test changes:

| Command                 | Result                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | Passed, exit 0.                                                                                                                                                         |
| `npm run test`          | Passed, exit 0: 149 files passed, 3 skipped; 2,614 tests passed, 32 skipped. Includes 83 state-controller/playback-addition tests. Skips remain opt-in profiling cases. |
| `npm run build`         | Passed, exit 0: demo, library, declarations and plain Node import/controller checks. Existing `lucide-react` module-level `use client` directive warnings remain.       |
| `npm run lint`          | Passed, exit 0.                                                                                                                                                         |
| `npm run format:check`  | Passed, exit 0.                                                                                                                                                         |
| `npm run check:version` | Passed, exit 0: package, lockfile, standalone tarball reference and changelog agree on 0.7.3.                                                                           |
| `git diff --check`      | Passed, exit 0.                                                                                                                                                         |

Browser tests, optional profiling and packed-consumer checks were not run. No CI or browser-installation changes were made.

Deferred: React/graph editors, generic rule expressions, input/movement/physics/navigation/AI/combat decisions, multi-actor choreography, per-layer state controllers, action backlogs, completion promises and finite loop counts. Authored formats remain version 1.
