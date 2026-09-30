# Paper Puppeteer Engine

A reusable TypeScript + Phaser engine for 2D paper puppets: rigid transparent cutouts connected by hierarchical joints, animated through local keyframed transforms. v0.3 adds crossfades, timeline events, stepped playback, and masked animation layers to the existing two-bone IK and katana demo.

## Install and run

Requires Node.js **20.19+ or 22.12+** (Node 24 recommended) and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The demo starts in idle. The control panel also supports clicking/tapping.

| Key | Action |
| --- | --- |
| `1` | Play / restart idle |
| `2` | Play / restart walk |
| `3` | Two-handed katana stance; enables hand IK |
| `4` / `5` | Crossfade to idle / walk over 300 ms |
| `S` | Toggle smooth / stepped playback |
| `8` / `0` | Set stepped playback to 8 / 10 FPS |
| `L` | Toggle the masked upper-body sword layer |
| `P` | Pause / resume animation clocks |
| `[` / `]` | Decrease / increase playback speed by 0.25× |
| `A` / `D` | Face left / right |
| `B` | Toggle joint pivots, hierarchy lines, and bone names |
| `I` | Toggle IK targets, joints, chain lines, lengths, bend signs and names |
| `H` | Toggle mouse-controlled right-hand IK |
| `F` | Toggle fixed world-space foot targets and gentle body sway |
| Mouse | Move the hand target while hand IK is enabled |
| `Q` / `E` | Rotate the katana; the right-facing two-handed rear palm stays visible beside the body |
| `T` | Detach / reattach the katana to the right hand |
| `Space` | Stop at the current pose / restart |
| `R` | Restart the current clip |

To compare playback styles, press `2`, then `S` and `8`. The walk pose updates eight times per second while Phaser continues rendering and IK still solves every frame. Press `S` again for smooth motion. Press `4` and `5` to compare crossfades in both directions. Press `L` during walking to keep the legs walking under a sword-ready upper body. The status panel shows the current event, transition progress, playback speed and layer state.

To verify the hierarchy, press `2`, then `B`: elbow, wrist, and hand follow the upper arm; knee, ankle, and foot follow the thigh. Press `A` and `D` to see the entire skeleton mirror while the labels stay readable. Press `Space` to freeze a pose. `T` demonstrates attachment ownership.

Press `H` and move the mouse over the stage to aim the right wrist. Press `I` to inspect the chain and residual line to an unreachable target. Press `F` to plant both ankle pivots as the body sways; during walking, the feet alternate between a grounded stance and a lifted return step. Press `3`, then rotate with `Q` / `E`: the left wrist follows the second katana grip. Switching to idle or walk disables hand IK; foot IK has its own toggle. Turn off `F` to inspect the original authored gait.

The two-handed katana stance reuses idle's pelvis bob, leg rotations, and facing-dependent hip positions. This keeps the lower-body pose the same when switching between idle and the stance. If foot IK is enabled, it still adjusts the legs toward the fixed ground targets.

Each limb has a consistent color across all its pieces: left arm blue, right arm purple, left leg coral, and right leg gold. The legend beside the stage identifies them; it moves below the stage on narrower screens.

The walk is authored facing right: thighs swing forward and backward, knees stay fairly straight through stance and flex for the shorter return swing, and the legs alternate half a cycle apart. A smaller pelvis rise and gentler foot lift keep the knees from folding too deeply. Walking uses the same thigh attachment points on the pelvis as idle for each facing direction. Mirroring the root reverses the whole gait for left-facing playback. Right-facing idle tilts the right arm slightly toward screen-left and the left arm slightly toward screen-right.

During walking and idle, the whole left arm draws behind the body when facing right, and the whole right arm draws behind the body when facing left; the other arm draws in front of the body. The near leg draws in front of the pelvis and the far leg: the right leg when facing right, and the left leg when facing left. During walking and idle in both directions, the left arm attaches to the screen's right-side shoulder and the right arm to the left-side shoulder. Both animations swap hip positions when facing right and keep the default hip positions when facing left. The right elbow bends inward in idle and has a stronger bend during walking; both bends mirror with facing. Props follow their hand's draw slot.

```bash
npm run typecheck
npm test
npm run check
npm run build
npm run preview
```

`check` runs Biome's formatting, lint, and import checks; `npm run check:fix` applies safe fixes. `build` verifies TypeScript and produces **both** the demo in `dist/demo` and the reusable ES module plus declarations in `dist/library`. `preview` serves the production demo. Vitest tests cover rig validation, animation, pure IK math, coordinate adapters, lengths, mix, and pose restoration without requiring a browser; `npm run test:watch` runs them interactively.

