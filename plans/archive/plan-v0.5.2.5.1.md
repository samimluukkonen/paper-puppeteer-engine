You are continuing development of my standalone TypeScript project:

# Paper Puppeteer Engine

Current completed version:

# v0.5.2.4.3

Do NOT rebuild or replace working systems from earlier versions.

The Animation Editor already supports:

- animation working copies
- immutable source animation
- authoritative `currentTime`
- playback / pause / looping / restart
- playback speed
- scrubbing
- timeline ruler and playhead
- bone tracks
- expandable property tracks
- visual keyframe markers
- single-key selection
- bone/property/key selection synchronization
- keyframe deletion
- keyframe dragging
- keyframe time movement
- frame/time snapping
- keyboard keyframe nudging
- collision handling
- Undo/Redo
- dirty-state tracking
- working-animation validation
- existing runtime evaluator for preview
- IK/facing safety

Tech stack:

- TypeScript
- Phaser
- Vite
- npm
- strict TypeScript
- ES modules
- no React

Keep dependencies minimal.

---

# Goal

Implement:

# v0.5.2.5.1 — Multi-Key Selection Foundation

This milestone extends the timeline from single-key selection to multiple selected keyframes.

Implement:

1. multi-key selection model
2. Ctrl/Cmd-click additive/toggle selection
3. Shift-click range selection
4. box/marquee selection
5. selected-key visual states
6. synchronization with bone/property selection
7. multi-key deletion
8. safe Undo/Redo integration
9. clean selection invalidation after authored mutations

Do NOT implement copy/paste, duplication, or group dragging yet.

---

# 1. Replace single-key selection with a selection set

The editor currently supports one selected keyframe.

Generalize this into a selection collection.

Conceptually:

```ts
interface KeyframeRef {
  boneId: string;
  property: BoneTransformProperty;
  time: number;
}
```

and:

```ts
interface KeyframeSelectionState {
  selectedKeys: readonly KeyframeRef[];
  primaryKey: KeyframeRef | null;
}
```

Exact names should follow current project architecture.

Avoid DOM-element identity.

Do not add arbitrary persistent key IDs to animation JSON unless absolutely necessary.

Selection is editor-only state.

---

# 2. Primary key

When multiple keys are selected, maintain a clear concept of:

```text
primary selected key
```

The primary key is useful for:

- inspector context
- selected bone/property
- currentTime jumping
- future paste/group operations

For a normal click:

```text
selectedKeys = clicked key only
primaryKey = clicked key
```

For additive selection:

the most recently interacted key may become primary.

Document the chosen behavior.

---

# 3. Normal click

Clicking an unselected key without modifiers:

```text
clear previous key selection
↓
select clicked key
↓
make it primary
↓
select corresponding bone/property
↓
currentTime = key.time
```

Preserve current v0.5.2.4 single-key behavior.

---

# 4. Ctrl/Cmd additive selection

Support platform-appropriate additive selection:

```text
Ctrl-click
```

and:

```text
Cmd-click on macOS
```

Behavior:

- unselected key → add it
- selected key → remove it
- maintain valid primary key
- do not dirty animation
- do not create Undo history

Use modifier detection cleanly.

Do not require separate platform-specific code paths where avoidable.

---

# 5. Shift-click range selection

Implement a useful range-selection behavior.

Preferred behavior:

Within the same property track:

```text
select key A
Shift-click key D
→ select A through D on that property track
```

If Shift-click occurs on a different track, choose a simple deterministic behavior.

Preferred:

```text
select all keys in the rectangular time/track range
```

ONLY if this can be implemented cleanly.

Otherwise:

```text
Shift-click on different track
→ replace/add clicked key
```

and document it.

Do not overbuild this feature.

---

# 6. Box / marquee selection

Allow dragging on empty timeline space to create a selection rectangle.

Example:

```text
pointer down on empty timeline
↓
drag rectangle
↓
keys inside rectangle become selected
```

Support multiple tracks.

Selection rectangle is transient UI state.

Do NOT alter authored animation data.

---

# 7. Coordinate correctness

Marquee selection must work correctly with:

- horizontal scrolling
- vertical scrolling
- timeline resizing
- timeline zoom if available

Use shared timeline coordinate conversion/state.

Do not rely on raw viewport positions as animation time.

---

# 8. Modifier + marquee

If clean to implement:

```text
normal marquee
→ replace selection

Ctrl/Cmd + marquee
→ add to selection
```

Optional toggle behavior is acceptable if consistent.

Do not make this milestone excessively complex.

---

# 9. Selected marker visuals

All selected keyframe markers must be visibly distinguishable.

The primary key should optionally have a stronger visual state.

Example:

```text
◆ normal
◇ selected
◈ primary
```

Exact CSS is not important.

Prioritize clear state.

---

# 10. Bone/property synchronization

With multiple selected keys, selection state may span multiple bones/properties.

Avoid contradictory UI assumptions.

Preferred model:

```text
primaryKey
→ controls inspector bone/property context

selectedKeys
→ timeline selection set
```

Therefore:

- multiple selected keys may exist across tracks
- inspector follows primary key
- selected bone/property corresponds to primary key
- selection set remains broader

