# Paper Puppeteer Engine — v1.5.5
## Reusable Choreography & Scene Templates

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.5.4**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing:
- Scene Editor
- Actor choreography
- Animation/root-motion clips
- Scene timeline
- Backgrounds and layers
- Camera animation/cuts/fades
- Audio and dialogue
- Project asset management
- Character variants
- Export/import and autosave

## Goal

Allow the artist to reuse common cinematic choreography and scene setups.

Examples:
- Character walks into frame and stops
- Two characters bow to one another
- Sword attack followed by a reaction
- Character kneels and rises
- Camera pans toward a character
- Reusable forest or dojo scene layout

Mukashi Monogatari is a LINEAR scripted storytelling application.

Do not implement player choices, branching narrative logic or gameplay.

## 1. Inspect Scene Editor architecture

Review:
- SceneDefinition
- Scene action/clip models
- Actor references
- Timeline editing
- Root-motion ownership
- Camera tracks
- Audio/dialogue tracks
- Scene clock
- Existing scene duplication
- Project asset registry

Reuse existing authoring and playback systems.

## 2. Reusable choreography

Introduce a lightweight reusable choreography asset or preset.

A choreography preset represents a finite, timed group of existing authored actions.

Examples:
- Walk forward → stop → bow
- Draw sword → attack → recover
- Two Actors enter → turn to face each other

Preserve existing action types.

Do not create a new runtime language or action interpreter.

## 3. Relative timing

Store choreography timing relative to the beginning of the reusable sequence.

When inserted at another scene time:
- Shift actions consistently.
- Preserve relative spacing.
- Preserve compatible event timings.
- Respect scene-duration rules.

Avoid modifying the source preset.

## 4. Actor role mapping

A reusable choreography should not depend exclusively on scene-specific Actor IDs.

Provide authoring-time roles.

Example:

PRESET: Two Samurai Bow

Roles:
- Samurai A
- Samurai B

Apply to Scene:
- Samurai A → Actor 17
- Samurai B → Actor 23

Validate that referenced animations and character rigs are compatible with selected Actors.

Do not automatically retarget incompatible animations silently.

Use existing Animation Library and retargeting functionality.

## 5. Position semantics

Define whether a choreography preset uses:
- Relative Actor displacement
- Absolute scene positions
- Existing root-motion animation displacement

Prefer relative offsets for reusable character choreography.

Preserve explicit scene-world positions only when they are intentionally part of the preset.

Do not apply root motion twice.

## 6. Scene Editor UI

Add actions such as:

**Save Selected Actions as Choreography**

**Insert Choreography**

Suggested workflow:
1. Select timeline actions.
2. Save as a named preset.
3. Choose preset in another scene.
4. Assign Actor roles.
5. Choose insertion time.
6. Preview.
7. Confirm insertion.

Use existing timeline selection/dragging and Undo/Redo.

## 7. Choreography preview

Preview before insertion where feasible.

Show:
- Required Actors
- Duration
- Animation references
- Root-motion behavior
- Missing assets or compatibility warnings

Preview must not modify the destination scene.

## 8. Scene templates

Provide a separate lightweight workflow:

**Save Scene as Template**

**Create Scene from Template**

A template may include:
- Background layers
- Camera setup
- Scene artwork
- Optional Actors
- Optional timeline tracks
- Audio/dialogue elements when explicitly included

Use copy-on-create semantics initially.

The new scene should have its own identity and independent authored document.

Shared project assets may remain referenced.

Do not create complex live nested scenes.

## 9. ID and reference remapping

This is important.

When copying choreography or a scene:
- Generate fresh scene-local action IDs.
- Remap selected Actor references.
- Update dialogue speaker IDs where copied.
- Preserve shared asset IDs when appropriate.
- Validate references to animations and audio assets.
- Preserve scene cue payloads without executing them.

Do not leave dangling IDs.

Do not copy arbitrary runtime callback functions.

## 10. Timing and conflicts

Validate:
- Overlapping movement ownership
- Root-motion conflicts
- Invalid action timing
- Missing animation assets
- Camera/fade collisions
- Invalid audio/dialogue references

Use the existing Scene Editor validators.

Allow warnings for editable drafts but prevent invalid export where appropriate.

## 11. Source isolation

Editing an inserted choreography must not automatically change its source preset.

Initially use independent copied actions after insertion.

Do not implement live-linked choreography inheritance.

A future explicit "Update Preset" operation could be added separately.

## 12. Tests

Cover:
- Save choreography
- Insert at different times
- Actor role remapping
- Relative motion
- Root-motion ownership
- Multi-Actor choreography
- Missing animation
- Incompatible rig
- Scene template creation
- Fresh IDs
- Audio/dialogue references
- Undo/Redo
- Source immutability
- Export/import

## 13. Manual acceptance

Create a short scene:

1. Two samurai walk toward one another.
2. Both stop.
3. Both bow.
4. Save the action sequence as choreography.
5. Create another scene.
6. Insert the same choreography at a different time.
7. Map roles to different compatible characters.
8. Preview playback.
9. Save the scene as a template.
10. Create a new scene from that template.
11. Modify the new scene.
12. Verify the template and first scene remain unchanged.
13. Export/reload.

## 14. Out of scope

Do not implement:
- Player branching
- Interactive choices
- Conditional gameplay triggers
- Quest systems
- Complex live scene inheritance
- Procedural scene generation
- Multiplayer collaboration

## 15. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

The artist can save, insert and adapt reusable choreography and scene templates without rebuilding timeline actions or altering the original source documents.

## Final report

Describe choreography model, Actor mapping, timing semantics, scene templates, source isolation, validation, files changed, tests and exact results.
