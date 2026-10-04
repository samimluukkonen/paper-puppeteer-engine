You are continuing development of my standalone TypeScript project:

# Paper Puppeteer Engine

Current completed version:

# v0.5.1.3

Do NOT rebuild or replace working systems from earlier versions.

The engine is a reusable 2D paper-puppet / cutout skeletal animation engine built with:

- TypeScript
- Phaser
- Vite
- npm
- strict TypeScript
- ES modules

Do NOT introduce React.

Keep dependencies minimal.

The production runtime and editor/devtools must remain clearly separated.

The engine already has a working Visual Rig Editor with:

- editable rig working copy
- immutable source rig
- hierarchy panel
- bone/slot selection
- bone manipulation
- sprite offset/origin editing
- slot transform editing
- render depth editing
- snapping
- undo/redo
- dirty state
- validation
- rig JSON import/export
- stable serialization
- clipboard/download workflow
- reload/round-trip validation
- keyboard shortcuts/help

The animation runtime already supports:

- keyframe animation
- animation blending/crossfading
- shortest-path rotation interpolation
- stepped animation
- smooth animation
- per-animation FPS
- playback speed
- animation events
- completion events
- loops
- animation layers
- bone masks
- partial animations
- pose representation
- IK after authored animation evaluation

Do not rewrite those systems.

---

# Goal

Implement:

# v0.5.2.1 — Visual Animation Editor Foundation

This milestone establishes the editor architecture and timeline state required for later visual keyframe authoring.

Do NOT implement full keyframe editing yet.

Specifically, this version should introduce:

1. a dedicated Animation Editor mode/route
2. an editable animation working-copy model
3. animation-editor session state
4. a basic visual timeline
5. timeline ruler
6. playhead
7. scrubbing
8. animation duration handling
9. current-time display
10. basic animation selection/loading
11. integration with the existing puppet preview
12. clean architecture for later keyframe tracks and editing

The result should be a usable foundation for v0.5.2.2+ without prematurely implementing those later milestones.

---

# Important architectural principle

Do not make the timeline UI itself the authoritative animation state.

Use a clean data/state architecture approximately like:

```text
source animation definition
        ↓
editable animation working copy
        ↓
animation editor session/state
        ↓
timeline/controller
        ↓
existing animation evaluation/runtime
        ↓
puppet preview
```

The editor should modify a working copy.

The original source animation should remain unchanged until explicit export/save behavior in a later milestone.

Keep pure state/math logic separate from Phaser where practical.

---

# 1. Dedicated Animation Editor

Add a dedicated Animation Editor entry point using the existing editor architecture where possible.

Reuse existing routing/devtool structure instead of introducing a completely separate application.

A conceptual structure could be something like:

```text
/editor/rig
/editor/animation
```

or whatever matches the current project architecture.

Do not rename or break the existing Rig Editor.

The Animation Editor should be able to:

- load a character/rig
- display the puppet
- load/select an animation
- display timeline controls
- show the current animation pose at the selected time

The editor should initially support at least the project's existing sample/demo character.

---

# 2. Animation working-copy model

Create an editor-side editable representation of an animation definition.

Requirements:

- source animation must remain immutable
- working copy must be independently editable
- deep-copy/clone behavior must be explicit and safe
- no Phaser objects inside animation data
- no functions/maps/cyclic references
- data remains JSON-compatible
- preserve existing external animation schema
- do not invent an incompatible editor-only animation format unless strictly necessary

If temporary editor metadata is needed, keep it separate from the serialized animation definition.

For example:

```ts
interface AnimationEditorSession {
  sourceAnimation: AnimationDefinition;
  workingAnimation: AnimationDefinition;

  currentTime: number;
  selectedAnimationId: string | null;

  isPlaying: boolean;

  // editor-only state
}
```

Exact API names may differ to match the existing codebase.

Avoid `any`.

---

# 3. Animation Editor session state

Create a clear state/controller layer for the animation editor.

