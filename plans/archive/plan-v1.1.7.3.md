# Paper Puppeteer Engine — v1.1.7.3
## Visual Root Motion Authoring in Animation Editor

Continue developing Paper Puppeteer Engine.

**Previous milestone: v1.1.7.2 — Runtime Root Motion Evaluation.**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems:
- Animation Editor
- Bone keyframes
- Graph Editor
- Timeline editing
- IK animation
- Root-motion data and evaluator
- Undo/Redo
- Ground references and optional foot contact markers

## Goal

Allow my artist friend to visually author root motion while creating an animation.

This is the key artist-facing feature.

The artist must be able to animate a forward step, lunge, jump or dodge in world-relative space WITHOUT having to express the entire character's travel through the pelvis bone.

## 1. Inspect editor architecture

Review:
- Animation timeline
- Keyframe editing
- Track selection
- Property inspectors
- Graph Editor
- Phaser manipulation gizmos
- Pose preview
- Editor camera/world transforms
- Undo/Redo

Reuse existing UI and editing infrastructure.

## 2. Root Motion track

Add a dedicated track group inside Animation Editor.

Example:

```text
ANIMATION TIMELINE

Root Motion
  Position X   •────────•────•
  Position Y   •────•────────•

Skeleton
  Pelvis
  Left Leg
  Right Leg
  Left Arm
  Right Arm

IK
  Left Foot Target
  Right Foot Target
```

The Root Motion group should be visually distinct from skeletal bone tracks.

It should NOT be a disguised pelvis track.

## 3. Authoring controls

Support:
- Add root position key
- Select key
- Move key time
- Edit X/Y values
- Delete key
- Duplicate key
- Edit interpolation
- Undo/Redo

Use existing keyframe authoring conventions.

## 4. Root Motion editing mode

Add a clear editor mode or tool:

**Edit Root Motion**

When enabled, dragging the root-motion handle should alter root-motion keys at the current playhead.

It must not:
- Move individual bones
- Change the pelvis animation track
- Alter IK target keys
- Reposition the ground guide

When disabled, preserve normal skeletal editing behavior.

## 5. Visual root handle

Display a dedicated root-motion origin/handle in Phaser preview.

Use an appearance different from:
- Bone joints
- IK targets
- Foot contact markers
- Ground guide handles

The artist must know which part of the character they're manipulating.

## 6. World-relative animation viewport

This is particularly important.

When root motion is enabled for display, the entire character should move across the fixed animation reference coordinate system according to authored root motion.

The artist should be able to observe:
- The pelvis bobbing relative to the skeleton
- The entire character translating relative to ground
- Feet moving relative to world
- Sword/arms continuing their authored motion

Do not move the ground line along with the character.

Do not move the editor camera automatically when editing root motion.

## 7. Root-position editing

Allow selecting a keyframe and dragging the character's root-motion handle in the viewport.

Convert world/preview coordinates back into authored root-motion coordinates correctly.

Account for:
- Camera zoom and pan
- Actor facing
- Character scale
- Existing origin conventions
- Nested skeletal transforms

The editing handle must use the authoritative data model.

## 8. Visual trajectory

Draw an optional line showing root displacement over animation time.

Show key positions and selected key.

Support hiding the trajectory to reduce visual clutter.

The trajectory is an editor overlay, not exported character artwork.

## 9. Graph Editor integration

Root Position X and Position Y should be editable through the existing Graph Editor.

Reuse:
- Interpolation curves
- Tangent handles
- Time/value coordinate conversion
- Selection
- History

Do not introduce a second easing engine.

## 10. Undo/Redo

One completed drag should create one history transaction.

Support Escape to cancel.

Do not create hundreds of history entries during a single drag.

## 11. Root motion versus skeletal animation

Ensure the artist can switch between:
- Editing character body pose
- Editing character root translation

Both use the same animation playhead and evaluation.

Changing root motion must not silently rewrite bone keyframes.

## 12. Tests

Cover:
- Create root track
- Add/move/delete keys
- X/Y editing
- Graph Editor integration
- Root handle dragging
- Camera coordinate conversion
- Undo/Redo
- Scrubbing
- Animation looping
- Facing/mirroring
- IK
- Ground reference
- Serialization
- Old animations

## 13. Manual acceptance test

Create a sword attack animation:

1. Begin at root X = 0.
2. Animate anticipation using skeletal bones.
3. At the beginning of the forward step, add a root position key.
4. Advance the playhead.
5. Move the entire character forward 80 units.
6. Continue the sword-cut pose animation.
7. Add a final hold at root X = 80.
8. Scrub through the clip.
9. Verify the character visibly travels relative to ground.
10. Verify the pelvis still animates naturally within the skeleton.
11. Undo/Redo.
12. Export/reload.

## 14. Out of scope

Do not implement:
- Physics
- Automatic foot locking
- Root-motion extraction from pelvis tracks
- Scene choreography authoring
- Rotation/scaling root tracks
- Advanced motion blending

## 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The artist can author genuine root motion directly in Animation Editor using timeline keys, numeric controls, a root handle and the existing Graph Editor.

Root motion remains separate from skeletal bone animation.

## Final report

Describe UI controls, root handle behavior, coordinate transforms, Graph Editor integration, Undo/Redo, files changed, tests and exact results.
