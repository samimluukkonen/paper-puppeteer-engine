You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.5.1

The Animation Editor now supports:

- multi-key selection
- primary key
- Ctrl/Cmd additive selection
- Shift range selection
- marquee selection
- selection reconciliation
- multi-key deletion
- existing Undo/Redo

Do NOT redesign selection.

---

# Goal

Implement:

# v0.5.2.5.2 — Copy, Paste & Duplicate Keyframes

Add editor keyframe clipboard operations.

Implement:

1. copy selected keyframes
2. internal editor keyframe clipboard
3. paste relative to currentTime
4. preserve timing offsets
5. duplicate selected keyframes
6. collision handling
7. cross-bone/property preservation
8. selection of newly pasted keys
9. one Undo transaction per paste/duplicate

Do NOT implement group dragging yet.

---

# 1. Internal clipboard

Create an editor-side keyframe clipboard.

Do NOT depend on the system clipboard for core functionality.

Conceptually:

```ts
interface KeyframeClipboard {
  entries: KeyframeClipboardEntry[];
  anchorTime: number;
}
```

Each entry should contain enough authored data to recreate:

- bone
- property
- relative time
- key value
- interpolation metadata if applicable

Use existing animation schema/types.

Do not serialize Phaser/editor objects.

---

# 2. Copy

Command:

```text
Ctrl/Cmd + C
```

Copies selected keys.

Copy must NOT:

- modify animation
- dirty animation
- create history
- move currentTime

Empty selection:

do nothing safely.

---

# 3. Clipboard anchor

Preserve relative spacing.

Preferred anchor:

```text
earliest selected key time
```

Example selected keys:

```text
0.5
0.8
1.2
```

Clipboard relative times:

```text
0.0
0.3
0.7
```

If pasted at:

```text
2.0
```

results:

```text
2.0
2.3
2.7
```

Do not collapse copied keys onto one time.

---

# 4. Preserve tracks

Copy must preserve each key's:

```text
boneId
property
```

Example:

```text
forearm.rotation @ 0.5
hand.rotation @ 0.7
torso.x @ 0.9
```

Paste should recreate those same track relationships.

Do not paste everything into the currently selected track.

---

# 5. Paste

Command:

```text
Ctrl/Cmd + V
```

Paste clipboard so its anchor is placed at:

```text
currentTime
```

Use existing keyframe mutation APIs.

Paste must be one history transaction.

---

# 6. Duration handling

Define behavior when pasted keys would exceed animation duration.

Preferred policy:

If animation duration is an explicit authored property that can be safely extended:

```text
extend duration to include pasted keys
```

ONLY if that matches the existing schema/runtime.

Otherwise:

```text
clamp/reject out-of-range keys
```

Inspect current architecture first.

Do NOT silently invent a new duration semantic.

Document chosen policy.

Avoid collapsing multiple out-of-range keys onto the same clamped time.

Rejecting the paste may be safer than destructive clamping.

---

# 7. Collision policy

Reuse the same same-track/same-time collision policy established in v0.5.2.4.3.

Do NOT invent different behavior for paste.

If destination already contains a key for the same:

```text
bone + property + time
```

apply the established replace/reject policy consistently.

Undo must restore exact previous state.

---

# 8. Pasted selection

After successful paste:

```text
selectedKeys = newly pasted keys
```

Choose a deterministic primary key, preferably the earliest pasted key or clipboard's original primary key if preserved.

Set:

```text
primaryKey
```

accordingly.

Do not keep old unrelated selection mixed in unless modifier behavior explicitly requests that.

---

# 9. currentTime after paste

Preferred:

```text
currentTime remains paste anchor
```

Do not jump to the last pasted key.

Preview should refresh at the current playhead time.

---

# 10. Duplicate

Add:

```text
Ctrl/Cmd + D
```

or an explicit Duplicate command.

Duplicate selected keys should use clipboard/group logic internally rather than a separate ad-hoc implementation.

Define a useful offset.

Preferred:

```text
duplicate by one authored frame
```

when valid FPS exists.

Otherwise use a small deterministic timeline step.

Alternative acceptable behavior:

duplicate and immediately enter move mode only if existing architecture supports this cleanly.

Do not place duplicates exactly on top of originals.

---

# 11. Duplicate offset safety

If the duplicate offset would create collisions:

