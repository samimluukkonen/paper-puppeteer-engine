Continue the existing `paper-puppeteer-engine` TypeScript + Phaser project.

Do NOT rewrite the project from scratch.

The project currently has:

- v0.1:
  - hierarchical puppet bones/joints
  - configurable pivots
  - render ordering/depth
  - facing left/right
  - attachments
  - debug visualization
  - basic keyframe animation
  - idle and walk animations

- v0.2:
  - two-bone IK
  - stable bend directions
  - IK mix/influence
  - foot planting demo
  - hand IK targeting
  - katana attachment
  - two-handed katana grip using secondary-hand IK
  - IK debug visualization

The goal of v0.3 is to improve the **animation system**, specifically:

1. animation blending / crossfading
2. animation events
3. stepped / low-FPS puppet animation mode
4. animation layers/tracks in a simple form
5. cleaner animation state handling
6. better animation lifecycle API

Do NOT implement a visual editor yet.

Do NOT significantly expand IK in this version.

## Main goal

I want the engine to support transitions like:

```ts
puppet.play("idle");

puppet.play("walk", {
  fadeDuration: 250,
});
```

so the character does not instantly snap from one animation to another.

I also want timeline events:

```ts
{
  time: 320,
  event: "footstep",
}
```

and stepped animation playback so the puppet can intentionally look like it is animated at approximately 8–12 FPS even though Phaser renders at 60+ FPS.

This stepped mode is very important for the intended paper-puppet aesthetic.

## Preserve compatibility

Existing v0.1 and v0.2 behavior must continue to work.

In particular:

- existing idle animation still works
- existing walk animation still works
- IK still works
- two-handed katana grip still works
- foot IK still works
- facing left/right still works
- attachments still work
- existing rig definitions should not need to be rewritten unless absolutely necessary

Do not break the public API without a strong reason.

If you must change something, provide a compatibility layer where practical.

# 1. Animation blending / crossfading

Implement animation blending between the current animation and the next animation.

For example:

```ts
puppet.play("idle");

puppet.play("walk", {
  fadeDuration: 300,
});
```

The pose should gradually transition from idle to walk over 300 ms.

Support at least:

```ts
interface PlayAnimationOptions {
  fadeDuration?: number;
  restart?: boolean;
}
```

You may add other options if useful, but keep the API small.

## Blend transform properties

Blend at least:

- rotation
- x
- y
- scaleX
- scaleY

For rotations, interpolate correctly across angle wrapping.

Do not naïvely interpolate from +179° to -179° through 0°.

Use shortest-angle interpolation.

Prefer radians internally.

## Blend architecture

Do not mutate animation clip definitions.

The animation system should conceptually evaluate:

```text
source animation pose
        +
target animation pose
        ↓
blend factor
        ↓
blended pose
        ↓
IK constraints
        ↓
final transform
```

Keep animation blending before IK.

IK should operate on the final blended animation pose.

The approximate update order should remain:

```text
1. evaluate animation pose(s)
2. blend animation poses
3. apply animation layers if any
4. apply IK constraints
5. resolve world transforms
6. render
```

Document the actual order used.

# 2. Animation events

Add event markers to animation clips.

For example:

```ts
const walk: AnimationClip = {
  name: "walk",
  duration: 800,
  loop: true,

  tracks: {
    // existing bone animation data
  },

  events: [
    {
      time: 100,
      name: "left-footstep",
    },
    {
      time: 500,
      name: "right-footstep",
    },
  ],
};
```

Support optional payload data:

```ts
{
  time: 300,
  name: "draw-sword",
  data: {
    hand: "right",
  },
}
```

Use a type like:

```ts
interface AnimationEvent {
  time: number;
  name: string;
  data?: unknown;
}
```

Avoid `any`.

## Event listener API

Provide a simple runtime API.

For example:

```ts
puppet.onAnimationEvent((event) => {
  console.log(event.name);
});
```

or:

```ts
puppet.animationPlayer.on("event", ...);
```

Choose whichever fits the architecture best.

Events must fire correctly:

- during normal playback
- during looping
- after animation wraps from end to beginning
- when playback speed is changed
- when frames are stepped

Events must NOT repeatedly fire every render frame after their event time is passed.

They should fire once per timeline crossing.

