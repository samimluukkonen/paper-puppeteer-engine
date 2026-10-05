You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.3.1

v0.5.2.3.1 introduced reliable pure APIs for:

- creating bone/property keyframes
- updating keyframes
- deleting keyframes
- querying keyed properties
- sorted timeline mutation
- floating-point-safe key time matching
- source-animation immutability

Do NOT rewrite those APIs.

---

# Goal

Implement:

# v0.5.2.3.2 — Visual Bone Keyframing Workflow

This milestone connects the existing Animation Editor and bone manipulation UI to the keyframe authoring core.

The user should now be able to:

1. select a bone
2. scrub to a time
3. inspect its animated transform
4. change transform values
5. explicitly create/update keyframes
6. delete authored keys at the current time
7. immediately see the resulting animation pose

Do NOT build full timeline tracks or draggable keyframe diamonds yet.

---

# 1. Bone selection

Reuse existing visual bone selection/hierarchy concepts from the Rig Editor where practical.

Do not duplicate skeleton-selection architecture unnecessarily.

The Animation Editor should support selecting a bone through:

- puppet/bone visualization if already practical
- hierarchy/list UI

Selection itself must not modify animation data.

---

# 2. Animation transform inspector

When a bone is selected, show its relevant animation transform values at `currentTime`.

For example:

```text
Bone: rightForearm

X:        [...]
Y:        [...]
Rotation: [...]
Scale X:  [...]
Scale Y:  [...]
```

Only expose properties supported by the current animation schema.

Use existing numeric editor UI patterns where practical.

---

# 3. Critical distinction: rig transform vs animation transform

Do NOT accidentally edit the rig/bind pose.

Animation Editor transform editing means:

```text
authored animation transform
```

not:

```text
rig bind transform
```

The Rig Editor remains responsible for bind/rest rig structure.

The Animation Editor modifies animation data only.

---

# 4. Pose displayed at currentTime

When selecting a bone at the playhead, inspector values should correspond to the animation pose/evaluation at that time.

Reuse the existing evaluator.

Do NOT duplicate interpolation logic.

The visible puppet pose and inspector values must agree.

---

# 5. Explicit keyframing

For this milestone, prefer EXPLICIT key creation rather than hidden automatic keyframing.

Provide an action conceptually like:

```text
[ Set Key ]
```

or property-specific controls.

When the user changes a property and commits it:

- use the v0.5.2.3.1 mutation API
- create a key if one does not exist
- update it if one already exists
- refresh preview
- mark dirty

Choose a clear UX and document it.

Do not introduce a complicated auto-key mode yet.

---

# 6. Property-level keying

Preserve partial animation support.

Prefer allowing individual transform properties to be keyed rather than forcing every property into every key.

For example:

```text
Rotation     27°    ● keyed
X            4      ○ not keyed
Y            0      ○ not keyed
```

Exact UI may differ.

A clear keyed/not-keyed indicator is required.

---

# 7. Set key from current visible value

The editor should support a workflow like:

```text
scrub to 0.8 s
↓
select forearm
↓
change rotation to 35°
↓
Set Key
↓
rotation key at 0.8 s is authored
↓
preview updates
```

The value written must correspond to the authored/local transform convention expected by the existing animation schema.

Do NOT bake world-space transforms accidentally.

Do NOT bake IK output.

---

# 8. Local transform correctness

Keyframes must use the same coordinate/transform space as existing animation definitions.

Do not author:

```text
screen coordinates
world coordinates
final IK-corrected coordinates
```

when the runtime expects:

```text
bone-local animation transform
```

Reuse existing conversion utilities.

This is especially important for nested bones.

---

# 9. Visual manipulation

Where practical, reuse existing Rig Editor manipulation controls for rotating/moving a selected bone, but in Animation Editor mode their target must be animation authoring state.

Architecture should distinguish:

```text
Rig Editor drag
→ modifies rig working copy

Animation Editor drag
→ modifies prospective/current animation transform
```

Do not share mutable state incorrectly.

If reusing the existing manipulator would require dangerous refactoring, numeric editing is sufficient for this subversion.

Prioritize correctness over fancy handles.

---

# 10. Uncommitted edits

Avoid ambiguous state.

Choose a clear model such as either:

### A

Changing a committed numeric value immediately writes/updates a key.

or:

### B

Editing produces a temporary value and pressing `Set Key` commits it.

For this milestone, B is preferred if it cleanly prevents accidental animation mutation.

If using temporary edits:

- keep them editor-only
- do not mark dirty until committed
- Cancel/reset should restore evaluated value

Document the behavior.

---

# 11. Delete key at playhead

Provide an action for deleting a property key at `currentTime`.

Example:

```text
Rotation 35°   ●   [Delete Key]
```

Deletion must use the v0.5.2.3.1 mutation API.

After deletion:

