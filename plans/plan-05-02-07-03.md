You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.7.2

The Animation Editor now supports:

- event track
- event markers
- event selection
- create/edit/delete events
- payload/data editing according to existing schema
- event movement
- event snapping
- event keyboard nudging
- Undo/Redo

This phase completes v0.5.2.7.

Do NOT redesign the runtime event system.

---

# Goal

Implement:

# v0.5.2.7.3 — Event Copy/Paste, Playback Semantics & Hardening

Implement:

1. copy selected event
2. paste event at currentTime
3. duplicate event
4. precise editor playback event semantics
5. correct looping/restart behavior
6. scrub safety
7. large-delta safety
8. serialization/validation regression
9. full v0.5.2.7 regression pass

Single-event selection is sufficient.

Do NOT implement event multi-selection unless it is trivial and clearly justified.

---

# 1. Event clipboard

Extend/reuse the existing Animation Editor clipboard architecture where practical.

Do not create an unrelated clipboard system if keyframe clipboard infrastructure can support typed clipboard contents cleanly.

Event clipboard must preserve exact authored event data.

Do not preserve editor/DOM objects.

---

# 2. Copy event

Support an appropriate:

```text
Ctrl/Cmd + C
```

when an event is the active timeline selection.

Copy:

- does not mutate animation
- does not dirty animation
- creates no history operation
- preserves event name/type/payload exactly

Do not interfere with text-field copy.

---

# 3. Paste event

Support:

```text
Ctrl/Cmd + V
```

when timeline context is active and event clipboard data is available.

Paste should:

```text
copied event
↓
new time = currentTime
```

All other authored event fields are preserved.

Paste is one Undo operation.

New event becomes selected.

---

# 4. Duplicate event

Provide Duplicate through a safe shortcut or visible action.

Use clipboard/clone infrastructure rather than ad-hoc code.

Duplicate should create a new event at a deterministic nearby time.

Prefer one authored frame later when valid FPS exists.

Otherwise use the existing timeline nudge step.

Do not duplicate directly on top of the source event unless same-time duplication is intentionally desired.

---

# 5. Same-time duplicates

If same-time events are legal, preserve them.

Do not accidentally de-duplicate events based solely on timestamp.

If the schema contains an event identity/name uniqueness rule, follow it.

---

# 6. Cross-animation paste

If copied event data is valid for another compatible animation:

allow paste.

Validate against destination schema.

Do not tie event clipboard unnecessarily to one animation instance.

---

# 7. Runtime event system remains authoritative

Do NOT create a second editor-specific algorithm for deciding when playback crosses events.

Reuse the existing runtime/event traversal semantics where possible.

The editor playback system should integrate cleanly with the existing event dispatch model.

---

# 8. Critical distinction: playback vs navigation

These operations must NOT fire runtime event side effects:

```text
scrubbing
clicking playhead
selecting event marker
selecting keyframe
Home/restart navigation while paused
manually setting currentTime
Undo/Redo
```

They are editor navigation/authoring operations.

---

# 9. Forward playback

Normal forward playback should preserve existing runtime event semantics.

An event should fire according to the existing runtime definition when playback crosses its timestamp.

Do not fire the same event repeatedly every render frame while currentTime remains near it.

---

# 10. Loop behavior

Verify events around the loop boundary.

Example:

```text
duration = 2.0
event A = 1.9
event B = 0.1
```

When playback crosses:

```text
1.8 → 0.2 through loop
```

the existing event semantics should correctly account for:

- event A before wrap
- event B after wrap

No event loss.

No duplicate unintended firing.

Reuse existing runtime behavior where available.

---

# 11. Large delta

A single playback update may cross multiple events.

Example:

```text
previousTime = 0.1
newTime = 0.8

events:
0.2
0.4
0.7
```

All relevant events must follow existing runtime semantics.

Do not only check equality with currentTime.

---

# 12. Multiple same-time events

If several events share:

```text
time = 0.5
```

normal playback must preserve deterministic dispatch of all of them according to runtime semantics.

Do not collapse them.

---

# 13. Restart behavior

Clarify behavior when:

```text
Play reaches end
↓
user presses Play again
```

or:

```text
Restart while playing
```

Avoid accidentally firing time-zero events twice through separate navigation and playback paths.

Use existing runtime conventions.

Document observed/final behavior.

---

# 14. Manual scrub safety

Scrubbing across ten events must still result in:

```text
0 event side effects
```

unless the project already explicitly implements an opt-in event preview mode.

Do NOT add such a mode now.

---

# 15. Optional event feedback

If useful and very small, the editor may show transient non-authored feedback that an event fired during normal playback.