## Useful future examples

The event system should be suitable later for:

- footsteps
- sword swoosh sounds
- sword impact timing
- dialogue triggers
- particle effects
- camera shake
- drawing/sheathing a weapon
- swapping sprite attachments
- changing facial expressions

Do not implement those systems now.

Just make the event system generic.

# 3. Animation completion callbacks/events

Add a way to react when a non-looping animation completes.

For example:

```ts
puppet.play("drawSword");

puppet.onAnimationComplete("drawSword", () => {
  puppet.play("combatIdle");
});
```

Or preferably support an async-friendly API if clean:

```ts
await puppet.playAndWait("drawSword");

puppet.play("combatIdle");
```

Do NOT make the API unnecessarily complicated.

At minimum, provide a reliable completion event.

Completion must NOT fire repeatedly.

# 4. Stepped / low-FPS animation mode

This is a major feature for the project.

The engine runs at normal Phaser frame rate, but animation pose evaluation should optionally update only at a lower virtual animation FPS.

Example:

```ts
puppet.setAnimationFPS(10);
```

or:

```ts
puppet.setPlaybackMode({
  type: "stepped",
  fps: 10,
});
```

Then:

```text
Phaser render:
60 FPS

animation pose:
10 FPS
```

The same pose should be held for several render frames before switching to the next evaluated pose.

This should create a deliberate stop-motion / paper-puppet feeling.

## Example

At 10 FPS:

```text
0 ms     pose A
100 ms   pose B
200 ms   pose C
300 ms   pose D
```

Between those points, the pose should remain unchanged.

Do NOT interpolate every render frame when stepped mode is enabled.

## Support smooth mode too

The engine must still support current smooth interpolation.

Something conceptually like:

```ts
puppet.setAnimationPlaybackMode("smooth");
```

and:

```ts
puppet.setAnimationPlaybackMode("stepped", {
  fps: 10,
});
```

or another clean API.

Default should remain smooth unless the current project design suggests otherwise.

## Important

Stepped animation affects the animation pose.

It should NOT reduce Phaser's rendering frame rate.

It should also NOT break:

- IK
- weapon constraints
- transform hierarchy
- debug rendering

For example:

```text
animation pose updates at 10 FPS

IK target may move every frame

IK should still be able to react every Phaser frame
```

This distinction is important.

The authored character pose can look stepped while procedural constraints remain responsive.

# 5. Per-animation playback mode

Support optionally configuring playback style per animation.

For example:

```ts
const idle: AnimationClip = {
  name: "idle",
  duration: 1600,
  loop: true,

  playback: {
    mode: "stepped",
    fps: 8,
  },

  tracks: {
    ...
  },
};
```

And:

```ts
const swordSlash: AnimationClip = {
  name: "swordSlash",
  duration: 500,
  loop: false,

  playback: {
    mode: "stepped",
    fps: 12,
  },
};
```

Global puppet playback settings may act as default values.

Clip-specific settings should override them if present.

Keep this optional and simple.

# 6. Playback speed

Add animation playback speed.

Example:

```ts
puppet.setAnimationSpeed(1);
```

```ts
puppet.setAnimationSpeed(0.5);
```

```ts
puppet.setAnimationSpeed(1.5);
```

Or per play call:

```ts
puppet.play("walk", {
  speed: 1.2,
});
```

The exact API can follow the current architecture.

Playback speed must correctly affect:

- timeline position
- animation events
- completion
- loop timing
- stepped playback

Do not allow negative playback speed yet unless trivial.

# 7. Pause / resume

Support:

```ts
puppet.pauseAnimation();
puppet.resumeAnimation();
```

Paused animation should:

- keep the current pose
- stop timeline progression
- stop event progression
- preserve current animation state

IK may still update if targets move while animation is paused.

# 8. Simple animation layers

Add a minimal animation layer concept.

Do NOT create a huge animator-controller system.

The goal is to support something like:

```text
base layer:
walk

upper-body layer:
sword-ready pose
```

For example:

```ts
puppet.play("walk", {
  layer: "base",
});

puppet.play("guardUpperBody", {
  layer: "upperBody",
});
```

The upper-body animation should affect only selected bones.

## Bone mask

Support a simple bone mask.

For example:

