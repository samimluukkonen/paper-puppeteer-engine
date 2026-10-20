You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.4.2

The Animation Editor timeline now supports:

- bone tracks
- property tracks
- keyframe markers
- single-key selection
- selected-key state
- key deletion
- Undo/Redo integration
- synchronized bone/property/key selection

Do NOT redesign these systems.

---

# Goal

Implement:

# v0.5.2.4.3 — Move Keyframes & Timeline Hardening

This milestone adds direct manipulation of keyframe timing.

Implement:

1. drag selected keyframes horizontally
2. move authored key time safely
3. snapping
4. collision/conflict handling
5. drag as one Undo operation
6. keyboard nudging
7. edge clamping
8. final v0.5.2.4 regression/hardening

Still support only ONE selected keyframe.

Do NOT implement multi-selection or copy/paste yet.

---

# 1. Keyframe move API

Add or extend a pure authored-data operation for moving a key.

Conceptually:

```ts
moveBonePropertyKeyframe(
  animation,
  boneId,
  property,
  fromTime,
  toTime
)
```

Use the existing key-time matching/tolerance policy.

Do NOT implement movement by UI code manually deleting/splicing arrays.

Centralize the authored mutation.

---

# 2. Move semantics

Moving a key should:

- change only its authored time
- preserve its value
- preserve interpolation metadata if applicable
- keep the property's keys sorted
- leave other bones/properties unchanged

Example:

```text
rotation:
0.0 → -20
0.5 → 30
1.0 → -10
```

move:

```text
0.5 → 0.7
```

result:

```text
0.0 → -20
0.7 → 30
1.0 → -10
```

---

# 3. Dragging key markers

Allow horizontal pointer dragging of a keyframe marker.

During drag:

```text
pointer X
↓
timeline X → time
↓
preview proposed destination
```

Use existing timeline conversion helpers.

Do NOT use screen pixels as authored animation data.

---

# 4. Drag transaction

One drag gesture must be ONE Undo operation.

Conceptually:

```text
pointer down
↓
drag updates temporary/provisional time
↓
pointer up
↓
commit authored move
```

Do NOT create history entries for every pointer-move event.

Reuse the Rig Editor gesture transaction pattern where practical.

---

# 5. Provisional drag state

Prefer keeping the authored animation unchanged during the active drag until commit, if this fits current architecture.

For example:

```ts
dragState = {
  originalTime,
  previewTime
}
```

Then on pointer release:

```text
commit move
```

This makes cancellation and history cleaner.

If the current editor architecture already safely mutates during drag with history snapshots, reuse that established pattern.

Do not create unnecessary architecture divergence.

---

# 6. CurrentTime while dragging

Preferred behavior:

While dragging a key:

```text
currentTime = previewTime
```

so:

- playhead follows
- puppet preview shows destination time
- inspector remains useful

Pause playback when key dragging begins.

Do not resume automatically after an authored key move.

---

# 7. Clamp to duration

A key may never be moved before:

```text
0
```

or after:

```text
animation duration
```

Clamp destination.

Do not produce negative times.

Do not produce keys beyond valid timeline bounds.

---

# 8. Snapping

Introduce simple keyframe-time snapping.

Reuse any timeline/grid/snapping infrastructure where appropriate.

Support at least:

### No snapping

continuous timeline time

and preferably:

### Frame snapping

snap to authored animation FPS:

```text
frameDuration = 1 / fps
```

Example at 10 FPS:

```text
0.0
0.1
0.2
0.3
...
```

If authored FPS is unavailable/invalid, fall back safely.

Do NOT force all animation data globally onto frame boundaries.

Snapping is an editor authoring aid.

---

# 9. Optional modifier behavior

If consistent with existing editor conventions, allow a modifier such as:

```text
Shift
```

to temporarily disable snapping during drag.

Only implement if conflict-free.

Document the behavior.

---

# 10. Key collision policy

Define deterministic behavior when moving a key onto an existing key of the SAME:

```text
bone
property
time
```

Do NOT allow duplicate same-time keys.

Choose a clear policy.

Preferred:

```text
moving key onto existing key
→ destination key is replaced by moved key
```

or reject the move.

Pick whichever best matches existing mutation APIs.

The important requirements are:

- deterministic
- no duplicate keys
- Undo restores exact prior state

Document the policy.

---

# 11. Cross-property safety

Moving:

```text
forearm.rotation
```

must not affect:

```text
forearm.x
upperArm.rotation
```

No accidental cross-track movement.

Key remains on its original property track.

This milestone moves TIME only.

Do not drag keys vertically between property tracks yet.

---

# 12. Keyboard nudging

For a selected keyframe, support small time movement from keyboard.

Good options:

```text
Left Arrow
Right Arrow
```

Move by:

- one snapped frame when frame snapping is active
- or a reasonable small time increment

Optional modifier:

```text
Shift + Arrow
```

for larger movement.

Use project shortcut conventions.

Do not trigger while typing in fields.

Each keyboard nudge should be one history action unless existing repeat batching supports something better cleanly.

---

# 13. Selection after move

