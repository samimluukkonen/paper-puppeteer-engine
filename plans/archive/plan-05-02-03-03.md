You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.3.2

The Animation Editor now supports:

- bone selection
- inspecting animated transforms at currentTime
- property keyed/not-keyed state
- creating keys
- updating keys
- deleting keys
- partial transform animation
- preview refresh through the existing evaluator
- source-animation immutability

Do NOT add major new animation-authoring features.

---

# Goal

Implement:

# v0.5.2.3.3 — Keyframe Authoring Undo/Redo, Hardening & Regression

This is the stabilization phase for v0.5.2.3.

Focus on:

1. undo/redo integration
2. clean authored edit transactions
3. dirty-state correctness
4. transform-space correctness
5. navigation safety
6. validation
7. edge cases
8. regression verification

Do NOT begin the full timeline track/keyframe UI yet.

---

# 1. Reuse existing history architecture

The Rig Editor already has:

- undo
- redo
- redo invalidation
- gesture transaction behavior

Reuse or generalize the existing history architecture where practical.

Do NOT create an unrelated second undo framework if the existing one can support Animation Editor authored-data transactions cleanly.

However, keep Rig Editor and Animation Editor histories/session ownership separate.

---

# 2. What enters undo history

These authored mutations should create history operations:

- create key
- update key
- delete key
- authored FPS change if already supported
- authored animation-level stepped/smooth setting if already supported

These must NOT enter history:

- Play/Pause
- currentTime changes
- scrubbing
- loop preview
- playback speed
- bone selection
- preview facing
- IK preview toggle
- temporary uncommitted inspector edits

---

# 3. One logical edit = one history action

If a numeric field edit produces many intermediate browser `input` events, do NOT create dozens of undo entries.

Commit one logical edit as one operation.

Likewise, if visual dragging is enabled:

```text
pointer down
→ many updates
→ pointer up
```

must become ONE undoable authored edit.

Follow the Rig Editor gesture-history pattern where possible.

---

# 4. Undo create key

Example:

```text
no key at 0.5
↓
create rotation key 30°
↓
Undo
↓
no key at 0.5
```

Preview and keyed indicator must refresh.

---

# 5. Undo update key

Example:

```text
key = 20°
↓
update to 35°
↓
Undo
↓
20°
```

Redo should restore `35°`.

---

# 6. Undo delete key

Example:

```text
rotation key exists
↓
delete
↓
Undo
↓
exact authored key restored
```

Do not reconstruct it approximately from evaluated pose.

History should restore authored data exactly.

---

# 7. Redo invalidation

Standard behavior:

```text
edit A
edit B
Undo
new edit C
```

must invalidate redo for B.

Reuse established behavior from Rig Editor.

---

# 8. Dirty-state lifecycle

Ensure dirty state remains correct through:

- edit
- Undo
- Redo

If the existing editor history can track a clean checkpoint, use it.

Ideal behavior:

```text
loaded state = clean
edit = dirty
Undo back to exact loaded state = clean
Redo = dirty
```

If current architecture does not support clean-checkpoint detection cheaply, implement the same semantics already used by Rig Editor rather than inventing something inconsistent.

---

# 9. Animation switching

If the working animation is dirty and the user selects another animation, preserve the architecture required to prevent accidental silent loss.

Do not build an elaborate modal system if the existing editor already has a pattern.

At minimum, do not silently corrupt history by carrying edits/history from animation A into animation B.

Each newly loaded animation should get a clean history baseline.

---

# 10. Navigation safety

Verify:

```text
temporary edit
↓
scrub/select another bone/change animation
```

does not accidentally commit to the wrong time/bone.

Temporary authoring state should be:

- committed explicitly
- or cancelled predictably

No ghost edits.

---

# 11. Time-edge authoring

Test authoring at:

```text
0
duration
near existing key time
```

No duplicate near-equal times.

No values outside valid animation range.

If currentTime is clamped, authored time must use the clamped value.

---

# 12. Rotation correctness

The runtime already supports shortest-path rotation interpolation.

Do not break its conventions.

Ensure authored rotation values:

- use the same units as existing animations
- use the same normalization expectations
- are not unexpectedly converted between degrees/radians

UI may display degrees if existing editor conventions do so, but stored values must match schema/runtime conventions.

Centralize conversion.

---

# 13. Nested hierarchy correctness

Verify editing keys on:

- parent bone
- child bone

does not accidentally bake parent/world transform into child authored local transform.

For example:

```text
upper arm rotation
+
forearm rotation
```

must remain independently authored local transforms.

---

# 14. Bind/rest fallback

When a property has no authored key, the evaluator must continue using its existing fallback semantics.

Do not automatically create zero-value keys just because a property is unkeyed.