```ts
const upperBodyMask = [
  "torso",
  "head",
  "leftUpperArm",
  "leftForearm",
  "leftHand",
  "rightUpperArm",
  "rightForearm",
  "rightHand",
];
```

Then:

```ts
puppet.setLayerMask("upperBody", upperBodyMask);
```

or define the mask in layer configuration.

The desired concept:

```text
legs:
walk animation

upper body:
combat stance animation
```

This is especially useful for side-scrolling puppet scenes.

## Keep layers simple

For v0.3, support only a small fixed concept:

- base layer
- optional additional layers
- layer weight
- bone mask
- animation per layer

Do NOT implement:

- blend trees
- animator graphs
- state machines
- procedural layer graphs
- nested state machines

Those can come later.

## Layer weights

Support something like:

```ts
puppet.setLayerWeight("upperBody", 0.7);
```

Where:

```text
0 = layer contributes nothing
1 = full layer contribution
```

# 9. Animation states

Improve internal animation state tracking.

Each active animation/layer should know at least:

- animation clip
- current time
- duration
- speed
- loop
- paused state
- blend weight
- transition state if blending
- stepped mode state

Do not expose unnecessary internals publicly.

But structure this cleanly.

Avoid accumulating lots of unrelated mutable fields inside `AnimationPlayer`.

If needed, create:

```text
AnimationState.ts
AnimationLayer.ts
AnimationTransition.ts
```

Only create classes/modules that improve maintainability.

# 10. Pose representation

If the current animation system directly writes values to bones during evaluation, consider introducing an intermediate pose representation.

For example:

```ts
interface BonePose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}
```

and:

```ts
type PuppetPose = Map<string, BonePose>;
```

or another efficient representation.

Conceptually:

```text
AnimationClip
    ↓
evaluate
    ↓
PuppetPose
    ↓
blend
    ↓
PuppetPose
    ↓
layers
    ↓
PuppetPose
    ↓
apply to rig
```

This will make blending and layers much cleaner.

Do this refactor only if appropriate.

Do not unnecessarily rewrite stable systems.

# 11. Missing tracks / partial animations

Animations should NOT need to contain tracks for every bone.

For example:

```ts
const headLook: AnimationClip = {
  name: "headLook",
  ...
  tracks: {
    head: [...]
  }
};
```

Bones not animated by that clip should preserve their underlying/base pose.

This is especially important for animation layers.

# 12. Demo scene updates

Expand the demo so the new features can be tested visually.

Suggested controls:

```text
Paper Puppeteer Engine v0.3

1 - Idle
2 - Walk
3 - Two-handed sword pose

4 - Walk -> Idle crossfade
5 - Idle -> Walk crossfade

S - Toggle smooth / stepped playback
8 - Set stepped FPS to 8
0 - Set stepped FPS to 10
2? - Avoid conflicting key assignments

P - Pause / Resume

L - Toggle upper-body animation layer

A / D - Facing

B - Bone debug
I - IK debug

Q / E - Rotate katana
```

Choose non-conflicting controls.

Display useful runtime information:

```text
Current animation: walk
Playback: stepped
Animation FPS: 10
Playback speed: 1.0x
Paused: false

Upper body layer: active
Layer weight: 1.0

Transition:
idle -> walk
42%
```

# 13. Visual stepped-mode test

Make stepped animation visually obvious.

For example:

```text
walk at smooth mode

versus

walk at 8 FPS stepped mode
```

I should clearly see the difference.

Do not artificially reduce Phaser rendering FPS.

# 14. Event demo

Add visible/logged animation events.

For example, during walk:

```text
LEFT FOOTSTEP
RIGHT FOOTSTEP
```

Show the last triggered animation event in the demo UI.

For a sword animation, add something like:

```text
draw-start
weapon-ready
```

No sound is necessary yet.

# 15. Crossfade demo

Make sure this is easy to test.

For example:

```text
idle
↓
press key
↓
300 ms blend
↓
walk
```

There should be no obvious pose snapping.

Test transitions in both directions.

# 16. Interaction with IK

This is critical.

Animation blending and layers must happen BEFORE IK.

Example:

```text
walk base animation
+
upper-body sword pose
+
crossfade
        ↓
combined authored pose
        ↓
left-hand katana IK
        ↓
final pose
```

