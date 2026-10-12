You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.6.2

Interpolation authoring and UI are implemented.

This phase is for hardening.

Do NOT add major new interpolation features.

---

# Goal

Implement:

# v0.5.2.6.3 — Interpolation Hardening & Regression

Focus on:

1. interpolation edge cases
2. multi-key workflows
3. playback/scrubbing correctness
4. undo/redo consistency
5. copy/paste preservation
6. duplicate preservation
7. serialization/validation
8. full timeline regression testing

---

# 1. Copy/paste preservation

Verify copied keys preserve interpolation metadata exactly.

Example:

```text
Smooth key
Stepped key
```

Copy/paste must retain their respective modes.

Do not default pasted keys to one mode.

---

# 2. Duplicate preservation

Duplicate must preserve:

- key value
- time offset behavior
- interpolation metadata

No loss of interpolation state.

---

# 3. Group move preservation

Moving keys in time must not alter interpolation metadata.

Only time changes.

---

# 4. Multi-delete / Undo

Deleting interpolation-bearing keys and Undoing must restore exact metadata.

Redo must remove them again.

---

# 5. Collision replacement

If current key collision policy replaces destination keys:

verify interpolation metadata follows the documented moved/pasted key behavior.

Undo must restore destination key's original interpolation exactly.

---

# 6. Last-key behavior

Test property tracks where the final key has interpolation metadata but no outgoing segment.

Ensure:

- runtime safe
- UI safe
- selection safe
- copy/paste safe
- validation safe

No misleading preview behavior.

---

# 7. One-key track

Test a property with only one key.

No crash.

Interpolation UI must follow v0.5.2.6.1 semantics.

---

# 8. Empty property track

No interpolation UI errors.

No invalid assumptions about first/next keys.

---

# 9. Mixed multi-selection

Select keys across:

- different bones
- different properties
- smooth/stepped modes
- applicable and unavailable keys

Verify mixed/unavailable behavior remains deterministic.

---

# 10. Scrubbing regression

Switch interpolation mode while paused and scrub immediately.

Preview must reflect new authored behavior.

No stale cached pose/evaluator state.

---

# 11. Playback regression

Change interpolation and:

- Play
- Pause
- Loop
- change playback speed
- Restart

All should use updated authored interpolation.

---

# 12. FPS interaction

Verify authored animation FPS/stepped preview settings do not get confused with key interpolation.

Keep these conceptual layers separate.

For example:

```text
animation FPS = 10
key interpolation = Smooth
```

must remain a valid distinction if supported by runtime.

Do not collapse them into one setting.

---

# 13. IK regression

Interpolation changes affect authored pose BEFORE IK.

Pipeline remains:

```text
animation interpolation
↓
authored pose
↓
IK/procedural correction
↓
render
```

No IK baking.

---

# 14. Facing regression

Preview facing/mirroring must not alter interpolation metadata.

Switch facing repeatedly and verify animation definition unchanged.

---

# 15. Undo/Redo regression

Test:

```text
change interpolation
move keys
copy/paste
delete
Undo repeatedly
Redo repeatedly
```

Animation state must remain exact and valid.

No stale interpolation UI.

---

# 16. Selection reconciliation

After:

- deletion
- paste
- duplicate
- group move
- Undo
- Redo

interpolation UI must reflect current selected keys accurately.

No references to deleted keys.

---

# 17. Serialization

If animation JSON serialization/export infrastructure currently exists internally:

verify interpolation metadata survives:

```text
working definition
→ serialize
→ parse/reload
```

without loss.

Do NOT build the final production export workflow if it is still deferred.

Just test round-trip compatibility where possible.

---

# 18. Validation

Run existing animation validation on edited interpolation data.

Do not weaken validation.

Invalid interpolation values must be rejected.

No arbitrary unknown strings.

---

# 19. Architecture review

Verify:

- no duplicate interpolation evaluator
- no duplicated authored mutation logic
- no interpolation state stored only in DOM
- no stale marker cache
- no `any`
- no unnecessary unsafe casts
- no new dependency
- runtime/editor separation preserved

Avoid unrelated refactors.

---

# 20. Tests

Expand automated coverage for:

- copy/paste interpolation
- duplicate interpolation
- move preservation
- collision behavior
- last key
- one-key track
- mixed selection
- Undo/Redo sequences
- serialization round trip
- validation
- source immutability
- playback evaluator integration where pure tests permit

---

# 21. Manual verification

Build a test animation with at least:

```text
Bone A / rotation:
0.0 Smooth
0.5 Stepped
1.0 Smooth

Bone B / x:
0.2 Stepped
0.8 Smooth
```

Then test:

- scrub
- playback
- looping
- multi-select
- change interpolation
- copy/paste
- duplicate
- group move
- delete
- Undo/Redo
- FPS changes
- playback speed
- IK preview
- facing preview

Confirm authored modes remain correct throughout.

---

# 22. Full v0.5.2.6 regression

Verify no regressions to:

- Rig Editor
- Animation Editor loading
- timeline ruler
- tracks
- key markers
- selection
- marquee
- key creation/update/delete
- individual movement
- group movement
- snapping
- copy/paste
- duplicate
- Undo/Redo
- playback
- loop
- scrubbing
- playback speed
- FPS handling
- animation validation
- source immutability
- IK
- facing
- character loading

---

# 23. Do NOT implement yet

Still defer:

- Bézier curve editor
- custom easing curves
- tangent handles
- event tracks
- animation event authoring UI
- onion skinning
- ghost poses
- mirrored keyframe operations
- IK target animation
- IK baking

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

# Final v0.5.2.6 definition of done

The complete v0.5.2.6 milestone is done when:

- authored interpolation can be queried
- interpolation can be edited
- multi-key interpolation editing works
- stepped/smooth modes use existing runtime semantics
- timeline shows interpolation state
- mixed selection works
- copy/paste preserves interpolation
- duplicate preserves interpolation
- moving keys preserves interpolation
- Undo/Redo restores interpolation exactly
- serialization/validation remain compatible
- playback/scrubbing use updated interpolation immediately
- FPS and interpolation remain separate concepts
- IK/facing do not affect authored metadata
- source animation remains immutable
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Final interpolation model

## Runtime/editor integration

## Multi-key behavior

## Copy/paste/move preservation

## Serialization/validation

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

## Deferred to v0.5.2.7+

Explicitly list events, onion skinning, mirrored operations, IK authoring/baking, and advanced curve editing as deferred.

Do not claim completion unless all required commands pass.
