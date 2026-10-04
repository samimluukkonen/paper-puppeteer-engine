# Animation and pose APIs

[All guides](../README.md#guides)

## Static poses and authoring

A pose file is a version 1 JSON object with a name and sparse local bone transforms. Rotations are radians. Every property is an absolute local value; properties and bones left out preserve their current underlying pose. The sample is [combat-ready.json](../public/characters/demo-puppet/poses/combat-ready.json). List pose paths in the optional `poses` array of `character.json`; `CharacterLoader` loads and validates them against the rig. For programmatic puppets, pass `poses` to the constructor or call `addPose`. Invalid versions, unknown bones, extra fields, and nonfinite values are rejected.

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

`mix` ranges from 0 to 1. At 0 the pose changes nothing; at 1 it fully replaces named properties. A preset remains active across updates until `clearPose`, another `applyPose`, or bind reset. Each joint's immutable `bindPose` comes from the normalized rig and remains available after reset. Evaluation order is **bind/rest pose → base animation → animation layers → persistent pose preset → IK → rendered pose**. Animation does not advance when paused or stopped. IK is temporary: its changes are restored before the next evaluation and before export. `resetToBindPose()` clears animation layer state and the active preset, resets joint transforms, and disables IK constraints so the displayed result matches the bind pose. It leaves the rig, registered clips, and registered poses intact. Resume IK explicitly if needed.

Press `O` in the demo to enter the developer inspector. It stops animation, resets joints, disables IK, and restores a consistent draw order and limb placement for the current facing. The on-screen panel shows the selected bone's local x, y, rotation, and scales. Use the controls in the table above to select and adjust a bone. `A` / `D` change facing while preserving manual adjustments relative to the facing layout. `C` loads the combat-ready preset as editable values; `R` resets the current facing's rest layout. Pressing `O` again exits the inspector and starts idle. `X` logs JSON, copies it when clipboard access is available, and downloads `exported-pose.json`. Export compares each authored local property with its rig bind value using an epsilon of `0.0001`, so unchanged properties are omitted. The demo's right-facing layout may therefore export shoulder, hip, and arm corrections even before manual edits; those values are needed to recreate that facing-specific pose. Save the result under a character's `poses/` directory and add its path to `character.json`; it will load like the sample pose. `J` logs a versioned rig snapshot with normalized local positions, rotation, logical lengths, slot transforms, sprite offsets, and origins. These exports contain data only, never Phaser objects. The rig snapshot reflects loaded rig definitions; tuning pivots or sprite offsets still requires editing the rig JSON.

The recommended new character workflow is: load the artist's artwork, load its rig, press `B` to inspect bones, tune pivots and sprite offsets in the rig JSON, press `O` to inspect and adjust a pose, press `X` to export it, save the file under `poses/`, then use its name in scripted scenes. The `schemas/` folder has JSON Schemas for character, rig, skin, animation, and pose files, generated from the engine's Zod definitions. Run `npm run schemas:generate` after changing file shapes or scalar constraints; tests check that the committed schemas stay in sync. Rig references and animation timeline rules are shared by file validation and runtime construction. This repository includes VS Code file associations in `.vscode/settings.json`; external projects can associate the packaged schemas with their own folders.

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

`stop()` freezes every layer. `restart()` resets every selected layer to time zero and clears its fade, retaining clip speeds, masks, weights, the global speed, playback mode, and pause state. Time-zero events fire after all restarted layers have been synchronized. To restart only one layer, call `play(name, { layer, speed })` with its desired settings.

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

Stepped playback quantizes pose sample time to `floor(time / (1000 / fps)) * (1000 / fps)`. It also quantizes crossfade weights. At 10 FPS, one authored pose is held for 100 ms across normal Phaser render frames. Clip-specific `playback: { mode: 'stepped', fps: 12 }` or `{ mode: 'smooth' }` overrides the puppet default. The animation clock, event crossings and IK still update at normal frame rate. A nonlooping clip shows its exact final pose at completion.

For base-clip previews, `animationPlayer.sample(time, { mode: 'playback' })` uses the same pose timing rules, including clip playback overrides and the exact nonlooping final pose. `sample(time)` (or `{ mode: 'raw' }`) interpolates at the requested time regardless of playback settings. Both paths clamp time to `[0, duration]`, including for looping clips, and leave clocks, playback state, and events unchanged. They sample only the base clip, excluding crossfades, overlay layers, and IK. Properties controlled only by active fades or layers return to bind values; untracked manual edits are retained. When sampling a puppet with IK or a pose preset, call `puppet.preparePose()` before sampling and `puppet.syncPose()` afterward to update its rendered preview. At 50 ms in a linear clip from x=0 to x=100 over 1000 ms, raw sampling gives x=5; playback sampling at 10 FPS gives x=0.

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

Additional layers apply in insertion order after the base layer. A layer touches only tracked properties on masked bones; all other properties retain the pose below it. The base layer has a fixed weight of one. Each layer has its own clip, clock and optional transition. The update order is: restore the previous pre-IK pose, advance animation clocks, sample and blend the base clips, apply masked layers, run per-frame host pose adjustments, solve IK constraints in priority order, synchronize world transforms and rendering, then refresh debug overlays. In the demo, foot and hand IK therefore operate on the blended authored pose.

The puppet updates automatically with its scene. For manual scheduling or future constraints:

```ts
const puppet = new Puppet(scene, { rig, animations: [wave], autoUpdate: false });
puppet.play('wave');
// In Scene.update(time, delta):
puppet.update(delta);

puppet.stop();
puppet.setBoneRotation('forearm', 0.1);
const hand = puppet.getBone('hand');
hand.pose.x = 3;
puppet.syncPose();
const worldPosition = hand.getWorldPosition();
```

An active track overwrites manual changes to its property on the next update. With `autoUpdate: false`, advanced hosts call `puppet.animationPlayer.update(delta, () => puppet.preparePose())`, modify joint poses, and call `puppet.syncPose()` to evaluate constraints. The optional preparation callback restores the previous pre-IK pose after validation succeeds, so rejected updates leave poses unchanged. `animationPlayer.update(delta)` returns `true` when it evaluated a pose and `false` when playback was paused or no layer advanced; the callback runs only when a pose will be evaluated. Hosts can use this result to avoid evaluating again before presentation. Before direct manual edits while paused or stopped, call `preparePose()` explicitly. `animationPlayer.duration` exposes the active base clip duration in milliseconds (zero when none is selected). `animationPlayer.applyCurrentPose()` reapplies the current stepped/blended/layered pose before external adjustments; `sample(time)` remains available to sample the base clip at an explicit smooth time without changing its clock. `puppet.resetPose()` stops playback and restores all bind transforms; enabled IK is then evaluated on that pose.
