# Paper Puppeteer Engine — v0.6.6.4.2
## Visual IK Constraint & Target Editor

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.6.6.4.1**

Tech stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

v0.6.6.4.1 implemented validated IK constraint creation, modification and deletion APIs.

Existing Animation Editor already has draggable animated IK targets.

Do not rebuild these systems.

## Goal

Provide an artist-friendly visual IK constraint editor inside the Rig Editor.

The artist must be able to create IK chains, adjust target locations, configure the solver and preview results without manually editing JSON.

## 1. Rig Editor IK panel

Add a panel integrated with existing React editor UI.

Example:

```text
IK CONSTRAINTS

leftHandIK
rightHandIK
leftFootIK

[ + Add IK Constraint ]

-------------------------

Selected: leftHandIK

Start bone:  [leftUpperArm]
Middle bone: [leftForearm]
End bone:    [leftHand]

Target X: [120]
Target Y: [-35]

Influence: [1.0]
Bend: [Clockwise / Counterclockwise]
Enabled: [x]

[ Delete Constraint ]
```

Use actual supported properties and actual bone IDs.

Do not invent unsupported fields.

## 2. Create IK wizard/form

When adding IK, guide the artist through:
1. Choosing the bone chain.
2. Naming the constraint.
3. Initializing its target position.
4. Configuring available settings.
5. Confirming creation.

Filter or validate incompatible bone selections.

The UI must support both humanoid and non-humanoid rigs.

## 3. Visual target handles

Render editor-only Phaser gizmos representing each IK target.

Suggested appearance:
- Crosshair or circle at target
- Optional line to the constrained end effector
- Highlight for selected target
- Clearly distinguish enabled/disabled constraints

Do not embed gizmos in exported artwork.

## 4. Direct target dragging

Allow the artist to drag a constraint's default target visually.

```text
Select IK target
       ↓
Drag target
       ↓
Convert pointer coordinates
       ↓
Update rig working copy
       ↓
Existing IK solver updates
       ↓
Preview new pose
```

Reuse existing editor coordinate utilities.

Handle camera zoom/pan, puppet scaling, translation and facing.

Do not store screen coordinates in rig data.

## 5. Rig target versus animation target

**This distinction is critical.**

Rig Editor target movement edits the rig's default/static IK target.

Animation Editor target movement edits authored IK target animation or its transient preview, according to the existing animation authoring workflow.

Keep these two actions separate.

Rig Editor operations must never create animation keyframes.

## 6. Live solver preview

After target or constraint property changes:
- Re-evaluate the rig
- Apply the existing IK solver
- Update puppet preview
- Show resulting joint motion

Respect existing constraint priority and ownership.

Do not create another IK solver.

## 7. Visual joint/bone relationships

When selecting a constraint, highlight its affected bones.

Example:

```text
Shoulder → Elbow → Wrist
                   |
                IK Target
```

This should help the artist understand which bones the constraint controls.

Do not alter the bone hierarchy merely by selecting a constraint.

## 8. Unreachable targets

If the target is outside the chain's reachable range:
- Leave the requested target at its actual authored position
- Let the existing solver use its defined unreachable-target behavior
- Optionally display a subtle reachability indicator

Do not silently clamp authored target coordinates.

## 9. Inspector synchronization

Dragging the target must update numeric React controls.

Editing numeric controls must move the Phaser target handle.

Use authoritative Rig Editor state rather than competing copies.

Avoid unnecessary React re-renders every Phaser frame.

## 10. Undo/Redo

One completed drag must create one history entry.

Support Escape to cancel a gesture.

No history entry should be created for merely selecting or previewing a constraint.

## 11. Delete/edit protection

Show dependency warnings from v0.6.6.4.1.

Do not let the UI bypass model validation.

Prevent unsafe edits to constraints referenced by existing animations.

## 12. Empty-state support

For a new character with no IK constraints, show:

```text
No IK constraints

Create an IK constraint to control
a chain of bones using a target.

[ + Add IK Constraint ]
```

Do not require demo-specific bone names.

## 13. Tests

Add tests for:
- Form validation
- Constraint creation
- Constraint selection
- Visual handle synchronization
- Coordinate conversion
- Drag commit/cancel
- Solver preview
- Undo/Redo
- Dependency warnings
- Empty-state behavior
- React/Phaser lifecycle cleanup

## 14. Manual verification

Using a simple three-joint arm chain:

1. Open Rig Editor.
2. Create an IK constraint.
3. Choose appropriate bones.
4. Name the target.
5. Drag it in Phaser.
6. Verify the arm follows.
7. Adjust influence.
8. Change bend direction.
9. Undo/Redo.
10. Export/reload the rig.
11. Confirm the constraint still works.

Repeat with an existing character's IK constraint.

## 15. Out of scope

Do not implement:
- New IK solvers
- IK baking
- New animation authoring tools
- Automatic rigging
- Scene choreography

## 16. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The Rig Editor allows artists to create and visually manipulate IK constraints and target positions, configure supported solver settings, and see live results with proper Undo/Redo.

## Final report

Provide:
1. React components
2. Phaser target gizmos
3. Drag/coordinate behavior
4. Preview integration
5. Validation and history behavior
6. Files/APIs changed
7. Tests
8. Verification results

Do not claim completion unless all commands pass.
