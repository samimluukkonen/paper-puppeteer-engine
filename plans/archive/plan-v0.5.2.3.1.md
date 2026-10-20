You are continuing development of my standalone TypeScript project:

# Paper Puppeteer Engine

Current completed version:

# v0.5.2.2.4

The Animation Editor already supports:

- animation working copies
- immutable source animation
- animation selection
- timeline ruler
- authoritative `currentTime`
- playhead
- scrubbing
- Play/Pause
- Restart
- looping
- playback speed
- authored FPS handling where supported
- stepped/smooth preview using the existing runtime evaluator
- safe scrub/playback interaction
- dirty-state plumbing
- hardened playback edge cases

Do NOT rebuild or replace these systems.

Tech stack:

- TypeScript
- Phaser
- Vite
- npm
- strict TypeScript
- ES modules
- no React

---

# Goal

Implement:

# v0.5.2.3.1 — Keyframe Authoring Core

This milestone introduces the DATA/STATE foundation for editing animation keyframes.

Do NOT build full timeline keyframe tracks yet.

Focus on:

1. pure keyframe editing operations
2. identifying authored bone properties at a given time
3. creating keyframes
4. updating existing keyframes
5. deleting keyframes
6. preserving source-animation immutability
7. keeping animation evaluation compatible with the existing runtime
8. defining clear behavior for animation values between keyframes

The goal is to establish reliable authored-data mutation APIs before wiring them deeply into the visual editor.

---

# 1. Existing animation format remains authoritative

Inspect the project's existing `AnimationDefinition` and timeline/keyframe types.

Do NOT introduce a second incompatible animation format.

Use the existing external animation schema.

All authored changes must mutate:

```text
workingAnimation
```

and never:

```text
sourceAnimation
```

Editor-only metadata must remain separate.

---

# 2. Do not mutate evaluator output

This distinction is critical:

```text
AnimationDefinition
= authored animation data

evaluated Pose
= calculated result at currentTime
```

Do NOT edit an evaluated pose object and treat it as the source animation.

Keyframe authoring must explicitly write serializable values into `workingAnimation`.

---

# 3. Pure keyframe editing API

Create or extend a pure animation-editing layer.

Conceptual operations may resemble:

```ts
setBonePropertyKeyframe(
  animation,
  boneId,
  property,
  time,
  value
)

removeBonePropertyKeyframe(
  animation,
  boneId,
  property,
  time
)

findBonePropertyKeyframe(
  animation,
  boneId,
  property,
  time
)
```

Exact APIs must follow the existing schema and project naming.

Prefer pure/testable functions.

Do NOT require Phaser or DOM for keyframe mutation.

Avoid `any`.

---

# 4. Supported bone transform properties

Support the transform properties already understood by the animation runtime.

For example, depending on the existing schema:

```text
x
y
rotation
scaleX
scaleY
```

Only support properties that actually exist in the current runtime/schema.

Do not invent new animation properties unnecessarily.

---

# 5. Keyframe time matching

Floating-point time comparison needs one centralized policy.

Do not rely on brittle exact comparisons such as:

```ts
key.time === currentTime
```

if editor times may contain floating-point error.

Implement a small centralized time comparison/tolerance strategy appropriate for the project's animation units.

For example:

```text
0.5000000001
```

should not accidentally become a separate key from:

```text
0.5
```

Do NOT globally quantize animation time to FPS unless the existing animation format requires it.

---

# 6. Create vs update semantics

Define deterministic behavior.

If no key exists at the authored time:

```text
set key
→ create new keyframe
```

If a key already exists for the same bone/property/time:

```text
set key
→ update existing value
```

Do NOT create duplicates at effectively the same time.

Keep keyframes sorted by time after editing.

---

# 7. Delete semantics

Deleting a key should:

- remove only the requested bone/property/time key
- leave unrelated properties unchanged
- leave unrelated bones unchanged
- keep timeline arrays valid
- clean up empty structures if appropriate to the existing schema

For example, if removing the final `rotation` key from a bone timeline leaves an empty property array, normalize it consistently with existing serialization conventions.

Do not corrupt other animation data.

---

# 8. Partial transform animation

The engine already supports partial animations.

Preserve that.

