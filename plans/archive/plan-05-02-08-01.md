You are continuing development of my standalone TypeScript project:

# Paper Puppeteer Engine

Current completed version:

# v0.5.2.7.3

Do NOT rebuild or replace working systems from earlier versions.

The Animation Editor already supports:

- animation working copies
- immutable source animations
- playback / pause / restart / looping
- scrubbing
- timeline ruler and playhead
- bone/property tracks
- keyframe creation/update/delete
- keyframe selection and multi-selection
- marquee/range selection
- keyframe movement/group movement
- snapping
- copy/paste/duplicate
- interpolation editing
- visual animation events
- event create/edit/delete/move/copy/paste
- Undo/Redo
- dirty-state tracking
- animation validation
- runtime evaluator preview
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

# v0.5.2.8.1 — Stable Animation Serialization & Export

This phase establishes a production-quality export path for authored animations.

Implement:

1. canonical animation serialization
2. deterministic/stable JSON output
3. float normalization
4. validation before export
5. export API
6. Copy JSON
7. Download `animation.json`
8. console fallback where useful
9. clear export errors
10. tests proving export does not mutate editor state

Do NOT implement import/reload yet.

---

# 1. Existing animation schema is authoritative

Export the existing serializable `AnimationDefinition`.

Do NOT create a second export-only schema.

The exported file must remain directly compatible with:

- CharacterLoader
- runtime animation playback
- animation validator
- current animation format version
- events
- interpolation metadata
- keyframes

Do not include editor-only state.

---

# 2. Never export editor/session state

The exported animation JSON must NOT contain things such as:

- `currentTime`
- selected bone
- selected property
- selected keys
- selected event
- timeline expansion state
- timeline scroll
- playback state
- playback speed
- editor loop preference
- clipboard contents
- temporary drag state
- history/undo state
- dirty state
- IK preview state
- preview facing

Only authored animation data belongs in `animation.json`.

---

# 3. Canonical serialization

Create or reuse a centralized serialization path.

Conceptually:

```ts
serializeAnimation(animation): string
```

or:

```ts
exportAnimationDefinition(animation): SerializableAnimationDefinition
```

Use current project conventions.

Do not scatter `JSON.stringify(...)` calls throughout UI handlers.

---

# 4. Deterministic output

The same authored animation should generate stable output.

Maintain deterministic ordering for:

- bone/property timelines
- keyframes
- animation events
- same-time events according to existing event ordering semantics

Do not randomly reorder data between exports.

If object-key ordering matters for human readability, define it centrally and consistently.

---

# 5. Stable formatting

Use readable JSON formatting.

Preferred:

```ts
JSON.stringify(data, null, 2)
```

or the project's existing stable serializer.

Include a trailing newline if that matches existing rig export conventions.

Prefer consistency with the Rig Editor production export workflow.

---

# 6. Float normalization

Avoid noisy floating-point artifacts such as:

```text
0.30000000000000004
```

in exported authored values.

Reuse Rig Editor float-normalization utilities if they are generic enough.

Normalize only where appropriate.

Do NOT noticeably alter valid authored animation values.

Examples potentially needing normalization:

- keyframe times
- transform values
- event times
- interpolation-related numeric values if any

Do not quantize everything to animation FPS unless that is already an authored requirement.

---

# 7. Do not mutate workingAnimation during normalization

This is important.

Serialization should conceptually be:

```text
workingAnimation
↓
serialization copy / normalized output
↓
JSON
```

Do NOT modify authored working data merely to make JSON prettier.

Export must be side-effect free.

---

# 8. Validation before export

Before export:

```text
workingAnimation
↓
existing animation validator
↓
if valid → export
if invalid → reject export
```

Use the existing validation layer.

Do NOT duplicate validation.

Do NOT silently repair invalid authored data during export.

Display actionable validation problems.

---

# 9. Export API

Provide an editor/controller-level export operation.

Conceptually:

```ts
const result = animationEditor.exportAnimation();
```

The exact API should follow the Rig Editor conventions.

The export operation should expose:

- success
- serialized JSON/data
- validation failure information

Keep DOM download logic separate from core serialization where practical.

---

# 10. Copy JSON

Add:

