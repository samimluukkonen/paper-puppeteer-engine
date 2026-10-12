Continue the existing `paper-puppeteer-engine`.

Do NOT rewrite existing systems.

This is **v0.5.1.2 — Visual Rig Manipulation**.

v0.5.1.1 already implemented:

- RigEditor shell
- editable rig working copy
- bone visualization
- slot visualization
- hierarchy panel
- bone/slot selection
- read-only inspector
- editor zoom/pan
- bind-pose editor mode

The goal of this milestone is to make the selected rig elements visually editable.

Do NOT implement undo/redo or final rig export yet.

## Main goal

I should be able to visually tune a real character by manipulating:

1. bone/joint position
2. bone rotation
3. logical bone length
4. sprite offset
5. sprite origin
6. slot transform
7. render depth

Changes should update the preview immediately.

# 1. Drag bone joints

Allow selected bone joints to be dragged with the mouse.

Dragging must correctly convert:

```text
screen
→ world
→ puppet
→ parent bone local coordinates
```

Store canonical local-space rig values.

Do NOT store screen/world coordinates in rig data.

# 2. Hierarchical behavior

When a bone local position changes:

```text
parent
  ↓
selected bone
  ↓
children
```

children should naturally move through hierarchy transforms.

Do NOT rewrite child local transforms simply because their world positions changed.

# 3. Coordinate correctness

Joint dragging must work correctly when:

- puppet root is moved
- puppet is scaled
- parent bone is rotated
- editor camera is zoomed
- editor camera is panned

Add pure coordinate conversion helpers where practical.

# 4. Numeric editing

Make inspector fields editable.

Support at least:

```text
x
y
rotation
scaleX
scaleY
length

spriteOffsetX
spriteOffsetY

originX
originY
```

Use plain HTML inputs if useful.

Input changes should update preview immediately.

# 5. Bone rotation editing

Allow rotation through:

- numeric input
- keyboard
- optional visual rotation handle

Show both:

```text
radians
degrees
```

Use radians internally.

Suggested controls:

```text
, / .
rotate fine

Shift + , / .
rotate coarse
```

Use non-conflicting controls if better.

# 6. Joint nudging

Allow precise keyboard movement.

Example:

```text
Arrow keys
move selected joint 1 unit

Shift + Arrow
move 10 units
```

If arrow keys conflict with other editor behavior, choose another sensible scheme.

# 7. Sprite offset mode

This distinction is essential.

The skeleton joint and visual artwork position must remain separate.

Provide an explicit mode:

```text
Edit:
Joint
Sprite
```

In `Joint` mode:

```text
drag
→ changes bone local x/y
```

In `Sprite` mode:

```text
drag
→ changes spriteOffsetX/Y
```

Moving artwork must NOT move the skeleton joint.

# 8. Sprite origin visualization/editing

Visualize sprite origin/pivot.

Allow origin values to be edited.

If practical, provide a draggable origin handle.

Keep these concepts distinct:

```text
bone joint
sprite offset
sprite origin
```

Do not collapse them into one transform.

# 9. Bone length editing

Visualize logical bone length.

Allow:

- numeric editing
- optionally dragging a bone-length handle

Changing logical length should affect IK geometry but must NOT automatically stretch artwork.

# 10. Slot editing

Allow selected slot properties to be modified:

- x
- y
- rotation
- scale
- depth/order where supported

Slot editing should update attachments immediately.

# 11. Render depth editing

Allow adjusting visual depth/order.

The editor must make it easy to establish paper-puppet layering such as:

```text
far arm
far hand
far leg
torso
near leg
near arm
near hand
weapon
```

Do not hardcode those semantics.

Depth remains generic numeric data.

# 12. Dim / isolate selection

Add a useful selection visibility option.

At minimum support:

```text
Dim unselected artwork
```

Optionally:

```text
Show selected part only
```

This helps when near/far limbs overlap.

# 13. IK preview

Add optional existing-IK preview.

For example:

```text
IK Preview: OFF / ON
```

This allows checking:

- shoulder/elbow geometry
- hip/knee geometry
- bone lengths

IK preview must never overwrite authored bind rig data.

# 14. Live validation

Run lightweight validation after edits where appropriate.

For example show warnings for:

- invalid bone length
- non-finite values
- broken slot bone reference

Do not block every edit while dragging.

Full validation can run after edit completion.

# 15. Dirty state

Track whether working rig differs from its loaded state.

Display:

```text
Unsaved changes *
```

No export behavior yet; just maintain correct dirty state.

# 16. Tests

Add tests for:

## Coordinate conversion

- world → local
- local → world
- transformed parent
- scaled puppet
- camera independent

## Editing

- joint edit updates correct local position
- sprite offset edit does not change bone transform
- bone length changes correctly
- slot transforms update correctly

## Working copy

- original source definition remains unchanged

# 17. Do NOT implement yet

Do NOT implement:

- undo/redo
- redo history
- grid snapping
- rotation snapping
- reset entire rig
- final JSON export
- clipboard export
- download
- animation timeline
- hierarchy reparenting

Those belong to v0.5.1.3.

# Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Manually verify:

- drag shoulder
- drag elbow
- drag wrist
- drag hip
- drag knee
- drag ankle
- descendants follow correctly
- artwork can move independently from skeleton
- origin editing works
- logical length editing works
- slot movement works
- depth changes update preview
- camera zoom/pan does not corrupt values
- IK preview still works
- original runtime demo remains unaffected

## Success criteria

v0.5.1.2 succeeds when I can visually align a real artist-created puppet to its skeleton without manually guessing most transform numbers.

At the end report:

- files changed
- coordinate-space approach
- editing modes
- numeric inspector behavior
- slot/depth editing behavior
- IK preview behavior
- known limitations
