# Paper Puppeteer Engine — v0.5.7.1
## Timeline Track Search & Filtering

Continue developing my standalone Paper Puppeteer Engine.

**Current completed version: v0.5.6.5**

Technology stack:
- React + TypeScript (strict) for editor UI
- Phaser for rendering
- Vite, npm, ES modules

Already implemented:
- Visual Rig Editor
- Visual Animation Editor
- Bone/property timeline tracks
- Keyframe selection and editing
- IK target animation and IK baking
- Interpolation, events and playback
- Onion skinning and mirroring
- Undo/Redo and animation import/export

Do not rebuild these systems.

## Goal

Implement **v0.5.7.1 — Timeline Track Search & Filtering**.

Improve navigation through complex character animations with many bones, keyframes and IK tracks.

### 1. Track search

Add a search field above the animation timeline.

Search by:
- Bone names and IDs
- Property names
- IK constraint/target names
- Supported track labels

Make searching case-insensitive.

Use the existing React UI architecture.

Filtering should be responsive without unnecessarily rebuilding the entire timeline.

### 2. Track visibility filters

Provide options such as:

- Show All Tracks
- Keyed Tracks Only
- Selected Bone Only
- Show/Hide IK Tracks
- Show/Hide Event Track

Only implement filters that map cleanly to the current track model.

A filter hides rows visually; it never removes authored data.

### 3. Hierarchy preservation

Maintain understandable parent-child grouping when search results match a nested bone.

Example:

```text
Search: forearm

Character
  └── rightUpperArm
       └── rightForearm
            └── rotation
```

A simplified filtered hierarchy is acceptable, but matching tracks must remain easy to identify.

### 4. Expand/collapse controls

Add:
- Expand All
- Collapse All
- Expand Selected

Reuse existing track expansion state.

Do not modify rig hierarchy or animation data.

Preserve manually chosen expansion settings when clearing filters where practical.

### 5. Selection synchronization

Search/filter state must cooperate with:
- Selected bone
- Selected property
- Selected keyframes
- Selected IK target
- Selected event

Hidden selected tracks should remain selected internally.

Provide a clear way to reveal a hidden selection, rather than silently clearing it.

### 6. Filtering and authored operations

Copy, paste, delete and group operations must continue to act on their actual selected keys.

Do not automatically limit existing selection merely because some selected keys are hidden by a filter.

If a destructive command affects hidden selected keys, make its affected count clear.

### 7. Editor-only state

Store filter/search/expansion state separately from AnimationDefinition.

These operations must NOT:
- Mark animation dirty
- Create Undo history
- Modify workingAnimation
- Affect JSON export
- Modify the rig

### 8. React architecture

Use existing components, hooks and state management.

Keep filtering derivation pure/testable where practical.

Avoid duplicated authoritative track models or unnecessary React re-renders.

### 9. Tests

Test:
- Case-insensitive searching
- Keyed-only filtering
- Nested hierarchy results
- IK/event track visibility
- Expand/collapse
- Hidden selection preservation
- Clearing filters
- Empty search results
- Source/working animation immutability

### 10. Manual verification

Use a character with many bones and tracks.

Verify:
1. Search for a forearm.
2. Display keyed tracks only.
3. Hide IK tracks.
4. Expand/collapse groups.
5. Select a bone through the Phaser preview.
6. Reveal that selection in the timeline.
7. Scrub and play while filtered.
8. Clear filters and confirm all data remains.

### 11. Do NOT implement

- New animation keyframe types
- New IK systems
- Bulk retiming
- New snap modes
- Sprite replacement
- Rig-tweak mode
- Scene choreography

### 12. Required verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Track search works
- Filtering works
- Hierarchy remains understandable
- Expand/collapse shortcuts work
- Selection remains coherent
- Hidden tracks retain their authored data
- Playback and timeline editing remain functional
- No authored dirty/history changes
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented features
2. Track filtering architecture
3. Selection behavior
4. React components/files changed
5. Tests
6. Manual verification performed
7. Exact command results
8. Deferred functionality

Do not claim completion unless all commands pass.