- re-evaluate animation
- display resulting interpolated/default value
- update keyed status
- mark dirty

Do not delete unrelated keys.

---

# 12. Bone-level convenience action

Optionally provide:

```text
Set Transform Key
```

which keys all currently supported transform properties for the selected bone.

Only implement this if it fits cleanly.

Property-level keying remains authoritative.

Do not require users to always key every transform property.

---

# 13. Keyed indicators

Show clearly whether each property has an authored key at `currentTime`.

For example:

```text
Rotation  [35.0]   ●
X         [ 2.0]   ○
Y         [ 0.0]   ○
```

Use the keyed-state query API from v0.5.2.3.1.

Do not infer keyed state from whether the displayed value differs from the bind pose.

---

# 14. Preview refresh

After create/update/delete:

```text
working animation changes
↓
existing evaluator runs at currentTime
↓
puppet preview refreshes
↓
inspector refreshes
```

No duplicate evaluator.

---

# 15. Playback interaction

Do not allow visual editing and automatic playback to fight.

Preferred behavior:

When the user starts editing an authored transform:

```text
if playing
→ pause playback
```

Keep current time unchanged.

Do not automatically resume after a keyframe edit.

This is safer for authoring.

Document behavior.

---

# 16. Scrubbing interaction

When currentTime changes:

- discard or explicitly handle any temporary uncommitted edit
- update evaluated transform values
- update keyed indicators

Do not accidentally carry a temporary edit from time 0.5 to time 1.2.

Prefer cancelling temporary edits when navigation changes.

---

# 17. IK safety

This is critical.

The inspector/keyframe authoring should represent authored animation transform BEFORE IK correction.

Do NOT save final IK-adjusted bone rotation/position as a key.

Existing pipeline remains conceptually:

```text
authored animation
↓
pose
↓
IK/procedural correction
↓
render
```

A later milestone may add explicit IK baking.

Not now.

---

# 18. Facing safety

Preview facing/mirroring must not change authored key values.

Keyframes should remain canonical-facing authored data.

Do not bake mirrored preview values.

---

# 19. Dirty state

These mark dirty:

- create key
- update key
- delete key

These do not:

- select bone
- scrub
- inspect values
- enter temporary uncommitted value
- change preview facing
- toggle IK preview

---

# 20. Tests

Add tests for the editor/controller logic where practical.

Cover:

- selecting bone does not mutate animation
- commit creates correct property key
- commit updates existing property key
- deleting property key works
- unrelated properties remain unchanged
- temporary edit does not dirty before commit
- committed edit marks dirty
- currentTime change clears temporary edit if that is the chosen UX
- source animation remains immutable
- authored values use expected local transform representation
- IK preview does not alter key data
- facing preview does not alter key data

Avoid brittle DOM tests unless existing test infrastructure already supports them well.

---

# 21. Manual verification

Use at least one existing demo character.

Verify:

### Bone selection

- select torso
- select upper arm
- select forearm
- select hand
- selection changes inspector

### Rotation key

At `0.5 s`:

- select forearm
- change rotation
- commit key
- verify puppet pose changes
- scrub away
- scrub back
- verify key is preserved

### Translation key

For a bone supporting translation:

- author X/Y
- verify hierarchy behaves correctly

### Delete

Delete a key:

- keyed indicator disappears
- evaluated pose updates correctly

### Partial animation

Key only rotation:

- ensure no unwanted X/Y/scale keys appear

### Playback

After adding multiple keys:

- press Play
- existing evaluator animates between/through them correctly

### IK

With IK preview enabled:

- author transform
- verify saved value is pre-IK authored value

---

# 22. Do NOT implement yet

Do not implement:

- full bone timeline tracks
- keyframe diamonds on tracks
- dragging/moving keyframes
- range selection
- multi-key selection
- copy/paste keyframes
- mirrored-key operations
- auto-key mode
- per-key interpolation editor
- animation event editor
- onion skinning
- ghost poses
- IK target animation
- IK baking
- production animation export workflow

Those belong to later milestones.

---

# 23. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

---

# Definition of done

v0.5.2.3.2 is complete when:

- Animation Editor supports bone selection
- selected bone's animated transform is inspectable
- displayed values correspond to currentTime
- properties clearly show keyed/not-keyed state
- user can create a property key
- user can update a property key
- user can delete a property key
- partial transform keying works
- preview updates immediately
- edits use correct local transform space
- rig bind pose is not modified
- IK output is not baked
- facing preview is not baked
- authored mutation affects working animation only
- dirty-state behavior is correct
- existing playback continues to work
- tests/typecheck/build pass

---

# Final report

Report:

## Implemented

## Visual authoring workflow

Explain exactly how a user creates, updates, and deletes a key.

## Transform space

Explain what transform representation is stored.

## IK/facing safety

## Files changed

## APIs changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.3.3+

Do not claim completion unless all commands pass.
