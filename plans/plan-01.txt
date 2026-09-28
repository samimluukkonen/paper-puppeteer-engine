Create a new standalone TypeScript project called `paper-puppeteer-engine`.

The goal is to build a reusable 2D paper-puppet / cutout skeletal animation engine on top of Phaser. This engine will later be used as a dependency in another project called Mukashi Monogatari.

The visual concept is similar to a traditional paper puppet: a character is composed from separate transparent image pieces such as head, torso, upper arms, forearms, hands, thighs, lower legs, feet, weapons, clothing pieces, etc. These pieces are connected through hierarchical joints/bones and animated by rotating, translating and scaling those joints.

Do NOT build anything specific to Mukashi Monogatari, samurai, Yagyū, or any particular character. The engine must remain generic and reusable.

## Technology

Use:

- TypeScript
- Phaser
- Vite
- npm
- strict TypeScript configuration
- ES modules

Do not use React.

The project should be runnable with:

```bash
npm install
npm run dev
```

Also provide:

```bash
npm run build
npm run typecheck
```

Use a clean architecture and avoid unnecessary dependencies.

## Main goal for v0.1

I want one demo character made from simple temporary graphical body parts or placeholder PNG assets.

The character should have:

- root
- torso
- head
- left upper arm
- left forearm
- left hand
- right upper arm
- right forearm
- right hand
- pelvis
- left thigh
- left lower leg
- left foot
- right thigh
- right lower leg
- right foot

The important thing is NOT artwork quality.

The important thing is proving that the skeletal hierarchy, pivot points, transformations and animation system work correctly.

## Architecture

Create a reusable engine library under something similar to:

```text
src/
  engine/
    Puppet.ts
    Rig.ts
    Bone.ts
    Joint.ts
    AnimationClip.ts
    AnimationPlayer.ts
    types.ts

  demo/
    DemoScene.ts
    demoRig.ts
    demoAnimations.ts

  main.ts
```

You can adjust the exact structure if there is a strong architectural reason.

The engine code should not depend on DemoScene.

## Puppet hierarchy

A puppet should consist of hierarchical nodes.

For example:

```text
root
└── pelvis
    ├── torso
    │   ├── head
    │   ├── leftUpperArm
    │   │   └── leftForearm
    │   │       └── leftHand
    │   └── rightUpperArm
    │       └── rightForearm
    │           └── rightHand
    │
    ├── leftThigh
    │   └── leftLowerLeg
    │       └── leftFoot
    │
    └── rightThigh
        └── rightLowerLeg
            └── rightFoot
```

Use Phaser containers or another appropriate Phaser-native mechanism for hierarchical transforms.

If a shoulder rotates:

```text
shoulder
  ↓
upper arm moves
  ↓
elbow moves
  ↓
forearm moves
  ↓
hand moves
```

The child hierarchy must follow the parent automatically.

## Rig definitions

Do NOT hardcode the rig structure inside the Puppet class.

A rig must be described using TypeScript data.

For example, conceptually:

```ts
const demoRig = {
  root: "root",

  bones: {
    root: {},

    pelvis: {
      parent: "root",
      x: 0,
      y: 0,
    },

    torso: {
      parent: "pelvis",
      x: 0,
      y: -50,
    },

    head: {
      parent: "torso",
      x: 0,
      y: -70,
    },

    leftUpperArm: {
      parent: "torso",
      x: -30,
      y: -45,
    },

    leftForearm: {
      parent: "leftUpperArm",
      x: 0,
      y: 50,
    },
  },
};
```

Please create proper TypeScript interfaces/types for this instead of using loose objects.

A bone definition should be able to contain at least:

- name/id
- parent
- x
- y
- rotation
- scaleX
- scaleY
- sprite/texture information
- sprite offset
- pivot/origin information
- optional render depth/order

The system should make it possible later to load this information from JSON.

Do not implement JSON loading yet unless it is trivial, but design the types so that JSON serialization will be easy later.

## Pivot points

Correct pivot points are extremely important.

For example:

- upper arm rotates around the shoulder
- forearm rotates around the elbow
- hand rotates around the wrist
- thigh rotates around the hip
- lower leg rotates around the knee
- foot rotates around the ankle
- head rotates around the neck

Make pivot/origin positioning configurable per body part.

Do not assume every image rotates around its center.

## Puppet API

Aim for an API approximately like this:

```ts
const puppet = new Puppet(scene, {
  x: 500,
  y: 500,
  rig: demoRig,
});

puppet.play("idle");
```

And later:

```ts
puppet.play("walk");
puppet.play("attack");
```

It should also be possible to access a bone:

```ts
puppet.getBone("leftForearm");
```

and perhaps:

```ts
puppet.setBoneRotation("head", 0.1);
```

Use radians internally if that fits Phaser best.

## Animation system

Create a simple reusable keyframe animation system.

Animations should NOT be hardcoded into Puppet.

Something conceptually like:

```ts
const idle: AnimationClip = {
  name: "idle",
  duration: 1800,
  loop: true,

  tracks: {
    torso: [
      { time: 0, rotation: -0.01 },
      { time: 900, rotation: 0.01 },
      { time: 1800, rotation: -0.01 },
    ],

    head: [
      { time: 0, rotation: 0.02 },
      { time: 900, rotation: -0.02 },
      { time: 1800, rotation: 0.02 },
    ],
  },
};
```

Support keyframing at least:

- rotation
- x
- y
- scaleX
- scaleY

Implement interpolation between keyframes.

Linear interpolation is enough for v0.1.

Design the system so other easing/interpolation types could be added later.

## Required demo animations

Create at least:

### Idle

A subtle paper-puppet idle animation:

- slight torso movement
- subtle head movement
- small arm motion

