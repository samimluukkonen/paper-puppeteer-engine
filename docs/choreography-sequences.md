# Choreography sequences (v0.8.4)

[All guides](../README.md#guides)

`ChoreographySequence` is an optional runtime helper for ordered actions on one `Actor`. Import it from the package root or `/runtime`. It delegates to Actor movement/facing, Puppet `playAndWait()` and the existing Puppet update clock. It has no React dependency, evaluator, movement system or scene update subscription of its own.

```ts
import { ChoreographySequence } from 'paper-puppeteer-engine/runtime';

const sequence = new ChoreographySequence(actor)
  .walkTo(300, 200, { speed: 160, faceMovement: true })
  .lookAt(otherActor)
  .playAnimation('draw-weapon', { fadeDuration: 80 })
  .wait(250)
  .cue(() => {
    showDialogue(); // Synchronous application cue; return undefined.
  })
  .playAnimation('attack');

const result = await sequence.run();
if (result.status === 'completed') advanceScene();
// While running, sequence.cancel() stops only its active owned action.
```

Animation IDs must already be registered. Walking uses the Actor's default locomotion mapping or an explicit per-step override. Sequence movement destinations use Actor's parent coordinates; look targets use world coordinates. Actor targets are sampled when reached. Point targets and command options are copied when added.

## Step model and API

Construct with `new ChoreographySequence(actor, steps?)`, append typed descriptions through `add(step)`, or use the fluent methods below. Every builder returns the same sequence. `ChoreographyStep` is a discriminated union with these kinds:

| Kind        | Builder                                                 | Execution                                                                               |
| ----------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `move`      | `moveTo(x, y, { speed? }?)`                             | Await Actor `moveTo()`.                                                                 |
| `walk`      | `walkTo(x, y, { speed?, locomotion?, faceMovement? }?)` | Await Actor `walkTo()`, including its locomotion ownership policy.                      |
| `lookAt`    | `lookAt(pointOrActor)`                                  | Call Actor `lookAt()` once. A disposed target ends the sequence.                        |
| `face`      | `setFacing('left' \| 'right')`                          | Call Actor `setFacing()`.                                                               |
| `animation` | `playAnimation(name, { speed?, fadeDuration? }?)`       | Await a fresh base playback with `loop: false`, `restart: true` and owned cancellation. |
| `wait`      | `wait(durationMilliseconds)`                            | Accumulate deltas from `Puppet.onUpdate()`.                                             |
| `cue`       | `cue(callback)`                                         | Invoke a synchronous `(actor: Actor) => undefined` callback.                            |

The runtime exports `ChoreographySequence`, `ChoreographyStep`, `ChoreographyMoveOptions`, `ChoreographyWalkOptions`, `ChoreographyOutcome`, `ChoreographyResult` and `ChoreographyActionResult`. The renderer-independent `/core` entry retains its existing scope.

`run()` executes once. All calls, including concurrent or reentrant calls, return the same promise and result. Builders reject after execution, cancellation or disposal starts. Create a new instance to repeat a script. `cancel()` and `dispose()` are idempotent; before `run()` they prevent all actions. Sequence disposal releases sequence resources and owned work without disposing the Actor or Puppet.

## Timing and validation

Each step begins only after its predecessor reports successful completion. Zero waits, zero-distance moves, facing and cues require no runtime ticks. Animation steps always run one pass, even when the registered clip loops; registered animation metadata stays unchanged. A zero animation speed explicitly holds playback until speed changes, interruption, cancellation or disposal.

Waits and movement use the same millisecond delta as ordinary Puppet updates. Phaser scene pause/sleep suppresses scene updates, so waits and movement do not advance. Animation-only pause and animation speed do not pause or rescale scripted waits or movement. In manual mode (`autoUpdate: false`), the host controls advancement through `puppet.update(deltaMilliseconds)` and must stop calling it to pause. Promise continuations start subsequent steps after the current synchronous update completes; unused delta does not carry into the next step. No wall-clock timers are used.

`run()` preflights all steps before performing any action. Missing Actors, unknown animations, nonfinite destinations, nonpositive movement speed, invalid durations/mappings/facing/cues, unsupported kinds and unsupported options return a failed result. Disposed Actors and look targets return disposed. Runtime-dependent movement validation, such as a collapsed parent transform, stays in Actor's existing movement implementation. Source/target liveness and step inputs are checked again when a step is reached.

Cues are application-owned synchronous effects. Promise-returning functions do not satisfy the public callback type. If an untyped caller returns a value or promise, the sequence fails; an accidentally returned rejected promise is observed. Already performed cue effects cannot be undone or cancelled.

## Outcomes, cancellation and ownership

`run()` resolves `ChoreographyResult`. Invalid commands and thrown cue/start errors are returned as `failed` with the original `error`, rather than rejecting the sequence promise. Runtime update/listener errors continue to propagate from their existing runtime call boundaries.

| Status        | Meaning                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `completed`   | Every step completed successfully.                                                                |
| `cancelled`   | Sequence cancellation or cancellation of its active movement ended execution.                     |
| `interrupted` | Movement was replaced, or playback was replaced/stopped.                                          |
| `failed`      | Validation, a cue or starting an operation failed; inspect `error`.                               |
| `disposed`    | Sequence/Actor disposal, Puppet destruction, scene shutdown or a disposed target ended execution. |

Every result contains `completedSteps`. Unsuccessful results include the zero-based `stepIndex` when known. Action outcomes retain the existing `ActorMovementResult` or `PlaybackWaitResult` in `stepResult`, including movement snapshots and exact playback identity. Playback `stopped` maps to sequence `interrupted`, while the underlying result retains `stopped`. No unsuccessful outcome starts later steps. First explicit cancel/dispose request wins; an already settled result never changes. As in the existing playback API, a committed terminal playback outcome can settle before a start callback subsequently throws.

Movement receives a sequence-local abort signal. Aborting stops that request and lets Actor restore idle only while the walk still owns locomotion. A newer movement or animation retains control. Wait cancellation removes its update/abort listeners. The sequence subscribes to Actor's existing `disposalSignal` and removes that subscription on every exit. `Actor.locomotion` exposes the frozen default mapping for preflight without starting movement.

Animation uses the additive `PlayAndWaitOptions.stopOnAbort` option. Its default is false, preserving ordinary wait-only cancellation. When true, abort or a start failure stops only the fresh instance selected by this call, guarded by exact state identity. `restart: false` is rejected with owned waits so an existing host instance cannot be adopted accidentally. Replaced or naturally completed playback is preserved. Other layers and host queue requests remain untouched; stopping an instance does not itself advance a pending queue. A stop-listener error releases the wait and becomes a failed sequence result. Pre-aborted requests still skip validation and playback.

The sequence claims no permanent Actor lock. External Actor/Puppet operations retain the existing interruption rules. While waiting or running a cue, the sequence owns no movement or playback and cancellation does not affect those host operations.

## Coverage and deferred work

Deterministic tests cover ordering, move/walk then play, play then face, natural completion, zero-duration actions, update-clock waits, scene and animation pause semantics, interrupted/stopped playback, movement replacement, cancellation during movement/animation/waits/start callbacks, Actor and scene disposal, invalid commands, copied data/live targets, synchronous cue failures, repeated/reentrant execution, exactly-once settlement and listener cleanup. Existing async playback regressions verify default wait behavior remains compatible.

v0.8.5 work remains deferred: concurrent multi-Actor actions, synchronization barriers, sequential/parallel composition, optional Actor registration, same-Actor conflict policy and fail-fast sibling cancellation. Visual timelines, authored scene serialization, camera direction, dialogue branching, behavior trees, physics and navigation are outside this runner.
