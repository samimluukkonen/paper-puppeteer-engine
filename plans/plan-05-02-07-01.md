You are continuing development of my standalone TypeScript project:

# Paper Puppeteer Engine

Current completed version:

# v0.5.2.6.3

Do NOT rebuild or replace working systems from earlier versions.

The Animation Editor already supports:

- animation working copies
- immutable source animation
- authoritative `currentTime`
- playback / pause / restart / looping
- playback speed
- FPS-aware preview
- bone/property tracks
- keyframe markers
- keyframe creation/update/delete
- keyframe multi-selection
- marquee/range selection
- keyframe dragging/group movement
- snapping
- copy/paste/duplicate
- Undo/Redo
- interpolation editing
- stepped/smooth interpolation
- dirty state
- validation
- existing runtime evaluator
- IK/facing safety

The runtime already supports animation events.

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

# v0.5.2.7.1 — Animation Event Model, Track & Selection

This milestone establishes visual animation-event support without yet implementing full event editing/movement.

Implement:

1. inspect and reuse the existing animation-event schema
2. pure event query/mutation foundations
3. dedicated timeline event track
4. visual event markers
5. single event selection
6. event selection synchronization with currentTime
7. editor-safe event identity
8. groundwork for editing/moving events in v0.5.2.7.2

Do NOT redesign the runtime event system.

---

# 1. Existing event schema is authoritative

First inspect the current animation runtime/schema.

Determine exactly how animation events are currently represented.

For example, the project may use fields conceptually like:

```text
time
name/type
payload/data
```

but use the actual existing types.

Do NOT invent incompatible event fields.

Do NOT create a second editor-only serialized event format.

---

# 2. Preserve runtime compatibility

Animation Editor-authored events must remain compatible with:

- existing AnimationDefinition
- existing runtime event dispatch
- existing animation validation
- loops
- crossfades where currently supported
- JSON serialization

Do not modify runtime event semantics unnecessarily.

---

# 3. Event references

Introduce a clean editor-side way to reference an authored event.

If the existing schema already has stable IDs, use them.

If it does not, create an editor-side reference strategy without unnecessarily adding persistent IDs to animation JSON.

Do not use DOM elements as event identity.

The reference must remain usable for:

- selection
- deletion
- movement
- Undo/Redo
- future copy/paste

---

# 4. Multiple events at the same time

Do NOT assume animation-event timestamps are unique.

If the existing runtime/schema allows:

```text
event A @ 0.5
event B @ 0.5
```

the editor must preserve that capability.

Do NOT apply keyframe same-time collision rules blindly to events.

---

# 5. Pure event queries

Create/reuse pure helpers for operations such as conceptually:

```ts
getAnimationEvents(animation)
getEventsAtTime(animation, time)
findAnimationEvent(animation, ref)
```

Exact API should match project conventions.

Keep this independent from DOM/Phaser where practical.

---

# 6. Event mutation foundation

Provide centralized authored-data helpers needed by later phases.

Conceptually:

```ts
addAnimationEvent(...)
updateAnimationEvent(...)
removeAnimationEvent(...)
```

Do not expose raw array splicing throughout UI code.

Requirements:

- working animation only
- source animation immutable
- event order deterministic
- JSON-compatible
- validation-compatible
- no `any`

Full UI editing comes in v0.5.2.7.2.

---

# 7. Event ordering

Keep animation events in deterministic time order where the existing schema expects ordering.

If multiple events share one timestamp, preserve deterministic relative ordering.

Do not randomly reorder same-time events during unrelated mutations.

---

# 8. Dedicated timeline event track

Add a dedicated event track to the Animation Editor timeline.

Conceptually:

```text
Events     |----◆------◆---◆----------|

torso
  rotation |--◆----------◆------------|
upperArm
  rotation |------◆------------◆------|
```

The event track should be visually separate from bone/property tracks.

Do not represent animation events as fake bones or fake keyframes.

---

# 9. Event marker positioning

Render event markers using the existing shared:

```text
time → timeline X
```

