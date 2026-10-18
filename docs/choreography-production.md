# Scripted scenes and Actor ownership (v0.8.6)

[All guides](../README.md#guides) · [Actor API](actors.md) · [Sequence API](choreography-sequences.md) · [Release report](release-notes-v0.8.md)

## A complete working scene

The reusable [runtime example](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/src/examples/choreography.ts) and its [standalone copy](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/examples/standalone/src/scriptedScene.ts) implement the entire scene. Package checks compile the example against an isolated packed install and require both copies to agree. The [standalone application](https://github.com/samimluukkonen/paper-puppeteer-engine/tree/master/examples/standalone) supplies the Phaser game, controls and extracted exported character package. Its `choreography.html` page runs the scene repeatedly, cancels it, and destroys the game.

The two instances load the same exported package independently and share its cached textures. Both start idle on opposite sides, walk concurrently at different speeds, wait at a barrier, face one another, play `attack` then `recover`, return to idle, and dispose. These animation names, plus `idle` and `walk`, exist in the standalone package. They are application mappings, not engine conventions. For different exports supply `animations: { idle, walk, action, response }`; missing clips fail before constructing Puppets.

After copying the example module into your application and changing its runtime import to `paper-puppeteer-engine/runtime`, this is a complete desktop entry point:

```ts
import Phaser from 'phaser';
import { createScriptedScene } from './choreography.js';

class NarrativeScene extends Phaser.Scene {
  constructor() {
    super('narrative');
  }

  create(): void {
    void this.runScene().catch((error: unknown) => console.error(error));
  }

  private async runScene(): Promise<void> {
    const url = new URL('character/character.json', document.baseURI).href;
    const script = await createScriptedScene(this, { urls: [url, url] });
    if (!script) return; // Scene shutdown during package loading.
    const result = await script.run(); // Always disposes on completion or interruption.
    console.info(result.status);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: 760,
  height: 640,
  backgroundColor: '#eee8dc',
  scene: NarrativeScene,
});
window.addEventListener('pagehide', () => game.destroy(true), { once: true });
```

The host HTML needs `<div id="stage"></div>` and a module entry for that TypeScript file. Use Vite, install Phaser and the engine, and serve the extracted package under `public/character/`. The example helpers are application source, not additional package exports.

## Create and place Actors

```ts
import { Actor, Puppet } from 'paper-puppeteer-engine/runtime';

const puppet = new Puppet(scene, { definition, x: 140, y: 380 });
const actor = new Actor({
  id: 'a',
  puppet,
  puppetOwnership: 'owned',
  locomotion: { walk: 'walk', idle: 'idle', fadeDuration: 120 },
  animationStates: {
    initialState: 'rest',
    states: { rest: { animation: 'idle', loop: true }, action: { animation: 'attack' } },
  },
});
actor.setPosition(160, 380); // Also synchronizes world-target IK immediately.
```

`position` is a frozen snapshot in the outer Puppet container's parent coordinates. `worldPosition` includes enclosing Phaser transforms. `setPosition()` teleports the outer container without touching bone keys, playback clocks or the current destination; a pending movement continues toward its original destination from the updated position. Keep instance IDs unique within each choreography registry. Puppets remain independently usable without Actor.

## Move, walk and face

`await actor.moveTo(x, y, { speed })` moves directly without selecting animation. `walkTo()` additionally starts the mapped looping walk and restores idle on arrival or cancellation only while it still owns playback. Speed is positive world units per second, default 120; deltas and fades are milliseconds. Destination coordinates follow `position`, including when a parent is rotated or scaled. Arrival clamps to the exact destination. Zero-distance movement settles immediately without starting a new walk. A replacement settles the old request as `interrupted`.

Movement is direct point-to-point motion, not collision-aware navigation. There is no pathfinding, obstacle avoidance, physics, root motion or acceleration. Animated bone offsets do not move Actor placement. A moving parent can add its own world displacement. A collapsed parent travel direction rejects; a collapse during movement cancels it and reports the transform error through `Puppet.update()`.

`actor.lookAt(otherActor)` samples the other's current world origin once. A point argument also uses world coordinates. Facing mirrors the whole Puppet horizontally; it does not rotate the head, aim a weapon or track a target continuously. Horizontal ties, self targets and disposed Actor targets preserve facing. Vertical/collapsed right axes cannot choose a horizontal side. `walkTo(..., { faceMovement: true })` opts into facing horizontal world travel; default walking preserves facing. See [transform details](actors.md#identity-and-position).

## Animation integration

Actor delegates to the same Puppet animation player. `play`, `playAndWait`, `waitForPlayback`, pause/resume, skins and attachments preserve its existing options and instance identities. Queues, layers, events, IK and baked clips remain available through `actor.puppet`. There is no second evaluator, event dispatcher or clock.

Optional `animationStates` constructs the existing state controller and starts its initial state. `currentState` remembers the last persistent state; imperative playback and locomotion may temporarily take control. Explicitly call `setState('rest')` after scripted responses to regain policy ownership. `playAction('action')` uses a configured state ID and returns to the persistent state after natural completion. `playAndWait('attack', { loop: false })` uses an animation ID. A looping or paused animation wait intentionally remains pending until completion, interruption, cancellation or disposal.

A choreography animation step always starts a fresh finite base instance, even for a looping registered clip. Normal Puppet queue replacement rules apply when it starts; queue work added afterward follows the existing runtime policy. Cancelling a step stops only its own selected instance and preserves later host queue work and unrelated layers. Replacing a walk's animation externally gives the host playback precedence but does not interrupt spatial movement; replacing movement interrupts the walk request.

## Sequence, coordinate and settle

`ChoreographySequence(actor).walkTo(...).playAnimation(...).wait(...).run()` runs ordered steps. The fluent helpers and typed `ChoreographyStep` data share validation. `Choreography` registers Actors and composes `actor(id, steps)`, `sequence(children)` and `parallel(children)` descriptions. Its full tree is validated and snapshotted before any action starts. A parallel barrier requires every branch to succeed. Failure or interruption cancels active siblings and prevents later nodes. See [the full composition example](choreography-sequences.md#multi-actor-composition).

Contexts and sequences are single-run; repeated `run()` returns the same promise. Create another for another scene. Parallel branches cannot share a Puppet, including aliases or future nested steps; conflicts return `failed` with `ChoreographyConflictError`. Independent contexts and standalone sequences share active leaf claims. Direct Actor/Puppet commands remain authoritative. Avoid competing direct movement through multiple borrowed Actor wrappers.

| Result        | Meaning                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `completed`   | All reached steps completed naturally.                                                           |
| `interrupted` | Movement or the selected animation was replaced; explicit playback stop maps here.               |
| `cancelled`   | The run or its owned action was cancelled.                                                       |
| `disposed`    | The sequence/context or an active Actor/Puppet was disposed.                                     |
| `failed`      | Invalid script, ownership conflict, or synchronous command/cue error; original `error` retained. |

Direct Actor async validation rejects its promise. Choreography instead resolves typed outcomes and includes progress; callers must check `status`. Host notification failures retain the runtime's synchronous notification boundary; listen and handle errors around manual `puppet.update()` calls as well. Script cues must be synchronous and return `undefined`; accidental returned rejected promises are observed and reported as invalid cues.

## Cancel and dispose

A direct movement accepts an `AbortSignal`; `cancelMovement()` cancels the Actor's current request. Direct Actor playback waits cancel only the wait by default; `stopOnAbort: true` also stops their selected instance. `sequence.cancel()` and `context.cancel()` cancel only currently owned actions. They settle without another scene tick, including while a scene is paused. A group observes all sibling outcomes before resolving. Unused delta does not carry into later promise-driven steps.

Puppet's automatic scene subscription is the only clock. With `autoUpdate: false`, call each participating `puppet.update(deltaMilliseconds)` once per host tick. A paused Phaser scene emits no updates, freezing movement, timed waits and playback. `pauseAnimation()` pauses only animation; movement and timed waits still consume Puppet updates.

Borrowed ownership is the default: Actor disposal releases movement, state policy and Actor waits while retaining the live Puppet. Owned disposal also destroys the Puppet; only one Actor may own it. Context disposal clears its registry without adopting Actors. Finished sequences release stored cue and look-target references, but retain their public `actor` binding and cached result by design. Drop handles when finished. The reusable example disposes its context, Actors and Puppets on all exits, including shutdown and partial setup failure. Caller-created event listeners remain caller-owned. Puppet destruction clears its own listeners and GameObjects. Textures and the Phaser game belong to the host: destroy the game or release shared texture keys only after all consumers finish.

## Future integration

v0.9 can build application adapters over typed plans, outcomes and disposal signals without changing Puppet playback. Keep dialogue, sound, camera control and branching in host systems. Define serialization, navigation and concurrent ownership policy explicitly before adding them; do not infer these features from the current runtime-only plans.
