You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.5.2

The Animation Editor now supports:

- multi-key selection
- primary key
- marquee/range selection
- multi-delete
- copy
- paste
- duplicate
- internal keyframe clipboard
- Undo/Redo
- individual key dragging/nudging

Do NOT redesign those systems.

---

# Goal

Implement:

# v0.5.2.5.3 — Group Keyframe Movement & Workflow Hardening

This completes v0.5.2.5.

Implement:

1. drag multiple selected keys as one group
2. preserve relative timing
3. multi-key keyboard nudging
4. group snapping
5. boundary handling
6. collision handling
7. one Undo transaction per group move
8. selection preservation
9. timeline editing hardening and regression checks

Do NOT implement interpolation/easing yet.

---

# 1. Group drag

When multiple keys are selected and the user drags one selected marker:

```text
move all selected keys together
```

Preserve relative timing.

Example:

```text
selected:
0.5
0.8
1.2

drag +0.4
→
0.9
1.2
1.6
```

Do not collapse spacing.

---

# 2. Dragging an unselected key

If user begins dragging a key that is not selected:

preferred existing behavior:

```text
replace selection with dragged key
↓
move only that key
```

Do not unexpectedly move a previous hidden selection.

---

# 3. Time delta model

Group dragging should use:

```text
deltaTime
```

relative to the drag's primary/origin key.

Do NOT independently round/recalculate each key from pointer X before determining group delta.

Conceptually:

```ts
delta = targetPrimaryTime - originalPrimaryTime

newTime_i = originalTime_i + delta
```

This preserves spacing.

---

# 4. Provisional group drag

During pointer movement:

keep a provisional group-move state.

Conceptually:

```ts
interface GroupKeyDragState {
  originalKeys: readonly KeyframeRef[];
  anchorKey: KeyframeRef;
  previewDelta: number;
}
```

Do not create history operations during every pointer move.

On release:

```text
commit one authored transaction
```

---

# 5. Group snapping

Apply snapping to the GROUP DELTA, not each key independently.

Example:

If anchor snaps by:

```text
+0.3 s
```

all selected keys move:

```text
+0.3 s
```

This prevents relative-spacing distortion.

Use existing frame/time snapping behavior.

---

# 6. Boundary handling

No selected key may move:

```text
< 0
```

or beyond the valid animation range, according to current duration semantics.

Therefore constrain the whole group's delta.

Example:

selected earliest key:

```text
0.2
```

user tries `-0.5`.

Allowed delta:

```text
-0.2
```

so earliest key lands at `0`.

Do NOT individually clamp keys because that would collapse spacing.

Similarly handle the group's latest key at the duration boundary.

---

# 7. Collision policy

Moving a group may collide with existing UNSELECTED keys.

Reuse the established key collision policy.

Important:

Keys inside the selected group must not be treated as conflicts with each other's ORIGINAL positions.

The move should conceptually remove the selected group from collision consideration before evaluating destination collisions.

Avoid false self-collisions.

---

# 8. Atomic group operation

A group move must be atomic.

Do not partially move some selected keys while others fail.

Preferred:

```text
validate entire destination
↓
commit entire move
```

If collision policy rejects the destination:

```text
reject whole move
```

If established policy replaces destination keys:

perform all replacements as one transaction.

Document behavior.

---

# 9. Key ordering

After group move:

all affected property timelines must remain sorted.

No duplicate same-track/same-time keys may exist.

Use centralized mutation helpers.

Do not sort/mutate arrays from UI code directly.

---

# 10. Selection preservation

After commit:

all moved keys should remain selected at their new times.

Primary key should follow its moved time.

Inspector bone/property context remains based on primary key.

---

# 11. currentTime during group drag

Preferred:

```text
currentTime follows preview time of primary/anchor key
```

The playhead follows the anchor during drag.

Pause playback when group dragging starts.

Remain paused afterward.

---

# 12. Escape/cancel

If existing single-key dragging supports Escape cancellation, extend this to group drag.

Cancelled group drag:

- restores original visual positions
- authored animation unchanged
- selection unchanged
- no history entry
- no dirty-state change

---

# 13. Multi-key keyboard nudging

When multiple keys are selected:

```text
Left Arrow
Right Arrow
```

should move the entire selection as a group.

Preserve relative spacing.

Use same group boundary/collision/snapping rules as pointer dragging.

Do not implement separate incompatible keyboard movement logic.

---

# 14. Nudge step

Use existing single-key nudge semantics:

- one frame when frame snapping is active
- otherwise existing small time step

Optional Shift modifier can use larger movement if already supported.

One keypress/group nudge = one history operation.

---

# 15. Group deletion regression

Ensure existing:

```text
Delete selected keys
```

still removes the entire group as one history transaction.

No regression from group move work.

---

# 16. Copy/paste regression

After moving a group:

- Copy uses new authored times
- Paste preserves new relative spacing
- Duplicate operates on moved selection

No stale selection refs.

---

# 17. Marquee regression

After group movement:

marquee selection must use markers at their new positions.

No cached stale coordinates.

---

# 18. Undo/Redo

Example:

```text
select 8 keys
drag +0.5
↓
Undo
→ all 8 return exactly

Redo
→ all 8 move again
```

Collision replacements must restore exactly.

