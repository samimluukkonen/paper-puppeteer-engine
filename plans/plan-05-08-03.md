# Paper Puppeteer Engine — v0.5.8.3
## Animation Editor Rig-Tweak Mode

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.8.2**

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

Existing systems:
- Production Rig Editor
- Production Animation Editor
- Shared skeleton/transform architecture
- Rig joint and artwork alignment tools
- Animation playback/scrubbing
- Separate rig and animation working copies
- Undo/Redo and import/export

Do not rebuild working editor systems.

## Goal

Implement **v0.5.8.3 — Rig-Tweak Mode accessible from Animation Editor**.

The artist should be able to notice a misplaced joint while animating, temporarily adjust the rig, and continue animating without manually switching between two disconnected workflows.

**A rig tweak must remain a rig change, never an animation keyframe.**

### 1. Explicit editor modes

Provide two clearly distinguishable modes:

```text
Animation Mode
→ Edit animation keyframes and IK targets

Rig-Tweak Mode
→ Edit rig joints and artwork alignment
```

Only one authoring mode may be active at a time.

### 2. React mode control

Add a clear mode switch using current editor conventions.

Example:

```text
Editor Mode:

(o) Animation
( ) Rig Tweak
```

Show a clear indication when the artist is editing rig data.

### 3. Reuse Rig Editor functionality

Reuse existing:
- Bone/joint manipulation
- Sprite offset/origin manipulation
- Slot transform editing
- Selection handles
- Coordinate conversion
- Validation

Do not implement a second independent rig manipulator.

Share reusable components/controllers where appropriate without combining unrelated histories.

### 4. Working-copy ownership

The Animation Editor must not silently mutate the loaded source rig.

Provide one authoritative editable rig working copy for the active character/editor session.

Coordinate ownership with the existing Rig Editor to avoid independent conflicting edits to the same working rig.

Rig changes and animation changes must remain distinct.

### 5. Separate authored histories

Keep clear Undo/Redo semantics.

Preferred:
- Rig-Tweak edits enter rig history
- Animation edits enter animation history
- Mode switching does not create history entries

Use current project history conventions.

Do not let Undo accidentally modify unrelated animation data.

### 6. Pause playback

Entering Rig-Tweak Mode should pause playback and preserve currentTime.

While tweaking:
- Current animation remains available as visual context
- Automatic animation playback stays paused
- The artist modifies rig properties only

### 7. Live pose update

After a rig change:

```text
Rig working copy changes
        ↓
Existing animation reevaluated
        ↓
IK/procedural preview updates
        ↓
Character preview refreshes
```

Do not rewrite animation keyframes.

Do not bake IK to compensate for rig changes.

### 8. Rig change consequences

A changed joint position or bone length can affect existing animations and IK behavior.

Do not promise automatic motion preservation.

Where practical, show a clear before/after preview and explain that the rig change affects every animation sharing that rig.

Keep a straightforward Revert/Undo path.

### 9. Mode-specific controls

In Rig-Tweak Mode:
- Joint and artwork handles are active
- Keyframe authoring handles are inactive
- Keyframe drag and deletion should not accidentally occur

In Animation Mode:
- Normal animation tools return
- Rig manipulation is inactive

### 10. Save/export distinction

Show separate statuses:

```text
Rig: Modified
Animation: Clean
```

or the reverse.

Provide clear access to exporting/saving the updated rig using existing workflow.

Do not mark the animation modified merely because the rig changed.

### 11. Unsaved changes

Protect against losing rig tweaks when:
- Switching character
- Reloading rig
- Leaving editor
- Importing another rig

Use existing dirty-state and confirmation conventions.

### 12. Tests

Add tests for:
- Mode switching
- Correct working-copy ownership
- Rig modification only
- Animation remains unchanged
- Separate history
- Playback pause
- Preview refresh
- IK reevaluation
- Revert
- Import/export
- React/Phaser lifecycle cleanup

### 13. Manual verification

1. Open an existing animation.
2. Scrub to a pose exposing a bad elbow pivot.
3. Enter Rig-Tweak Mode.
4. Move elbow joint.
5. Verify preview updates.
6. Return to Animation Mode.
7. Scrub and play animation.
8. Undo rig change.
9. Export updated rig.
10. Reload and verify result.

Confirm no animation keys were created.

### 14. Do NOT implement

- Automatic animation retargeting after rig edits
- Automatic IK baking
- Sprite asset package export
- New bone deformation system
- Scene choreography

### 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Rig-Tweak Mode exists inside Animation Editor
- Rig and animation modes are clearly separated
- Existing rig manipulation tools are reused
- Rig changes update preview
- No animation keyframes change accidentally
- Rig history and animation history remain distinct
- Rig changes can be exported/reverted
- Existing animation workflow remains functional
- Tests, typecheck and build pass

## Final report

Provide:
1. Editor mode architecture
2. Rig working-copy ownership
3. Shared Rig Editor tools
4. History/dirty-state separation
5. Live preview behavior
6. Files/APIs changed
7. Tests and manual verification
8. Command results
9. Deferred features

Do not claim completion unless all commands pass.