Direct dependencies use exact versions: Biome **2.5.14**, Phaser **4.2.1**, Vite **8.3.1**, TypeScript **7.0.2**, and Vitest **5.0.2**. `package-lock.json` locks the resolved dependency graph.

## Architecture

```text
src/engine/
  types.ts             JSON-friendly rig and transform definitions
  Rig.ts               Validation, immutable rig snapshot, parent-first ordering
  Joint.ts             Renderer-independent bind pose and mutable local pose
  Bone.ts              Joint backed by a Phaser container and optional image
  AnimationClip.ts      Keyframe types, validation and property-track compilation
  AnimationPlayer.ts    Layer clocks, transitions, events and completion
  AnimationPose.ts      Pure clip evaluation and pose blending
  Puppet.ts            Hierarchy, playback API, facing, attachments and lifecycle
  PuppetDebug.ts       Scene-space joint, pivot and hierarchy overlay
  PuppetRenderer.ts    Independent draw slots retaining ancestor transform chains
  ik/
    types.ts           Targets, constraint definitions and coordinate adapter
    solveTwoBoneIK.ts  Pure law-of-cosines solver and angular blending
    TwoBoneIKConstraint.ts  Chain validation, effective lengths and pose solving
    IKPoseState.ts     Pre-IK rotation restoration between passes
    IKDebug.ts         Independent world-space IK overlay
  index.ts             Public library entry point
src/demo/
  DemoScene.ts         Example scene, controls and prop
  demoRig.ts           Generic 16-joint character
  demoAnimations.ts    Idle and walk data
  demoPresentation.ts  Walking arm order and walking/idle shoulder placement by facing
  createTextures.ts    Temporary transparent cutout textures
  demoIK.ts            Arm/leg chains with explicit execution priorities
  Katana.ts            Placeholder weapon transform and two data-defined grips
src/main.ts            Demo bootstrap and control panel
```

The engine does not import demo code or assets. `Rig`, `Joint`, `AnimationPlayer`, the IK solver, and `TwoBoneIKConstraint` do not depend on Phaser. Bone containers provide the joint hierarchy; each image and its attachments have an independent draw slot with a copy of their ancestor transform chain. This permits global drawing order while preserving rotation, scaling, and shear. `syncPose()` applies the evaluated pose, executes IK, then synchronizes rendering and debug overlays. The puppet's outer container provides placement, scale, and facing independently of animation tracks. The demo uses one texture per WebGL batch for reliable rendering on software WebGL; hosts control their own Phaser renderer settings.

## Define a rig

Definitions are plain serializable data. Bone IDs must be unique. There is exactly one root; every other bone needs a valid parent. Bones may appear in any order; cycles and invalid transforms are rejected.

```ts
import { Puppet, type RigDefinition } from 'paper-puppeteer-engine';

const rig: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root' },
    {
      id: 'upperArm', parent: 'root', x: 0, y: -50,
      sprite: { texture: 'upper-arm', originX: 0.5, originY: 0.1 },
    },
    {
      id: 'forearm', parent: 'upperArm', x: 0, y: 60,
      sprite: { texture: 'forearm', originX: 0.5, originY: 0.15 },
    },
    { id: 'hand', parent: 'forearm', y: 45, sprite: { texture: 'hand', originY: 0.2 } },
  ],
};

// Load these texture keys through your Phaser scene before constructing the puppet.
const puppet = new Puppet(scene, { x: 400, y: 300, rig });
puppet.setDebug(true);
```

`x`, `y`, `rotation`, `scaleX`, and `scaleY` define a bone's **local bind pose** relative to its parent. Positions use pixels, rotations use **radians** (positive clockwise in Phaser's downward Y axis), and scales default to 1. Each container's `(0, 0)` is its joint/pivot. Rotating an upper arm therefore carries the elbow, forearm, and hand automatically.

`sprite.originX` / `originY` are normalized image origins in `[0, 1]`; put them at the shoulder/elbow/etc. within the texture, rather than assuming the center. `sprite.x` / `y` offset the image relative to the joint, and `sprite.scaleX` / `scaleY` scale only the image. Bone scale affects descendants too. `sprite.frame` selects an atlas/spritesheet frame. Transparent images are supported directly.

IK normally measures the current joint-to-child offsets, including effective chain scale. Optional `length` overrides the logical bind distance to each direct child. `Rig` normalizes the child's `x`/`y` to that length while keeping its direction; a child with no offset defaults to positive Y. For example, an upper arm with `length: 52` places its elbow 52 logical pixels from its shoulder, regardless of image height. Images keep their original dimensions. Position animation can subsequently change that distance, and IK measures the evaluated offsets. Lengths must be finite and nonnegative.

