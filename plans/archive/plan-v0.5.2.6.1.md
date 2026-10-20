You are continuing development of my standalone TypeScript project:

# Paper Puppeteer Engine

Current completed version:

# v0.5.2.5.3

Do NOT rebuild or replace working systems from earlier versions.

The Animation Editor already supports:

- animation working copies
- immutable source animation
- authoritative `currentTime`
- playback / pause / looping / restart
- playback speed
- timeline ruler and playhead
- scrubbing
- bone/property tracks
- visual keyframe markers
- multi-key selection
- primary key
- marquee/range selection
- create/update/delete keyframes
- keyframe dragging
- group keyframe movement
- snapping
- multi-key keyboard nudging
- copy/paste
- duplicate
- Undo/Redo
- dirty state
- validation
- existing runtime evaluator for preview
- stepped/smooth runtime animation behavior
- IK/facing safety

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

# v0.5.2.6.1 — Interpolation Authoring Core

This phase introduces reliable authored interpolation editing at the data/model level.

Do NOT build a curve editor.

Do NOT implement Bézier handles/tangents.

Focus on the interpolation types already supported by the runtime.

At minimum, support authored interpolation such as:

```text
stepped
smooth
```

ONLY if these concepts already map to the existing animation schema/runtime.

Do not invent incompatible interpolation semantics.

---

# 1. Inspect existing interpolation representation

First inspect how the runtime currently represents:

- stepped interpolation
- smooth interpolation
- per-animation interpolation
- per-track interpolation
- per-keyframe interpolation

Use the existing representation as authoritative.

Do not create a duplicate editor-only interpolation model if the current schema already supports one.

If interpolation is currently only global/per-animation, do not pretend per-key interpolation exists.

Extend only what is architecturally valid.

---

# 2. Clarify interpolation ownership

Interpolation must remain authored animation data when it is actually part of the animation definition.

Keep this distinction clear:

```text
preview playback mode
!=
authored interpolation metadata
```

Do not confuse editor preview FPS/stepped preview controls with authored key interpolation.

---

# 3. Central interpolation type

If not already centralized, create/reuse a strict type such as conceptually:

```ts
type InterpolationMode =
  | "stepped"
  | "smooth";
```

Use existing project names if present.

Do NOT use arbitrary strings.

Do NOT use `any`.

---

# 4. Interpolation query API

Provide pure helpers to determine interpolation for a key/segment according to the existing schema.

Conceptually:

```ts
getKeyframeInterpolation(...)
```

or:

```ts
getSegmentInterpolation(...)
```

depending on how the runtime models interpolation.

Do not duplicate runtime interpolation evaluation logic.

The editor should query authored metadata, not infer interpolation from sampled poses.

---

# 5. Interpolation mutation API

Add a centralized pure authored-data operation for changing interpolation.

Conceptually:

```ts
setKeyframeInterpolation(
  animation,
  keyRef,
  mode
)
```

or the appropriate track/segment equivalent.

Requirements:

- mutate working animation only
- preserve key value
- preserve key time
- preserve unrelated keys
- preserve unrelated bones/properties
- maintain valid serialization
- preserve source animation

Do not directly manipulate interpolation metadata from DOM/UI code.

---

# 6. Multi-key application support

The mutation layer should support applying an interpolation mode to multiple selected keys in one logical authored operation.

Conceptually:

```ts
setInterpolationForKeys(
  animation,
  selectedKeys,
  mode
)
```

Use the existing multi-selection/key reference model.

Do not implement UI yet.

---

# 7. Mixed interpolation query

For multiple selected keys, provide a way to answer:

```text
all stepped
all smooth
mixed
none/not-applicable
```

Conceptually:

```ts
type InterpolationSelectionState =
  | { kind: "uniform"; mode: InterpolationMode }
  | { kind: "mixed" }
  | { kind: "unavailable" };
```

Exact shape may differ.

