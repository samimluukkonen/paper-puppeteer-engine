You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.6.1

The project now has centralized interpolation query/mutation APIs based on the existing runtime/schema.

Do NOT rewrite them.

---

# Goal

Implement:

# v0.5.2.6.2 — Interpolation Editing UI

Expose authored interpolation editing inside the Animation Editor.

Implement:

1. interpolation control for selected key(s)
2. stepped/smooth selection
3. mixed-selection state
4. timeline marker indication
5. immediate preview refresh
6. multi-key interpolation edits
7. keyboard shortcut only if clean/conflict-free

Do NOT build a curve editor.

---

# 1. Interpolation editor UI

Add a compact control to the Animation Editor.

Example:

```text
Interpolation:
[ Smooth ▼ ]
```

Available options should come from the actual interpolation modes supported by v0.5.2.6.1.

Do not hard-code unsupported modes.

---

# 2. Selection-driven state

When one applicable key is selected:

show its interpolation.

Example:

```text
Interpolation: Smooth
```

When multiple selected keys share one mode:

```text
Interpolation: Stepped
```

When selected keys differ:

```text
Interpolation: Mixed
```

Use the v0.5.2.6.1 query API.

Do not manually inspect raw arrays in UI code.

---

# 3. No-selection state

With no key selected:

- disable interpolation control
- or show `—`

Do not allow ambiguous mutations.

---

# 4. Unavailable state

If a selected key cannot meaningfully control interpolation, for example a final key with no outgoing segment according to current schema:

show a clear disabled/unavailable state.

Do not silently mutate meaningless metadata unless the model explicitly allows it.

---

# 5. Multi-key changes

When multiple selected applicable keys exist:

changing interpolation should apply to all of them.

Example:

```text
select 6 keys
Interpolation → Stepped
```

must be:

- one authored operation
- one history entry
- one dirty-state transition
- preview refresh

Use centralized mutation API.

---

# 6. Mixed selection

If current selection is mixed:

```text
Interpolation: Mixed
```

Choosing `Smooth` should set all applicable selected keys to Smooth.

Choosing `Stepped` should set all applicable selected keys to Stepped.

Do not alter unavailable keys unless model semantics say they are valid.

---

# 7. Timeline visual indication

Make it possible to visually distinguish at least stepped vs smooth authored interpolation on key markers.

Keep visuals simple.

Examples:

```text
◆ smooth
■ stepped
```

or use a small secondary indicator.

Do not redesign the whole timeline.

The selected-state visual must remain clear.

Interpolation marker appearance must derive from authored data.

---

# 8. Tooltip / title

Where useful, marker hover may show:

```text
rightForearm.rotation
Time: 0.500 s
Interpolation: Stepped
```

Do not build a complex tooltip system if none exists.

Native title/compact tooltip is fine.

---

# 9. Preview refresh

When interpolation changes:

```text
workingAnimation changes
↓
existing evaluator re-evaluates currentTime
↓
preview updates immediately
```

No reload.

No duplicate evaluator.

---

# 10. Playhead position

Changing interpolation must NOT change:

- key times
- currentTime
- playhead position

Only interpolation semantics change.

---

# 11. Selection preservation

After interpolation edit:

- selected keys remain selected
- primary key remains valid
- selected bone/property remains valid

No unnecessary selection reset.

---

# 12. Playback integration

After interpolation changes:

Play should immediately use the new interpolation semantics.

Do not introduce an editor-specific playback path.

Existing runtime evaluator remains authoritative.

---

# 13. Stepped visual verification

For two keys:

```text
A at 0.0
B at 1.0
```

with stepped interpolation:

pose should hold A's value until runtime semantics switch to B.

Use existing evaluator behavior exactly.

---

# 14. Smooth visual verification

For the same keys with smooth interpolation:

pose should follow existing smooth interpolation between A and B.

Do not change smooth interpolation math.

---

# 15. Undo/Redo

Example:

```text
select several Smooth keys
set Stepped
Undo
→ Smooth
Redo
→ Stepped
```

UI marker appearance and control state must refresh correctly.

---

# 16. Dirty state

Changing authored interpolation:

```text
dirty
```

Selecting keys or opening dropdown:

```text
not dirty
```

---

# 17. Shortcut

OPTIONAL:

If there is a clean conflict-free shortcut architecture, add something like:

```text
S = stepped
M = smooth
```

ONLY when timeline context is active and no input has focus.

If this is likely to conflict with editor controls, skip it.

UI control is sufficient.

---

# 18. Tests

Add tests for editor/controller logic:

- one selected smooth key shows smooth
- one stepped key shows stepped
- mixed selection reports mixed
- no selection disabled
- unavailable key disabled
- multi-key edit calls one logical mutation
- selection preserved after edit
- currentTime unchanged
- Undo/Redo refreshes mode
- dirty behavior correct
- source unchanged

Avoid brittle pixel-level DOM tests.

---

# 19. Manual verification

Create at least:

```text
rotation key @ 0.0
rotation key @ 1.0
```

Test:

### Smooth

Set first key Smooth.

Scrub:

```text
0.0
0.25
0.5
0.75
1.0
```

Verify runtime preview is smooth.

### Stepped

Set first key Stepped.

Scrub same times.

Verify stepped hold behavior.

### Multi-selection

Select multiple keys across different tracks.

Set Stepped.

Verify all applicable keys change.

Undo/Redo.

### Mixed

Create mixed selection.

Verify UI reports Mixed.

### Playback

Play and verify authored mode is respected.

---

# 20. Do NOT implement yet

Do not implement:

- easing presets
- ease-in/ease-out families
- Bézier curves
- tangent handles
- visual curve graph
- per-axis curve editor
- event editing
- onion skinning
- ghost poses
- mirrored key copying
- IK target authoring
- IK baking

---

# 21. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

---

# Definition of done

v0.5.2.6.2 is complete when:

- selected key interpolation can be inspected
- selected interpolation can be changed
- multi-key editing works
- mixed state works
- unavailable state is safe
- timeline markers indicate interpolation
- preview updates immediately
- currentTime/key timing remains unchanged
- Undo/Redo works
- source animation stays immutable
- existing evaluator remains authoritative
- tests/typecheck/build pass

---

# Final report

Provide:

## Implemented

## Interpolation UI behavior

## Mixed-selection behavior

## Timeline marker behavior

## Preview/runtime integration

## History/dirty behavior

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.6.3+

Do not claim completion unless all required commands pass.
