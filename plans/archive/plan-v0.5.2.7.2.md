You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.7.1

The Animation Editor now has:

- existing event schema integration
- event query/mutation foundation
- dedicated event timeline track
- event markers
- single-event selection
- read-only event inspection
- coherent event/keyframe selection

Do NOT redesign those systems.

---

# Goal

Implement:

# v0.5.2.7.2 — Event Authoring, Editing & Movement

Implement:

1. create event at currentTime
2. edit selected event
3. delete selected event
4. edit supported event payload/data
5. drag event horizontally
6. snapping
7. keyboard nudging
8. Undo/Redo
9. validation
10. dirty-state integration

Do NOT implement event multi-selection yet.

---

# 1. Create event

Add a clear action such as:

```text
+ Event
```

Creating an event should use:

```text
currentTime
```

as its initial timestamp.

Pause playback if necessary.

Use the centralized event mutation API from v0.5.2.7.1.

---

# 2. Event defaults

Use sensible defaults based on the EXISTING schema.

Do not invent story-specific event names.

If an event requires a name/type, use a neutral developer default such as:

```text
event
```

only if validation requires one.

Prefer allowing the user to enter the required value immediately.

---

# 3. Editable inspector

Make the selected event inspector editable.

Expose only fields actually supported by the schema.

Typical examples might include:

```text
Time
Name / Type
Payload / Data
```

but inspect the real types first.

---

# 4. Payload/data editing

If events support payload data:

preserve JSON compatibility.

Do not allow:

- functions
- Phaser objects
- Maps
- Sets
- cycles
- `undefined` where JSON cannot represent it

If payload is structured JSON, a simple developer-oriented JSON text editor is acceptable.

Validate before commit.

Do not add a large JSON-editor dependency.

---

# 5. Edit transaction behavior

Editing one event field should create sensible history operations.

Do not create dozens of history entries for every keystroke.

Prefer:

```text
focus/input editing
↓
commit on blur/Enter/change
↓
one authored history operation
```

Follow existing numeric/keyframe inspector conventions.

---

# 6. Delete selected event

Support:

```text
Delete
```

and/or a visible Delete Event button.

Deletion should:

- remove only selected event
- create one history operation
- mark dirty
- clear event selection
- refresh timeline
- preserve unrelated events

Undo restores exact event data.

---

# 7. Drag event marker

Allow horizontal dragging of an event marker to change its time.

Use:

```text
pointer X
↓
existing timeline X → time
```

Do not duplicate conversion logic.

Movement changes TIME only.

Do not alter event name/payload.

---

# 8. Drag transaction

One event drag:

```text
pointer down
→ many preview updates
→ pointer up
```

must be ONE Undo operation.

Prefer provisional drag state if consistent with keyframe dragging.

Do not write history on every pointer move.

---

# 9. currentTime during drag

Preferred behavior:

```text
event preview time
→ currentTime
```

so playhead follows event marker while dragging.

Pause playback when drag begins.

Remain paused after authored event movement.

---

# 10. Time bounds

Event time must remain within valid animation bounds according to the current event/runtime schema.

Clamp safely to:

```text
0 ... duration
```

unless existing schema explicitly permits otherwise.

---

# 11. Event snapping

Reuse keyframe/timeline snapping infrastructure where appropriate.

Support the same relevant modes, such as:

- no snapping
- authored-frame snapping

Do not build a second snapping implementation solely for events.

---

# 12. Same-time events

Dragging an event onto another event's time must NOT automatically behave like a keyframe collision.

If multiple events at the same timestamp are valid:

allow it.

Do not replace an unrelated event merely because timestamps match.

---

# 13. Keyboard nudging

For a selected event:

```text
Left Arrow
Right Arrow
```

should move event time using existing timeline nudge/snapping conventions.

Do not trigger while typing inside inspector inputs.

Each committed nudge should integrate with Undo/Redo.

---

# 14. Undo/Redo

Verify:

```text
create event
Undo
Redo
```

```text
edit event
Undo
Redo
```

```text
delete event
Undo
Redo
```

```text
move event
Undo
Redo
```

Exact authored event data must be restored.

---

# 15. Selection after movement

After event time changes:

selected event reference must follow the moved event.

Do not leave selection pointing at stale time/index data.

Use the v0.5.2.7.1 reconciliation strategy.

---

# 16. Validation

Use existing animation/event validation.

Invalid values must not silently enter workingAnimation.

Examples:

- NaN time
- Infinity
- invalid required event name/type
- invalid payload representation
- unsupported fields

Do not weaken validation.

---

# 17. Dirty state

These mark dirty:

- create event
- edit event
- delete event
- move event

These do not:

- select event
- inspect event
- scrub
- change playback state

---

# 18. Source immutability

All event authoring must mutate:

```text
workingAnimation
```

only.

Never mutate `sourceAnimation`.

Add tests.

---

# 19. Event marker refresh

After any event mutation:

- marker updates immediately
- inspector updates
- timeline stays synchronized
- no reload required

Timeline remains a view of `workingAnimation`.

---

# 20. Tests

Add tests for:

### Create

- event created at currentTime
- source unchanged
- dirty true
- Undo removes it

### Edit

- supported fields update
- unrelated fields/events untouched

### Payload

- valid JSON-compatible payload preserved
- invalid payload rejected

### Delete

- exact event removed
- Undo restores

### Drag/move

- only time changes
- bounds respected
- same-time events allowed where supported
- selection follows moved event

### Snapping/nudge

Uses existing timeline policy.

### History

One logical operation per create/edit/delete/drag.

---

# 21. Manual verification

Verify:

### Create

- scrub to 0.75
- add event
- marker appears at 0.75

### Edit

- rename/type it
- edit supported payload
- marker/inspector stay synchronized

### Move

- drag event
- snapping works
- playhead follows

### Same time

- place two different events at same timestamp
- both remain intact

### Delete

- delete
- Undo
- Redo

### Boundaries

- move to 0
- move to duration

### Playback regression

- keyframes/interpolation/playback remain functional

---

# 22. Do NOT implement yet

Do not implement:

- event multi-selection
- event marquee selection
- event copy/paste
- event duplication
- group event movement
- firing events during scrub
- custom runtime event debugger
- onion skinning
- ghost poses
- IK target authoring

---

# 23. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Definition of done

v0.5.2.7.2 is complete when:

- events can be created at currentTime
- events can be edited
- supported payload data can be authored safely
- events can be deleted
- events can be dragged
- events can be keyboard-nudged
- event snapping uses shared timeline infrastructure
- same-time event semantics remain correct
- mutations integrate with Undo/Redo
- validation works
- source animation remains immutable
- timeline refreshes immediately
- tests/typecheck/build pass

---

# Final report

Provide:

## Implemented

## Event authoring workflow

## Payload handling

## Event movement/snapping

## Same-time event behavior

## History/dirty behavior

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.7.3+

Do not claim completion unless all required commands pass.
