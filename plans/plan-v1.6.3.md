# Paper Puppeteer Engine — v1.6.3
## Visual Story Editor & Dialogue Advance Authoring

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.6.2.2**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems:
- StoryDefinition
- Linear scene sequencing
- Dialogue holds
- Hold-local animations and audio
- Scene Editor
- Project Workspace
- Validation, Undo/Redo and autosave
- Feature Guide Wizard

## Goal

Make linear story sequencing and dialogue advancement fully authorable through a visual interface.

The artist should not need to edit JSON or write TypeScript to create a complete scripted story.

## 1. Inspect existing UI

Review:
- Project Workspace navigation
- Scene asset browsing
- Scene Editor
- Dialogue track editing
- Timeline inspectors
- Asset dependency UI
- Existing preview and history systems

Reuse existing patterns.

## 2. Story Editor

Introduce a lightweight Story Editor or Story Sequence panel.

Suggested UI:

STORY: The First Encounter

Scenes:

1. Forest Entrance
2. The Meeting
3. Sword Demonstration
4. Departure

[+ Add Scene]

Actions:
- Add existing scene
- Remove entry
- Reorder scenes
- Duplicate entry
- Open source scene
- Preview story

Do not implement a complex nonlinear node editor.

A simple ordered list is appropriate.

## 3. Story creation

Support:
- New Story
- Rename Story
- Select existing scene
- Add scene
- Reorder scene entries
- Remove scene entry
- Save/recover
- Preview

Removing a scene from a story should not delete the underlying shared SceneDefinition.

## 4. Dialogue advance controls

Extend Scene Editor's existing dialogue inspector.

Provide a progression setting:

- Timed
- Wait for Enter

When Wait for Enter is selected, expose relevant hold configuration.

Examples:
- Speaker
- Text
- Advance behavior
- Optional Actor idle animation
- Optional hold-safe ambience/music behavior

Avoid exposing settings that are unsupported by the runtime.

## 5. Hold visualization

Show dialogue advance points on the Scene Editor timeline.

Use a recognizable marker or icon.

For example:

Dialogue:
  2.0s — Hero speaks [Enter]
  2.0s — Guard responds [Enter]
  5.0s — Narration [Timed]

The same-timestamp example represents an explicitly ordered dialogue sequence, not overlapping unrelated subtitles.

Keep existing time ruler and snapping behavior.

## 6. Preview interaction

In Scene Editor, provide a preview mode that simulates actual dialogue advancement.

The artist should be able to:
1. Play a scene.
2. Reach a dialogue hold.
3. Inspect the paused scene.
4. Observe permitted idle/ambient activity.
5. Press the configured advance control.
6. Continue playback.

Normal editing/scrubbing must remain available without getting trapped in viewer-input mode.

## 7. Story preview

Add **Preview Entire Story**.

Reuse the actual story sequencing runtime.

The preview should play scenes in order and honor their dialogue holds.

Provide artist-only preview controls for stop, restart and navigation as needed.

These authoring controls are NOT viewer gameplay features and should not be exposed in the finished Mukashi Monogatari runtime by default.

## 8. Validation feedback

Show warnings for:
- Missing scenes
- Invalid dialogue holds
- Invalid idle-animation references
- Invalid audio hold configuration
- Incompatible scene references
- Unsupported transitions

Allow opening the relevant source scene or dialogue item from the warning.

## 9. Undo/Redo

One completed reorder should produce one history operation.

Ensure story edits and scene dialogue edits modify the correct working documents.

Do not mark unrelated animations or scenes dirty.

## 10. Tests

Cover:
- Create story
- Reorder scenes
- Remove/duplicate entry
- Story preview
- Dialogue progression edits
- Hold markers
- Idle selection
- Invalid references
- Undo/Redo
- Autosave/recovery
- Export/import

## 11. Out of scope

Do not implement:
- Branching node editor
- Conditional logic
- Dialogue choices
- Gameplay input
- Quest state
- Player movement
- Interactive story variables

## 12. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

An artist can visually assemble a complete linear story and configure dialogue-advance behavior using the existing editors.

## Final report

Describe Story Editor workflow, dialogue inspector changes, preview integration, persistence, files changed, tests and exact results.