At minimum it should track:

- selected animation
- current time
- animation duration
- playing/stopped state if useful for architecture
- loop state if already naturally available
- timeline zoom/scale if needed
- dirty state architecture, even if actual animation editing is minimal in this milestone

Do not tightly couple this state to DOM elements.

Prefer something testable independently from Phaser/DOM.

For example:

```ts
AnimationEditorState
AnimationEditorController
TimelineState
```

Use the naming/style already established by the Rig Editor if equivalent abstractions already exist.

Reuse existing abstractions rather than duplicating them.

---

# 4. Animation duration

The editor must have one authoritative animation duration.

Determine duration using the existing animation format and runtime conventions.

Do not create a second conflicting duration interpretation.

The timeline should correctly represent:

```text
0 → animation duration
```

If animation duration is derived from keyframes/events rather than explicitly stored, centralize that logic.

Add tests for duration calculation if it is not already tested.

Handle:

- empty animations
- zero-duration animations
- animations containing only some bone tracks
- events extending to the animation end if relevant to current format

Do not silently mutate animation data when calculating duration.

---

# 5. Timeline UI

Implement a basic timeline panel.

It does NOT need bone tracks or keyframe diamonds yet.

The timeline should include:

- horizontal timeline area
- time ruler
- tick marks
- playhead
- visible current-time location
- duration/end marker

Example concept:

```text
0.0      0.5      1.0      1.5      2.0
|---------|---------|---------|---------|
                    ▲
                 playhead
```

The visual style can remain simple and developer-oriented.

Plain HTML/CSS is acceptable.

Do not introduce UI framework dependencies.

---

# 6. Timeline ruler

Implement timeline ruler generation independent from the DOM when practical.

The ruler should adapt reasonably to duration.

It should generate sensible:

- major ticks
- minor ticks
- time labels

Do not hard-code the ruler only for one animation duration.

For example, depending on scale/duration it may use intervals such as:

```text
0.1 s
0.25 s
0.5 s
1 s
```

Keep the implementation simple.

Do not build a full professional NLE timeline system.

The goal is clean extensibility.

---

# 7. Playhead

Add a visible playhead representing the editor's current time.

Requirements:

- current time must be clamped to valid animation range
- moving current time updates playhead position
- moving playhead updates current time
- external state changes update the UI
- avoid duplicated competing time state

Prefer:

```text
AnimationEditorState.currentTime
```

as the authoritative value.

The DOM/playhead should reflect it.

---

# 8. Scrubbing

Allow the user to click or drag on the timeline to scrub.

Requirements:

- click timeline → set current time
- drag pointer → continuously update current time
- release pointer → end scrub
- clamp before 0
- clamp after animation duration

Use Pointer Events if appropriate.

Avoid fragile mouse-only handling.

Dragging outside the timeline after starting a scrub should behave sensibly.

Do not create hundreds of undo operations for scrubbing.

Scrubbing itself is editor navigation and should NOT mark animation data dirty.

---

# 9. Existing animation evaluator must drive preview

This is important.

Do NOT manually interpolate bones in the Animation Editor UI.

At a given `currentTime`, the existing animation evaluation system should produce the authored animation pose.

Conceptually:

```text
currentTime
    ↓
existing animation evaluator
    ↓
pose
    ↓
existing puppet runtime
    ↓
rendered preview
```

Reuse the existing animation runtime/evaluation logic.

Do not duplicate interpolation algorithms inside the editor.

This guarantees that editor preview matches runtime behavior.

---

# 10. Scrubbed pose preview

When the user scrubs:

```text
timeline currentTime changes
↓
animation evaluated at currentTime
↓
puppet updates immediately
```

The preview should work while:

- stopped
- manually scrubbing
- selecting another animation
- resetting current time

For this milestone, playback may remain minimal if the architecture needs it.

Full playback controls belong mainly to v0.5.2.2.

Do not overbuild playback yet.

---

# 11. Animation selection

