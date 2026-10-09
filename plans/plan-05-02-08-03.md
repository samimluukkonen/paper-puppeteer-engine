You are continuing Paper Puppeteer Engine.

Current completed version:

# v0.5.2.8.2

The Animation Editor now supports:

- stable canonical animation serialization
- validation-before-export
- Copy JSON
- Download JSON
- paste-based JSON import
- file-based JSON import
- transactional validation
- fresh source/working-copy sessions
- import history reset
- export/import round-trip verification

This phase completes v0.5.2.

Do NOT add major new animation-authoring features.

---

# Goal

Implement:

# v0.5.2.8.3 — Production Animation Workflow Hardening

Focus on:

1. production session lifecycle
2. Save/Export status clarity
3. unsaved-change protection
4. reload/revert workflow
5. import/export edge cases
6. exact visual/data round-trip confidence
7. editor usability polish
8. full v0.5.2 regression pass
9. documentation for real artist workflow

---

# 1. Production session status

Make editor session state obvious.

Display useful status such as:

```text
Animation: walk
Status: Modified
```

or:

```text
Animation: walk
Status: Clean
```

Use existing dirty-state architecture.

Do not derive dirty state independently in the DOM.

---

# 2. Unsaved-change protection

Protect against accidentally losing authored changes when:

- selecting another animation
- importing another animation
- reloading/reverting
- navigating away from the Animation Editor if current architecture supports route protection

Reuse Rig Editor behavior where practical.

A simple confirmation is sufficient.

Do not build a complex document-management system.

---

# 3. Revert to source

Add:

```text
Revert Animation
```

or equivalent.

Behavior:

```text
sourceAnimation
↓ clone
workingAnimation
```

Then:

- history reset
- dirty false
- playback paused
- temporary selection reconciled/reset
- timeline refreshed
- preview refreshed

Require confirmation if this destroys unsaved changes.

---

# 4. Revert must not reload from network unnecessarily

If immutable source animation already exists in the editor session, use it.

Do not perform unnecessary fetches.

This is a session revert.

---

# 5. Export/save checkpoint semantics

Finalize a clear policy for when the editor becomes clean.

Prefer consistency with Rig Editor.

For example:

### Option A

Successful export/download establishes a new clean baseline.

or:

### Option B

Only explicit "Set as saved baseline" / load/import establishes clean state.

Use the existing project convention.

Do NOT have Rig Editor and Animation Editor behave confusingly differently without a reason.

Document the final behavior.

---

# 6. Reload exported animation verification

Provide a straightforward development workflow to verify:

```text
working animation
↓ export
↓ reload/import
↓ identical authored result
```

This may be a dev-only button if useful:

```text
Round-Trip Test
```

or simply a test helper + manual procedure.

Avoid bloating production UI.

---

# 7. Visual equivalence

Create test/manual verification that exported and reloaded animations reproduce:

- same poses at key times
- same interpolation between keys
- same duration
- same FPS behavior
- same stepped behavior
- same event markers/times
- same event payloads

Do not compare only JSON structure if visual/runtime semantics could differ.

---

# 8. Evaluated-pose comparison helper

If practical, add a pure/dev-test helper that evaluates:

```text
original animation
```

and:

```text
round-tripped animation
```

at a set of representative times and compares the resulting authored poses within suitable floating-point tolerance.

Suggested sample times:

- 0
- each key time
- midpoint between representative keys
- near duration
- duration

Reuse the existing evaluator.

Do not create a comparison evaluator.

---

# 9. Event round-trip semantics

Verify events survive exactly enough that runtime dispatch behavior remains equivalent.

Test:

- event at 0
- event at duration
- multiple same-time events
- payloads
- event ordering

Import itself must never fire events.

---

# 10. Float stability across repeated round trips

Test repeated cycles:

```text
serialize
parse
serialize
parse
serialize
```

Values must not slowly drift.

Avoid normalization that changes data on each pass.

Canonical output should stabilize immediately.

---

# 11. Unknown/additional data policy

Inspect current schema behavior.

Do not silently discard valid supported authored fields because the editor does not currently expose them.

Use current schema/parser conventions for unknown fields.

Document behavior rather than inventing one.

---

# 12. Very small / large animations

Test:

### Empty animation

No keys/events.

### Zero-duration animation

Safe export/import.

### Minimal animation

One bone, one key.

### Larger sample

Many tracks, keys and events.

No crashes or obvious severe UI degradation.

Do not optimize prematurely with virtualization unless actually needed.

---

# 13. Filename handling

Make download filenames safe and predictable.

Sanitize invalid filename characters if animation IDs/names feed the filename.

Do not alter animation IDs merely for filename purposes.

---

# 14. Import file safety

Reject or clearly report:

- empty file
- malformed JSON
- wrong document type if distinguishable
- unsupported version
- invalid schema

Do not crash.

---

# 15. Keyboard/shortcut audit

