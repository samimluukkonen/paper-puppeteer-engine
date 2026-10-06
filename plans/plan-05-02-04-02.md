You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.4.1

The Animation Editor timeline now has:

- bone tracks
- property tracks
- expand/collapse
- synchronized bone selection
- property-track selection
- shared timeline time coordinates
- existing ruler/playhead/playback/scrubbing

Do NOT redesign the timeline.

---

# Goal

Implement:

# v0.5.2.4.2 — Keyframe Markers & Selection

Add visual keyframe markers to property tracks and allow selecting a single keyframe.

Implement:

1. visible keyframe markers
2. correct time positioning
3. click-to-select keyframe
4. selected-key visual state
5. selection synchronization with playhead/currentTime
6. delete selected key command
7. navigation between keys if cleanly supported

Do NOT implement dragging/moving keys yet.

---

# 1. Keyframe markers

For every authored property keyframe, render a marker at its time.

Conceptually:

```text
rotation |---◆--------◆------◆------|
```

A diamond is conventional, but exact CSS is not important.

Markers must be based on authored keyframe data, not sampled/evaluated poses.

---

# 2. Time positioning

Reuse the timeline's existing:

```text
time → timeline X
```

conversion.

Do NOT write separate positioning math for keyframes.

A key at:

```text
time = 0
```

must align with timeline start.

A key at:

```text
time = duration
```

must align with the end.

---

# 3. Keyframe identity

Define a stable editor-side identity for a keyframe.

Conceptually it may contain:

```ts
interface KeyframeSelection {
  boneId: string;
  property: BoneTransformProperty;
  time: number;
}
```

Do not depend on DOM element identity.

Do not add persistent arbitrary IDs to animation JSON unless absolutely necessary.

Use existing animation structure as authority.

---

# 4. Single-key selection

For this milestone, support exactly ONE selected keyframe.

Click marker:

```text
select key
```

Click another marker:

```text
replace selection
```

Click empty timeline area:

choose a clear behavior, preferably:

```text
clear key selection
```

Do NOT implement multi-select yet.

---

# 5. Selected marker state

The selected marker must be visibly distinct.

Keep styling simple.

Selection is transient editor state:

- not dirty
- not undoable authored data
- not serialized

---

# 6. Selection and bone/property state

Selecting a key should also select its:

```text
bone
+
property track
```

so the inspector and timeline remain coherent.

Do not create contradictory states such as:

```text
selected key = forearm.rotation

selected bone = torso
```

Use one coordinated selection model.

---

# 7. Key selection and currentTime

Preferred behavior:

Clicking a keyframe marker should:

```text
select key
↓
currentTime = key.time
↓
playhead moves
↓
preview evaluates at key.time
```

This makes key selection useful for editing.

If playback is active, pause playback before jumping to the key.

Do not auto-resume.

---

# 8. Inspector integration

When a key is selected, the existing transform inspector should show the relevant bone/property at that exact time.

Existing keyed indicators should remain correct.

Do NOT create a separate keyframe inspector unless needed.

---

# 9. Delete selected key

Add a command such as:

```text
Delete
```

or an explicit UI button to delete the selected keyframe.

Use the existing v0.5.2.3 keyframe mutation API.

Deletion must:

- create one undo history operation
- mark authored animation dirty
- preserve unrelated keys
- refresh timeline markers
- refresh preview
- clear or update selection appropriately

Do NOT directly splice animation arrays in UI code.

---

# 10. Keyboard deletion safety

If supporting:

```text
Delete
Backspace
```

ensure it does not trigger while typing into editor inputs.

Do not accidentally navigate browser history with Backspace.

Use existing shortcut infrastructure.

---

# 11. Key navigation

If clean to implement, add:

```text
Previous Key
Next Key
```

for the current selected bone/property.

Could be buttons or shortcuts.

Behavior:

```text
jump currentTime
select destination key
update preview
```

This is optional if it would enlarge the milestone significantly.

Do not implement complicated cross-track navigation.

---

# 12. Key markers and animation mutation

If keyframes are created/deleted/updated via the inspector:

timeline markers must refresh immediately.

Do not require reload.

The timeline is a view of `workingAnimation`.

It must never become a stale independent copy of authored animation.

---

# 13. Undo/Redo

Existing keyframe Undo/Redo must update:

- key markers
- selection validity
- preview
- keyed indicators

Example:

```text
delete selected key
↓
Undo
↓
marker returns
```

If the previously selected key no longer exists after an operation, clear selection safely.

---

# 14. Floating-point time identity

Reuse the centralized key-time tolerance policy from v0.5.2.3.

Do not create a second equality rule for UI selection.

A key at `0.5` should still be identifiable after operations that produce a tiny floating-point difference.

---

# 15. Playback

Playback should continue to work while key markers are visible.

During playback:

- markers stay stationary
- playhead moves
- selected key may remain selected
- selected key does not force currentTime back to its time every frame

Key selection only changes time at the moment of selection.

---

# 16. Scrubbing

Scrubbing away from a selected key may either:

A. retain key selection

or

B. clear key selection

Choose one predictable behavior.

Preferred:

```text
retain selection
```

but do not let retained selection override `currentTime`.

---

# 17. Tests

Add tests for:

- marker model generated from authored keys
- correct marker time data
- selecting key selects bone/property
- selecting key sets currentTime
- key selection does not dirty animation
- deleting selected key mutates working animation
- deletion marks dirty
- deletion uses history
- Undo restores deleted marker
- Redo removes it again
- invalid/deleted selection clears safely
- source animation unchanged

---

# 18. Manual verification

Verify:

### Markers

- create several keys using existing inspector
- markers appear at correct positions
- keys at 0 and duration align correctly

### Selection

- click key
- correct bone/property selected
- playhead jumps to key
- preview updates
- inspector shows correct data

### Delete

- delete selected key
- marker disappears
- preview updates
- Undo restores
- Redo removes again

### Playback

- play animation
- markers remain correctly positioned
- playhead moves independently

### Scrub

- select key
- scrub elsewhere
- behavior remains predictable

---

# 19. Do NOT implement yet

Do not implement:

- dragging keys
- moving keys
- multi-key selection
- box selection
- copy/paste
- duplication
- keyframe groups
- event markers
- interpolation editor
- onion skinning
- mirrored key operations

---

# 20. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

---

# Definition of done

v0.5.2.4.2 is complete when:

- authored property keys appear as timeline markers
- markers use shared timeline coordinates
- a single key can be selected
- key selection selects matching bone/property
- key selection can jump currentTime to the key
- preview updates correctly
- selected keys are visually distinguishable
- selected key can be deleted
- Undo/Redo updates markers correctly
- timeline always reflects working animation
- source remains immutable
- playback/scrubbing remain functional
- tests/typecheck/build pass

---

# Final report

Provide:

## Implemented

## Marker architecture

## Keyframe selection architecture

## Deletion/history behavior

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.4.3+

Do not claim completion unless all commands pass.