`depth` orders subtrees among siblings for the default drawing order; `sprite.depth` determines where the parent's image appears relative to its children. The engine derives a global back-to-front order from these defaults. To interleave unrelated branches, pass every bone ID exactly once to `puppet.setRenderOrder(ids)`. `puppet.getRenderOrder()` returns the current order; `puppet.resetRenderOrder()` restores the rig default. Bones without images still have a draw slot for attachments. The skeleton's parenting stays unchanged when the order changes.

Debug crosses and outlined circles mark joint pivots; orange dots mark sprite origins (which may differ if the image has an offset). Lines connect parents and children. Names remain upright when mirrored.

Use `puppet.setDebugLabelSide('boneId', 'left')` or `'right'` to choose the screen side of a pivot label. Omit the side to restore automatic placement. In the demo's idle pose, the near knee label faces outward: right lower leg to the left when facing right, and left lower leg to the right when facing left. The left foot label stays to the right in right-facing idle, and the right foot label stays to the left in left-facing idle.

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
puppet.restart(); // Restart the selected clip at time zero.
puppet.setFacing('left');
puppet.setFacing('right');
```

Key times and durations are **milliseconds**. Values are **absolute local transforms**, not deltas from the bind pose. All five transform properties support interpolation, independently across sparse keys. Rotations take the shortest angular path in radians. Each property's first/last value is held outside its key range; a single key holds a constant value. Key times must increase strictly and stay within the duration. Missing properties/bones use the bind pose on the base layer and the underlying pose on an overlay. Playing the same name restarts it unless `restart: false` is passed. Duplicate clip names and unknown bones/animations throw descriptive errors.

Looping wraps the clock at the duration; use matching start/end poses for a seamless cycle. Nonlooping clips stop at their exact final pose. Shortest-path rotation interpolation is intended for joint poses, not authored full-turn spins.

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

Stepped playback quantizes pose sample time to `floor(time / (1000 / fps)) * (1000 / fps)`. It also quantizes crossfade weights. At 10 FPS, one authored pose is held for 100 ms across normal Phaser render frames. Clip-specific `playback: { mode: 'stepped', fps: 12 }` or `{ mode: 'smooth' }` overrides the puppet default. The animation clock, event crossings and IK still update at normal frame rate. A nonlooping clip shows its exact final pose at completion.

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

An active track overwrites manual changes to its property on the next update. With `autoUpdate: false`, advanced hosts call `puppet.preparePose()` to restore the previous pre-IK pose, then `puppet.animationPlayer.update(delta)`, modify joint poses, and call `puppet.syncPose()` to evaluate constraints. `animationPlayer.applyCurrentPose()` reapplies the current stepped/blended/layered pose before external adjustments; `sample(time)` remains available to sample the base clip at an explicit smooth time without changing its clock. `puppet.resetPose()` stops playback and restores all bind transforms; enabled IK is then evaluated on that pose.

## Two-bone inverse kinematics

Forward animation specifies joint rotations to place a hand or foot. **Inverse kinematics (IK)** starts with a desired endpoint and calculates those rotations. A two-bone chain contains a root joint (shoulder/hip), middle joint (elbow/knee), and end joint (wrist/ankle).

The pure `solveTwoBoneIK` function uses the law of cosines to solve a triangle from two segment lengths and the root-to-target distance. It clamps that distance to the chain's inner and outer reach boundaries and clamps cosine arguments to `[-1, 1]`. Far targets fully extend the chain; close targets fully fold it. No images stretch. Zero-length segments and a target at the root have deterministic finite solutions. Invalid nonfinite input is rejected.

```ts
import { Puppet, type TwoBoneIKDefinition } from 'paper-puppeteer-engine';

const rightArmIK: TwoBoneIKDefinition = {
  name: 'rightArmIK',
  rootBone: 'rightUpperArm', middleBone: 'rightForearm', endBone: 'rightHand',
  bendDirection: -1, mix: 1, priority: 0,
};
const puppet = new Puppet(scene, { rig, ik: [rightArmIK], ikDebug: true });
puppet.setIKTarget('rightArmIK', { x: 500, y: 300 });
puppet.setIKTarget('rightArmIK', 500, 300); // Equivalent overload.

const arm = puppet.getIK('rightArmIK');
arm.setTarget(450, 320);
arm.target = { x: 460, y: 330 };
arm.mix = 0.5;
arm.enabled = false;

