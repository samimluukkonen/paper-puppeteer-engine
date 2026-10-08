You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.8.1

The Animation Editor now supports:

- canonical serialization
- deterministic animation JSON
- float normalization
- validation-before-export
- Copy JSON
- Download animation JSON
- production-quality export API

Do NOT rewrite those systems.

---

# Goal

Implement:

# v0.5.2.8.2 — Animation Import, Reload & Round-Trip

Implement:

1. import animation JSON
2. import from pasted JSON
3. import from local JSON file
4. parse + validate before replacing editor state
5. reload animation into a fresh working copy
6. reset history appropriately
7. reset selection/navigation state safely
8. round-trip verification
9. ensure imported animation previews exactly through existing runtime evaluator

Do NOT implement drag-and-drop or advanced asset management unless trivial.

---

# 1. Central import pipeline

Create one core import pipeline.

Conceptually:

```text
JSON text
↓
parse
↓
schema/version validation
↓
animation validation
↓
normalized AnimationDefinition
↓
fresh source/working-copy session
```

Do not create different parsing logic for paste and file upload.

---

# 2. Reuse existing parsing/validation

The project already has animation JSON parsing and validation infrastructure from earlier milestones.

Reuse it.

Do NOT:

- duplicate validators
- manually trust arbitrary parsed JSON
- cast unknown JSON directly to AnimationDefinition

Treat imported JSON as unknown until validated.

Avoid unsafe casts.

---

# 3. Import from pasted JSON

Add a developer-oriented UI for:

```text
Import / Paste Animation JSON
```

This may use:

- textarea
- modal/panel
- existing import UI pattern

No React.

Provide:

- Parse/Import
- Cancel

Invalid JSON should produce useful errors.

---

# 4. Import from file

Support choosing a local `.json` file with a browser file input.

Read text using browser APIs.

Feed the text into the SAME central import pipeline as pasted JSON.

Do not create separate parsing semantics.

---

# 5. Never replace working state before validation succeeds

Critical behavior:

```text
current valid working animation
+
attempt invalid import
↓
show errors
↓
current working animation remains unchanged
```

Do not partially replace the editor session and then discover validation errors.

Import should be transactional.

---

# 6. Fresh source + working copy

After successful import:

create a fresh immutable source snapshot and editable working copy.

Conceptually:

```text
imported validated definition
↓
sourceAnimation
↓ clone
workingAnimation
```

Preserve the existing source/working-copy architecture.

---

# 7. History reset

A successful import starts a new editing session.

Therefore:

```text
undo history = reset
redo history = reset
clean baseline = imported animation
```

Do not allow Undo to reach back into the previous animation's history.

---

# 8. Dirty state after import

A successfully imported animation should normally become:

```text
clean
```

because the imported data is now the session baseline.

Follow Rig Editor conventions if they differ.

Document behavior.

---

# 9. Reset transient selection state

After successful import, safely reset:

- selected keys
- primary key
- selected event
- temporary drag state
- marquee
- clipboard context only if necessary
- temporary inspector edits

Bone/property selection may either reset or remain if references are still valid.

Prefer deterministic simple behavior.

---

# 10. Reset currentTime

Preferred:

```text
currentTime = 0
```

after import.

Evaluate preview immediately.

Playback should be paused.

Do not carry playback from the previous animation into imported data.

---

# 11. Timeline rebuild

Successful import must immediately rebuild views from the imported working animation:

- duration
- ruler
- bone/property tracks
- keyframe markers
- interpolation marker states
- event markers

No browser refresh required.

---

# 12. Runtime preview

After import:

```text
imported animation
↓
existing evaluator
↓
puppet preview
```

Do not add an import-specific evaluator.

---

# 13. Unsupported format versions

If imported animation uses an unsupported format version:

- reject cleanly
- show actionable version error
- preserve existing editor session

Do not silently reinterpret unknown versions.

---

# 14. Invalid bone references

If imported animation references bones that do not exist in the currently loaded rig:

