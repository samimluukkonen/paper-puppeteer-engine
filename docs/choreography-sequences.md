# Choreography sequences and multi-Actor coordination (v0.8.6)

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

Each running single-Actor sequence now holds an exclusive choreography claim on its Puppet until settlement, including during waits and cues. Another choreography sequence targeting that Puppet returns `failed` with `ChoreographyConflictError`, without interrupting the owner. Claims are shared across contexts and Actor wrappers and released on every exit. External Actor/Puppet operations retain the existing interruption rules. While waiting or running a cue, the sequence owns no movement or playback and cancellation does not affect those host operations.

## Multi-Actor composition

`Choreography` adds a lightweight Actor registry and a single coordinated run over the existing single-Actor runner. Import `Choreography`, `ChoreographyPlan`, `ChoreographyCoordinationResult` and `ChoreographyConflictError` from the root or `/runtime`. It owns no Actor, Puppet, scene subscription, movement evaluator or timer.

```ts
import { Choreography } from 'paper-puppeteer-engine/runtime';

// actorA and actorB are live Actors with distinct IDs and explicit locomotion mappings.
// Replace these animation names with finite responses registered on your Puppets.
const choreography = new Choreography([actorA, actorB]);
const plan = choreography.sequence([
  choreography.parallel([
    choreography.actor(actorA.id, [
      { kind: 'walk', x: 400, y: 300, options: { speed: 160, faceMovement: true } },
    ]),
    choreography.actor(actorB.id, [
      { kind: 'walk', x: 600, y: 300, options: { speed: 120, faceMovement: true } },
    ]),
  ]),
  choreography.parallel([
    choreography.actor(actorA.id, [{ kind: 'lookAt', target: actorB }]),
    choreography.actor(actorB.id, [{ kind: 'lookAt', target: actorA }]),
  ]),
  choreography.actor(actorA.id, [{ kind: 'animation', name: 'bow' }]),
  choreography.actor(actorB.id, [{ kind: 'animation', name: 'response' }]),
  choreography.actor(actorA.id, [{ kind: 'cue', callback: () => { showDialogue(); } }]),
]);

const outcome = await choreography.run(plan);
if (outcome.status === 'completed') advanceScene();
// During execution: choreography.cancel() cancels only this run's active owned actions.
choreography.dispose(); // Releases the registry, without disposing the Actors.
```

`actor(id, steps)` describes one Actor's existing `ChoreographyStep` sequence. `sequence(children)` and `parallel(children)` describe arbitrarily nested groups. These helpers return typed, lazy descriptions; they start no actions. Actor helper calls snapshot options and point targets just like `ChoreographySequence`; group helpers copy their child arrays. `run(plan)` snapshots and validates the entire tree, including raw descriptions, before any visible action. Actor targets remain live references sampled when their look step is reached. Plans are runtime-only and are not an authored scene format.

`new Choreography(actors?)` registers initial Actors; `register(actor)` adds an Actor before execution and returns the context. `getActor(id)` returns the live registered Actor. Duplicate IDs, missing IDs and disposed Actors are rejected. Registry operations throw validation errors; `run()` returns them as typed outcomes. Registration closes after execution, cancellation or disposal begins. Registration never adopts the Actor's Puppet ownership. Call `dispose()` when finished with a context to release its registry references.

Each context runs once. Concurrent, repeated and reentrant `run()` calls return the same promise, even if passed another plan. Create another context for a new run. Empty sequences and parallel groups complete without runtime ticks. Reusing the same Actor in successive sequential nodes is supported.

### Barriers, conflicts and failure

A parallel group starts its branches in input order without awaiting earlier branches. Its barrier completes only when **every** branch reports `completed`. Different arrival times are expected: an early arrival cannot release the barrier. An interrupted, stopped, cancelled, failed or disposed branch prevents all subsequent scene steps.