```text
Copy Animation JSON
```

to the Animation Editor.

Use browser clipboard APIs where available.

Copy exactly the same canonical JSON used by file export.

Do not have separate clipboard/file serialization implementations.

Provide useful failure feedback if clipboard access is unavailable.

---

# 11. Download animation.json

Add:

```text
Download animation.json
```

or a similarly clear action.

Use browser-side Blob/download functionality.

Default filename should be sensible.

If the selected animation has a stable animation ID/name:

prefer something like:

```text
walk.json
attack.json
idle.json
```

Otherwise:

```text
animation.json
```

Do not use unsafe filesystem APIs.

---

# 12. Console fallback

If useful and consistent with Rig Editor behavior, provide a development fallback:

```text
Export to Console
```

or log export JSON when clipboard/download is unavailable.

Do not make console output the primary production workflow.

---

# 13. Dirty state

Exporting does NOT itself modify authored animation data.

Decide carefully whether successful export should establish a new clean checkpoint.

Preferred behavior:

If Rig Editor already treats successful export/download as "saved", follow the same convention.

Otherwise keep dirty semantics consistent with the existing editor architecture.

Do not invent inconsistent save semantics between Rig and Animation editors.

Document the behavior.

---

# 14. Events/interpolation preservation

Export must preserve:

- keyframe interpolation metadata
- animation-level settings
- FPS
- events
- same-time events
- payload data
- partial bone/property timelines
- duration semantics
- loop-related authored data if part of schema

Do not drop fields simply because they are not visible in one editor panel.

---

# 15. JSON compatibility

Ensure export contains no:

- Phaser objects
- DOM objects
- functions
- Maps
- Sets
- cycles
- `undefined`
- editor controllers
- class instances requiring runtime reconstruction

Output must remain normal JSON-compatible authored data.

---

# 16. Schema/version fields

Preserve current animation format versioning.

Do not silently increment the format version unless the schema itself actually changed.

If v0.5.2 editor work has not changed the external schema, leave the external format version alone.

Engine milestone version and file-format version are separate concepts.

---

# 17. Tests

Add tests for:

### Stable output

Same animation exported twice produces identical JSON.

### Source/working immutability

Export does not mutate:

- source animation
- working animation

### Float normalization

Noise is removed where appropriate.

### Key ordering

Timeline ordering remains deterministic.

### Events

Events survive export exactly.

### Same-time events

Preserved.

### Interpolation

Preserved.

### Partial tracks

Preserved.

### Editor-state exclusion

No transient editor fields appear.

### Validation

Invalid animation export is rejected.

### Valid JSON

Serialized output parses successfully.

---

# 18. Manual verification

Create/edit an animation containing:

- multiple bones
- partial property tracks
- several keyframes
- smooth interpolation
- stepped interpolation
- multiple events
- same-time events
- payload data

Then:

1. Copy JSON
2. paste into a text editor
3. inspect formatting
4. Download file
5. compare downloaded JSON with clipboard JSON
6. export repeatedly
7. confirm deterministic output
8. verify no editor-session fields exist

---

# 19. Regression requirements

Do not regress:

- keyframe authoring
- multi-selection
- key movement
- copy/paste
- interpolation editing
- event editing
- Undo/Redo
- playback
- scrubbing
- validation
- Rig Editor
- runtime animation loading

---

# 20. Do NOT implement yet

Do not implement:

- animation JSON import UI
- reload exported animation
- drag-and-drop files
- round-trip visual comparison workflow
- onion skinning
- ghost poses
- mirrored animation tools
- IK target animation authoring
- IK baking

Those come later.

---

# 21. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Definition of done

v0.5.2.8.1 is complete when:

- Animation Editor has one canonical serialization path
- output is stable/deterministic
- output is readable JSON
- floating-point noise is normalized appropriately
- validation occurs before export
- invalid data cannot be silently exported
- Copy JSON works
- Download JSON works
- events/interpolation/keyframes are preserved
- editor state is excluded
- export does not mutate authored state
- source animation remains immutable
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Serialization architecture

## Deterministic ordering

## Float normalization

## Validation-before-export

## Dirty/save semantics

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.8.2+

Do not claim completion unless all required commands pass.