This will be used by v0.5.2.6.2 UI.

---

# 8. Segment semantics

Be precise about what interpolation affects.

If interpolation belongs to the key at the START of a segment, preserve that convention.

Example:

```text
key A ---- segment ---- key B
```

If `key A.interpolation` controls A→B, document that.

Do not silently attach interpolation to the wrong key.

Add tests.

---

# 9. Last-key behavior

Handle the final key on a property timeline safely.

If interpolation metadata on the last key has no effect because there is no outgoing segment:

- keep behavior valid
- UI may later mark it unavailable
- do not crash
- do not create inconsistent state

Do not invent semantics for a nonexistent outgoing segment.

---

# 10. Single-key property timeline

If a property has only one key:

- interpolation query should behave predictably
- mutation should either be allowed as metadata or reported unavailable according to schema/runtime behavior
- no crash

Document the choice.

---

# 11. Existing stepped runtime semantics

Reuse existing stepped interpolation.

Do not implement a second stepped evaluator.

The editor mutation changes authored metadata; the runtime evaluator remains responsible for producing the pose.

---

# 12. Existing smooth runtime semantics

Reuse existing smooth interpolation.

Do not introduce a new easing function in this milestone.

"Smooth" means whatever the existing runtime currently means.

---

# 13. Dirty state

Actual interpolation mutation must:

```text
mark dirty
```

Interpolation queries must not.

Changing selection must not.

---

# 14. Undo/Redo support

Changing interpolation of:

- one key
- multiple keys

must create one logical history transaction.

Example:

```text
select 8 keys
set Stepped
Undo
→ all 8 restored
```

Redo restores the change.

Do not create one history entry per selected key.

---

# 15. Source immutability

Add tests proving `sourceAnimation` remains unchanged after interpolation edits.

Only `workingAnimation` may change.

---

# 16. Serialization compatibility

Edited interpolation metadata must remain compatible with:

- existing AnimationDefinition
- existing validator
- existing JSON serialization
- existing runtime evaluator

Do not add editor-only fields into exported animation structures.

---

# 17. Tests

Add pure tests for:

### Single-key mode mutation

- smooth → stepped
- stepped → smooth

### Key preservation

Changing interpolation does not change:

- time
- value
- bone
- property

### Segment ownership

Correct segment gets affected.

### Multi-key mutation

All requested keys updated in one authored operation.

### Mixed query

Correctly reports mixed selection.

### Last-key behavior

Safe and deterministic.

### One-key timeline

Safe and deterministic.

### Undo/Redo

Exact restoration.

### Dirty state

Mutation dirty; queries not dirty.

### Source immutability

Guaranteed.

### Validation

Edited animation remains valid.

---

# 18. Do NOT implement yet

Do NOT implement:

- interpolation dropdown UI
- keyframe color/icon changes
- curve editor
- Bézier handles
- easing presets
- custom cubic curves
- tangent editing
- event tracks
- onion skinning
- ghost poses
- mirrored keys
- IK target animation
- IK baking

---

# 19. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Definition of done

v0.5.2.6.1 is complete when:

- existing interpolation schema/runtime semantics are identified and reused
- strict interpolation types exist where needed
- interpolation can be queried
- interpolation can be changed through centralized authored-data APIs
- multiple selected keys can be updated atomically
- mixed interpolation state can be queried
- segment ownership is correct
- last-key/single-key edge cases are safe
- changes integrate with Undo/Redo
- source animation remains immutable
- validation still passes
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Existing interpolation model

Explain exactly how runtime/schema represent interpolation.

## Segment ownership

Explain which key controls which segment.

## Mutation APIs

## Multi-key behavior

## Files changed

## APIs/types changed

## Tests

## Verification

Report exact results of:

```bash
npm run typecheck
npm run test
npm run build
```

## Deferred to v0.5.2.6.2+

Do not claim completion unless all required commands pass.
