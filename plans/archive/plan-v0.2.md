Continue the existing `paper-puppeteer-engine` TypeScript + Phaser project.

Do NOT rewrite the project from scratch.

The current v0.1 already has:

- hierarchical puppet bones/joints
- configurable pivots
- a reusable `Puppet` API
- basic keyframe animation
- idle animation
- walk animation
- facing left/right
- attachments
- debug visualization
- a standalone Phaser demo

The goal of this iteration is to add a **small, clean inverse kinematics system**, specifically:

1. two-bone IK
2. foot planting
3. one-handed weapon targeting
4. two-handed katana grip support
5. debug visualization for IK

Do not add a visual editor yet.

## Main goal

I want to be able to tell the puppet:

```ts
leftHandIK.target = {
  x: 500,
  y: 300,
};
```

and have the engine automatically calculate the rotations for:

```text
upper arm
   ↓
forearm
   ↓
hand
```

so that the hand reaches the requested target.

The same system should work for legs:

```text
thigh
  ↓
lower leg
  ↓
foot
```

This is classic two-bone IK.

## Architecture

Add an IK system without coupling it tightly to the current animation system.

Prefer something conceptually like:

```text
src/
  engine/
    ik/
      TwoBoneIKConstraint.ts
      IKTarget.ts
      types.ts
```

Adjust naming if the existing architecture suggests something better.

Keep IK independent enough that future constraint types can be added later.

Possible future constraint types include:

- look-at constraint
- rotation constraint
- position constraint
- copy-transform constraint
- distance constraint
- weapon constraint

Do NOT implement all of those now.

## Two-bone IK

Implement a reusable two-bone IK solver.

The chain should conceptually be:

```text
root bone
   ↓
middle bone
   ↓
end effector
```

Example arm:

```text
leftUpperArm
   ↓
leftForearm
   ↓
leftHand
```

Example leg:

```text
leftThigh
   ↓
leftLowerLeg
   ↓
leftFoot
```

The solver should calculate the root and middle bone rotations needed for the end effector to reach a target point.

Use an analytical two-bone IK solution.

Do not use an iterative CCD/FABRIK solver for this version unless there is a strong technical reason.

## IK definition

I want constraints to be data-driven.

For example:

```ts
const leftArmIK: TwoBoneIKDefinition = {
  name: "leftArmIK",
  rootBone: "leftUpperArm",
  middleBone: "leftForearm",
  endBone: "leftHand",

  bendDirection: 1,

  mix: 1,
};
```

The target may be provided separately:

```ts
puppet.setIKTarget("leftArmIK", {
  x: 400,
  y: 300,
});
```

or:

```ts
const constraint = puppet.getIK("leftArmIK");

constraint.setTarget(400, 300);
```

Use whichever API best matches the current engine design.

## Bend direction

The IK solver must support elbow/knee bend direction.

For example:

```ts
bendDirection: 1
```

versus:

```ts
bendDirection: -1
```

This is important because arms and legs must be able to bend in the desired direction.

The bend direction should remain stable and not randomly flip when the target moves.

## Bone lengths

The IK solver must use actual effective bone lengths.

Do not rely on arbitrary constants.

Bone length should come from either:

- rig definition
- joint-to-child distance
- explicitly configured length

Choose a clean solution consistent with the current architecture.

It should be possible to define a bone length explicitly if the sprite dimensions do not match the logical skeleton length.

For example:

```ts
{
  id: "leftUpperArm",
  parent: "torso",
  x: -30,
  y: -45,
  length: 52,
}
```

## Reachability

Handle three cases correctly:

### Target is reachable

The chain should bend naturally toward the target.

### Target is too far away

The arm or leg should stretch toward the target as far as possible without producing invalid math or broken rotations.

Do NOT stretch the actual sprites yet.

The chain should simply become fully extended.

### Target is too close

The chain should fold as much as mathematically possible without producing NaN values or unstable flipping.

Clamp values where needed.

## Mix / IK strength

Support an IK influence value:

```ts
mix: 0
```

means animation controls the bones completely.

```ts
mix: 1
```

means IK controls them completely.

Values between 0 and 1 should blend between normal animation rotation and IK rotation.

For example:

```ts
mix: 0.5
```

This is important because later we may blend authored animation with procedural IK.

## Update order

Think carefully about update order.

The likely order should be approximately:

```text
1. animation system evaluates pose
2. local bone transforms are updated
3. IK constraints modify relevant bone rotations
4. final world transforms are resolved
5. rendering happens
```

Do not allow IK to permanently overwrite the original animation keyframe data.

IK should operate on the current evaluated pose.

Document the chosen update order.

## World and local coordinates

Targets may exist in Phaser world coordinates.

The solver must correctly convert target coordinates into the coordinate space required by the bone hierarchy.

For example:

```ts
puppet.setIKTarget("rightArmIK", worldX, worldY);
```

must still work if:

- puppet is moved
- puppet is scaled
- puppet is facing left
- parent containers are rotated
- puppet root is transformed

Be careful with local-to-world and world-to-local conversion.

## Facing / mirroring

Existing:

```ts
puppet.setFacing("left");
puppet.setFacing("right");
```

must continue to work.

IK must also work when the whole puppet is horizontally mirrored.

Do not assume that left/right facing has positive scale.

Test both directions.

## Foot planting demo

Add a simple demonstration of foot planting.

For example:

```text
left leg IK target = fixed ground point
right leg IK target = fixed ground point
```

The puppet body may move slightly up/down or horizontally while the feet remain planted.

The demo does not need automatic terrain detection yet.

For now use manually positioned ground targets.

Add controls such as:

```text
F = toggle foot IK
```

When enabled, the legs should adjust so the feet remain near their target markers.

## Hand target demo