After a successful move:

```text
selected key
```

must follow the new key time.

Do not leave selection pointing to the old nonexistent time.

Inspector/property selection remains unchanged.

---

# 14. Undo/Redo

Verify:

```text
drag key 0.5 → 0.8
Undo
→ 0.5

Redo
→ 0.8
```

Collision replacement must also undo exactly.

Keyboard nudges must be undoable.

---

# 15. Dirty state

Committed key move:

```text
dirty = true
```

Active provisional drag without commit should not create unnecessary dirty/history churn.

Cancelled drag should leave authored animation unchanged.

---

# 16. Escape/cancel

If practical, support:

```text
Escape
```

during an active drag to cancel the movement.

Result:

- original authored key unchanged
- no history entry
- no dirty-state change from the cancelled drag

Only implement if it fits cleanly.

---

# 17. Playback interaction

Starting a keyframe drag while playing should:

```text
pause playback
```

Do not let playback advance `currentTime` while a key is being authored/moved.

After drag ends, remain paused.

---

# 18. Timeline scrolling/coordinates

Key dragging must remain correct if the timeline is:

- horizontally scrolled
- resized
- zoomed, if zoom exists

Use existing coordinate conversion utilities.

Do not assume timeline begins at viewport X=0.

---

# 19. Marker refresh

After move:

- marker moves immediately
- timeline data remains synchronized
- inspector remains valid
- keyed indicators remain valid
- evaluator uses new key time
- playback uses new key time

No reload.

---

# 20. Pure tests

Add tests for:

### Move

```text
0.5 → 0.8
```

### Sorted order

Moving through neighboring key positions keeps sorted timeline.

### Clamp

Negative destination → 0.

Destination past duration → duration.

### Collision

Same bone/property destination collision follows documented policy.

### Isolation

Other tracks unchanged.

### Value preservation

Key value/interpolation metadata preserved.

### Frame snapping

Example:

```text
10 FPS
0.143 → 0.1
```

or whichever nearest-frame rule is chosen.

### Selection update

Selection follows new time.

### Undo/Redo

Exact restoration.

### Cancelled drag

No authored mutation.

### Source immutability

Still guaranteed.

---

# 21. Manual verification

Create keys at:

```text
0.0
0.5
1.0
```

Then:

- drag 0.5 → 0.7
- verify marker
- verify preview
- Undo
- Redo
- drag before zero
- verify clamped
- drag beyond duration
- verify clamped
- enable frame snapping
- verify marker lands on frame boundaries
- test collision with another key
- verify documented behavior
- move via keyboard arrows
- test while horizontally scrolled
- test while timeline resized
- try starting drag while playing
- confirm playback pauses

---

# 22. Full v0.5.2.4 regression pass

Verify no regressions to:

- bone selection
- inspector key creation
- inspector key deletion
- property keyed indicators
- Undo/Redo
- playback
- looping
- playback speed
- scrubbing
- timeline ruler
- playhead
- rig hierarchy
- source immutability
- dirty state
- stepped animations
- smooth animations
- IK preview
- facing preview
- Rig Editor
- character loading
- animation validation

---

# 23. Architecture review

Before completion verify there is no:

- duplicate timeline clock
- duplicate time-to-X conversion
- duplicate keyframe mutation implementation
- direct DOM ownership of authored data
- world-space key baking
- IK baking
- `any`
- unsafe unnecessary casts
- global mutable timeline state

Do not perform unrelated refactors.

---

# 24. Do NOT implement yet

Still defer:

- multi-key selection
- Shift/Cmd multi-select
- box/range selection
- copy keyframes
- paste keyframes
- duplicate keys
- move groups of keys
- vertical dragging between tracks
- mirrored key copying
- interpolation editing
- tangent/easing editor
- event track
- animation events UI
- onion skinning
- ghost poses
- IK target animation authoring
- IK baking

Those belong to v0.5.2.5+.

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

# Final v0.5.2.4 definition of done

The complete v0.5.2.4 milestone is done when:

- timeline contains bone tracks
- property tracks can expand/collapse
- keyframes are visible on property tracks
- keyframe positions correspond to authored time
- single keyframe selection works
- selecting a key synchronizes bone/property selection
- selected key can jump currentTime/playhead
- selected key can be deleted
- keys can be dragged horizontally
- key movement changes authored time only
- drag is one Undo operation
- keys remain sorted
- duplicate same-time keys cannot occur
- timeline snapping works
- selected key follows its moved time
- keyboard nudging works
- time boundaries are safe
- playback/scrubbing remain functional
- source animation remains immutable
- working animation remains authoritative
- timeline always reflects working animation
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Timeline architecture

## Key marker/selection architecture

## Key movement architecture

## Snapping

Explain the snapping policy.

## Collision policy

Explain exactly what happens when a key is moved onto another existing key.

## History behavior

Explain drag/nudge Undo/Redo.

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

## Deferred to v0.5.2.5+

Explicitly confirm that multi-key operations, copy/paste, interpolation editing, events, onion skinning, and IK authoring remain deferred.

Do not claim completion unless all required commands pass.