// Constraints can also be registered after construction.
puppet.addIK({
  name: 'leftLegIK', rootBone: 'leftThigh', middleBone: 'leftLowerLeg', endBone: 'leftFoot',
  bendDirection: 1,
});
```

The three IDs must form a direct parent-child chain. Names must be unique. Definitions default to `bendDirection: 1`, `mix: 1`, `enabled: true`, and `priority: 0`. A constraint stays inactive until a target is supplied. Assigning `target = undefined` clears it. Targets are copied; assign a new point or use `setTarget` to move them. Changes take effect on the next update or an explicit `syncPose()`.

An optional `endOffset: { x, y }` moves the solved endpoint from the end bone's joint to a local point on that bone. The solver includes the end bone's rotation and scale when measuring the second effective link. With the default `{ x: 0, y: 0 }`, it still targets the joint itself. Use an offset such as `{ x: 0, y: 20 }` to place a hand's palm on a target while its wrist remains behind it.

`bendDirection: 1` selects a positive turn from the first segment to the second; `-1` selects the opposite turn. In Phaser's downward Y axis, positive rotation is clockwise. The sign is defined in rig space and mirrors with facing, so a knee keeps its intended bend when the entire character turns around. The solver does not choose an elbow side based on the previous frame or randomly change branches.

`mix: 0` leaves the evaluated animation rotations alone; `mix: 1` applies the solved rotations; intermediate values blend each local angle along the shortest angular path. Mix must be finite and in `[0, 1]`. Angle blending does not interpolate the endpoint linearly and does not guarantee exact target contact below full influence. Authored full turns are preserved through the nearest equivalent solved angle.

### World coordinates and execution order

Targets use Phaser **world coordinates**, independent of camera screen coordinates. The Puppet adapter inverts the full world matrix of the chain root's parent, then solves in that parent's coordinates. This removes puppet translation, facing, scale, root bone transforms, and rotated/scaled enclosing containers, including affine shear from their combined transforms. Local child offset directions are accounted for; segments need not point along +X or +Y. Sprite origins never supply skeleton lengths. Use `pointer.worldX` / `pointer.worldY` for the default camera; with other cameras, use `camera.getWorldPoint(pointer.x, pointer.y)`.

The normal `puppet.update(delta)` pass is:

1. Restore the previous pre-IK rotations.
2. Advance animation and evaluate local poses.
3. Synchronize skeleton and attachment render mounts.
4. Execute constraints by ascending priority, retaining insertion order for ties. Each constraint resolves its target immediately before solving; the skeleton and render mounts are refreshed after it.
5. Record solved rotations, then update both debug overlays and render the final pose.

IK modifies the evaluated pose, never animation keys or bind poses. Restoring before each pass prevents partial influence from accumulating on stopped animation or untracked bones. Disabling IK restores the authored pose on the next pass. `syncPose()` also restores the previous pass before resolving constraints; explicit changed pose rotations are retained. For externally scheduled animation, call `preparePose()` before sampling so the evaluation starts from the authored pose:

```ts
puppet.preparePose();
puppet.animationPlayer.update(delta);
// Apply any custom procedural pose edits here.
puppet.syncPose();
```

Constraint `status` reports `inactive`, `solved`, `clamped`, `singular-transform`, or `unsupported-scale`. `resolvedTarget`, `lengthA`, and `lengthB` expose the last solve's diagnostics. `puppet.setIKDebug(true)` controls the separate IK overlay; `setDebug(true)` still controls the existing bone overlay. Displayed lengths are in the chain parent's solve coordinates.

### Foot planting

In idle and sword stance, the demo's two leg constraints receive fixed world-space ground points. `F` enables them while the puppet's body sways horizontally and vertically. During walking, each ankle target follows the authored horizontal stride. IK limits how low the ankle can sink during contact, then fades out before toe-off so the authored heel rise and return swing remain visible. The legs alternate by half a cycle and mirror with facing. This is an in-place stepping demonstration without terrain detection or ground raycasts. Foot orientation remains authored; this version constrains endpoint position only.

```ts
puppet.setIKTarget('leftLegIK', { x: 360, y: 510 });
puppet.getIK('leftLegIK').enabled = true;
// Moving the puppet container now makes the leg solve toward the fixed point.
```

### Two-handed katana

`src/demo/Katana.ts` defines a weapon container with primary and secondary grip points in its own coordinates. Hand joints are at the wrists; the demo places each grip 15 local pixels down the corresponding hand, at the palm center. Facing changes remount the weapon on the front hand: the right hand holds the primary grip when facing right, and the left hand holds the secondary grip when facing left. The mount compensates for blade rotation so its grip stays on that palm. One-handed mouse targeting (`H`) moves the front arm and its attached katana.

In stance `3`, the front arm runs at priority 0 and follows the mouse target. Its solved hand transform carries the katana. The rear arm runs at priority 1 with an `endOffset` at the **palm**. A target provider reads its grip in world space after the demo aims the blade with `Q` / `E`. Rotating the katana therefore moves the rear grip, and that arm solves toward it in the same frame. Priorities switch when facing changes, so the left arm can fully extend when pointing left.

The demo uses bend direction `-1` for both elbows in the two-handed stance. Both hands follow their grip points without moving the shoulders.

In the two-handed stance, the blade can turn through a horizontal overhead pose. In either facing direction, the rear palm stays outside the head, torso, and pelvis cutouts. It travels around the head's top corners in bounded steps, so moving the mouse or rotating the sword cannot make the hands snap across the face. The demo checks the cutout edges at the palm's height and adjusts the front arm's hand target when either input would carry the rear palm behind the body. Both shoulders stay fixed and both palms stay on the hilt.

```ts
// Assume katana is attached at its primary grip and both arm chains are registered.
puppet.getIK('leftArmIK').setTargetProvider(() => {
  const point = katana.container.getWorldTransformMatrix()
    .transformPoint(katanaGrips.secondary.x, katanaGrips.secondary.y);
  return { x: point.x, y: point.y };
});
```

Use lower priority for the primary arm and higher priority for the secondary arm. Providers may return `undefined` to skip a pass. `setTarget` or assigning `target` replaces a provider; `setTargetProvider(undefined)` restores use of the stored fixed target. Register dependent constraints in one direction; dependency graphs and cycle detection are outside this iteration. If either grip is beyond an arm's reach, that arm clamps and the debug residual line shows the gap.

## Attach an object

Any Phaser GameObject from the same scene can be mounted under a bone. A mount container supplies offset/rotation without overwriting the object's transform.

```ts
const prop = scene.add.image(0, 0, 'flag').setOrigin(0.1, 0.8);
puppet.attach('hand', prop, { x: 4, y: 8, rotation: 0.1, depth: 1 });
puppet.detach(prop);
```

Attached props inherit all ancestor transforms and facing, and draw in their bone's global slot. Attachment `depth` sorts relative to that bone's image and other props. `detach` returns `true` when it releases a registered prop back to the scene display list; the object survives with its original local transform. It does **not** preserve world coordinates automatically. Reattaching moves the object to the new mount. Attached objects are destroyed with the puppet; detach anything you want to keep before `puppet.destroy()`. The puppet removes its update hooks and debug objects on scene shutdown or destruction.

## Use as a local package

Build this repository first, then in another Phaser TypeScript project:

```bash
npm install /absolute/path/to/paper-puppeteer-engine
```

```ts
import { Puppet, type RigDefinition, type AnimationClip } from 'paper-puppeteer-engine';
```

The library includes TypeScript declarations and source maps. Phaser is externalized and declared as an exact peer dependency so the consumer provides the same Phaser runtime. No package has been published. Engine rendering APIs are browser-based and should be imported in a browser environment.

## Current limitations

- Rigid pieces only: no mesh deformation, weighted skinning, physics, ragdolls, or cloth.
- One clip per layer with simple masked overlays; no animation graph, blend tree, editor or automatic state machine.
- Only direct two-link chains and endpoint positions: no joint limits, end-effector rotation constraints, arbitrary-length chains, or terrain-aware locomotion. Foot planting is manual; the walk remains in place.
- The rotating chain root must have uniform scale magnitudes (`abs(scaleX) === abs(scaleY)`); its signs may differ. Nonuniform scale inside that joint is skipped with `unsupported-scale`. Arbitrary nonsingular ancestor transforms and middle-joint scale are supported. Zero/singular transforms skip solving safely.
- Two-handed gripping adjusts the primary arm target when the second grip leaves the opposite arm's reach. The katana is a demo prop, not a combat system.
- Debug name labels can overlap on dense rigs. Independent draw slots duplicate ancestor containers, so very large rigs require profiling.
- No rig editor, animation editor, or JSON loader. Rig/clip/IK definitions are already JSON-friendly.

## Planned features

- Joint angle limits and optional end-effector rotation alignment.
- More advanced animation state orchestration and editor tooling.
- Multiple skins, sprite swapping, and runtime weapon swapping through attachments.
- Visual rig and animation editors.
- JSON rig and animation loading.

The next useful milestone is joint limits and palm/foot orientation constraints, plus attachment or facial sprite swapping driven by the new event API.