use the established collision policy or choose the next valid snapped position if that fits existing conventions.

Keep behavior deterministic.

Document it.

---

# 12. Copy/paste key values exactly

Copied keys must preserve authored values exactly.

Do NOT:

- sample evaluator output
- bake world transforms
- bake IK
- bake mirrored facing
- recompute values from visual pose

Clipboard contains authored keyframe data.

---

# 13. Interpolation metadata

If the current keyframe schema already stores interpolation information:

copy/paste must preserve it.

Do NOT implement editing that metadata yet.

Just preserve it.

---

# 14. Source immutability

Paste/duplicate mutate:

```text
workingAnimation
```

only.

`sourceAnimation` remains untouched.

---

# 15. History

Each:

```text
Paste
```

is one Undo action.

Each:

```text
Duplicate
```

is one Undo action.

Example:

```text
paste 12 keys
Undo
→ remove all 12 and restore replaced collision keys if applicable
```

Redo must restore exactly.

---

# 16. Dirty state

Copy:

```text
not dirty
```

Paste:

```text
dirty
```

Duplicate:

```text
dirty
```

Selection changes:

```text
not dirty
```

---

# 17. Keyboard shortcut safety

Do not intercept:

```text
Cmd/Ctrl+C
Cmd/Ctrl+V
Cmd/Ctrl+D
```

while user focus is inside a text/numeric input where native editing behavior should win.

Use existing shortcut filtering architecture.

Be careful with browser bookmark shortcut behavior for Ctrl/Cmd+D.

Only intercept Duplicate when Animation Editor timeline context is appropriate.

If Cmd+D is unsafe/conflicting, use another shortcut and document it.

---

# 18. Clipboard lifetime

The internal keyframe clipboard may survive:

- selection changes
- scrubbing
- playback
- switching between animations within the same Animation Editor session

But pasting must validate that referenced bones/properties exist in the destination animation's rig.

If not valid:

- skip invalid entries with clear feedback
- or reject paste cleanly

Do not crash.

---

# 19. Cross-animation paste

If two animations belong to the same compatible rig, pasting copied keys between them should work if bone/property references remain valid.

This is desirable.

Do not hard-code clipboard to animation identity.

Validate references before mutation.

---

# 20. Tests

Add tests for:

### Copy

- copies all selected keys
- preserves tracks
- preserves values
- preserves relative timing
- does not dirty animation

### Paste

- anchor placed at currentTime
- relative spacing preserved
- track mappings preserved
- pasted keys selected afterward
- one history operation

### Multiple properties/bones

Works correctly.

### Collision

Matches established collision policy.

### Undo/Redo

Restores exact state.

### Duplicate

Uses deterministic offset
and selects duplicates.

### Cross-animation

Compatible animation works.

### Invalid bone/property

Fails/skips safely according to documented policy.

### Source immutability

Still guaranteed.

---

# 21. Manual verification

Create/select keys across:

- torso
- upper arm
- forearm
- multiple properties

Test:

### Copy/paste

- select 5+ keys
- copy
- move playhead
- paste
- verify relative timing

### Undo/Redo

- Undo entire paste in one step
- Redo it

### Duplicate

- select group
- duplicate
- verify group spacing

### Collision

Paste onto existing keys.

Verify documented behavior.

### Cross-animation

- copy from idle
- switch to compatible animation
- paste
- verify bone/property references

### Playback

Play the pasted animation and confirm evaluator uses the new keys normally.

---

# 22. Do NOT implement yet

Do not implement:

- group drag
- multi-key keyboard nudge
- time scaling/stretching
- mirrored key copying
- cross-track remapping UI
- clipboard JSON/system clipboard export
- interpolation editor
- event copying
- onion skinning
- IK-target authoring

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

v0.5.2.5.2 is complete when:

- selected keys can be copied
- clipboard preserves exact authored data
- relative key timing is preserved
- paste anchors at currentTime
- original bone/property tracks are preserved
- collisions follow existing policy
- paste is one Undo action
- duplicates can be created
- duplicate offset is deterministic
- pasted/duplicated keys become selected
- cross-animation paste validates references
- source animation remains immutable
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Clipboard architecture

## Anchor/relative-time behavior

## Paste behavior

## Collision policy

## Duplicate behavior

## Cross-animation validation

## History/dirty behavior

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.5.3+

Do not claim completion unless all commands pass.
