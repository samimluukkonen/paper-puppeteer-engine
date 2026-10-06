You are continuing development of my standalone TypeScript project:

# Paper Puppeteer Engine

Current completed version:

# v0.5.2.3.3

Do NOT rebuild or replace working systems from earlier versions.

The Animation Editor already supports:

- animation working copies
- immutable source animation
- authoritative `currentTime`
- timeline ruler
- playhead
- scrubbing
- Play/Pause
- Restart
- looping
- playback speed
- authored FPS/mode handling where supported
- bone selection
- animated transform inspector
- creating bone/property keyframes
- updating keyframes
- deleting keyframes
- property keyed/not-keyed indicators
- partial transform animation
- Undo/Redo for authored animation changes
- dirty-state tracking
- existing animation evaluator as preview authority
- IK/facing safety
- validation

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

# v0.5.2.4.1 — Bone & Property Timeline Tracks

This milestone turns the basic timeline into a structured animation timeline.

Implement:

1. bone tracks
2. expandable property tracks
3. synchronization between hierarchy selection and timeline selection
4. timeline row layout/state
5. track labels
6. visual distinction between keyed and unkeyed tracks
7. infrastructure for keyframe markers in v0.5.2.4.2

Do NOT implement selectable/draggable keyframe diamonds yet.

---

# 1. Timeline structure

The timeline should conceptually support:

```text
root
├─ torso
│  ├─ x
│  ├─ y
│  ├─ rotation
│  ├─ scaleX
│  └─ scaleY
├─ upperArm
│  ├─ rotation
│  └─ ...
└─ forearm
   ├─ rotation
   └─ ...
```

Only show properties actually supported by the animation schema/runtime.

Do not invent new animation properties.

---

# 2. Track model

Create a clean editor-side track representation.

Conceptually:

```ts
type TimelineTrack =
  | BoneTimelineTrack
  | PropertyTimelineTrack;
```

Possible fields:

```ts
interface BoneTimelineTrack {
  kind: "bone";
  boneId: string;
  expanded: boolean;
}

interface PropertyTimelineTrack {
  kind: "property";
  boneId: string;
  property: BoneTransformProperty;
}
```

Exact types should follow existing project architecture.

The track model is editor state.

Do NOT serialize timeline row expansion into animation JSON.

---

# 3. Bone rows

Each animated/available bone should have a timeline row.

Display at least:

- bone name/id
- expand/collapse indicator
- whether the bone contains any authored keys

Example:

```text
▶ torso
▼ rightUpperArm
    rotation
    x
    y
▶ rightForearm
```

Developer-oriented styling is sufficient.

---

# 4. Property rows

When a bone is expanded, show property tracks.

Only include valid animation transform properties.

Prefer one of these strategies:

A. show all supported transform properties

or

B. show authored properties plus currently relevant supported properties

Choose whichever fits the current editor architecture cleanly.

Do not hide a property so aggressively that the user cannot key it later.

---

# 5. Track ordering

Track order should follow the rig/skeleton hierarchy where practical.

Do not alphabetically scramble bones if the rig already defines meaningful hierarchy/order.

Property ordering should be stable, for example:

```text
x
y
rotation
scaleX
scaleY
```

or the existing project convention.

Stable ordering is important.

---

# 6. Selection synchronization

Bone selection should synchronize between:

- visual puppet
- hierarchy panel
- timeline bone row

Selecting:

```text
rightForearm
```

in any supported editor surface should make the same bone selected everywhere.

Do NOT create separate incompatible selected-bone state for the timeline.

Reuse the existing Animation Editor selected bone state.

---

# 7. Property selection state

Introduce property-track selection if useful for future keyframe work.

Conceptually:

```ts
selectedBoneId: string | null;
selectedProperty: BoneTransformProperty | null;
```

Clicking a property row may select:

```text
bone + property
```

This selection is transient editor state.

It must not dirty animation data.

---

# 8. Expansion state

Bone rows should support expand/collapse.

Expansion state:

