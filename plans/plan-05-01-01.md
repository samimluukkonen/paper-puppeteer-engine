Continue the existing `paper-puppeteer-engine` TypeScript + Phaser project.

Do NOT rewrite the project from scratch.

This is **v0.5.1.1 — Visual Rig Editor Foundation**.

The goal of this milestone is ONLY to build the editor shell, visualize the existing rig, and allow reliable bone/slot selection.

Do NOT implement dragging/editing/export/undo yet.

## Existing engine

The engine already includes:

- hierarchical bones/joints
- bind/rest pose
- slots and attachments
- skins
- render depth
- IK
- JSON rig format
- validation
- character manifests
- pose tools
- animation system

Preserve all existing behavior.

## Main goal

I should be able to launch a dedicated rig editor and:

1. load an existing character
2. see its artwork
3. see bones/joints over the artwork
4. see bone hierarchy
5. click bones/joints to select them
6. select bones from a hierarchy panel
7. select slots
8. inspect current values
9. toggle editor visualization helpers

No values need to be editable yet.

# 1. Separate RigEditor architecture

Keep editor functionality outside the production runtime.

Prefer something conceptually like:

```text
src/
  devtools/
    rig-editor/
      RigEditor.ts
      RigEditorState.ts
      RigSelection.ts
      RigEditorOverlay.ts
```

Do not move stable runtime systems unnecessarily.

Prefer:

```ts
const editor = new RigEditor(scene, puppet);

editor.enable();
editor.disable();
```

rather than putting editor responsibilities directly inside `Puppet`.

# 2. Dedicated editor route / scene

Create a clean development entry point.

For example:

```text
/rig-editor
```

or a dedicated Phaser scene selectable from the existing dev application.

The normal engine demo should remain available.

# 3. Rig working copy

Prepare for later editing by separating:

```text
original loaded rig
        ↓
editable working copy
        ↓
runtime preview
```

Even though this milestone does not edit anything yet, establish this architecture now.

Do not mutate the originally loaded rig definition.

# 4. Bone visualization

Render clear debug handles for all bones.

Display:

- joint point
- line to parent
- optional logical bone length
- bone name

Conceptually:

```text
shoulder ●────────● elbow
                   \
                    ● wrist
```

Use sufficiently large hit areas so small joints are easy to click.

# 5. Bone selection

Allow selection by clicking:

- joint handle
- bone line if practical

Selected bone must be clearly highlighted.

Display:

```text
Selected Bone:
rightForearm

Parent:
rightUpperArm
```

If multiple objects overlap, use a deterministic selection rule.

# 6. Hierarchy panel

Create a simple hierarchy tree/list.

Example:

```text
root
└─ pelvis
   ├─ torso
   │  ├─ head
   │  ├─ leftUpperArm
   │  │  └─ leftForearm
   │  │     └─ leftHand
   │  └─ rightUpperArm
   ├─ leftThigh
   └─ rightThigh
```

Clicking a hierarchy entry should select that bone.

Do NOT implement drag/drop reparenting.

# 7. Slot visualization

Add a toggle for displaying slots.

Show:

- slot location
- slot name
- parent bone
- current attachment where practical

Slots must be visually distinguishable from bone joints.

# 8. Slot selection

Allow selecting slots from:

- canvas
- hierarchy/list panel

Keep bone selection and slot selection represented by a clear type-safe selection model.

For example:

```ts
type RigEditorSelection =
  | { type: "bone"; id: string }
  | { type: "slot"; id: string }
  | null;
```

# 9. Read-only inspector

Create a compact inspector.

Plain HTML/CSS is acceptable.

Do NOT add React.

For selected bones display:

```text
Bone: rightForearm
Parent: rightUpperArm

x: 0
y: 52

rotation:
-0.84 rad
-48.1°

scaleX: 1
scaleY: 1

length: 48

spriteOffsetX: -3
spriteOffsetY: 5

originX: 0.5
originY: 0.1

depth: 20
```

For slots display appropriate slot properties.

All values are read-only in this milestone.

# 10. Visibility controls

Add toggles for:

```text
Artwork
Bones
Bone Names
Bone Lengths
Slots
Sprite Origins
IK
```

Allow artwork opacity to be changed.

For example:

```text
Artwork opacity:
100%
50%
25%
```

This is important for aligning skeletons later.

# 11. Canonical facing

The editor should clearly operate on the canonical/default facing direction.

If the character can face left/right at runtime, do NOT accidentally display or store mirrored values as canonical rig values.

For this milestone, it is acceptable to restrict editing/inspection to canonical facing.

Document this.

# 12. Bind-pose mode

Rig editor should display the bind/rest pose.

Pause/disable animation by default.

Disable IK by default.

Provide optional IK visualization but do not let IK modify authored values.

Display somewhere:

```text
Rig Editor
Bind Pose
```

# 13. Navigation

Add basic editor navigation:

- zoom
- pan

For example:

```text
Mouse wheel = zoom
Middle mouse drag = pan
```

Camera navigation must not modify puppet rig transforms.

# 14. Tests

Add tests for editor state that do not require visual rendering where practical.

Test:

- selecting a bone
- selecting a slot
- clearing selection
- hierarchy lookup
- working copy does not mutate source rig

# 15. Do NOT implement yet

Do NOT implement:

- dragging joints
- bone rotation editing
- sprite offset editing
- bone length editing
- depth editing
- undo/redo
- snapping
- export
- animation timeline
- reparenting

Those belong to later v0.5.1.x milestones.

# Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Manually verify:

- rig editor launches
- character loads
- bones are visible
- hierarchy panel matches rig
- selecting canvas joint selects correct bone
- hierarchy selection selects correct bone
- slot selection works
- inspector shows correct values
- artwork opacity works
- zoom/pan works
- normal runtime demo is unaffected

## Success criteria

v0.5.1.1 is complete when I can load a real puppet character and reliably inspect/select its entire rig visually without modifying any data.

At the end report:

- files added
- files changed
- editor architecture
- selection architecture
- hierarchy implementation
- navigation implementation
- known limitations