Ensure import/export controls do not conflict with:

- copy/paste keyframes
- copy/paste events
- browser shortcuts
- text editing
- playback shortcuts

Update Animation Editor help/shortcut documentation.

---

# 16. Full history regression

Test a workflow:

```text
load animation
edit keys
edit interpolation
edit events
Undo
Redo
export
edit more
revert
import exported copy
edit again
Undo
Redo
```

History/session state must remain coherent.

No history from previous sessions may leak into new imported/reverted sessions.

---

# 17. Full dirty-state regression

Verify state transitions for:

```text
load → clean
edit → dirty
Undo to baseline → expected clean state
Redo → dirty
export → according to chosen save policy
edit → dirty
revert → clean
import → clean
```

Match Rig Editor conventions where possible.

---

# 18. Full v0.5.2 regression pass

Verify all Animation Editor functionality:

## Foundation

- animation selection/loading
- timeline
- playhead
- scrubbing

## Playback

- play/pause
- restart
- loop
- playback speed
- FPS

## Authoring

- bone selection
- create/update/delete keys
- property tracks
- key markers

## Editing

- single-key movement
- multi-selection
- marquee/range
- group movement
- snapping
- copy/paste
- duplicate
- keyboard nudging

## Interpolation

- stepped
- smooth
- mixed selections
- preservation through copy/move/import

## Events

- track
- create/edit/delete
- move
- copy/paste
- playback semantics
- same-time events

## History

- Undo/Redo

## Data

- dirty state
- validation
- source immutability
- import/export

## Runtime

- IK preview
- facing
- existing evaluator

---

# 19. Rig Editor regression

The existing Rig Editor must still work.

Verify at minimum:

- load rig
- bone selection
- joint manipulation
- sprite offset/origin
- slots
- Undo/Redo
- rig export

Do not let shared export/import utilities regress it.

---

# 20. Character loader regression

Use an exported animation in the normal character folder/manifest workflow.

Verify it can be loaded by the existing CharacterLoader without editor-specific conversion.

This is a critical production criterion.

Conceptually:

```text
Animation Editor
↓ export walk.json
↓
characters/demo/animations/walk.json
↓
character manifest
↓
CharacterLoader
↓
Puppet
↓
puppet.play("walk")
```

---

# 21. Documentation

Add/update concise documentation describing the real animation-authoring workflow.

At minimum:

## Animation Editor workflow

1. load character/animation
2. scrub/select time
3. select bone/property
4. create/edit keys
5. adjust timing
6. set interpolation
7. add events
8. preview
9. validate
10. export
11. reload/round-trip if desired

## Important data separation

Document:

```text
Rig Editor
= skeleton/joint/artwork alignment

Animation Editor
= motion over time
```

Do not encourage modifying bind-rig structure through normal animation keyframing.

---

# 22. Architecture audit

Before completion verify:

- one authoritative animation schema
- one canonical serializer
- one central import pipeline
- one validator
- existing evaluator remains authoritative
- no DOM-owned authored state
- source animation immutable
- working animation editable
- history belongs to current animation session only
- editor state excluded from JSON
- no `any`
- no unnecessary dependency
- no Phaser objects inside external data

Do not perform unrelated large refactors.

---

# 23. Do NOT implement yet

Explicitly defer to later milestones:

- onion skinning
- ghost poses
- mirrored pose/keyframe operations
- IK target animation authoring
- IK baking
- advanced timeline QoL
- sprite upload/replacement workflow
- Animation Editor rig-tweak mode
- scene choreography
- physics/ragdolls
- mesh deformation

---

# 24. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

Do not declare v0.5.2 complete until all three pass.

---

# Final v0.5.2 definition of done

The entire Visual Animation Timeline milestone is complete when:

- animations can be loaded into the editor
- timeline/playhead/scrubbing work
- playback works
- bones/properties can be authored
- keys can be created/updated/deleted
- key markers/tracks exist
- multi-key selection works
- group editing works
- copy/paste/duplicate works
- interpolation can be authored
- animation events can be authored
- Undo/Redo works
- animation JSON exports deterministically
- animation JSON imports safely
- invalid import/export is rejected cleanly
- round-trip is stable
- exported animations work with CharacterLoader/runtime
- editor/session state is never serialized
- source definitions remain immutable
- production workflow is documented
- Rig Editor has no regressions
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Production workflow

Describe the final end-to-end Animation Editor workflow.

## Session lifecycle

Explain:

- source animation
- working animation
- dirty state
- clean checkpoint
- history reset
- revert
- import

## Serialization/import architecture

## Round-trip guarantees

## Runtime/CharacterLoader verification

## Files changed

## APIs/types changed

## Tests

## Manual verification

## Documentation changes

## Required command results

Report exact results of:

```bash
npm run typecheck
npm run test
npm run build
```

## Deferred to v0.5.3+

Explicitly list later features.

Do not claim completion unless all required commands pass.