- editor-only
- not undoable authored data
- does not dirty animation
- does not alter animation JSON

Preserve expansion while scrubbing/playback where reasonable.

---

# 9. Timeline alignment

The left track-label area and right timeline-time area must remain vertically aligned.

Conceptually:

```text
| labels            | timeline area
| torso             |-------------------
|   rotation        |-------------------
|   x               |-------------------
| upperArm          |-------------------
```

Scrolling vertically should not cause labels and timeline rows to drift apart.

Use a clean layout architecture.

Do not implement an overly complicated virtualized list yet.

---

# 10. Horizontal time area

Reuse existing:

- ruler
- playhead
- time-to-X conversion
- timeline zoom/scale infrastructure if present

Do NOT duplicate timeline time conversion logic per row.

All tracks should share the same time coordinate system.

---

# 11. Authored-key awareness

Tracks should be able to answer:

```text
Does this bone have any keys?
Does this property have any keys?
```

Use existing animation data/query helpers.

Do NOT infer this from evaluated pose.

For this subversion, a simple indicator is enough.

Example:

```text
rightArm        •
  rotation      •
  x
  y
```

Exact visuals are not important.

---

# 12. Current-time behavior

Changing track selection must NOT change `currentTime`.

Scrubbing must continue to work exactly as before.

Playback must continue to update the global playhead across every timeline row.

---

# 13. Playback compatibility

While playing:

- tracks remain visible
- playhead moves
- row selection remains stable
- expansion remains stable

Track UI must not introduce a second playback clock.

---

# 14. Dirty-state behavior

These must NOT dirty animation:

- selecting a row
- selecting a property
- expanding/collapsing
- scrolling
- timeline navigation

No authored animation change occurs in this milestone.

---

# 15. Prepare for keyframe markers

Design timeline rows so v0.5.2.4.2 can render multiple keyframe markers at time positions.

Conceptually each property row should eventually be able to render:

```text
|----◆---------◆------◆--------|
```

Do NOT implement selectable diamonds yet.

But avoid a DOM/layout architecture that would need to be replaced to add them.

---

# 16. Empty states

Handle:

- animation with no keyed bones
- bone with no authored properties
- zero-duration animation
- no animation selected
- invalid animation

Timeline should remain stable.

---

# 17. Tests

Prefer pure tests for track-building/state logic.

Test:

- track ordering
- bone hierarchy ordering
- expand/collapse state
- property row generation
- authored-key detection
- bone selection synchronization
- property selection
- expansion does not dirty animation
- selection does not dirty animation
- source animation remains unchanged

Avoid brittle DOM tests unless project infrastructure already supports them cleanly.

---

# 18. Manual verification

Verify with demo character:

- all expected bones appear
- hierarchy order makes sense
- expand/collapse works
- property tracks appear
- select bone from hierarchy → timeline updates
- select timeline bone → puppet/hierarchy selection updates
- select property track
- playback continues working
- scrubbing continues working
- playhead aligns across rows
- no authored data becomes dirty from navigation

---

# 19. Do NOT implement yet

Do not implement:

- keyframe marker selection
- dragging keys
- moving keys
- multi-key selection
- box selection
- copy/paste
- duplicate keyframes
- interpolation editing
- event tracks
- onion skinning
- mirrored keyframes
- IK target tracks

---

# 20. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

---

# Definition of done

v0.5.2.4.1 is complete when:

- timeline has bone rows
- bones can expand into property rows
- ordering is deterministic
- track labels align with timeline area
- selection is synchronized with existing Animation Editor selection
- property selection is available if architecturally useful
- authored-key presence can be shown
- expansion/selection remain transient editor state
- playback and scrubbing still work
- architecture is ready for keyframe markers
- tests pass
- typecheck passes
- build passes

---

# Final report

Provide:

## Implemented

## Timeline track architecture

## Selection ownership

## Files changed

## APIs/types added or changed

## Tests

## Manual verification

## Required command results

## Deferred to v0.5.2.4.2+

Do not claim completion unless all required commands pass.
