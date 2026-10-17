# Actors, movement and facing (v0.8.3)

[All guides](../README.md#guides)

`Actor` is an optional runtime facade over an existing `Puppet`. It delegates animation, appearance and pose synchronization to the existing runtime. Puppet remains usable directly. Actor adds no clock, scene update subscription, evaluator, character loading or editor dependency.

```ts
import { Actor, Puppet } from 'paper-puppeteer-engine/runtime';

// Construct after the host has loaded the definition and its textures.
const puppet = new Puppet(scene, { definition, x: 300, y: 400 });
const actor = new Actor({
  id: 'character-a',
  puppet,
  puppetOwnership: 'owned',
  locomotion: { walk: 'stride', idle: 'idle', fadeDuration: 120 },
  animationStates: {
    initialState: 'rest',
    states: {
      rest: { animation: 'idle' },
      greeting: { animation: 'wave' },
    },
    defaultFadeDuration: 120,
  },
});

actor.setPosition(450, 400).faceLeft();
actor.lookAt({ x: 500, y: 400 }); // Scene/world coordinates, including enclosing transforms.
actor.playAction('greeting');
actor.setState('rest');
const result = await actor.playAndWait('wave');
if (result.status === 'completed') actor.setState('rest');
await actor.moveTo(500, 400); // Default speed: 120 world units per second.
const arrival = await actor.walkTo(700, 400, { speed: 160, faceMovement: true });
if (arrival.status === 'completed') actor.playAction('greeting');
actor.dispose();
```

Animation names in this example must exist in the supplied character. `animationStates` is optional; supplying it constructs the existing `AnimationStateController` and starts its initial state. Without it, use `play()` directly. `setState()`, `playAction()` and `currentState` require this configuration. Initial state playback may invoke the host's existing animation callbacks.

## Public API

Both the package root and `/runtime` export `Actor`, `ActorOptions`, `ActorPosition`, `ActorPuppetOwnership`, `ActorLocomotion`, `ActorMoveOptions`, `ActorWalkOptions`, `ActorMovementOutcome`, `ActorMovementResult` and `ActorMovementSnapshot`. Actor's implementation has no Phaser value import; its Puppet reference is a type-only dependency. The existing `/core`, `/data` and `/serialization` exports retain their scope.

| API                                                                               | Behavior                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `new Actor({ id, puppet, puppetOwnership?, animationStates?, locomotion? })`      | Wrap a live Puppet; ownership defaults to `'borrowed'`.                                     |
| `id`, `puppet`, `puppetOwnership`, `isDisposed`                                   | Read instance identity, host reference, fixed ownership mode and lifecycle status.          |
| `position`, `setPosition(x, y)`                                                   | Read a detached, frozen position snapshot or update the Puppet's container directly.        |
| `worldPosition`                                                                   | Read a detached, frozen scene/world position including enclosing container transforms.      |
| `moveTo(x, y, { speed?, signal? }?)`                                              | Await direct movement without changing animation. Replacing a walk releases its locomotion. |
| `walkTo(x, y, { speed?, signal?, locomotion?, faceMovement? }?)`                  | Await movement with mapped locomotion and optional horizontal world auto-facing.            |
| `cancelMovement()`                                                                | Stop the current movement, settling it as cancelled.                                        |
| `currentAnimation`, `isPlaying`                                                   | Query the existing Puppet playback.                                                         |
| `play(name, options?)`, `stop()`                                                  | Delegate existing playback, layer options and stopping behavior.                            |
| `pauseAnimation()`, `resumeAnimation()`                                           | Delegate the existing global animation pause/resume.                                        |
| `playAndWait(name, options?)`, `waitForPlayback(options?)`                        | Delegate exact-instance promises with the existing `PlaybackWaitResult`.                    |
| `currentState`, `setState(id, options?)`, `playAction(id, options?)`              | Use the Actor-owned optional `AnimationStateController`.                                    |
| `setFacing()`, `setSkin()`, `applySkin()`, `setAttachment()`, `clearAttachment()` | Delegate existing appearance operations with their normal validation.                       |
| `facingDirection`, `faceLeft()`, `faceRight()`                                    | Read or change Puppet's existing left/right orientation.                                    |
| `lookAt(pointOrActor)`                                                            | Face a world position or another Actor's current world origin once.                         |
| `dispose()`                                                                       | Release movement, state policy and waits; destroy an owned Puppet once.                     |

Mutating methods return the Actor for chaining, except async methods and `dispose()`. Advanced APIs, including queues, layers, IK, prop objects, events and manual updates, remain available through `actor.puppet`. Subscriptions made directly through Puppet remain the caller's responsibility.

## Identity and position

The host supplies a nonempty instance ID and ensures uniqueness within its application. Actor does not maintain a global ID registry. The ID is independent of the character definition ID, clip names and player-local numeric playback IDs. Two independent Puppets can share one immutable `CharacterDefinition` and compiled animation data while their Actors retain distinct IDs, positions and playback clocks.

The Puppet container is the only position authority. `position` reads its current `x` and `y`; changing the container directly is visible in the next snapshot. Mutating a previous snapshot cannot move the character. `setPosition()` validates both coordinates before changing either, then synchronizes the pose so world-space IK and debug overlays follow immediately without advancing animation time.

Coordinates follow the existing outer-container convention: pixels in scene coordinates for an unparented Puppet, or parent-local coordinates if the host reparents it. Positive Y points down. Camera transforms remain host-owned. Facing and bone animation do not change this outer position.

`worldPosition` instead reads the outer container's full Phaser world transform, including every enclosing translation, rotation and scale. It returns a frozen snapshot and rejects nonfinite world coordinates. This origin is independent of animated bone positions and camera scroll/zoom.

## Facing and spatial targeting

`faceLeft()` and `faceRight()` delegate to `setFacing('left' | 'right')`; `facingDirection` reads the current Puppet value, including changes made directly through Puppet. The runtime supports two orientations through the sign of the outer container's X scale. It retains scale magnitude and synchronizes the existing pose/IK/render pipeline. It does not rotate the skeleton or edit animation keys, skins, attachment selections or the bone hierarchy. Existing world IK targets remain fixed; authored puppet-local IK targets mirror with the character. Props retain their bone/slot mounts and inherit the existing transforms.

```ts
actor.faceLeft();
actor.faceRight();
actor.lookAt({ x: 500, y: 300 });
actor.lookAt(otherActor);
const origin = actor.worldPosition;
```

`lookAt()` compares the target's horizontal world position with the Actor's world origin. Point targets must already be in scene/world coordinates; another Actor contributes its current `worldPosition`, even under a different parent. Screen, React viewport and raw pointer coordinates require host-side conversion first. Y must be finite but does not select orientation. Equal horizontal positions, including differences within **1e-8 world units**, preserve current facing. Repeated targeting in the same direction skips redundant pose synchronization.

Facing selects the supported mirror whose transformed right axis points horizontally toward the target. Reflected or rotated enclosing transforms can reverse which mirror does this. If the facing axis is vertical (within a relative tolerance of 1e-12) or collapsed, targeting preserves orientation because neither supported mirror can face horizontally; it never introduces an arbitrary rotation.

Self-targeting and disposed Actor/Puppet/player targets are no-ops. Nonfinite point positions, live target positions or source positions throw before changing facing. A disposed source Actor rejects operations as usual. Targeting samples once and retains no target reference or tracking subscription.

## Deterministic movement

`moveTo()` and `walkTo()` accept destinations in those same coordinates. Speed defaults to **120 world units per second** and must be finite and strictly positive. Nonfinite destinations, unrepresentable travel distances and directions collapsed by a parent transform reject before interrupting an existing request. A rotated or scaled parent changes how far a local step travels in the world; movement accounts for this, while the Puppet's own scale and facing do not change its translation speed. Camera zoom is irrelevant.

Each request subscribes to `Puppet.onUpdate(deltaMilliseconds)`, which runs after animation evaluation and callbacks in the existing `puppet.update()` call. Movement converts the delta to seconds, advances toward the destination at the selected speed, clamps arrival to the exact destination and synchronizes the pose, world IK and debug views. There are no timers or additional game loops. A large delta can arrive in one update. Zero distance completes immediately without starting locomotion. Animation pause, stop and speed multipliers do not pause or rescale movement; stop movement with `cancelMovement()` or its signal.

The container stays authoritative throughout the request. `setPosition()` or direct container changes are reflected in the next movement step, which proceeds from the actual current position toward the requested destination. If a parent moves during travel, that externally imposed displacement is additional to movement's own step. If the host invalidates the position or collapses the travel direction during movement, the request cancels and the update reports the error.

Both methods return a `Promise<ActorMovementResult>` with these terminal outcomes:

| Status        | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `completed`   | The destination was reached exactly, including zero-distance requests.   |
| `interrupted` | A valid newer movement on this Actor replaced this request.              |
| `cancelled`   | `cancelMovement()` or the supplied signal stopped this request.          |
| `disposed`    | Actor disposal, Puppet destruction or scene shutdown ended this request. |

Every started request includes a frozen `movement` snapshot with `start`, `destination`, final `position` and `speed`. It settles once and removes update, abort and locomotion subscriptions on termination. A pre-aborted signal resolves `{ status: 'cancelled' }` without a snapshot, validation, playback or interruption of the existing request. Invalid calls reject their promises; disposal still rejects new operations even with a pre-aborted signal. Snapshot positions are captured before idle callbacks run.

```ts
const abort = new AbortController();
const pending = actor.walkTo(900, 400, {
  speed: 140,
  signal: abort.signal,
  locomotion: { walk: 'run-cycle', idle: 'standing', fadeDuration: 80 },
});
// A later script command can use abort.abort() or actor.cancelMovement().
const outcome = await pending;
```

Each Actor manages one movement request. A new request replaces the old one from the current position. Wrappers sharing one Puppet also share its transform; the host should select one movement owner for that Puppet.

## Locomotion and animation ownership

`walkTo()` requires explicit registered **animation IDs** for both `walk` and `idle`, either in `ActorOptions.locomotion` or the per-request override. `moveTo()` needs no mapping. Neither animation name is globally hardcoded. The mapping is copied for each request; `fadeDuration` is a nonnegative number of milliseconds. Walk and idle are played as loops using the existing base-channel `AnimationStateController` and crossfade behavior. Idle is the explicit destination on arrival, cancellation or live borrowed disposal; walking does not resume a previous action or its clock. Existing Actor state configuration remains available for subsequent `setState()` or `playAction()` calls.

Locomotion starts once per nonzero walk. If another system replaces or stops base playback, **movement continues independently**, and arrival/cancellation does not restore idle or restart walk over the newer owner. Playback identity controls ownership, so even a newer request for the same walk clip wins. Overlay layers do not take base ownership. Replacing one walk with another skips an intermediate idle; replacing walking with plain `moveTo()` releases owned locomotion to idle. A zero-distance replacement also releases the previous walk. Idle crossfades start at arrival and advance on subsequent updates.

`walkTo(..., { faceMovement: true })` opts into facing at request start, before locomotion callbacks, and before subsequent nonzero movement steps. It uses the horizontal **world** travel vector derived from the destination's parent coordinates. External placement or parent changes are reflected in the next step. Zero-distance, effectively vertical and zero-delta steps preserve facing, and an unchanged direction never calls `setFacing()` repeatedly. Facing remains at its last value on arrival, cancellation or replacement. The default is false; `moveTo()` retains its existing behavior. Movement-facing applies the same supported-axis rules as `lookAt()` and does not change travel speed or animation timing.

Starting walk/idle may invoke host animation callbacks. Reentrant cancellation, replacement and disposal are supported, and subscriptions are released even if a callback throws. A failed walk start rejects and restores idle only if it still owns the committed playback. An idle callback failure propagates through the update/command while the movement's terminal outcome still settles.

## Playback, cancellation and ownership

Actor does not reinterpret animation completion. `playAndWait()` and `waitForPlayback()` retain the existing completed, interrupted, stopped, disposed and cancelled results, loop rejection, layer selection and playback identities. Aborting a supplied `AbortSignal` releases only that wait; an already-aborted signal skips playback and clip validation on a live Actor. `stop()` delegates Puppet's normal stopping behavior. Named states retain the existing action-return, crossfade and direct-playback precedence rules.

With `'borrowed'` ownership, the host keeps the Puppet. Actor disposal settles movement as disposed, restores its still-owned locomotion to idle, cancels pending Actor playback waits and removes subscriptions. Other playback, external waits, textures and wrappers remain usable. No automatic action return occurs after Actor disposal. Use `stop()` before disposal if the host wants to stop playback and retain that stopped state.

With `'owned'` ownership, disposal also destroys the Puppet. Only one Actor may own a particular Puppet; borrowed wrappers may coexist and observe the same host. Owned destruction settles pending playback waits through Puppet before Actor cancels any remaining waits, preserving existing terminal outcomes. A failed Actor constructor releases its ownership claim and leaves Puppet destruction to the host.

Puppet's additive `onDestroy(listener)` hook returns an unsubscribe function and runs once after runtime cleanup, including idle destruction and scene shutdown. Cleanup and remaining callbacks finish even if a listener throws; failures propagate through the existing cleanup error boundary. All wrapping Actors dispose when their Puppet is destroyed. Actor disposal is idempotent, including after cleanup failures. Other Actor operations reject after disposal or when the Puppet/player is no longer live; async operations reject their promises. Identity, ownership, the Puppet reference and `isDisposed` remain readable after disposal.

Puppet still receives scene updates automatically unless constructed with `autoUpdate: false`. In manual mode the host calls `puppet.update(deltaMilliseconds)` as before. Actor has no second update loop and leaves shared textures under host ownership. `Puppet.onUpdate(listener)` returns an unsubscribe function, uses a stable listener snapshot, stops delivery after destruction and clears subscriptions on destruction. Listener failures are reported after remaining listeners run.

## Coverage and deferred work

Actor regressions exercise construction, distinct instances sharing a definition, parent-coordinate transforms, immediate world-target IK synchronization, playback and state delegation, exact async outcomes, abort and disposal isolation, ownership conflicts, invalid/disposed operations, idle/completed/stopped shutdown and cleanup failures. Deterministic movement tests cover straight/diagonal travel, constant speed, delta partitions, large/zero deltas, arrival, invalid inputs, replacements, cancellation, disposal, synchronization, locomotion mapping/crossfades and external/reentrant playback ownership. Runtime dependency graph tests verify Actor's renderer/editor independence and public barrel compatibility.

Facing regressions cover explicit helpers, point/Actor targeting, equal horizontal positions, stale/self/invalid targets, nested and reflected transforms, world snapshots, movement auto-facing, world and authored IK, weapon mounts, stable slot selections/hierarchy and authored animation immutability.

Continuous tracking, head-only look constraints, 360-degree rotation, camera tracking, scene sequencing, choreography, physics, pathfinding, collision avoidance, obstacles, navmesh, root motion and a visual scene editor remain deferred.
