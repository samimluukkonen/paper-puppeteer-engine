# v0.5.2.2.2 — Looping and Scrub/Playback Interaction

Continue from completed:

# v0.5.2.2.1

Do NOT rewrite the playback controller.

## Goal

Add:

- Loop preview
- robust loop wrapping
- large-delta handling
- correct scrubbing while paused
- correct scrubbing while playing
- safe animation switching during playback

Do NOT implement playback speed or FPS editing yet.

---

## 1. Loop state

Add editor-only preview loop state.

Conceptually:

```ts
loop: boolean;
```

Loop state should NOT modify animation JSON unless the existing schema explicitly requires it.

Preferred:

```text
preview loop
= transient editor state
```

---

## 2. Loop behavior

When loop is enabled and playback passes duration:

wrap correctly.

Example:

```text
duration = 2.0
currentTime = 1.9
advance = 0.3

result = 0.2
```

Do not simply set time to zero, because that loses overshoot.

Handle multiple-duration overshoots too.

---

## 3. Zero duration

Do not modulo by zero.

For duration `0`:

```text
currentTime = 0
isPlaying = false
```

Keep UI stable.

---

## 4. Large delta handling

Handle cases such as:

- tab suspension
- debugger pause
- frame stall

For non-looping playback:

```text
advance past duration
→ clamp to duration
→ stop
```

For looping playback:

```text
advance by several animation lengths
→ wrap to valid time
```

No NaN or Infinity.

---

## 5. Scrubbing while paused

Existing scrubbing must remain unchanged:

```text
paused
↓
user scrubs
↓
currentTime updates
↓
preview updates
↓
remain paused
```

---

## 6. Scrubbing while playing

Implement clean interaction.

Preferred behavior:

```text
playing
↓
pointer-down starts scrub
↓
temporarily suspend automatic time advancement
↓
scrub controls currentTime
↓
pointer-up ends scrub
↓
resume playback if it was playing before
```

Do not allow playback and scrubbing to fight over `currentTime`.

Store only the minimal state required, e.g. conceptually:

```ts
wasPlayingBeforeScrub: boolean;
isScrubbing: boolean;
```

Use existing architecture/naming.

Scrubbing must not create undo history or dirty authored animation data.

---

## 7. Animation selection during playback

If the user selects another animation while playback is active:

```text
stop/pause old playback
↓
load selected working copy
↓
currentTime = 0
↓
preview new animation
```

Do not leave stale playback state from the previous animation.

Loop preference may remain an editor preference.

---

## 8. Event safety

Do NOT implement event authoring yet.

Manual scrubbing should primarily evaluate pose and should not repeatedly fire gameplay-style animation events unless existing architecture explicitly requires it.

Prefer:

```text
scrub
→ evaluate pose
→ no runtime side-effect events
```

Do not redesign the event system.

---

## 9. Tests

Add tests for:

- loop wrap
- loop with overshoot
- loop with very large delta
- non-loop large delta
- zero duration
- paused scrubbing
- playing → scrub → resume
- paused → scrub → remain paused
- animation switching during playback
- no dirty-state change from loop/scrubbing
- source animation unchanged

---

## 10. Manual verification

Verify:

- loop toggle works
- animation loops repeatedly
- no accumulating timing drift from lost overshoot
- manual scrub while paused works
- scrub while playing suspends playback during drag
- playback resumes after drag
- animation switch while playing is safe
- zero-duration animation does not crash
- large delta does not create invalid time

---

## 11. Do NOT implement yet

Do not implement:

- playback speed
- editable FPS
- stepped/smooth controls
- keyframe authoring
- event track editing
- onion skinning
- animation export

---

## 12. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

---

## Definition of done

v0.5.2.2.2 is complete when:

- looping works robustly
- overshoot is preserved
- large deltas are safe
- zero-duration animations are safe
- scrubbing while paused works
- scrubbing while playing behaves predictably
- playback safely resumes when appropriate
- animation switching during playback is safe
- transient navigation does not dirty animation data
- tests/typecheck/build pass

Report:

- implementation
- architecture/state changes
- files changed
- tests
- manual checks
- command results
- deferred features

