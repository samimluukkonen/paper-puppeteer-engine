# Paper Puppeteer Engine

A reusable TypeScript + Phaser engine for 2D paper puppets: rigid transparent cutouts connected by hierarchical joints, animated through local keyframed transforms. The v0.1 demo uses generated placeholder textures to make shoulders, elbows, wrists, hips, knees, ankles, and the neck easy to inspect.

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
| `A` / `D` | Face left / right |
| `B` | Toggle joint pivots, hierarchy lines, and bone names |
| `P` | Detach / reattach the flag to the right hand |
| `Space` | Stop at the current pose / restart |
| `R` | Restart the current clip |

To verify the hierarchy, press `2`, then `B`: elbow, wrist, and hand follow the upper arm; knee, ankle, and foot follow the thigh. Press `A` and `D` to see the entire skeleton mirror while the labels stay readable. Press `Space` to freeze a pose. `P` demonstrates attachment ownership.

Each limb has a consistent color across all its pieces: left arm blue, right arm purple, left leg coral, and right leg gold. The legend beside the stage identifies them; it moves below the stage on narrower screens.

The walk is authored facing right: thighs swing forward and backward, both knees fold backward during the return swing, and the legs alternate half a cycle apart. Walking uses the same thigh attachment points on the pelvis as idle for each facing direction. Mirroring the root reverses the whole gait for left-facing playback. Right-facing idle tilts the right arm slightly toward screen-left and the left arm slightly toward screen-right.

During walking and idle, the whole left arm draws behind the body when facing right, and the whole right arm draws behind the body when facing left; the other arm draws in front of the body. The near leg draws in front of the pelvis and the far leg: the right leg when facing right, and the left leg when facing left. During walking and idle in both directions, the left arm attaches to the screen's right-side shoulder and the right arm to the left-side shoulder. Both animations swap hip positions when facing right and keep the default hip positions when facing left. The right elbow bends inward in idle and has a stronger bend during walking; both bends mirror with facing. Props follow their hand's draw slot.

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

`build` verifies TypeScript and produces **both** the demo in `dist/demo` and the reusable ES module plus declarations in `dist/library`. `preview` serves the production demo. Vitest tests cover rig validation and animation behavior without requiring a browser; `npm run test:watch` runs them interactively.

Direct dependencies use exact versions: Phaser **4.2.1**, Vite **8.3.1**, TypeScript **7.0.2**, and Vitest **5.0.2**. `package-lock.json` locks the resolved dependency graph.

## Architecture

```text
src/engine/
  types.ts             JSON-friendly rig and transform definitions
  Rig.ts               Validation, immutable rig snapshot, parent-first ordering
  Joint.ts             Renderer-independent bind pose and mutable local pose
  Bone.ts              Joint backed by a Phaser container and optional image
  AnimationClip.ts      Keyframe types, validation and property-track compilation
  AnimationPlayer.ts    Playback clock and linear pose sampling
  Puppet.ts            Hierarchy, playback API, facing, attachments and lifecycle
  PuppetDebug.ts       Scene-space joint, pivot and hierarchy overlay
  PuppetRenderer.ts    Independent draw slots retaining ancestor transform chains
  index.ts             Public library entry point
src/demo/
  DemoScene.ts         Example scene, controls and prop
  demoRig.ts           Generic 16-joint character
  demoAnimations.ts    Idle and walk data
  demoPresentation.ts  Walking arm order and walking/idle shoulder placement by facing
  createTextures.ts    Temporary transparent cutout textures
src/main.ts            Demo bootstrap and control panel
```

The engine does not import demo code or assets. `Rig`, `Joint`, and `AnimationPlayer` do not depend on Phaser. Bone containers provide the joint hierarchy; each image and its attachments have an independent draw slot with a copy of their ancestor transform chain. This permits global drawing order while preserving rotation, scaling, and shear. `syncPose()` applies poses to the skeleton and rendering chains together. The puppet's outer container provides placement, scale, and facing independently of animation tracks. Future IK or constraints can operate on `Joint.pose` between animation sampling and display synchronization. The demo uses one texture per WebGL batch for reliable rendering on software WebGL; hosts control their own Phaser renderer settings.

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

Key times and durations are **milliseconds**. Values are **absolute local transforms**, not deltas from the bind pose. All five transform properties support linear interpolation, independently across sparse keys. Each property's first/last value is held outside its key range; a single key holds a constant value. Key times must increase strictly and stay within the duration. Missing properties/bones reset to their bind pose on `play`, preventing pose leakage when changing clips. Playing the same name restarts it. Duplicate clip names and unknown bones/animations throw descriptive errors.

Looping wraps the clock at the duration; use matching start/end poses for a seamless cycle. Nonlooping clips stop at their exact final pose. Rotations interpolate numerically, so authored angles can deliberately exceed a full turn; there is no implicit shortest-angle wrapping.

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

An active track overwrites manual changes to its property on the next update. With `autoUpdate: false`, advanced hosts can call `puppet.animationPlayer.update(delta)`, modify joint poses, then `puppet.syncPose()` to apply a constraint pass after sampling. `animationPlayer.sample(time)` samples the current clip without changing its playback clock. `puppet.resetPose()` stops playback and restores all bind transforms.

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
- One active clip, immediate switching, and linear interpolation; no blending, timeline events, or stepped playback yet.
- The walk is an in-place hierarchy demonstration; it does not move the character or keep feet physically planted.
- Debug name labels can overlap on dense rigs. Independent draw slots duplicate ancestor containers, so very large rigs require profiling.
- No IK, constraints, rig editor, animation editor, or JSON loader. Rig/clip data is JSON-friendly already.

## Planned features

- Two-bone IK and joint constraints.
- Animation blending, stepped / low-FPS animation (8–12 pose updates per second), and timeline events.
- Multiple skins, sprite swapping, and runtime weapon swapping through attachments.
- Visual rig and animation editors.
- JSON rig and animation loading.

The next useful addition is two-bone IK, with joint-space targets and optional limits, followed by stepped sampling for a more theatrical paper-puppet motion style.