conversion.

Do not duplicate timeline coordinate math.

Events at:

```text
0
duration
```

must align correctly with timeline bounds.

---

# 10. Event marker contents

A marker should visually indicate that an event exists.

If useful and inexpensive, show the event name/type as:

- short label
- tooltip
- title attribute

Do not clutter the timeline excessively.

---

# 11. Event selection

Support one selected animation event for this subversion.

Clicking an event marker should:

```text
select event
↓
pause playback if currently playing
↓
currentTime = event.time
↓
playhead moves
↓
preview updates
```

Do not fire the event simply because it was selected.

---

# 12. Key selection vs event selection

Keep timeline selection coherent.

Preferred behavior:

```text
select event
→ clear keyframe selection

select keyframe
→ clear event selection
```

This avoids two unrelated primary selections controlling the inspector simultaneously.

Do not modify authored data when changing selection.

---

# 13. Selected event visual state

Selected event marker must be visibly distinct.

Keep styling simple.

Selection is:

- editor-only
- non-dirty
- non-serialized
- not an Undo action

---

# 14. Event inspector foundation

Add a read-only event inspector or extend the existing inspector area so the selected event's authored values can be seen.

Show only fields actually present in the current event schema.

For example, if supported:

```text
Event
Time: 0.750 s
Name: footstep
Payload: ...
```

Do NOT implement full editing yet.

---

# 15. Scrubbing

Scrubbing must NOT fire authored animation events as gameplay side effects.

Scrubbing remains pose/time navigation.

Conceptually:

```text
scrub
→ update currentTime
→ evaluate pose
→ do NOT dispatch runtime event callbacks
```

Preserve existing editor behavior.

---

# 16. Playback

Do not redesign playback/event dispatch yet.

This milestone is primarily about event data visualization and selection.

Existing playback must continue working.

More event-preview semantics will be hardened in v0.5.2.7.3.

---

# 17. Dirty state

These do NOT dirty animation:

- event selection
- track selection
- timeline navigation
- scrubbing
- viewing event inspector

Actual event mutations in pure APIs should support normal dirty/history integration when used later.

---

# 18. Empty states

Handle gracefully:

- animation with no events
- zero-duration animation
- event at time 0
- event at duration
- multiple events at identical time
- invalid event definition
- no animation selected

No crashes.

---

# 19. Tests

Add tests for:

- event query logic
- deterministic ordering
- same-time event support
- event reference resolution
- marker model generated from authored events
- event selection sets currentTime
- selecting event clears key selection
- selecting key clears event selection
- event selection does not dirty animation
- source animation remains immutable
- scrubbing does not dispatch event side effects

Prefer pure/editor-state tests where possible.

---

# 20. Manual verification

Use an animation containing several events.

Verify:

- event track appears
- markers align with ruler
- event at 0 aligns correctly
- event at duration aligns correctly
- two events at same time are represented
- clicking event selects it
- playhead jumps to event time
- inspector shows correct event
- selecting key clears event selection
- selecting event clears key selection
- scrubbing does not trigger events
- playback/keyframe editing still works

---

# 21. Do NOT implement yet

Do not implement:

- create-event UI
- editable event inspector
- event dragging
- event keyboard nudging
- event copy/paste
- event duplication
- event multi-selection
- event payload JSON editor
- event playback debug log
- onion skinning
- ghost poses
- mirrored key operations
- IK-target animation

---

# 22. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Definition of done

v0.5.2.7.1 is complete when:

- existing event schema is reused
- centralized event query/mutation foundations exist
- timeline has an event track
- authored events render as markers
- same-time events are supported
- events can be selected
- event selection moves currentTime/playhead
- event selection and keyframe selection remain coherent
- read-only event information is visible
- scrubbing does not dispatch runtime side effects
- source animation remains immutable
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Existing event schema

Explain the actual event representation discovered in the project.

## Event identity/reference strategy

## Event track architecture

## Selection architecture

## Same-time event handling

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.7.2+

Do not claim completion unless all required commands pass.
