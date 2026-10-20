# Paper Puppeteer Engine — v0.6.6.4.1
## IK Constraint Authoring Foundation

Continue developing my Paper Puppeteer Engine project.

Tech stack: React + TypeScript (strict), Phaser, Vite, npm and ES modules.

The project already supports:
- Visual Rig Editor
- Visual Animation Editor
- Hierarchical bones and joints
- Two-bone arm/leg IK
- Animated IK targets and influence
- IK baking
- Rig and animation JSON validation
- Undo/Redo
- CharacterLoader and character packages
- New Character workflow (inspect actual implementation status)

Do not rebuild existing IK solvers or animation systems.

## Goal

Enable artists to create, configure and delete IK constraints directly from the Rig Editor, for both newly created and existing characters.

No manual editing of rig.json should be necessary.

This phase implements the rig-data/model/controller foundation. Visual controls come in the next phase.

## 1. Inspect current IK architecture

Before coding, inspect the actual:
- Rig definition and IK constraint schema
- Constraint IDs and target representation
- Two-bone IK solver and supported settings
- IK constraint ordering and target ownership
- Bone and parent/child hierarchy
- Rig Editor working-copy/history system
- Animation IK track references and baked-IK metadata
- Existing validators and serializers

Use existing types and conventions. Do not invent a second IK format.

## 2. Create IK constraint

Implement a typed rig authoring operation conceptually equivalent to:

```ts
createIKConstraint(rig, options)
```

The artist must be able to define a valid two-bone IK chain, such as:

```text
leftUpperArm
    ↓
leftForearm
    ↓
leftHand (end effector)

IK target: leftHandIK
```

Or:

```text
leftThigh
    ↓
leftShin
    ↓
leftFoot (end effector)

IK target: leftFootIK
```

Adapt chain requirements to the existing solver, which may use different bone references.

Do not restrict IK to human characters.

## 3. Stable identifiers

Every authored IK constraint must have a stable ID.

Examples:
- leftHandIK
- rightHandIK
- leftFootIK
- tailIK

IDs must remain stable across serialization and animation authoring.

Reject duplicates.

Do not base persistent identity on array indices or React component identity.

## 4. Configurable properties

Expose whichever properties the existing IK solver supports.

Potential examples:
- Constraint ID/name
- Root/start bone
- Middle/joint bone
- End-effector bone
- Target position
- Enabled state
- Influence/mix
- Bend direction
- Constraint priority/order

Do not add unsupported solver capabilities merely to expose these controls.

Use the existing rig coordinate system for target positions.

Never serialize screen/camera coordinates.

## 5. Initial target placement

When creating an IK constraint, prefer initializing its default target at the current end-effector position in the appropriate rig-local coordinate system.

This avoids unexpectedly moving the limb immediately after constraint creation.

Use existing transform conversion utilities.

## 6. Modify existing constraint

Implement typed operations to edit:
- Target coordinates
- Influence
- Bend direction
- Enabled state
- Supported chain settings

Allow existing constraints to be selected and modified without rebuilding them.

Preserve their stable IDs unless an explicit safe rename operation is supported.

## 7. Delete constraint

Implement deletion with dependency checking.

Before deleting or changing references, inspect:
- Animation IK target tracks
- IK baking metadata
- Other constraints
- Specialized foot/weapon constraints

Never silently delete animation keys or leave invalid references.

If references exist, block the operation with actionable feedback until dependencies are resolved through an explicit supported workflow.

## 8. Chain validation

Validate:
- Referenced bones exist
- Valid parent-child relationships
- No invalid/cyclic chain
- Unique constraint IDs
- Supported chain configuration
- Finite numeric values
- Valid mix ranges
- Valid bend direction
- Conflicting constraint ownership when relevant

Reuse the existing validation infrastructure.

## 9. Undo/Redo

Integrate all authored operations with Rig Editor history.

One logical operation = one Undo entry.

Never modify the immutable source rig directly.

## 10. Serialization

New and modified IK constraints must round-trip through the existing rig JSON format.

Update validation and format versioning only where actually necessary.

Older rigs without authored IK constraints must remain compatible.

## 11. Tests

Add tests covering:
- Create arm and leg constraints
- Modify target coordinates
- Change mix and bend settings
- Enable/disable
- Delete unused constraint
- Reject unsafe deletion
- Duplicate IDs
- Invalid chain
- Missing bones
- Undo/Redo
- Source immutability
- Serialization round-trip
- Existing character compatibility

## 12. Out of scope

Do not implement:
- React IK authoring panel yet
- Draggable visual IK handles yet
- New IK solver types
- New IK animation tracks
- IK baking changes
- Scene choreography

## 13. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

Artists can create, edit and delete valid IK constraints through reusable rig authoring APIs, with validation, stable IDs, Undo/Redo, and JSON round-trip compatibility.

## Final report

Provide:
1. Implemented features
2. Constraint data model and APIs
3. Coordinate conventions
4. Validation and dependency handling
5. Files changed
6. Tests
7. Verification command results
8. Deferred UI work

Do not claim completion unless all required commands pass.
