# Paper Puppeteer Engine — v1.1.7.1
## Root Motion Data Model & Architecture

Continue developing my Paper Puppeteer Engine project.

**Confirmed completed version: v1.1.5.**

Inspect the repository for any later implemented features, especially v1.1.6 Environment Preview.

### Stack
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems include:
- Rig Editor, Animation Editor and Scene Editor
- Skeletal FK/IK animation
- Animation keyframes and Graph Editor
- Puppet runtime, Actor system and choreography
- Project Workspace, validation, autosave and import/export
- Ground references and optional foot contact markers

This is a private tool for myself and one artist friend.

## Goal

Add the data-model foundation for **authored root motion**.

Root motion describes how a character's Actor/root transform moves over animation time, independently of its skeletal bone animation.

This solves an artist workflow problem: the skeleton is currently animated around a pelvis reference, making dynamic world-space movement difficult to visualize and author.

The pelvis should remain a normal skeletal bone.

## 1. Architecture inspection

Before coding, identify the actual relationship between:
- Puppet root/world transform
- Skeleton root bone
- Pelvis bone
- Actor world transform
- AnimationDefinition
- Scene Actor movement
- Animation timeline and Graph Editor
- Facing and mirroring

Document the transform hierarchy.

Do not assume that the first bone, pelvis, Actor origin and contact point are interchangeable.

## 2. Root motion data model

Extend existing animation data with an optional root-motion track.

Conceptual example:

```ts
interface RootMotionKey {
  time: number;
  x: number;
  y: number;
}

interface RootMotionDefinition {
  translationKeys: RootMotionKey[];
}
```

Adapt to existing keyframe schemas and interpolation infrastructure.

Support:
- X displacement
- Y displacement
- Independent timing
- Interpolation
- Empty root-motion track
- Stable keyframe identity where existing editing conventions require it

Do not add rotation, scaling or full 3D transforms in this milestone.

## 3. Coordinate semantics

Choose and document one clear root-motion coordinate convention.

Recommended:
- Root-motion keys represent animation-local displacement relative to the starting Actor transform.
- X/Y are not pelvis bone coordinates.
- Key values are evaluated as absolute offsets within an animation cycle, not added to the Actor every frame.
- Application to scene-world coordinates happens separately through the existing Actor/facing transform conventions.
- An explicit rule handles facing-left/mirrored playback.

Do not flip X twice when both character facing and animation mirroring are active.

## 4. Start and end positions

Define:
- Initial root-motion value
- Root displacement at time T
- Net displacement over the animation
- Duration and loop behavior

An optional normalization policy may make the starting offset zero, but it must be explicit and compatible with existing animation conventions.

A root-motion clip should not unexpectedly teleport the Actor when it starts.

## 5. Backward compatibility

Existing animations without root motion must behave exactly as before.

Root motion must be optional.

Do not automatically convert:
- Pelvis translation
- Root bone keys
- IK target movement
- Existing Scene Editor movement

into root motion.

These are distinct data types.

## 6. Validation

Validate:
- Finite coordinates
- Valid times
- Supported interpolation
- Key ordering
- Duration bounds
- Duplicate keyframe times according to existing policy
- Valid serialized structure

Preserve old animation formats and use existing versioning/migration rules if necessary.

## 7. Animation data ownership

Root motion belongs to the animation because it is authored motion.

However, simply evaluating the skeletal pose must not automatically mutate the Actor's world position.

Runtime application is handled explicitly in the next milestone.

Keep preview-only displacement settings separate from authored root motion.

## 8. Serialization

Extend existing:
- Animation validation
- JSON import/export
- Character package serialization
- Project asset handling

Keep output deterministic.

Do not include React state, Phaser objects or preview camera information.

## 9. Tests

Cover:
- Empty track
- Single key
- Several keys
- Positive/negative X
- Positive/negative Y
- Forward/backward motion
- Zero displacement
- Invalid data
- Serialization round trip
- Older animation compatibility
- Pelvis bone key preservation
- IK track preservation

## 10. Out of scope

Do not implement:
- Root-motion timeline UI
- Runtime Actor movement
- Environment Preview integration
- Scene clip ownership
- Physics, collision or pathfinding
- Root-motion extraction from pelvis bones
- Foot locking

## 11. Verification

Run and fix:

```bash
npm run typecheck
npm run test
npm run build
```

Use actual repository scripts where necessary.

## Definition of done

Animations can optionally contain validated, serialized X/Y root-motion data independently of skeletal animation.

Existing animations and runtime playback remain compatible.

## Final report

Explain:
1. Existing transform hierarchy
2. Root-motion data schema
3. Coordinate conventions
4. Loop/start/end semantics
5. Compatibility
6. Files/APIs changed
7. Tests and exact command results
8. Deferred runtime work

Do not claim verification that was not performed.
