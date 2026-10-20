# v0.5.2.2.1 — Core Animation Playback

You are continuing development of **Paper Puppeteer Engine**.

Current completed version:

# v0.5.2.1

Do NOT rebuild earlier systems.

The Animation Editor already has:

- animation working copies
- animation selection
- timeline
- ruler
- playhead
- manual scrubbing
- authoritative `currentTime`
- duration handling
- current-time display
- preview using the existing animation evaluator
- dirty-state plumbing

Tech stack:

- TypeScript
- Phaser
- Vite
- npm
- strict TypeScript
- ES modules
- no React

## Goal

Implement the core playback system for the Animation Editor.

This phase should add:

- Play
- Pause
- Restart
- optional Stop if it fits the existing UI
- delta-time-based playback
- automatic playhead movement
- synchronized puppet preview
- correct non-looping end behavior

Do NOT implement looping, playback speed, FPS editing, or keyframe authoring yet.

---

## 1. Playback state

Extend the Animation Editor state/controller with transient playback state.

Conceptually:

```ts
interface AnimationPlaybackState {
  isPlaying: boolean;
}
```

Use existing project architecture/naming where possible.

`currentTime` must remain the single authoritative animation-editor time.

Do NOT create separate timeline/runtime/playhead clocks.

---

## 2. Play

When Play is pressed:

- begin advancing `currentTime`
- continue from the current position
- update playhead automatically
- update puppet preview
- update time display

If Play is pressed while:

```text
currentTime == duration
```

restart from `0` and begin playing.

---

## 3. Pause

Pause must:

- stop automatic time advancement
- preserve current time
- preserve preview pose
- preserve playhead position

Pressing Play again resumes from the paused position.

---

## 4. Restart

Implement Restart.

Preferred behavior:

```text
Restart while playing
→ currentTime = 0
→ continue playing
```

```text
Restart while paused
→ currentTime = 0
→ remain paused
```

Update preview immediately.

---

## 5. Stop

Only add a separate Stop control if it fits cleanly.

If implemented:

```text
Stop
→ isPlaying = false
→ currentTime = 0
```

Do not confuse Pause and Stop semantics.

---

## 6. Delta-time playback

Playback must be based on elapsed time.

Conceptually:

```ts
currentTime += deltaSeconds;
```

Do NOT advance a fixed amount per render frame.

Do NOT assume 60 FPS.

Use the existing Phaser/editor timing infrastructure.

---

## 7. Non-looping end behavior

For now playback is non-looping.

When playback reaches the animation duration:

```text
currentTime = duration
isPlaying = false
```

The final pose must remain visible.

Do NOT automatically reset to zero.

Do NOT repeatedly trigger end-state logic every render frame.

---

## 8. Synchronization

During playback:

```text
currentTime
↓
existing animation evaluator
↓
puppet preview
```

and:

```text
currentTime
↓
timeline playhead
```

The playhead must not own playback state.

Reuse timeline conversion helpers from v0.5.2.1.

---

## 9. Renderer vs animation time

Do NOT throttle Phaser rendering.

The render loop may run at 60/120/144+ FPS.

Playback time advances continuously.

The existing animation evaluator remains responsible for stepped/smooth animation behavior.

Do not duplicate interpolation logic in the editor.

---

## 10. Dirty state

These actions must NOT mark animation data dirty:

- Play
- Pause
- Restart
- Stop
- playback time advancing

Playback is transient editor state.

Source and working animation data must remain unchanged.

---

## 11. Keyboard shortcut

Add:

```text
Space = Play / Pause
```

Do not trigger this when the user is typing in an input/select/textarea/content-editable element.

Reuse existing shortcut infrastructure.

---

## 12. Tests

Add tests for:

- playback advances with delta
- pause freezes time
- restart behavior
- playback stops exactly at duration
- final time never exceeds duration
- zero-duration animation remains safe
- playback does not mutate source animation
- playback does not mark animation dirty

Prefer pure unit tests.

---

## 13. Manual verification

Verify:

- Play works
- Pause works
- Resume works
- Restart works
- playhead moves automatically
- puppet animates
- time display updates
- animation stops at final frame
- final pose remains visible
- pressing Play at the end restarts correctly
- Rig Editor still works

---

## 14. Do NOT implement yet

Do not implement:

- loop playback
- playback speed
- editable FPS
- stepped/smooth editor controls
- advanced scrub/play interaction
- keyframe editing
- event editing
- onion skinning
- animation export workflow

---

## 15. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

---

## Definition of done

v0.5.2.2.1 is complete when:

- Play/Pause works
- Restart works
- playback is delta-time based
- currentTime remains authoritative
- playhead follows playback
- puppet preview follows playback
- playback stops at duration
- final pose remains visible
- source animation stays unchanged
- playback does not dirty animation data
- tests/typecheck/build pass

At the end, report:

- implementation summary
- files changed
- APIs added/changed
- tests added
- manual verification
- results of typecheck/test/build
- deferred features