Deleting the last key from a property should return evaluation to the existing fallback behavior.

---

# 15. Stepped vs smooth regression

Create at least two keys and verify the existing evaluator continues to handle:

- smooth interpolation
- stepped playback

Do NOT implement interpolation editing UI.

The purpose is only to verify newly authored keys are valid input to the existing evaluator.

---

# 16. Playback regression

After authored keys are created:

- Play
- Pause
- Loop
- playback speed
- Restart
- scrubbing

must all continue to work.

No special editor-only animation path should be required.

---

# 17. IK regression

Verify:

```text
authored pose
↓
IK preview
```

still works.

Undo/Redo must restore authored data, not final IK pose.

---

# 18. Facing regression

Verify left/right preview does not affect stored animation values.

Author in canonical data space.

Switch facing.

Switch back.

Authored keys must be unchanged.

---

# 19. Validation

Run existing animation validation against edited working animations.

Fix any authoring path that can create invalid definitions.

Do not weaken validation merely to make editor-created data pass.

---

# 20. Tests

Expand tests to include:

### History

- Undo create
- Redo create
- Undo update
- Redo update
- Undo delete
- Redo delete
- redo invalidation

### Dirty state

- clean → edit → dirty
- history behavior matches editor convention

### Navigation

- temporary edits do not leak between bones/times

### Time edges

- key at zero
- key at duration
- near-equal times remain deduplicated

### Hierarchy

- child authored local transform remains local

### Rotation

- stored/displayed unit conversion is correct

### Fallback

- deleting final property key restores existing evaluator fallback

### Source immutability

Still guaranteed through Undo/Redo.

---

# 21. Manual verification scenario

Create a simple test animation manually in the editor.

Example:

At:

```text
0.0 s
```

set arm rotation to:

```text
-20°
```

At:

```text
0.5 s
```

set:

```text
35°
```

At:

```text
1.0 s
```

set:

```text
-10°
```

Then verify:

- scrub through animation
- play animation
- loop animation
- stepped preview
- smooth preview if supported
- Undo latest key
- Redo latest key
- change middle key
- Undo change
- delete middle key
- Undo deletion

Confirm visual result always matches working animation data.

Also test a child bone while the parent is rotated.

---

# 22. Regression requirements

Verify no regression to:

- Rig Editor
- Rig Editor history
- rig manipulation
- rig export
- animation timeline
- timeline ruler
- playback
- looping
- scrubbing
- playback speed
- FPS behavior
- source working-copy isolation
- Puppet runtime
- blending
- animation layers
- events
- IK
- slots
- attachments
- skins
- character loading
- JSON validation

---

# 23. Architecture cleanup

Before declaring complete, inspect v0.5.2.3 code for:

- duplicate mutation logic
- duplicate evaluator logic
- accidental world-space authoring
- accidental IK baking
- unsafe casts
- `any`
- unnecessary dependencies
- hidden global editor state
- duplicated history architecture

Refactor only where clearly justified.

Do not make unrelated large refactors.

---

# 24. Do NOT implement yet

Still defer:

- expanded timeline bone tracks
- property tracks
- visual keyframe diamonds
- dragging keyframes along timeline
- multi-key selection
- box/range selection
- copy/paste keyframes
- duplicate key commands
- mirrored keyframe copying
- auto-key mode
- interpolation editor
- visual event editor
- onion skinning
- ghost poses
- IK target animation
- IK baking
- final animation JSON export/import production workflow

---

# 25. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Final v0.5.2.3 definition of done

The complete v0.5.2.3 milestone is done when:

- bones can be selected in Animation Editor
- transform values can be inspected at currentTime
- keyed properties are clearly indicated
- bone transform property keys can be created
- existing keys can be updated
- keys can be deleted
- partial property animation works
- authored data uses correct local transform space
- source animation remains immutable
- working animation is the only authored object mutated
- IK output is never baked accidentally
- preview facing is never baked
- evaluated pose updates immediately after authored changes
- authored changes integrate with undo/redo
- logical edits create sensible history entries
- dirty-state behavior is correct
- playback/scrubbing remain functional
- edited animations pass existing validation
- Rig Editor has no regressions
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Authoring workflow

Explain how a user creates/updates/deletes keys.

## Data architecture

Explain authored data vs evaluated pose vs temporary editor state.

## Transform-space handling

Explain local transforms, hierarchy, facing, and IK safety.

## History architecture

Explain Undo/Redo transaction behavior.

## Files changed

## APIs changed

## Tests

## Manual verification

## Command results

Report exact results of:

```bash
npm run typecheck
npm run test
npm run build
```

## Deferred to v0.5.2.4+

Explicitly list the deferred timeline/QoL features.

Do not claim completion unless all required commands pass.
