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
puppet.animationPlayer.update(delta, () => puppet.preparePose());
puppet.preparePose(); // Also restore before manual edits while playback is paused or stopped.
// Apply any custom procedural pose edits here.
puppet.syncPose();
```

Hosts making several corrective IK passes in a frame can call `puppet.syncPose({ updateDebug: false })` once, change constraint targets/settings, and use `puppet.syncIK({ updateDebug: false })` for subsequent passes. `syncIK()` restores previous pre-IK rotations, retains active pose presets, and updates only restored/solved IK joints and their render copies. It does not advance animation or rebuild the authored pose. Call `syncPose()` again after changing authored poses, skeleton transforms, or skeleton visibility/alpha. Bone and attachment transforms remain synchronized for dependent target providers during every pass; call `puppet.refreshDebugViews()` after the final pass so overlays read the final pose without running another solve.

Constraint `status` reports `inactive`, `solved`, `clamped`, `singular-transform`, or `unsupported-scale`. `resolvedTarget`, `lengthA`, and `lengthB` expose the last solve's diagnostics. `puppet.setIKDebug(true)` controls the separate IK overlay; `setDebug(true)` still controls the existing bone overlay. Displayed lengths are in the chain parent's solve coordinates.

### Foot planting

`F` enables foot planting only while walking, when the puppet's body sways horizontally and vertically. Idle and sword stance keep their authored leg poses, leave leg IK disabled, and recenter the puppet. During walking, each ankle target follows the authored horizontal stride. IK limits how low the ankle can sink during contact, then fades out before toe-off so the authored heel rise and return swing remain visible. The legs alternate by half a cycle and mirror with facing. This is an in-place stepping demonstration without terrain detection or ground raycasts. Foot orientation remains authored; this version constrains endpoint position only.

```ts
puppet.setIKTarget('leftLegIK', { x: 360, y: 510 });
puppet.getIK('leftLegIK').enabled = true;
// Moving the puppet container now makes the leg solve toward the fixed point.
```

### Two-handed katana

`src/demo/Katana.ts` defines a weapon container with primary and secondary grip points in its own coordinates. Hand joints are at the wrists; the demo places each grip 15 local pixels down the corresponding hand, at the palm center. Facing changes remount the weapon on the front hand: the right hand holds the primary grip when facing right, and the left hand holds the secondary grip when facing left. The mount compensates for blade rotation so its grip stays on that palm. One-handed mouse targeting (`H`) moves the front arm and its attached katana.

In stance `3`, the front arm runs at priority 0 and follows the mouse target. Its solved hand transform carries the katana. The rear arm runs at priority 1 with an `endOffset` at the **palm**. A target provider reads its grip in world space after the demo aims the blade with `Q` / `E`. Rotating the katana therefore moves the rear grip, and that arm solves toward it in the same frame. Priorities switch when facing changes, so the left arm can fully extend when pointing left.

The demo uses bend direction `-1` for both elbows in the two-handed stance. Both hands follow their grip points without moving the shoulders.

In the two-handed stance, the blade can turn through a horizontal overhead pose. In either facing direction, the rear palm stays outside the head, torso, pelvis, and both legs, including the feet. It travels around the head's corners in bounded steps and can return below the head to torso height. Crossing to the body's other side still requires passing above the head. The demo checks the cutout edges at the palm's height and adjusts the front arm's hand target when either input would carry the rear palm behind the body. Both arms' reach limits are respected, and clearance is checked again after smoothing and reach recovery. Both shoulders stay fixed and both palms stay on the hilt.

The sketch swaps its actual limb chains when facing left while keeping the right hand on the primary grip in both directions. The left hand holds the secondary grip and obeys the same torso and leg restrictions in its two-handed sword stance and upper-body sword layer while walking. Its body clearance margin is −4 pixels, allowing a small overlap at the body edge while retaining the eight-pixel head clearance. When facing left, the hilt follows the right palm in the `katanaHilt` slot behind the right leg; the blade keeps its foreground layer. This applies to both the grip-aware prop and the one-handed slot sprite.

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

See the [IK animation data model](ik-animation-data.md) for optional target/mix tracks, puppet-local coordinates, stable rig constraint names, validation, and pure authoring APIs. See [runtime IK evaluation](ik-animation-runtime.md) for playback, scrubbing, precedence, and layer blending. Visual IK authoring remains deferred.