For example:

```text
Last event: footstep
```

This is OPTIONAL.

Do not create a large event-debugging subsystem.

Do not persist it to animation data.

---

# 16. Copy/paste history

Paste and Duplicate each create one Undo transaction.

Example:

```text
paste event
Undo
→ event removed
Redo
→ event restored exactly
```

Payload and all metadata must round-trip.

---

# 17. Serialization

Verify event edits survive:

```text
working animation
→ existing serializer
→ parse/reload
```

where current infrastructure permits.

Preserve:

- event time
- event type/name
- payload
- same-time events
- deterministic ordering

Do not build final production animation export UI yet if that is reserved for v0.5.2.8.

---

# 18. Validation

Run current animation validator over event-edited animations.

Test:

- valid events
- same-time valid events
- malformed payload
- invalid time
- missing required fields

Do not weaken validation.

---

# 19. Undo/Redo stress sequence

Test sequences such as:

```text
create event
edit
move
duplicate
delete
Undo
Undo
Undo
Redo
Redo
```

State must remain exact.

Selection should reconcile safely.

---

# 20. Keyframe clipboard regression

If event clipboard reuses shared clipboard infrastructure, verify existing keyframe:

- copy
- paste
- duplicate

still work correctly.

Do not let event clipboard support regress keyframe editing.

Use discriminated clipboard content types if needed.

---

# 21. Event/key selection regression

Verify:

```text
select event
→ key selection clears

select key
→ event selection clears
```

Copy/paste commands should act on the appropriate active selection/context.

No ambiguous paste behavior.

---

# 22. Full manual verification

Create events such as:

```text
0.0   start
0.25  footstep-left
0.50  footstep-right
0.50  cloth
0.90  impact
```

Then test:

### Navigation

- scrub across all events
- confirm no side effects

### Playback

- play normally
- verify events follow runtime semantics

### Loop

- enable loop
- verify events near end/start

### Large delta

Where practical simulate/verify a frame crossing multiple events.

### Editing

- create
- edit
- move
- nudge
- delete

### Clipboard

- copy
- paste
- duplicate

### Undo/Redo

Test combinations.

### Serialization

Reload/round-trip if current infrastructure supports it.

---

# 23. Full v0.5.2.7 regression pass

Verify no regressions to:

- Rig Editor
- Animation Editor loading
- timeline
- ruler
- playhead
- scrubbing
- playback
- loop
- playback speed
- FPS behavior
- bone/property tracks
- keyframe markers
- key creation/update/delete
- multi-key selection
- key movement
- group movement
- copy/paste/duplicate
- interpolation editing
- Undo/Redo
- dirty state
- validation
- source immutability
- IK preview
- facing preview
- character loading

---

# 24. Architecture review

Verify there is no:

- duplicate runtime event dispatcher
- raw event-array mutations spread through UI
- DOM-owned authored event state
- duplicated timeline coordinate logic
- event timestamp equality based on fragile assumptions
- accidental event firing during scrub
- arbitrary story/game-specific event logic
- `any`
- unnecessary dependency

Paper Puppeteer Engine must remain generic.

---

# 25. Do NOT implement yet

Explicitly defer:

- advanced event debugger
- event breakpoint system
- event multi-selection unless trivial
- event group dragging
- event batch copy
- onion skinning
- ghost poses
- mirrored pose/keyframe copying
- IK target animation authoring
- IK baking
- scene choreography
- physics
- ragdolls
- mesh deformation

---

# 26. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Final v0.5.2.7 definition of done

The complete v0.5.2.7 milestone is done when:

- event track exists
- authored event markers are visible
- events can be selected
- events can be created
- events can be edited
- supported payload data can be edited
- events can be deleted
- events can be moved/nudged
- snapping works
- multiple same-time events remain valid where supported
- events can be copied
- events can be pasted
- events can be duplicated
- event mutations use Undo/Redo
- event mutations dirty working animation correctly
- source animation remains immutable
- scrubbing/navigation do not fire event side effects
- normal playback uses existing runtime event semantics
- loop crossings behave correctly
- large playback deltas handle all crossed events
- serialization/validation remain compatible
- keyframe editing/interpolation have no regressions
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Final event data model

## Event timeline/editor architecture

## Event authoring workflow

## Payload handling

## Movement/snapping

## Clipboard behavior

## Runtime playback semantics

Explain specifically:

- normal playback
- looping
- large delta
- same-time events
- restart
- scrubbing/navigation

## History/dirty behavior

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

## Deferred to v0.5.2.8+

Do not claim completion unless all required commands pass.
