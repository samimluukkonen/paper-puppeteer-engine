# Paper Puppeteer Engine — v0.9.8.1
## Foot Contact Marker Foundation

Continue developing Paper Puppeteer Engine.

Current completed version: **v0.9.7.4**.

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The engine includes visual Rig, Animation and Scene Editors, IK, character packages, Actor choreography and ground reference guides.

This is a private tool for myself and one artist friend. Keep implementation practical.

## Goal

Introduce authorable **Foot Contact Markers** that identify the precise point where a character's foot touches the ground.

A marker is attached to a rig bone and moves with its evaluated pose.

Do not implement physics, automatic foot planting or a second IK solver.

### 1. Inspect current architecture

Review:
- RigDefinition schema
- Bone hierarchy and local transforms
- Evaluated bone world transforms
- IK solver output
- Facing and mirroring
- Rig validation and serialization
- Ground Reference implementation from v0.9.7
- Existing foot-contact offset handling, if any

Reuse existing abstractions where suitable.

### 2. Marker data model

Introduce optional foot contact marker definitions in the rig.

Conceptually:

```ts
interface FootContactMarker {
  id: string;
  name: string;
  boneId: string;
  localX: number;
  localY: number;
}
```

This is illustrative. Adapt to the actual rig schema.

Requirements:
- Stable unique marker ID
- Human-readable name
- Reference to a valid bone
- Bone-local X/Y position
- Multiple markers per rig
- Zero markers allowed
- No hardcoded humanoid bone names

One marker per foot is the recommended starting convention, not a rigid engine restriction.

### 3. Coordinate semantics

Define explicitly how bone-local contact positions transform through:
- Bone translation and rotation
- Parent bone transforms
- Scale
- Puppet root transform
- Facing
- IK-adjusted poses
- Actor world transform

Use the existing transform pipeline.

Do not store screen coordinates.

### 4. World position evaluator

Implement a reusable pure calculation equivalent to:

```ts
getFootContactWorldPosition(
  marker,
  evaluatedPose,
  transforms
)
```

Use actual runtime types.

The returned position must represent the marker after the character's current bone and IK transforms are evaluated.

This function should work independently of React.

Do not alter the pose while calculating the position.

### 5. Default marker creation

When creating a marker, offer a reasonable initial bone-local position, such as the current bone endpoint when appropriate.

Do not assume that the ankle joint, bone endpoint or sprite bottom is the actual sole position.

The artist will adjust placement in Rig Editor.

### 6. Validation

Validate:
- Unique marker IDs
- Existing bone references
- Finite local coordinates
- Supported schema structure

Do not require left/right pairs.

Handle missing/deleted bones safely.

### 7. Backward compatibility

Existing rigs without contact markers must continue loading unchanged.

Use existing schema versioning/migration conventions where required.

Preserve existing character IDs, bone IDs and IK configuration.

### 8. Separation of concerns

A foot contact marker is:

- A rig attachment/reference point
- Not an IK target
- Not an animation keyframe
- Not a physics collider
- Not a ground constraint

Moving the marker in rig data must not automatically change IK or animation keys.

### 9. Tests

Add tests for:
- Marker creation
- Multiple markers
- Invalid bone reference
- Duplicate IDs
- Nested bone transforms
- Rotation/scale
- Facing
- Evaluated IK poses
- Rig JSON round-trip
- Existing rigs without markers
- Data immutability

### 10. Out of scope

Do not implement visual editing, snapping, foot sliding detection, collision, gravity or terrain systems.

### 11. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

The engine can store, validate and evaluate bone-local foot contact markers on arbitrary compatible rigs, without changing existing animation behavior.

## Final report

Explain marker data structure, coordinates, world-transform calculation, compatibility, files changed, tests and exact verification results.