Provide a basic way to select/load an existing animation for the character.

This can be a simple developer UI such as:

```text
Animation:
[ idle ▼ ]
```

Changing animation should:

1. load a fresh working copy
2. reset current time appropriately
3. update duration
4. evaluate the new animation
5. update timeline

If there are unsaved/dirty animation changes, create architecture that will allow later dirty-state protection.

Do not implement a complicated confirmation dialog unless it naturally fits existing editor behavior.

---

# 12. Current-time display

Display current time numerically.

Example:

```text
Time: 0.742 s
```

Optionally also show:

```text
0.742 / 2.000 s
```

Use a sensible precision without creating noisy floating-point values.

Internal time should remain numeric and precise.

Do not quantize animation state unnecessarily.

---

# 13. FPS awareness

Do not implement full FPS editing yet.

However, the Animation Editor architecture must understand the animation's existing FPS/stepped settings.

Display them read-only if useful.

Example:

```text
FPS: 10
Mode: stepped
```

Do not force timeline time itself to only exist at discrete frames.

The authoritative timeline coordinate should still be continuous time unless the current runtime format strongly requires otherwise.

Later versions will add proper frame/key snapping.

---

# 14. Coordinate and state separation

Keep these separate:

```text
animation time in seconds
timeline pixel X
animation frame number
runtime render frame
```

Do not use timeline pixels as animation state.

Provide explicit conversion helpers such as conceptually:

```ts
timeToTimelineX(time: number): number;

timelineXToTime(x: number): number;
```

Prefer pure/testable helpers.

---

# 15. Prepare for future tracks

The timeline architecture must be designed so later versions can add:

```text
bone tracks
property tracks
keyframe markers
event markers
selected keyframes
dragging keyframes
multi-selection
```

without replacing the entire timeline.

You do NOT need to implement these now.

A future conceptual structure may resemble:

```text
Timeline
├── ruler
├── playhead
├── bone tracks
│   ├── torso
│   ├── upperArm
│   └── forearm
└── event track
```

Build only the foundation required now.

---

# 16. Prepare for undo/redo but do not misuse it

The Rig Editor already has undo/redo.

Reuse the same history architecture where appropriate.

However:

```text
scrubbing
selection
timeline navigation
```

must NOT create history entries.

Only actual authored animation changes should eventually enter undo history.

Since v0.5.2.1 should not yet do major authored keyframe editing, history integration may remain minimal.

Avoid creating a second incompatible undo system.

---

# 17. Dirty state

Introduce animation-editor dirty-state plumbing.

At this milestone, merely loading/scrubbing/selecting must not make the animation dirty.

Architecture should make later mutations able to call something equivalent to:

```ts
markDirty();
```

and reset after import/export/save.

Reuse the Rig Editor dirty-state pattern where practical.

---

# 18. Validation

Use the existing animation validation system.

Loading an invalid animation into the editor should fail cleanly or display useful validation information.

Do not create a second independent validation implementation.

If an animation is invalid:

- show actionable validation issues
- avoid crashing Phaser/editor
- avoid corrupting the working copy

---

# 19. Empty state handling

Handle these gracefully:

- no character loaded
- no animation selected
- character with zero animations
- zero-duration animation
- invalid animation
- missing animation reference

The editor should not crash.

Display simple developer-oriented messages where appropriate.

---

# 20. Timeline sizing

The timeline should behave reasonably if the browser window changes size.

Do not hard-code a single screen resolution.

Simple responsive width is enough.

A horizontal scroll container is acceptable if useful.

Do not spend excessive time on responsive UI polish yet.

---

# 21. Tests

Add or update tests for pure logic.

At minimum test relevant new logic such as:

- time clamping
- time → timeline X conversion
- timeline X → time conversion
- duration handling
- ruler tick generation where appropriate
- working-copy isolation
- animation selection state transitions
- scrubbing must not mutate source animation
- scrubbing must not mark animation dirty