A bone may have:

```text
rotation keys
```

without necessarily having:

```text
x/y/scale keys
```

Do not force complete transform snapshots into every keyframe unless that is already how the existing schema works.

Prefer property-level authoring consistent with the runtime.

---

# 9. Evaluated value helper

The editor will need to answer:

> What authored/evaluated value does this bone property have at currentTime?

Reuse the existing animation evaluator where possible.

Do NOT reproduce interpolation math inside editor code.

If a helper is required, it should call/reuse existing animation evaluation logic.

This will later allow the UI to create a new key using the pose currently visible at the playhead.

---

# 10. Keyed-state queries

Provide clean queries for the editor.

Conceptually:

```ts
hasKeyframeAtTime(
  animation,
  boneId,
  property,
  time
): boolean
```

and possibly:

```ts
getKeyedPropertiesAtTime(
  animation,
  boneId,
  time
): BoneTransformProperty[]
```

This will be used by v0.5.2.3.2 to show which properties are keyed.

Keep this logic pure.

---

# 11. Dirty state

Actual authored keyframe mutations must mark the Animation Editor dirty.

Examples:

```text
create key → dirty
update key → dirty
delete key → dirty
```

Queries and evaluation must not.

Use the existing Animation Editor dirty-state architecture.

Do not create another dirty-state system.

---

# 12. Playback safety

If authored animation data changes while paused:

- preview should be refreshable immediately

If editing occurs while playback is active in future UI work:

- architecture must remain safe

But this phase does NOT need visual editing while playing.

Do not modify the playback clock architecture.

---

# 13. Validation

Run edited working animations through the existing animation validation logic where appropriate.

Do NOT create a second validation implementation.

A mutation helper should not easily produce:

- duplicate times
- unsorted timelines
- NaN
- Infinity
- invalid bone IDs
- invalid property values

Use reasonable guards.

---

# 14. Source immutability

Add tests proving:

```text
sourceAnimation
```

remains unchanged after:

- key creation
- key update
- key deletion

Only the working copy may change.

---

# 15. Tests

Add comprehensive pure tests for at least:

### Create key

No existing key:

```text
set rotation at t=0.5
→ new key exists
```

### Update key

Existing key at effectively same time:

```text
set rotation again
→ existing key updated
→ no duplicate
```

### Sorted insertion

Insert keys in random time order:

```text
1.0
0.25
0.5
```

stored order should remain valid.

### Delete key

Remove requested key without affecting others.

### Partial transforms

Creating a rotation key must not create unrelated x/y keys.

### Bone isolation

Editing one bone must not alter another.

### Time tolerance

Near-identical editor times should not generate duplicate keys.

### Keyed-property query

Correct properties are reported at current time.

### Source immutability

Source animation remains identical.

### Dirty state

Mutation marks dirty.

Read-only query does not.

---

# 16. Do NOT implement yet

Do NOT implement:

- visual transform editing
- keyframe diamonds
- bone timeline tracks
- dragging keyframes
- moving keyframes
- keyframe selection UI
- copy/paste
- multi-key selection
- auto-key mode
- event authoring
- interpolation editing UI
- onion skinning
- animation export workflow
- IK baking

Keep this milestone focused on the authored-data model.

---

# 17. Required commands

Before completion run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Definition of done

v0.5.2.3.1 is complete when:

- pure keyframe editing APIs exist
- existing animation schema remains authoritative
- keys can be created
- keys can be updated
- keys can be deleted
- duplicate-time keys are prevented
- timelines remain sorted
- partial property animation remains supported
- keyed-state queries exist
- source animation stays immutable
- mutations affect working animation only
- mutations mark dirty
- existing evaluator remains authoritative
- playback architecture is unchanged
- tests pass
- typecheck passes
- build passes

---

# Final report

When finished report:

## Implemented

## Keyframe data architecture

Explain how bone/property/time keys are represented and mutated.

## Time matching policy

Explain how duplicate floating-point times are prevented.

## Files changed

## APIs added/changed

## Tests

## Verification

Report exact results of:

```bash
npm run typecheck
npm run test
npm run build
```

## Deferred to v0.5.2.3.2+

Do not claim completion unless all required commands pass.