The policy is fail-fast for the whole context: the first observed unsuccessful branch cancels all active owned siblings, including nested siblings, prevents later nodes from starting, and preserves that branch's status and original error. The context waits for sibling cancellation and listener cleanup before resolving. Detection follows promise continuations after runtime callbacks finish; it cannot undo completed synchronous cues. First explicit cancel/dispose request wins if made before a branch failure is observed; an already observed branch failure retains precedence. Settled results never change.

Preflight rejects any parallel branches whose Actor sets overlap, including Actors used later inside nested sequences and distinct Actor wrappers over the same Puppet. This deliberately conservative policy reserves one Actor per parallel branch and prevents movement/base-animation races without timing guesses. Separate contexts and standalone `ChoreographySequence` runs also share exclusive claims for each active Actor leaf. Future sequential leaves do not reserve their Puppets: if another run still controls one when reached, the new leaf fails without taking over that run. Direct application Actor/Puppet commands remain authoritative and may interrupt choreography using existing runtime semantics.

`ChoreographyCoordinationResult` is a discriminated union with the existing five statuses. It contains immutable `children` in input order. Actor leaves also expose `actorId` and the original `sequenceResult`, including step progress and movement/playback details. Sequential groups include only reached children. Parallel groups include an outcome for every branch; branches suppressed by cancellation before starting have empty children. Preflight failures have empty children and preserve `error` for failed validation. An Actor disposed before its leaf starts returns `disposed` when reached; active Actor disposal stops the context immediately through the existing sequence disposal subscription.

Context cancellation calls only the active leaf sequences' owned cancellation. It preserves replacement movement/playback, unrelated layers, pending host queue requests and other contexts. Disposal cancels this context and clears the registry without destroying Actors or Puppets. Movement and waits still use Puppet updates. Hosts using manual updates must advance every participating Puppet with the scene's shared delta; automatic Puppets retain their existing scene update subscriptions. Promise orchestration never supplies a new clock or carries unused delta into future steps.

### Animation events and application cues

Animation leaves already react to the existing instance completion API. Authored events remain available through `puppet.onAnimationEvent()`; applications may react, update dialogue/sound/gameplay, or cancel the context from that callback. No event dispatcher or event clock is added. Application listeners remain application-owned and should be unsubscribed by the host:

```ts
const unsubscribe = actorA.puppet.onAnimationEvent((event) => {
  if (event.name === 'greeting') showDialogue();
});
try {
  await choreography.run(plan);
} finally {
  unsubscribe();
  choreography.dispose();
}
```

Cues remain synchronous, optional runtime callbacks. Asynchronous dialogue, sound, camera and gameplay systems remain application concerns.

## Coverage and deferred work

Deterministic tests cover ordering, move/walk then play, play then face, natural completion, zero-duration actions, update-clock waits, scene and animation pause semantics, interrupted/stopped playback, movement replacement, cancellation during movement/animation/waits/start callbacks, Actor and scene disposal, invalid commands, copied data/live targets, synchronous cue failures, repeated/reentrant execution, exactly-once settlement and listener cleanup. Existing async playback regressions verify default wait behavior remains compatible.

Multi-Actor regressions additionally cover two concurrent walks on shared scene ticks, different arrival times, nested barriers and animation responses, deterministic delta partitions, group cancellation during movement/animation/waits/cues, fail-fast sibling cleanup, authored-event cancellation, external interruption, disposed Actors, registration, preflight conflicts including shared Puppet wrappers, cross-context/standalone claims, invalid future actions, cyclic plans, immutable results and reentrant execution.

The [v0.8.6 production guide](choreography-production.md) supplies the complete reusable two-character sample using exported packages, the API/lifecycle audit and integration semantics. The [v0.8 release report](release-notes-v0.8.md) records verification, cleanup and measured performance. Visual timelines, authored scene serialization, camera direction, dialogue branching, behavior trees, physics and navigation are outside this runner.
