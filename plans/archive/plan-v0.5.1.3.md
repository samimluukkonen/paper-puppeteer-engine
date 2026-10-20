Continue the existing `paper-puppeteer-engine`.

This is **v0.5.1.3 — Rig Editor Production Workflow**.

Do NOT rewrite stable systems.

Existing Rig Editor now supports:

- hierarchy
- selection
- visual joint editing
- numeric editing
- sprite offset editing
- origin editing
- logical bone length editing
- slot editing
- render depth editing
- IK preview
- zoom/pan
- dirty state

The goal of this milestone is to make the editor safe and practical for actual production use.

Implement:

1. undo/redo
2. reset operations
3. snapping
4. robust dirty-state handling
5. rig validation before export
6. stable JSON serialization
7. copy/download rig.json
8. reload/export verification

# 1. Undo / redo

Implement editor history.

Support standard shortcuts:

```text
Ctrl/Cmd + Z
Undo

Ctrl/Cmd + Shift + Z
Redo
```

History must cover at least:

- joint position
- rotation
- scale
- bone length
- sprite offsets
- sprite origin
- slot transforms
- depth changes

# 2. Drag gesture history

Do NOT create one undo entry per mouse-move event.

A drag should be:

```text
mouse down
→ many updates
→ mouse up

= one history operation
```

Numeric editing should also produce reasonable history entries.

# 3. Redo invalidation

After:

```text
edit
undo
new different edit
```

the old redo stack must be discarded.

Add tests.

# 4. Reset selected element

Support:

```text
Reset Selected
```

For a bone, restore loaded values for that bone.

For a slot, restore loaded values for that slot.

This reset should itself be undoable.

# 5. Reset entire rig

Support:

```text
Reset Rig
```

Restore editor working copy to the values loaded when the editor session started.

This should also integrate sensibly with history.

# 6. Grid snapping

Add optional translation snapping.

For example:

```text
Grid:
Off
1
2
5
10
```

Dragging/nudging should respect grid when enabled.

Do not permanently quantize existing rig values unless the user edits them.

# 7. Rotation snapping

Add optional rotation snapping.

Example:

```text
Rotation Snap:
Off
1°
5°
15°
```

Apply to interactive rotation editing.

Numeric input may remain exact.

# 8. Export API

Add something like:

```ts
editor.exportRig();
```

The exported rig must:

- use existing rig format
- preserve version
- preserve IDs
- preserve unedited data
- contain canonical local transforms
- contain no Phaser runtime state
- pass rig validation

# 9. Stable serialization

Export readable, Git-friendly JSON.

Use stable ordering where practical.

Normalize floating-point values to avoid noise such as:

```text
0.49999999999999994
```

Do not round so aggressively that real rig accuracy is lost.

A sensible precision such as 4–6 decimal places is acceptable depending on the data.

# 10. Validation before export

Run complete existing rig validation.

If errors exist, do not silently export.

Display something like:

```text
Cannot export rig.

Errors:
- Bone "leftForearm" has invalid length.
- Slot "weapon" references missing bone "rightHand".
```

Warnings may permit export, but should be shown.

# 11. Copy JSON

Support:

```text
Copy rig JSON
```

Use clipboard API where available.

Provide success/failure feedback.

# 12. Download rig.json

Add browser-side download using Blob/object URL.

For example:

```text
Download rig.json
```

No backend required.

Use the original filename where known, or a sensible default.

# 13. Console output

Also provide an easy developer fallback:

```text
Log rig JSON
```

Useful if browser clipboard/download behavior fails.

# 14. Dirty-state lifecycle

Dirty state should work correctly.

Examples:

```text
Load
→ clean

Edit
→ dirty

Undo back to original
→ clean if state is identical

Edit
→ dirty

Export
→ optionally mark current working copy as saved baseline
```

Choose a clear behavior and document it.

Prefer marking exported state as the new saved baseline.

# 15. Reload exported rig

Add a way to verify exported data.

At minimum provide:

```text
Reload current rig
```

If practical, allow selecting/pasting a rig JSON and reloading it.

Do NOT build a general filesystem browser.

# 16. Round-trip correctness

This is extremely important.

Test:

```text
load rig
→ edit
→ export
→ parse
→ validate
→ recreate puppet
```

The recreated puppet should visually match the editor preview.

# 17. Keyboard shortcuts/help

Add a visible help panel or shortcut reference.

Include:

```text
Select bone
Drag joint
Sprite edit mode
Rotate
Nudge
Undo
Redo
Grid snap
Rotation snap
Reset selected
Reset rig
Export
```

# 18. Session status

Display useful state such as:

```text
Character: demo-puppet
Rig: rig.json

Mode: Joint
Selected: rightForearm

Grid: 1
Rotation Snap: 5°

Modified: Yes
Validation: OK
```

# 19. Tests

Add tests for:

## History

- edit → undo
- undo → redo
- new edit clears redo
- drag gesture produces one history entry

## Reset

- selected reset
- full reset
- reset undo

## Snapping

- translation snapping
- rotation snapping
- disabled snapping preserves exact values

## Dirty state

- initial clean
- edit dirty
- undo-to-baseline clean
- export establishes new baseline if implemented

## Serialization

- stable JSON
- no runtime-only fields
- values reflect edits
- unedited values preserved
- output passes validation

## Round trip

```text
definition
→ editor
→ edit
→ serialize
→ parse
→ validate
```

# 20. README

Document the complete v0.5.1 workflow:

```text
1. Start Rig Editor
2. Load character
3. Select bones
4. Position joints
5. Adjust artwork offsets/origins
6. Set logical lengths
7. Adjust slots/depth
8. Preview IK
9. Use snapping where useful
10. Undo mistakes
11. Validate
12. Export rig.json
13. Reload and verify
```

# 21. Do NOT implement yet

Do NOT implement:

- animation timeline
- keyframe editing
- curve editing
- animation event editor
- bone reparenting UI
- mesh deformation
- skinning editor
- scene editor
- choreography editor

Those belong to later releases.

# Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Then manually perform a full production-style test:

```text
load puppet
↓
move shoulder
↓
move elbow
↓
correct sprite offset
↓
change bone length
↓
change weapon slot
↓
change render depth
↓
undo
↓
redo
↓
enable snapping
↓
adjust again
↓
validate
↓
export rig.json
↓
reload exported rig
```

The reloaded puppet must match the editor preview.

## v0.5.1 complete success criteria

The entire v0.5.1 Visual Rig Editor is complete when I can take separate PNG artwork from an artist and produce a valid reusable `rig.json` visually without manually editing JSON transform numbers.

At the end report:

- files added/changed
- undo/redo design
- dirty-state behavior
- snapping behavior
- serialization strategy
- validation strategy
- export methods
- round-trip test results
- known limitations
- recommended v0.5.2 scope
