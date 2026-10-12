# Paper Puppeteer Engine — v0.5.5.1
## IK Animation Data Model

You are continuing development of my standalone Paper Puppeteer Engine.

**Current completed version: v0.5.4.5**

The project already has:
- Hierarchical bones and joints
- Two-bone IK for arms and legs
- IK influence/mix
- Foot planting
- Hand IK targets
- Two-handed weapon grip constraints
- Visual Rig Editor
- Visual Animation Editor
- Bone/property keyframe authoring
- Timeline tracks, selection and multi-key editing
- Undo/Redo, interpolation and animation events
- Animation JSON import/export
- Onion skinning
- Mirrored animation tools

### Technology stack

- React for editor UI
- TypeScript (strict)
- Phaser
- Vite
- npm
- ES modules

Reuse the existing React and editor architecture.

Keep animation data operations independent of React, DOM and Phaser where practical.

Do NOT rebuild working systems.

---

## Goal

Implement **v0.5.5.1 — IK Animation Data Model**.

Establish serializable animation data for IK targets.

This milestone is focused on schema, validation and pure authoring operations.

Do NOT implement runtime evaluation or visual authoring UI yet.

## 1. Inspect the existing IK architecture

Before coding, inspect:
- Existing IK constraint definitions
- IK target representation
- Two-bone solver
- Coordinate systems
- IK mix/influence
- AnimationDefinition schema
- Animation keyframe format
- Existing validators and serializers
- Bone/property keyframe mutation APIs

Extend existing concepts instead of introducing duplicate representations.

## 2. IK animation tracks

Support animated IK target positions associated with existing rig IK constraints.

Conceptually:

```ts
interface IKTargetKeyframe {
  time: number;
  x: number;
  y: number;
}

interface IKAnimationTrack {
  constraintId: string;
  positionKeys: IKTargetKeyframe[];
}
```

These are conceptual examples only.

Adapt the actual structure to existing animation/keyframe conventions.

Prefer independently keyable X/Y properties if that is consistent with the current animation architecture.

Do not introduce a new incompatible keyframe system.

## 3. Stable constraint references

Animated IK tracks must reference stable IK constraint identifiers.

Do not use:
- React component identities
- DOM elements
- Phaser GameObject references
- Array positions as permanent IDs

Validate every reference against the loaded rig's actual IK constraint definitions.

If existing constraints lack suitable stable IDs, introduce the smallest backward-compatible solution.

## 4. Target coordinate system

Define one explicit coordinate convention for authored IK targets.

Prefer puppet-local or rig-local coordinates so animation data remains reusable when a character is moved through the scene.

Do not accidentally serialize:
- Screen coordinates
- Camera coordinates
- Phaser world positions

Reuse existing IK world/local conversion utilities.

Document how facing and character scaling affect the target.

## 5. Animated IK influence

Support animated IK mix/influence if the existing runtime architecture can cleanly evaluate it.

Example:

```text
time    influence
0.0     0
0.3     1
0.8     1
1.0     0
```

Use the existing IK influence range and validation rules.

Do not create a second meaning of IK mix.

If necessary, define a separate optional influence channel compatible with existing animation timelines.

## 6. Backward compatibility

Existing animations without IK tracks must behave exactly as before.

Do not require all old animation files to add empty IK definitions.

When changing the external animation schema:
- Follow existing format-version conventions
- Update validators
- Update JSON schemas
- Update parsers
- Preserve supported older files
- Provide compatible defaults or a migration path where necessary

Engine version and animation file-format version are different concepts.

## 7. Pure keyframe operations

Create or extend operations conceptually supporting:

- Create IK target position key
- Update IK position key
- Delete IK position key
- Query IK keys at time
- Move IK key
- Query influence keys
- Update influence key

Reuse existing timeline time matching, sorting and collision rules.

Do not create duplicate key-time equality logic.

## 8. Interpolation metadata

Reuse the existing stepped/smooth interpolation representation where applicable.

Do not invent a new interpolation evaluator.

Keep target interpolation metadata serializable and consistent with bone keyframes.

## 9. Missing and invalid targets

Handle:
- Unknown constraint IDs
- Missing IK constraint
- Empty target timelines
- Invalid times
- Invalid positions
- NaN/Infinity
- Duplicate times
- Invalid influence values

Use structured validation issues.

Do not silently repair invalid authored data.

## 10. Source immutability

Mutation operations must affect working animation data only.

Never mutate:
- Source animation
- Rig definitions
- Existing bind/rest transforms
- Evaluated IK results

## 11. Tests

Add tests for:
- IK track creation
- Key insertion/update/deletion
- Target coordinate representation
- Influence validation
- Time sorting and duplicate prevention
- Existing interpolation metadata
- Invalid constraint references
- Empty tracks
- Serialization
- Old animation compatibility
- Source immutability

## 12. Do NOT implement yet

Do not implement:
- Runtime evaluation of animated IK tracks
- React IK timeline UI
- Draggable IK handles
- IK target copy/paste UI
- IK mirroring
- IK baking
- New IK solvers
- Physics or ragdolls

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- IK target animation format exists
- Target positions are serializable
- Constraint references are stable and validated
- Coordinate convention is documented
- IK mix animation is represented if supported
- Keyframe mutation/query APIs exist
- Existing animations remain compatible
- Data validates and serializes correctly
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented functionality
2. IK track schema and format changes
3. Coordinate convention
4. Keyframe APIs
5. Validation and compatibility
6. Files changed
7. Tests
8. Verification results
9. Deferred features

Do not claim completion unless all required commands pass.
