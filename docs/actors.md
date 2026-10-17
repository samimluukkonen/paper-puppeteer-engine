# Actor foundation (v0.8.1)

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
  animationStates: {
    initialState: 'rest',
    states: {
      rest: { animation: 'idle' },
      greeting: { animation: 'wave' },
    },
    defaultFadeDuration: 120,
  },
});

actor.setPosition(450, 400).setFacing('left');
actor.playAction('greeting');
actor.setState('rest');
const result = await actor.playAndWait('wave');
if (result.status === 'completed') actor.setState('rest');
actor.dispose();
```

Animation names in this example must exist in the supplied character. `animationStates` is optional; supplying it constructs the existing `AnimationStateController` and starts its initial state. Without it, use `play()` directly. `setState()`, `playAction()` and `currentState` require this configuration. Initial state playback may invoke the host's existing animation callbacks.

## Public API

Both the package root and `/runtime` export `Actor`, `ActorOptions`, `ActorPosition` and `ActorPuppetOwnership`. Actor's implementation has no Phaser value import; its Puppet reference is a type-only dependency. The existing `/core`, `/data` and `/serialization` exports retain their scope.

| API                                                                               | Behavior                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `new Actor({ id, puppet, puppetOwnership?, animationStates? })`                   | Wrap a live Puppet; ownership defaults to `'borrowed'`.                              |
| `id`, `puppet`, `puppetOwnership`, `isDisposed`                                   | Read instance identity, host reference, fixed ownership mode and lifecycle status.   |
| `position`, `setPosition(x, y)`                                                   | Read a detached, frozen position snapshot or update the Puppet's container directly. |
| `currentAnimation`, `isPlaying`                                                   | Query the existing Puppet playback.                                                  |
| `play(name, options?)`, `stop()`                                                  | Delegate existing playback, layer options and stopping behavior.                     |
| `pauseAnimation()`, `resumeAnimation()`                                           | Delegate the existing global animation pause/resume.                                 |
| `playAndWait(name, options?)`, `waitForPlayback(options?)`                        | Delegate exact-instance promises with the existing `PlaybackWaitResult`.             |
| `currentState`, `setState(id, options?)`, `playAction(id, options?)`              | Use the Actor-owned optional `AnimationStateController`.                             |
| `setFacing()`, `setSkin()`, `applySkin()`, `setAttachment()`, `clearAttachment()` | Delegate existing appearance operations with their normal validation.                |
| `dispose()`                                                                       | Release Actor state policy and waits; destroy an owned Puppet once.                  |

Mutating methods return the Actor for chaining, except async methods and `dispose()`. Advanced APIs, including queues, layers, IK, prop objects, events and manual updates, remain available through `actor.puppet`. Subscriptions made directly through Puppet remain the caller's responsibility.

## Identity and position

The host supplies a nonempty instance ID and ensures uniqueness within its application. Actor does not maintain a global ID registry. The ID is independent of the character definition ID, clip names and player-local numeric playback IDs. Two independent Puppets can share one immutable `CharacterDefinition` and compiled animation data while their Actors retain distinct IDs, positions and playback clocks.

The Puppet container is the only position authority. `position` reads its current `x` and `y`; changing the container directly is visible in the next snapshot. Mutating a previous snapshot cannot move the character. `setPosition()` validates both coordinates before changing either, then synchronizes the pose so world-space IK and debug overlays follow immediately without advancing animation time.

Coordinates follow the existing outer-container convention: pixels in scene coordinates for an unparented Puppet, or parent-local coordinates if the host reparents it. Positive Y points down. Camera transforms remain host-owned. Facing and bone animation do not change this outer position.

## Playback, cancellation and ownership

Actor does not reinterpret animation completion. `playAndWait()` and `waitForPlayback()` retain the existing completed, interrupted, stopped, disposed and cancelled results, loop rejection, layer selection and playback identities. Aborting a supplied `AbortSignal` releases only that wait; an already-aborted signal skips playback and clip validation on a live Actor. `stop()` delegates Puppet's normal stopping behavior. Named states retain the existing action-return, crossfade and direct-playback precedence rules.

With `'borrowed'` ownership, the host keeps the Puppet. Actor disposal cancels pending Actor waits and removes its state controller and destruction subscription; existing playback, external waits, textures and other wrappers remain usable. No automatic action return occurs after Actor disposal. Use `stop()` before disposal if the host wants to stop that playback.

With `'owned'` ownership, disposal also destroys the Puppet. Only one Actor may own a particular Puppet; borrowed wrappers may coexist and observe the same host. Owned destruction settles pending playback waits through Puppet before Actor cancels any remaining waits, preserving existing terminal outcomes. A failed Actor constructor releases its ownership claim and leaves Puppet destruction to the host.

Puppet's additive `onDestroy(listener)` hook returns an unsubscribe function and runs once after runtime cleanup, including idle destruction and scene shutdown. Cleanup and remaining callbacks finish even if a listener throws; failures propagate through the existing cleanup error boundary. All wrapping Actors dispose when their Puppet is destroyed. Actor disposal is idempotent, including after cleanup failures. Other Actor operations reject after disposal or when the Puppet/player is no longer live; async operations reject their promises. Identity, ownership, the Puppet reference and `isDisposed` remain readable after disposal.

Puppet still receives scene updates automatically unless constructed with `autoUpdate: false`. In manual mode the host calls `puppet.update(deltaMilliseconds)` as before. Actor has no second update loop and leaves shared textures under host ownership.

## Coverage and deferred work

Actor regressions exercise construction, distinct instances sharing a definition, parent-coordinate transforms, immediate world-target IK synchronization, playback and state delegation, exact async outcomes, abort and disposal isolation, ownership conflicts, invalid/disposed operations, idle/completed/stopped shutdown and cleanup failures. Runtime dependency graph tests verify Actor's renderer/editor independence and public barrel compatibility.

v0.8.2 will add deterministic delta-driven movement, `moveTo()`/`walkTo()`, speed, arrival, interruption/cancellation and explicit locomotion mappings. This foundation adds no movement interpolation, look-at behavior, choreography, physics, pathfinding or visual scene editor.