Do not try to make the inspector simultaneously represent multiple unrelated bones.

---

# 11. currentTime behavior

Selecting a new primary key should normally jump:

```text
currentTime = primaryKey.time
```

Adding/removing secondary keys should NOT repeatedly move currentTime.

Example:

```text
click key A
→ currentTime = A

Cmd-click key B
→ B added
→ currentTime remains at A unless B becomes primary by documented policy
```

Choose consistent behavior.

Avoid playhead jumping unpredictably during multi-selection.

---

# 12. Playback interaction

Beginning key selection/manipulation while playback is active should pause playback if current single-key interaction already does so.

Do not automatically resume.

Multi-selection itself must not start playback.

---

# 13. Selection identity and floating-point times

Reuse the centralized key-time tolerance policy from v0.5.2.3/v0.5.2.4.

Do not create a new equality policy for multi-selection.

After a key is moved, Undo/Redo occurs, or animation data is normalized:

selection should still resolve correctly when possible.

---

# 14. Selection reconciliation

Create a centralized helper to reconcile selected key references against the current `workingAnimation`.

After mutation:

- retain references to keys that still exist
- remove references to deleted keys
- update primary selection if required
- never leave dangling key references

This should be reusable by future copy/paste/group operations.

---

# 15. Multi-key deletion

Delete / Backspace should delete ALL selected keyframes.

Requirements:

- one logical operation
- one Undo entry
- all selected keys removed
- unrelated keys untouched
- working animation remains valid
- dirty state becomes dirty
- selection clears after deletion
- preview refreshes
- track markers refresh

Use existing keyframe mutation APIs.

Do not directly splice raw arrays in DOM handlers.

---

# 16. Undo/Redo

Example:

```text
select 5 keys
Delete
↓
5 keys removed
↓
Undo
↓
all 5 restored
↓
Redo
↓
all 5 removed
```

One multi-delete = one history transaction.

Selection after Undo may be restored if cleanly supported, but authored data correctness is more important.

Document behavior.

---

# 17. Empty-area click

Clicking empty timeline space should clear key selection unless a modifier implies additive interaction.

Do not alter bone selection unnecessarily unless that matches existing UX.

---

# 18. Escape

Support:

```text
Escape
→ clear keyframe selection
```

unless Escape is currently reserved for another higher-priority editor action.

Do not dirty animation.

---

# 19. Selection and animation switching

When switching animations:

```text
clear selectedKeys
clear primaryKey
```

Do not carry key selections from animation A into animation B.

---

# 20. Selection and animation mutation

If inspector editing changes a selected key's value without changing its time:

selection should remain valid.

If the selected key is deleted:

remove it from selection.

If a selected key time is moved using existing v0.5.2.4 functionality:

its selection reference should follow the new time.

Generalize current single-key behavior cleanly.

---

# 21. Tests

Add pure/editor-state tests for:

### Normal selection

- click one key
- only that key selected
- primary correct

### Add selection

- Ctrl/Cmd-click second key
- both selected

### Toggle

- additive-click selected key
- key removed

### Primary key

- remains deterministic

### Range selection

- same-track Shift behavior correct

### Marquee

- keys inside selected
- outside excluded

### Multi-track marquee

- correct track/time boundaries

### Clear selection

- empty click
- Escape
- animation switch

### Reconciliation

- deleted keys removed from selection
- moved key remains resolvable

### Multi-delete

- all selected keys deleted
- one history transaction
- Undo restores all
- source animation immutable

### Dirty state

Selection alone does not dirty animation.

---

# 22. Manual verification

Use an animation with several bones and several property keys.

Verify:

### Click selection

- click one key
- existing behavior remains correct

### Additive selection

- Cmd-click several keys on macOS
- Ctrl-click also works where expected

### Toggle

- modifier-click selected key
- it is removed

### Range

- Shift-click keys on same track

### Marquee

- select several keys across multiple tracks
- scroll timeline and repeat

### Delete

- select several keys
- Delete
- Undo
- Redo

### Playback

- select keys while playing
- playback pauses predictably

### Mutation

- move an already selected key
- selection remains valid

---

# 23. Do NOT implement yet

Do not implement:

- copy keyframes
- paste keyframes
- duplicate selected keys
- group key dragging
- group keyboard nudging
- mirrored key copying
- cross-track paste mapping
- interpolation editing
- event markers
- onion skinning
- ghost poses
- IK target authoring

---

# 24. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Definition of done

v0.5.2.5.1 is complete when:

- single-key behavior still works
- multiple keyframes can be selected
- Ctrl/Cmd additive selection works
- Shift range selection works according to documented policy
- marquee selection works
- primary key concept exists
- inspector follows primary key
- multi-selection may span tracks
- selection never dirties animation
- multi-key deletion is one history action
- selection reconciles after authored mutations
- animation switching clears selection
- source animation remains immutable
- existing playback/scrubbing/key moving still works
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Selection model

Explain `selectedKeys` and `primaryKey`.

## Modifier behavior

Explain normal/Ctrl/Cmd/Shift selection.

## Marquee selection

## Selection reconciliation

## Multi-delete/history behavior

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.5.2+

Do not claim completion unless all required commands pass.