use existing animation/character validation.

Fail cleanly.

Do not silently delete unknown bone tracks.

Do not remap bone names automatically.

---

# 15. Events and payloads

Import must preserve valid:

- events
- event times
- same-time events
- payload data

Do not fire events during import/reload.

---

# 16. Interpolation

Imported interpolation metadata must be respected immediately.

Timeline marker visuals and preview should match imported authored data.

---

# 17. Round-trip verification API

Add a reusable test/development helper for:

```text
AnimationDefinition A
↓ serialize
JSON
↓ parse/import
AnimationDefinition B
```

Verify authored equivalence.

Exact object identity is not required.

Authored semantic equality is.

Prefer canonical normalized comparison.

---

# 18. Export → Import round trip

Automated tests must cover:

```text
working animation
↓
export
↓
import
↓
re-export
```

Canonical output should be identical when no authored changes occur.

This is a critical v0.5.2.8 guarantee.

---

# 19. Visual round-trip behavior

Manual verification:

1. create animation
2. export JSON
3. change animation significantly
4. import previously exported JSON
5. confirm original animation visually returns

Verify:

- keyframes
- timing
- interpolation
- events
- duration/FPS
- preview pose

---

# 20. Reload exported animation

Add a development workflow/button if useful:

```text
Reload Current Export
```

or make normal import simple enough to perform the test.

Do not overbuild UI.

The important capability is:

```text
exported JSON
→ imported editor session
```

---

# 21. Import error presentation

Display structured errors clearly.

Examples:

```text
Invalid JSON
Unsupported format version
Unknown bone "leftArm2"
Invalid keyframe time
Invalid event payload
```

Use existing validation issue structures where possible.

Do not dump only `[object Object]`.

---

# 22. Clipboard import

If browser clipboard permissions make direct "Paste from Clipboard" reliable and small, optionally support it.

But a paste-text area is sufficient.

Do not block the milestone on clipboard-read permission handling.

---

# 23. Tests

Add tests for:

### Valid import

Loads correctly.

### Invalid JSON

Rejected without modifying current session.

### Invalid animation

Rejected transactionally.

### Unsupported version

Rejected.

### History

Cleared on successful import.

### Dirty state

Clean baseline after import.

### Playback

Paused/reset after import.

### currentTime

Reset appropriately.

### Selection

Stale selection cleared.

### Keyframes

Preserved.

### Interpolation

Preserved.

### Events

Preserved.

### Same-time events

Preserved.

### Round trip

Export → import → export stable.

### Source/working isolation

Imported source remains immutable while working copy can later change.

---

# 24. Manual verification

Use a non-trivial animation.

Test:

### Paste import

Export → copy → paste/import.

### File import

Download → choose downloaded file.

### Invalid JSON

Introduce syntax error.

Verify current animation remains untouched.

### Invalid authored data

Use unknown bone ID.

Verify rejection.

### Round-trip

Compare before/after visually and structurally.

### Editing afterward

After import:

- add key
- move key
- change interpolation
- edit event
- Undo/Redo

Confirm normal editor workflow still works.

---

# 25. Do NOT implement yet

Do not implement:

- drag-and-drop asset workflow
- sprite import/replacement
- onion skinning
- mirrored animation tools
- IK animation authoring
- IK baking
- scene choreography

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

# Definition of done

v0.5.2.8.2 is complete when:

- pasted JSON can be imported
- JSON file can be imported
- one central parsing/validation pipeline is used
- invalid imports do not destroy current editor state
- unsupported versions fail cleanly
- successful import creates fresh source/working copies
- history resets
- dirty state resets appropriately
- playback/currentTime reset safely
- timeline rebuilds automatically
- keyframes/interpolation/events survive
- preview uses existing runtime evaluator
- export → import → export round-trip is stable
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Import pipeline

## Transactional failure behavior

## Session/history reset behavior

## Round-trip architecture

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.8.3+

Do not claim completion unless all required commands pass.
