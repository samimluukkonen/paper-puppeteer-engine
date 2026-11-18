# Animation and pose APIs

[All guides](../README.md#guides)

## Static poses and authoring

A pose file is a version 1 JSON object with a name and sparse local bone transforms. Rotations are radians. Every property is an absolute local value; properties and bones left out preserve their current underlying pose. The sample is [combat-ready.json](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/public/characters/demo-puppet/poses/combat-ready.json). List pose paths in the optional `poses` array of `character.json`; `CharacterLoader` loads and validates them against the rig. For programmatic puppets, pass `poses` to the constructor or call `addPose`. Invalid versions, unknown bones, extra fields, and nonfinite values are rejected.

```json
{ "version": 1, "name": "combat-ready", "bones": { "torso": { "rotation": -0.08 }, "rightForearm": { "rotation": -1.1 } } }
```

```ts
puppet.applyPose('combat-ready');
puppet.applyPose('combat-ready', { mix: 0.5 });
puppet.clearPose();
puppet.resetToBindPose();
const json = JSON.stringify(puppet.exportPose('my-pose'), null, 2);
const rigValues = puppet.exportRig();
```

`mix` ranges from 0 to 1. At 0 the pose changes nothing; at 1 it fully replaces named properties. A preset remains active across updates until `clearPose`, another `applyPose`, or bind reset. Each joint's immutable `bindPose` comes from the normalized rig and remains available after reset. Evaluation order is **bind/rest pose → base animation → animation layers → persistent pose preset → IK → rendered pose**. Animation does not advance when paused or stopped. IK is temporary: its changes are restored before the next evaluation. Pose export reads the authored transforms without changing the held pose, rendering, or IK state, including when export validation fails. `resetToBindPose()` clears animation layer state and the active preset, resets joint transforms, and disables IK constraints so the displayed result matches the bind pose. It leaves the rig, registered clips, and registered poses intact. Resume IK explicitly if needed.

Use the [Rig Editor](rig-editor.md) to edit bind transforms and artwork alignment, and the [Animation Editor Pose Library](pose-library.md) to capture and apply authored FK poses.

Use [Creating Your First Character](creating-your-first-character.md) for artwork, rig, IK and animation authoring. The `schemas/` folder has JSON Schemas for character, rig, skin, animation and pose files, generated from the engine’s Zod definitions. Run `npm run schemas:generate` after changing file shapes or scalar constraints. VS Code file associations live in `.vscode/settings.json`; external projects can associate the packaged schemas with their own folders.

## Define an animation

Animation clips are independent of rigs and can be passed at construction or registered later.

```ts
import type { AnimationClip } from 'paper-puppeteer-engine';

const wave: AnimationClip = {
  name: 'wave', duration: 1200, loop: true,
  interpolation: 'linear',
  tracks: {
    upperArm: [
      { time: 0, rotation: -0.4 },
      { time: 600, rotation: 0.4 },
      { time: 1200, rotation: -0.4 },
    ],
    forearm: [
      { time: 0, rotation: -0.2, scaleY: 1 },
      { time: 600, rotation: -0.8, scaleY: 1.02 },
      { time: 1200, rotation: -0.2, scaleY: 1 },
    ],
  },
};

puppet.addAnimation(wave).play('wave');
puppet.stop();    // Freeze the current pose.
puppet.restart(); // Restart all selected layers at time zero, preserving their playback settings.
puppet.setFacing('left');
puppet.setFacing('right');
```

Key times and durations are **milliseconds**. Values are **absolute local transforms**, not deltas from the bind pose. All five transform properties support interpolation, independently across sparse keys. Rotations take the shortest angular path in radians. Each property's first/last value is held outside its key range; a single key holds a constant value. Key times must increase strictly and stay within the duration. Missing properties/bones use the bind pose on the base layer and the underlying pose on an overlay. Playing the same name restarts it unless `restart: false` is passed. Duplicate clip names and unknown bones/animations throw descriptive errors.

Looping wraps the clock at the duration; use matching start/end poses for a seamless cycle. Nonlooping clips stop at their exact final pose. Shortest-path rotation interpolation is intended for joint poses, not authored full-turn spins.

### Interpolation and sample timing

Version 1 defaults to linear interpolation. The optional clip-level `interpolation: 'linear'` declaration states that default; omitting it produces the same result. Since v1.1.2.1, a sparse keyframe can optionally carry `curves`, keyed by the property whose outgoing segment it controls. Bone properties are `x`, `y`, `rotation`, `scaleX` and `scaleY`; IK properties are `x`, `y` and `mix`. The same row must contain that property's numeric value. Controls apply until the next key on that property, skipping rows that key only siblings. A property's last key has no outgoing segment, and a single-key property remains constant; terminal controls can be retained for later key insertion or movement.

Supported outgoing curves are `{ mode: 'linear' }`, `{ mode: 'stepped' }` (hold until the next key), and cubic Bézier controls:

```json
{
  "time": 0,
  "rotation": -0.4,
  "curves": {
    "rotation": {
      "mode": "bezier",
      "control1": { "x": 0.25, "y": 0 },
      "control2": { "x": 0.75, "y": 1 }
    }
  }
}
```

Each handle uses segment-relative coordinates: `(0, 0)` is the start and `(1, 1)` is the end. Handle X maps elapsed time; Y maps progress between the endpoint values. All coordinates must be finite and in `[0, 1]`, with `control1.x <= control2.x`. This makes time monotonic and keeps values bounded, including IK influence. Flat endpoint tangents and coincident handles are valid. The runtime inverts Bézier time with deterministic bisection before evaluating value progress. Overshooting controls, explicit multi-turn rotation and graph viewport/selection state are outside this extension. The file version stays **1**; omitted controls retain exactly the previous defaults. Older readers that reject unknown fields require an update to load clips containing `curves`.

Rotation uses that progress along the existing shortest angular path in radians, including the negative half-turn tie. Values such as 170° → −170° travel 20°, even with Bézier timing. Authored values are retained without unwrapping or conversion into full-turn spins. At an exact interior/final key, the sampler may return an angularly equivalent unwrapped endpoint (190° in that example); after the last key it holds the stored value (−170°), preserving the previous runtime convention.

`playback.mode` controls when the shared evaluator samples the clip. `smooth` uses continuous time; `stepped` rounds sample time down to an FPS boundary and holds that evaluated pose until the next boundary. For linear keys at 0 ms (`x: 0`) and 1000 ms (`x: 100`), sampling at 550 ms produces `x: 55` in smooth mode and `x: 50` at 10 FPS in stepped mode. A property-level stepped curve instead holds until the next property key, independently of FPS. Clip playback settings are authored data. A player's default playback mode is runtime configuration, and editor preview speed/loop settings are transient preferences.

For property previews, import `compileClip`, `sampleProperty` and the `PropertyKeyframe`/`PropertyCurve` types from `/core` (also available through the root entry). Compilation validates and produces immutable bone and IK property maps. Pass one map entry to `sampleProperty(keys, timeMilliseconds, property)`; pass `'rotation'` for angular channels and omit it for IK. This is the same sampler used by `evaluateClip`, `evaluateIKClip`, buffered playback, layers and editor previews. Direct sampling expects validated, strictly ordered, nonempty keys and a finite time. It holds nearest endpoints outside the property range and does not advance clocks or emit events.

The Animation Editor preserves curves through import/export, history, movement, retiming, copying and selected-key mirroring. Normalized controls travel with their property; deletion removes only that property's controls. Value-only edits preserve existing controls; copied linear/default keys replace destination controls. IK baking samples curves through the runtime and replaces generated bone rotations with linear segments while preserving unrelated controls. The [Graph Editor](graph-editor.md) provides visual channel-scoped curve editing and tangent dragging with the same runtime evaluator.

`stop()` freezes every layer and discards pending queue requests. `restart()` also discards pending requests. `restart()` resets every selected layer to time zero and clears its fade, retaining clip speeds, masks, weights, the global speed, playback mode, and pause state. Time-zero events fire after all restarted layers have been synchronized. To restart only one layer, call `play(name, { layer, speed })` with its desired settings.

## Animation queues

```ts
puppet.queue('draw-weapon');
puppet.queue('attack', { speed: 1.5, fadeDuration: 100 });
puppet.queue('sheath-weapon');
```

The base-channel FIFO starts immediately when idle and advances after natural completion and its callbacks. Queued fades start at completion; large updates start the next clip at time zero without carrying excess delta. `getQueue()` returns frozen pending requests, `clearQueue()` discards pending requests, `stopQueue()` also freezes the base, and `replaceQueue(requests)` validates an entire replacement before interrupting playback. Successful ordinary base `play()` calls discard pending requests, including `restart: false` calls. Overlay playback leaves the queue alone. Looping requests and queueing behind an active base loop throw; stop or replace the loop first. See the [queue contract](animation-queues.md) for examples, interruption rules and lifecycle ordering.

## Playback, events and layers

```ts
puppet.play('idle');
puppet.play('walk', { fadeDuration: 250, speed: 1.2 });
puppet.pauseAnimation();
puppet.resumeAnimation();
puppet.setAnimationSpeed(0.5); // Global multiplier; nonnegative.

puppet.setAnimationPlaybackMode({ mode: 'stepped', fps: 10 });
puppet.setAnimationPlaybackMode({ mode: 'smooth' });
// Equivalent shortcut for stepped playback:
puppet.setAnimationFPS(8);
```

A crossfade evaluates the outgoing and incoming clips at their own advancing times and blends x, y, rotation, scaleX and scaleY. An interrupted fade starts from its currently visible pose. The fade duration uses real elapsed milliseconds; animation speed changes timeline progression but does not change fade duration. The outgoing clip is sampled during a fade but only the incoming clip sends events or completion. The base layer begins at the rig's bind pose, so partial clips also fade cleanly. A weight of zero is the source pose, one is the target pose. Rotation blending uses the shortest path around ±π.

`animationPlayer.playbackSpeed` exposes the global multiplier; `animationPlayer.currentAnimationSpeed` exposes the active base clip's multiplier from `play()` (1 without an active clip). The demo's walking body sway follows both multipliers, including zero speed, so it stays in step with foot contacts.

Use `await puppet.playAndWait(name, options?)` for one finite playback instance, or `await puppet.waitForPlayback({ layer, signal })` to observe the current instance without restarting it. Check `result.status === 'completed'` before continuing a sequence; interruption, explicit stop, disposal and wait cancellation are distinct results. See [async animation playback](async-animation.md) for the full contract.

`puppet.getPlaybackStatus(layer?)` returns a detached snapshot with a player-local `playbackId` and `status` (`playing`, `paused`, `completed`, `interrupted`, `stopped`, or `disposed`). `puppet.onPlaybackLifecycle(listener)` returns an unsubscribe function and reports `started`, `paused`, `resumed`, and each terminal outcome separately from authored markers. The same methods are available on `AnimationPlayer`. Every real start/restart gets a new identity, including repeated starts of the same clip. Crossfade replacement interrupts the outgoing instance immediately while retaining its visual blend. See the [playback lifecycle contract](playback-lifecycle.md) for ordering, layer, completion and disposal semantics.

```ts
const walk: AnimationClip = {
  name: 'walk', duration: 1000, loop: true,
  events: [
    { time: 100, name: 'footstep', data: { foot: 'left' } },
    { time: 600, name: 'footstep', data: { foot: 'right' } },
  ],
  tracks: { /* bone keyframes */ },
};

const offEvent = puppet.onAnimationEvent(({ name, data, clip, layer }) => {
  if (name === 'footstep') console.log(clip, layer, data);
});
const offComplete = puppet.onAnimationComplete(({ clip, layer }) => {
  if (clip === 'drawSword' && layer === 'base') puppet.play('combatIdle');
});
// Call offEvent() and offComplete() to unsubscribe.
```

Events fire once per timestamp crossing, including wraps and large frame deltas. They use the continuous timeline, so they fire even when the visible pose is held in stepped mode. A marker at time zero fires when a clip starts and on each loop wrap. Nonlooping completion fires once after the final pose is applied; looping clips do not complete. Pause holds all clocks, events and fades. IK targets can still move and solve while animation is paused.

Puppet callbacks run after transforms, pose presets, IK, and rendering are synchronized, including time-zero events from `play()` and `restart()`. With a large delta, every crossed marker observes the final pose of that update. A failing listener does not prevent remaining events or completion callbacks; its error is rethrown after delivery (multiple failures produce an `AggregateError`). Renderer-independent `AnimationPlayer` hosts can pass preparation and synchronization callbacks to `play()`, `restart()`, and `update()` to follow the same ordering with their own presentation pipeline.

`Puppet.destroy()` disposes its animation player. Standalone hosts should call `animationPlayer.dispose()` when playback is no longer needed. Disposal is idempotent, releases listeners, clips, layers, and joint references, and leaves the host's held pose intact. `isDisposed` becomes true and later `update()` calls return false; other playback, pose, and subscription methods reject use after disposal. Disposing during a callback cancels the remaining notifications in that delivery.

JSON-compatible event payloads are deep-copied when parsing files, compiling clips, and delivering each event to each listener. Changing source data after registration or mutating a delivered payload does not change playback data, other listeners, or later events. TypeScript-authored clips may also carry non-JSON runtime payloads such as functions or class instances; those payloads intentionally retain reference semantics. External animation files still require JSON data.

Updates reject overflowing timeline arithmetic, unsafe event cycle bounds, or more than 10,000 crossed events across all layers in one call. Rejected updates leave clocks, fades, poses, and event delivery unchanged. Reduce the delta or playback speed before retrying; events are never silently dropped.

Event starts, restarts, and updates also enforce a 1,000,000-unit JSON payload copy budget across all selected layers, crossings, and listeners (with at least one listener budgeted). Each JSON node and each string or object-key code unit costs one unit. This bounds payload amplification even for small files with rapidly looping events. Reduce payload sizes, listener count, or catch-up work when rejected. Runtime and editor playback check this before changing clocks or poses; deeply immutable payloads reuse their validation and cost profile while each listener still receives an independent object copy. If a pose hook or event callback adds listeners after preflight, delivery checks the remaining budget again and reports an error before further over-budget copies.

Stepped playback quantizes pose sample time to `floor(time / (1000 / fps)) * (1000 / fps)`. It also quantizes crossfade weights. At 10 FPS, one authored pose is held for 100 ms across normal Phaser render frames. Clip-specific `playback: { mode: 'stepped', fps: 12 }` or `{ mode: 'smooth' }` overrides the puppet default. The animation clock, event crossings and IK still update at normal frame rate. A nonlooping clip shows its exact final pose at completion.

For base-clip previews, `puppet.sampleAnimation(time, { mode: 'playback' })` uses the same pose timing rules, including clip playback overrides and the exact nonlooping final pose. `sampleAnimation(time)` (or `{ mode: 'raw' }`) interpolates at the requested time regardless of playback settings. Both paths clamp time to `[0, duration]`, including for looping clips, and leave clocks, playback state, and events unchanged. They sample only the base clip, excluding crossfades and overlay layers. Properties controlled only by active fades or layers return to bind values; untracked manual edits are retained. The helper restores temporary pose/IK changes before sampling, then applies active pose presets and IK and updates rendering. At 50 ms in a linear clip from x=0 to x=100 over 1000 ms, raw sampling gives x=5; playback sampling at 10 FPS gives x=0.

Renderer-independent hosts can use `animationPlayer.sample(time, options, preparePose)` directly. Its optional preparation callback runs only after time validation succeeds and a base clip is selected; the host remains responsible for subsequent rendering synchronization.

```ts
puppet.setLayerMask('upperBody', [
  'torso', 'head', 'leftUpperArm', 'leftForearm', 'leftHand',
  'rightUpperArm', 'rightForearm', 'rightHand',
]);
puppet.play('walk');
puppet.play('guardUpperBody', { layer: 'upperBody', fadeDuration: 250 });
puppet.setLayerWeight('upperBody', 0.7); // Range: 0–1.
puppet.clearLayer('upperBody');
```

Additional layers apply in insertion order after the base layer. A layer touches only tracked properties on masked bones; all other properties retain the pose below it. The base layer has a fixed weight of one. Each layer has its own clip, clock and optional transition. The update order is: restore the previous pre-IK pose, advance animation clocks, sample and blend the base clips, apply masked layers, run per-frame host pose adjustments, solve IK constraints in priority order, synchronize world transforms and rendering, then refresh debug overlays.

The puppet updates automatically with its scene. For manual scheduling or future constraints:

```ts
const puppet = new Puppet(scene, { rig, animations: [wave], autoUpdate: false });
puppet.play('wave');
// In Scene.update(time, delta):
puppet.update(delta);

puppet.stop();
puppet.setBoneRotation('forearm', 0.1); // Projects immediately.
const worldPosition = puppet.getBone('hand').getWorldPosition();
```

An active track overwrites manual changes to its property on the next update. With `autoUpdate: false`, `puppet.update(delta)` advances animation, evaluates pose presets and constraints, and renders; with the default `idleSync: 'always'` it also projects direct joint edits made since the previous update. `puppet.editPose(edit)` restores the pre-IK pose, runs `edit` (direct joint or constraint changes), then re-projects and solves IK, even if `edit` throws. `puppet.attachPoseSource(source)` drives the pose from external channels until the returned function detaches them. A standalone `AnimationPlayer.update(delta)` returns `true` when it evaluated a pose and `false` when playback was paused or no layer advanced. `animationPlayer.duration` exposes the active base clip duration in milliseconds (zero when none is selected). `animationPlayer.applyCurrentPose()` reapplies the current stepped/blended/layered pose before external adjustments; `sample(time)` remains available to sample the base clip at an explicit smooth time without changing its clock. `puppet.resetPose()` stops playback and restores all bind transforms; enabled IK is then evaluated on that pose.

See the [IK animation data model](ik-animation-data.md) for optional target/mix tracks, puppet-local coordinates, stable rig constraint names, validation, and pure authoring APIs. See [runtime IK evaluation](ik-animation-runtime.md) for playback, scrubbing, precedence, and layer blending. Visual IK authoring remains deferred.