Avoid browser/Phaser integration tests unless the current test architecture already supports them cleanly.

Prefer pure unit tests.

---

# 22. Manual verification

Provide a manual verification checklist and perform all reasonable checks.

At minimum verify:

### Editor entry

- Rig Editor still opens and works
- Animation Editor opens independently
- no regression to existing editor route

### Character loading

- sample character loads
- existing rig renders correctly

### Animation selection

- select idle
- select walk
- selected animation updates correctly

### Timeline

- correct duration shown
- ruler visible
- playhead visible
- current time visible

### Scrubbing

- click near animation start
- click middle
- click near end
- drag playhead continuously
- drag beyond left edge
- drag beyond right edge

Verify current time remains clamped.

### Preview

While scrubbing:

- puppet pose changes
- preview matches existing runtime animation
- stepped animation retains stepped behavior if runtime evaluation says so
- smooth animation retains smooth behavior

### Source safety

Verify:

- source animation object is unchanged
- merely scrubbing does not dirty animation
- selecting another animation creates/loads correct working copy

---

# 23. Regression requirements

Do not regress:

- runtime Puppet API
- character loader
- rig loading
- slots
- attachments
- skins
- animation playback
- animation blending
- animation events
- IK
- Rig Editor
- Rig Editor undo/redo
- rig export
- character manifests
- existing JSON schemas

Existing external rig/animation files must remain compatible.

---

# 24. Code quality

Requirements:

- strict TypeScript
- no `any`
- avoid unsafe casts
- ES modules
- minimal dependencies
- no React
- no duplicate animation evaluator
- no duplicate validation layer
- pure logic separated from Phaser where practical
- clear ownership of state
- no hidden global mutable animation-editor state
- document non-obvious timeline math

Reuse existing project conventions.

Do not perform large unrelated refactors.

---

# 25. Required commands

Before considering v0.5.2.1 complete, run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

Do not report the milestone complete while any of these commands fail.

---

# 26. Definition of done

v0.5.2.1 is complete when:

- dedicated Animation Editor exists
- existing Rig Editor still works
- sample character can be previewed
- existing animations can be selected
- selected animation is represented by an independent working copy
- animation duration is represented correctly
- basic timeline ruler is visible
- playhead is visible
- clicking timeline changes current time
- dragging/scrubbing works
- current time is clamped
- current time is displayed numerically
- puppet preview updates from the existing animation evaluator
- no duplicate interpolation logic was introduced
- source animation remains unchanged
- scrubbing does not dirty animation
- invalid/empty states do not crash
- architecture is ready for bone tracks and keyframes
- tests pass
- typecheck passes
- build passes

---

# 27. Do NOT implement yet

Explicitly leave these for later milestones unless a very small piece is absolutely required by architecture:

- editable bone tracks
- keyframe diamonds
- creating keyframes
- deleting keyframes
- moving keyframes
- copy/paste keyframes
- multi-keyframe selection
- interpolation editing UI
- event editing UI
- onion skinning
- ghost poses
- mirrored keyframes
- IK target authoring
- IK baking
- production animation JSON export
- complex playback controls
- scene choreography
- physics
- ragdolls
- mesh deformation

Do not scope-creep into v0.5.2.2 or beyond.

---

# 28. Final report

When finished, give me a concise implementation report containing:

## Implemented

List the completed v0.5.2.1 features.

## Architecture

Describe:

- animation working-copy ownership
- animation editor state ownership
- timeline state
- how current time reaches the existing animation evaluator
- how the puppet preview is updated

## Files changed

List all created/modified files and briefly explain each.

## Public/internal APIs added

List important new classes, functions, types, or editor APIs.

## Tests

Describe new/updated tests.

## Verification

Report results of:

```bash
npm run typecheck
npm run test
npm run build
```

## Manual checks

Report the manual verification performed.

## Deferred to v0.5.2.2+

Explicitly list features intentionally not implemented yet.

Do not claim success unless the required commands pass.
