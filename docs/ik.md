# Inverse kinematics and object attachments

[All guides](../README.md#guides)

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

The three IDs must form a direct parent-child chain. Names must be unique. Definitions default to `bendDirection: 1`, `mix: 1`, `enabled: true`, and `priority: 0`. A constraint stays inactive until a target is supplied. Assigning `target = undefined` clears it. Targets are copied; assign a new point or use `setTarget` to move them. Changes take effect on the next update.

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

IK modifies the evaluated pose, never animation keys or bind poses. Restoring before each pass prevents partial influence from accumulating on stopped animation or untracked bones. Disabling IK restores the authored pose on the next pass. Each pass also restores the previous pass before resolving constraints; explicit changed pose rotations are retained. `puppet.update(delta)` runs this pipeline after animation evaluation, and `setBoneRotation()` runs it immediately. To drive the pose from your own sampler, attach it as a pose source; the pipeline restores the authored pose, merges the source channels, then applies pose presets and IK:

```ts
const detach = puppet.attachPoseSource({ pose: sampledPose });
// Later, restore runtime playback:
detach();
```

Constraint `status` reports `inactive`, `solved`, `clamped`, `singular-transform`, or `unsupported-scale`. `resolvedTarget`, `lengthA`, and `lengthB` expose the last solve's diagnostics. `puppet.setIKDebug(true)` controls the separate IK overlay; `setDebug(true)` still controls the existing bone overlay. Displayed lengths are in the chain parent's solve coordinates.

### Foot planting

Hosts can implement foot contacts using world-space leg targets and influence. Blend constraint influence with the authored walk to preserve toe-off and the return swing. The solver constrains endpoint position; foot orientation remains authored.

```ts
puppet.setIKTarget('leftLegIK', { x: 360, y: 510 });
puppet.getIK('leftLegIK').enabled = true;
// Moving the puppet container now makes the leg solve toward the fixed point.
```

### Two-handed props

Attach a prop at its primary grip, then give the secondary arm a target provider that reads the secondary grip through the prop’s world transform. Use a palm `endOffset` when the hand joint is at the wrist. The host owns the prop, grip coordinates and any reach or clearance adjustments.

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

Use `puppet.attachToSlot('weaponHilt', prop)` to inherit a rig slot's transform and global depth instead. The prop and the slot's sprite can coexist; clearing or changing the sprite preserves the prop. The same attachment offsets and lifecycle apply, with `depth` sorting within that slot. `setSlotDepth` can move the entire slot behind another body part without changing the prop's bone assignment.

See the [IK animation data model](ik-animation-data.md) for optional target/mix tracks, puppet-local coordinates, stable rig constraint names, validation, and pure authoring APIs. See [runtime IK evaluation](ik-animation-runtime.md) for playback, scrubbing, precedence, and layer blending. See the [production IK authoring workflow](ik-animation-authoring.md) for visual and numeric target keys, reaching, influence, and supported timeline operations.