It should look intentionally like a puppet rather than realistic skeletal deformation.

### Walk

Create a simple looping walk cycle.

At minimum animate:

- left/right thighs in opposite directions
- lower legs
- arms swinging opposite to legs
- slight torso movement
- small head movement

It does not need to be physically perfect.

The purpose is to demonstrate that the hierarchical animation system works.

## Animation player

Create an `AnimationPlayer` abstraction.

It should handle:

- current animation
- elapsed time
- looping
- stopping
- restarting
- changing animations

Desired API:

```ts
puppet.play("idle");
puppet.play("walk");
puppet.stop();
```

Register animations separately from the rig.

For example:

```ts
puppet.addAnimation(idle);
puppet.addAnimation(walk);
```

or pass animation clips when creating the puppet if that results in a cleaner design.

## Character facing direction

Add support for facing:

```ts
puppet.setFacing("left");
puppet.setFacing("right");
```

Flipping the whole puppet must NOT break joint hierarchy or animation rotations.

Think carefully about how mirroring affects the skeleton.

For v0.1 a simple horizontal flip of the root/container is acceptable if it works correctly.

## Attachments

Design a simple attachment system.

For example, later I want:

```text
rightHand
└── katana
```

or:

```text
hip
└── scabbard
```

For v0.1 demonstrate this with one simple prop.

For example:

```ts
puppet.attach("rightHand", prop);
```

The prop must follow the parent bone.

Also support detaching it.

## Debug mode

This is important.

Create a debug mode that can visually display:

- joint positions
- bone hierarchy
- pivot points
- lines between parent and child joints
- bone names if practical

For example:

```ts
puppet.setDebug(true);
```

This will make developing rigs much easier.

## Demo controls

Create a simple demo scene.

Display one puppet in the center.

Allow keyboard controls such as:

```text
1 = idle
2 = walk

A = face left
D = face right

B = toggle bone/joint debug visualization
```

Also display a small text overlay showing:

```text
Paper Puppeteer Engine

1 - Idle
2 - Walk
A/D - Facing
B - Debug bones

Current animation: idle
```

## Important design constraints

Do NOT try to recreate Spine2D.

Do NOT implement these yet:

- full IK
- mesh deformation
- weighted skinning
- physics
- ragdolls
- animation editor
- visual timeline
- complicated constraints
- cloth simulation

However, structure the engine so we can add these later.

Especially keep future IK in mind.

In the future I want to be able to say something like:

```ts
handIK.target = swordHandle;
```

and have shoulder/elbow rotations calculated automatically.

Similarly:

```ts
footIK.target = groundPoint;
```

could keep a foot planted on the ground.

Do NOT implement IK in v0.1 unless there is an extremely simple reason to do so.

## Paper-puppet philosophy

This engine is specifically intended for a stylized paper-puppet look.

Do not assume we want smooth realistic deformation.

The desired aesthetic is:

- rigid cutout body pieces
- visible rotational joints
- intentionally limited movement
- slightly theatrical movement
- potentially low animation frame rates
- puppet-like movement rather than realistic skeletal deformation

Eventually we may support stepped animation where poses change at approximately 8–12 FPS even though Phaser renders at a higher frame rate.

Keep this possibility in mind when designing AnimationPlayer.

## Library separation

The final goal is to use this repository as a dependency in another TypeScript Phaser project.

Therefore:

- keep engine code separate from demo code
- don't import demo assets from engine classes
- don't put game-specific logic in the engine
- export public engine APIs cleanly
- create an `index.ts` public entry point

For example:

```ts
export { Puppet } from "./Puppet";
export type { RigDefinition } from "./types";
export type { AnimationClip } from "./AnimationClip";
```

I eventually want another project to be able to do something like:

```ts
import {
  Puppet,
  type RigDefinition,
  type AnimationClip,
} from "paper-puppeteer-engine";
```

Do not publish anything to npm yet.

Just make the project structurally capable of becoming an npm/local package later.

## Code quality

Use:

- strict TypeScript
- descriptive names
- small focused classes/modules
- explicit types
- no `any` unless absolutely unavoidable
- minimal comments explaining architectural decisions
- avoid overengineering

Prefer composition over giant classes.

Don't create abstractions unless they actually make the current system easier to maintain.

## Documentation

Create a README containing:

1. Purpose of the project
2. Installation
3. How to run the demo
4. Architecture overview
5. How a puppet rig works
6. How to define a new rig
7. How to define an animation
8. How to attach an object to a bone
9. Current limitations
10. Planned future features

Planned future features should include:

- two-bone IK
- constraints
- animation blending
- stepped / low-FPS animation mode
- events in animation timelines
- multiple skins
- sprite swapping
- runtime weapon swapping
- visual rig editor
- visual animation editor
- JSON rig/animation loading

## Implementation process

Work incrementally.

First:

1. scaffold the TypeScript + Phaser + Vite project
2. get an empty Phaser demo scene running
3. implement the hierarchy/bone system
4. create the test puppet
5. verify rotations and pivots
6. implement AnimationClip and AnimationPlayer
7. implement idle
8. implement walk
9. implement facing direction
10. implement attachments
11. implement debug visualization
12. clean up architecture
13. write README
14. run TypeScript checks and build

After implementation, verify:

```bash
npm run typecheck
npm run build
```

Fix all TypeScript/build errors.

Do not stop after simply generating scaffolding. Implement a working v0.1 demo.

At the end, give me:

- a brief architecture summary
- important files created
- how to start the demo
- keyboard controls
- what should be implemented next

The most important success criterion is:

**I should be able to run the project, see a segmented paper-puppet character, press a key to switch between idle and walking, and visually verify that parent-child joints and pivots work correctly.**