Keyboard group nudging also must Undo/Redo.

---

# 19. Dirty state

Committed group movement:

```text
dirty
```

Provisional/cancelled movement:

must not create extra dirty/history churn beyond existing editor convention.

Selection and marquee state remain non-dirty.

---

# 20. Source immutability

All group movement must mutate:

```text
workingAnimation
```

only.

Never mutate source animation.

---

# 21. Timeline workflow polish

Perform a small UX pass on:

- modifier selection
- marquee selection
- copy
- paste
- duplicate
- Delete
- group drag
- arrow nudging
- Escape

Make keyboard behavior coherent.

Update the Animation Editor shortcut/help display.

Do not redesign visual styling.

---

# 22. Shortcut conflicts

Verify shortcuts do not fire when user is editing:

- text input
- numeric input
- textarea
- contenteditable
- appropriate select controls

Maintain native text-editing behavior.

---

# 23. Edge cases

Test:

- one selected key
- many selected keys
- keys across multiple properties
- keys across multiple bones
- keys with identical times on different tracks
- earliest key at 0
- latest key at duration
- group nearly filling duration
- collisions on several tracks simultaneously
- zero-duration animation
- switching animation with selection
- Undo after animation mutation
- timeline resize/scroll
- group dragging with snapping off/on

No crashes or dangling selections.

---

# 24. Tests

Add tests for:

### Group delta

Relative spacing preserved.

### Boundary constraint

Whole group constrained, not individually clamped.

### Group snapping

Anchor determines snapped delta.

### Multiple tracks

All keys move correct delta.

### Self-collision

Selected keys' original positions do not block the move.

### External collision

Established collision policy applied.

### Atomicity

Rejected group move changes nothing.

### Selection

Moved keys remain selected.

### Primary

Primary follows moved time.

### Keyboard nudge

Group moves together.

### Undo/Redo

Exact restoration.

### Cancel

No mutation/history.

### Copy regression

Copied moved group has updated authored times.

### Source immutability

Still guaranteed.

---

# 25. Manual verification

Build an animation with keys across multiple bones/properties.

Select a group with marquee.

Verify:

### Group drag

- drag right
- drag left
- relative spacing unchanged

### Boundaries

- drag until earliest reaches 0
- drag until latest reaches duration
- group remains intact

### Snapping

- enable frame snapping
- move group
- entire group uses one snapped delta

### Collision

- move group onto existing unselected keys
- verify documented policy

### Undo/Redo

- Undo one group drag in one action
- Redo

### Keyboard

- select group
- arrow nudge
- Undo

### Copy/paste

- move group
- copy
- paste elsewhere
- spacing preserved

### Playback

Play resulting animation and verify runtime evaluator uses edited keys normally.

---

# 26. Full v0.5.2.5 regression pass

Verify no regressions to:

- Animation Editor playback
- playhead
- scrubbing
- looping
- playback speed
- timeline ruler
- tracks
- key markers
- key creation
- key update
- key deletion
- single-key movement
- Undo/Redo
- multi-selection
- marquee
- copy/paste
- duplicate
- dirty-state lifecycle
- source immutability
- validation
- stepped animation
- smooth animation
- IK preview
- facing preview
- Rig Editor
- rig export
- character loading

---

# 27. Architecture review

Verify there is no:

- duplicated group-move mutation logic
- direct DOM mutation of authored animation arrays
- duplicated collision policy
- duplicated time equality policy
- per-key clamping that changes spacing
- per-key snapping that changes spacing
- stale selection cache
- accidental world-space authoring
- IK baking
- `any`
- unnecessary new dependency

Do not perform unrelated refactors.

---

# 28. Do NOT implement yet

Explicitly defer:

- interpolation/easing editor
- per-key stepped/smooth editing UI
- tangent/curve editor
- event track/editor
- animation event markers
- onion skinning
- ghost poses
- mirrored pose/keyframe copying
- IK-target animation authoring
- IK baking
- final production animation import/export workflow if still pending

These belong to v0.5.2.6+.

---

# 29. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Final v0.5.2.5 definition of done

The complete v0.5.2.5 milestone is done when:

- multiple keys can be selected
- modifier and marquee selection work
- primary selection is coherent
- multi-delete works
- selected keys can be copied
- pasted keys preserve relative timing and tracks
- selected keys can be duplicated
- multiple selected keys can be dragged together
- group movement preserves relative timing
- group snapping preserves spacing
- whole-group boundary constraints work
- collision handling is deterministic and atomic
- moved keys remain selected
- multi-key keyboard nudging works
- Undo/Redo treats group operations logically
- copy/paste/duplicate integrate with selection
- source animation remains immutable
- working animation remains authoritative
- timeline remains synchronized
- existing playback/scrubbing/IK/facing behavior remains intact
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Multi-selection architecture

## Clipboard/copy/paste architecture

## Group movement architecture

## Snapping and boundary behavior

## Collision/atomicity policy

## Selection reconciliation

## History behavior

## Shortcut behavior

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

Report exact results of:

```bash
npm run typecheck
npm run test
npm run build
```

## Deferred to v0.5.2.6+

Explicitly list interpolation/easing, events, onion skinning, mirrored operations, and IK authoring as deferred.

Do not claim completion unless all required commands pass.