The IK system should not be rewritten.

Integrate cleanly with it.

# 17. Event behavior during crossfade

Choose and document a deterministic rule.

Preferred behavior:

Events should fire from the target/current active timeline that is actually progressing.

Do NOT fire duplicate events simply because both source and target clips are being evaluated during blending.

Keep behavior simple and predictable.

# 18. Tests

Add or extend unit tests.

Test at least:

## Blending

- 0% returns source pose
- 100% returns target pose
- 50% gives correct midpoint
- rotation shortest-path interpolation works

## Stepped playback

- 10 FPS correctly quantizes animation time
- same pose is maintained between steps
- smooth mode still interpolates normally

## Events

- event fires once when crossing its timestamp
- looped event fires once per loop
- event is not duplicated during crossfade
- events work when playback speed != 1

## Completion

- non-looping animation completes once
- looping animation never sends completion as a normal clip completion

## Pause

- timeline does not progress when paused

## Layers

- masked bones are affected
- unmasked bones preserve base pose
- layer weight 0 changes nothing
- layer weight 1 fully applies the layer

Use pure functions where practical so tests do not require Phaser rendering.

# 19. Performance

Avoid excessive object creation every render frame if practical.

However, prioritize correctness and clean architecture over premature optimization.

Do not implement object pools unless actually necessary.

# 20. README updates

Update README with:

1. animation blending
2. how crossfading works
3. animation events
4. completion events
5. stepped animation mode
6. difference between render FPS and animation FPS
7. playback speed
8. pause/resume
9. animation layers
10. bone masks
11. interaction between animation and IK
12. demo controls

Include TypeScript examples.

## Example API documentation

Something like:

```ts
puppet.play("walk", {
  fadeDuration: 250,
  speed: 1,
});
```

```ts
puppet.setAnimationPlaybackMode({
  mode: "stepped",
  fps: 10,
});
```

```ts
puppet.onAnimationEvent((event) => {
  if (event.name === "footstep") {
    // trigger sound later
  }
});
```

```ts
puppet.setLayerMask("upperBody", [
  "torso",
  "head",
  "leftUpperArm",
  "leftForearm",
  "leftHand",
  "rightUpperArm",
  "rightForearm",
  "rightHand",
]);

puppet.play("combatUpperBody", {
  layer: "upperBody",
});
```

# 21. Do NOT implement yet

Do NOT add:

- visual animation editor
- visual rig editor
- animator state machine
- blend trees
- animation graph
- arbitrary IK chains
- FABRIK
- CCD
- cloth simulation
- ragdolls
- physics
- procedural locomotion
- full audio system
- particles
- serialization editor
- network synchronization

Keep v0.3 focused on making animation playback production-ready.

# Implementation order

Work incrementally.

Recommended order:

1. inspect current AnimationPlayer architecture
2. introduce pose representation if useful
3. implement pose blending
4. add crossfade transitions
5. add stepped playback
6. add playback speed
7. add pause/resume
8. add animation events
9. add completion events
10. add simple animation layers
11. add bone masks
12. ensure IK still executes after animation evaluation
13. update demo
14. add tests
15. update README
16. run all checks

## Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all errors.

Manually verify:

- idle -> walk blends smoothly
- walk -> idle blends smoothly
- stepped 8–12 FPS mode visibly looks different from smooth mode
- Phaser still renders normally
- footstep events fire correctly
- pause/resume works
- playback speed works
- upper-body layer can play while legs continue walking
- layer masks work
- two-handed katana IK still works
- foot IK still works
- facing left/right still works
- no existing v0.1/v0.2 functionality regresses

## v0.3 success criteria

The version is successful when I can:

1. play idle
2. crossfade into walk
3. switch between smooth and 8–12 FPS stepped animation
4. receive footstep timeline events
5. pause/resume animation
6. change animation speed
7. play a walk animation on the base layer
8. overlay an upper-body sword stance
9. keep the katana hand constraint working through IK
10. visually see a deliberate paper-puppet / stop-motion animation feel

At the end, report:

- files added
- files changed
- public API additions
- animation evaluation/update order
- how blending is implemented
- how stepped playback works
- how animation events work
- how layers and bone masks work
- compatibility notes
- known limitations
- what the logical v0.4 milestone should be
