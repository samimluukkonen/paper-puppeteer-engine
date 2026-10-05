# v0.5.2.2.3 — FPS, Playback Speed and Preview Controls

Continue from completed:

# v0.5.2.2.2

Do NOT rewrite working playback or timeline behavior.

## Goal

Add:

- editor playback-speed control
- authored animation FPS awareness/editing where supported
- stepped/smooth animation preview controls where supported
- improved playback UI/status
- current-time formatting

Do NOT implement keyframe authoring yet.

---

## 1. Playback speed

Add editor-only preview playback speed.

Suggested options:

```text
0.25×
0.5×
1×
1.5×
2×
```

Default:

```text
1×
```

Playback advancement should be:

```ts
deltaAnimationTime =
  deltaRealTime * playbackSpeed;
```

Playback speed must NOT modify animation data.

Changing playback speed must NOT mark animation dirty.

---

## 2. Authored FPS

Inspect the existing animation schema/runtime.

If it already supports per-animation FPS, expose it in the Animation Editor.

Example:

```text
FPS: [10]
```

Requirements:

- modify working animation only
- source animation remains unchanged
- validate values
- reject NaN/Infinity/negative values
- use reasonable editor bounds
- mark animation dirty
- preview updates immediately

Do NOT retime keyframes merely because FPS changes unless the existing format explicitly requires it.

If keyframes use seconds, preserve them.

---

## 3. Stepped/smooth animation setting

If the existing animation format has an explicit animation-level stepped/smooth setting, expose it.

Changing it should:

- modify working animation only
- mark dirty
- update preview immediately
- use existing runtime evaluator

Do NOT implement per-keyframe interpolation editing yet.

If the schema does not have a clean animation-level property, do not invent one.

---

## 4. Critical rendering rule

Keep:

```text
Phaser render/update FPS
```

separate from:

```text
authored animation FPS
```

Example desired behavior:

```text
Phaser: 120 FPS
animation: 10 FPS stepped
playhead: smooth
puppet pose: updates according to 10 FPS stepped evaluator
```

Do NOT throttle Phaser to 10 FPS.

Reuse the existing animation evaluator.

---

## 5. Smooth animation behavior

Smooth animations must remain smooth.

Do not quantize all animations to FPS boundaries.

Do not change existing interpolation algorithms.

---

## 6. Playback UI

Provide a clean developer-oriented UI, for example:

```text
[ Restart ] [ Play/Pause ]   Loop [x]

Time: 0.742 / 2.000 s
Speed: [1×]
FPS: [10]
Mode: Stepped
```

Exact layout can follow existing styles.

Do not introduce a UI framework.

---

## 7. Current-time formatting

Display time with sensible precision, e.g.:

```text
0.742 / 2.000 s
```

Do not expose floating-point noise.

Formatting must not reduce internal time precision.

---

## 8. Dirty state rules

These must NOT dirty animation:

- playback speed
- loop preview
- current time
- Play/Pause
- scrubbing

These MAY dirty animation:

- authored FPS
- authored stepped/smooth setting

Use existing dirty-state architecture.

---

## 9. Tests

Add tests for:

- 0.5× playback
- 1× playback
- 2× playback
- playback speed does not dirty animation
- playback speed does not mutate animation
- FPS edit affects working copy only
- source animation remains unchanged
- FPS edit marks dirty
- invalid FPS input rejected
- stepped/smooth authored setting behaves correctly if exposed

---

## 10. Manual verification

Test:

```text
0.5×
1×
2×
```

Verify speed differences.

Verify stepped animation:

- playhead moves smoothly
- pose remains stepped

Verify smooth animation remains smooth.

If FPS editing exists:

- change FPS
- preview updates
- dirty state changes
- source remains unchanged

---

## 11. Do NOT implement yet

Do not implement:

- bone tracks
- keyframe creation
- keyframe deletion
- keyframe movement
- interpolation editing per keyframe
- event editing
- onion skinning
- mirrored keys
- IK baking
- animation export workflow

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

v0.5.2.2.3 is complete when:

- playback speed works
- speed is editor-only state
- authored FPS is exposed if supported
- FPS changes working copy only
- stepped/smooth settings are exposed only if supported cleanly
- runtime evaluator remains authoritative
- Phaser render FPS is not throttled
- dirty-state rules are correct
- tests/typecheck/build pass

Report:

- implemented features
- authored vs transient state
- files changed
- APIs changed
- tests
- manual verification
- command results
- deferred features