Add a movable hand target.

For example:

```text
arrow keys = move right-hand IK target
```

or:

```text
mouse = right-hand IK target
```

Prefer mouse control if easy.

Display the target position visually.

The arm should follow it.

This must clearly demonstrate the two-bone IK system.

## Katana support

Add a simple katana prop to the demo.

The katana can still use placeholder graphics.

The weapon should have:

- a transform
- a handle position
- optionally a second grip position

Conceptually:

```text
katana
├── primaryGrip
└── secondaryGrip
```

Represent grip points as data.

For example:

```ts
interface WeaponGripDefinition {
  x: number;
  y: number;
}
```

## One-handed weapon grip

Implement a basic one-handed sword grip.

The katana should be attachable to the right hand.

The existing attachment system can be reused if appropriate.

When attached:

```text
right hand
   ↓
katana
```

The weapon should follow the hand.

## Two-handed katana constraint

Add a first version of two-handed weapon handling.

This does NOT need to be a general-purpose weapon system yet.

The goal is:

```text
right hand = primary grip
left hand = secondary grip
```

The right hand / weapon should define the primary placement.

Then the left arm should use IK to reach the secondary grip point on the katana.

Conceptually:

```text
right hand
   ↓
katana
      ↓
secondary grip target
      ↑
left hand IK
```

So if the sword rotates:

```text
katana rotates
      ↓
secondary grip moves
      ↓
left hand IK target moves
      ↓
left arm follows automatically
```

This is extremely important for the project because many characters will use two-handed Japanese swords.

## Two-handed pose demo

Create a simple combat stance.

For example:

```text
torso
  slight forward lean

right arm
  holds katana primary grip

left arm
  IK follows secondary grip

katana
  angled diagonally forward
```

The katana may be controlled with the mouse or keyboard.

For example:

```text
Q / E = rotate katana
```

As the weapon rotates, the left hand should stay attached to the secondary grip automatically.

The point of this demo is to prove that two-handed sword poses are possible.

## Constraint priority

Think about constraint execution order.

For example:

```text
animation
↓
right-arm pose / weapon attachment
↓
weapon world transform
↓
secondary grip location
↓
left-arm IK
```

Make this deterministic.

Do not create a circular dependency.

Document the order.

## Debug visualization

Expand the existing debug mode.

When IK debugging is enabled, display:

- IK target
- root joint
- middle joint
- end effector
- line from root to middle
- line from middle to end
- line from end to target
- bone lengths
- bend direction if practical
- name of the IK constraint

Different visual debug shapes are fine.

Avoid requiring debug rendering code inside the mathematical solver itself.

Keep solving and visualization separated.

## Demo controls

Extend the existing demo overlay.

Something like:

```text
Paper Puppeteer Engine — IK Demo

1 - Idle
2 - Walk
3 - Two-handed sword pose

A / D - Face left/right

B - Bone debug
I - IK debug
F - Toggle foot IK

Mouse - Move hand IK target

Q / E - Rotate katana
```

Use whatever exact controls fit the implementation cleanly.

## Testing

Add unit tests for the mathematical IK solver if the project does not already have a test setup.

Tests should cover at least:

1. reachable target
2. fully extended target
3. target very close to root
4. opposite bend directions
5. no NaN/Infinity results
6. zero or nearly-zero length protection
7. mix = 0
8. mix = 1

Keep Phaser-specific rendering tests separate from pure IK math.

If adding a test framework is necessary, use something lightweight such as Vitest.

Do not add a heavy test stack.

## Numerical stability

Be careful with:

```ts
Math.acos()
```

Values passed into `acos` must be clamped between:

```ts
-1
```

and:

```ts
1
```

Avoid:

- NaN
- Infinity
- divide-by-zero
- unstable elbow flipping

Use small epsilon values where appropriate.

## Do not implement yet

Do NOT add:

- FABRIK
- CCD IK
- arbitrary-length chains
- mesh skinning
- cloth simulation
- physics
- ragdolls
- procedural locomotion
- automatic ground raycasting
- visual rig editor
- visual animation editor
- complex weapon combat system

Keep this iteration focused.

## README updates

Update the README with:

1. what IK means
2. how two-bone IK works
3. how to create an IK constraint
4. how bend direction works
5. how `mix` works
6. how world-space targets are converted
7. how foot planting works
8. how the two-handed katana demo works
9. current limitations

Include small TypeScript examples.

## Code quality

Continue the existing project conventions.

Use:

- strict TypeScript
- explicit types
- no unnecessary `any`
- small focused classes/modules
- pure functions for IK math where practical
- comments only where the math or transform logic needs explanation

Avoid tightly coupling the IK math to Phaser.

Ideally the actual two-bone solver can be expressed as a pure mathematical function and Phaser-specific code only handles transforms.

For example:

```ts
solveTwoBoneIK({
  root,
  target,
  lengthA,
  lengthB,
  bendDirection,
});
```

could return something like:

```ts
{
  rootRotation,
  middleRotation,
}
```

## Verification

After implementation:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all errors.

Then manually verify the demo.

The success criteria are:

- dragging/moving a hand target causes the two arm bones to follow it
- the elbow bends consistently
- unreachable targets do not break the rig
- foot IK can keep a foot planted
- facing left/right does not break IK
- the katana can be attached to one hand
- the opposite hand can follow the second grip using IK
- rotating the katana causes the secondary hand to follow the handle
- normal idle/walk animations still work when IK is disabled

Do not rewrite working v0.1 systems unless necessary.

Extend them carefully and preserve the existing public API where reasonable.

At the end, report:

- files added
- files changed
- public API additions
- how the IK solver works
- how two-handed weapon gripping is implemented
- known limitations
- what the next logical milestone should be
