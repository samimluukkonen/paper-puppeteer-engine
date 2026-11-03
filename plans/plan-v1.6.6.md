# Paper Puppeteer Engine — v1.6.6
## Linear Story Sequencing — Integration & Production Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.6.5**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Implemented v1.6 functionality:
- Linear StoryDefinition
- Scene sequencing
- Dialogue advance holds
- Hold-local idle animation and audio
- Visual Story Editor
- Story Player
- Enter-to-advance input
- Scene transitions and story packaging

Existing systems:
- Rig Editor
- Animation Editor
- Scene Editor
- Root motion and IK
- Mesh deformation
- Animation retargeting
- Reusable choreography
- Cinematic cameras
- Audio and dialogue
- Autosave/recovery
- Feature Guide Wizard

This application is privately used by myself and one artist friend.

Mukashi Monogatari is a LINEAR cinematic storytelling application. The viewer only advances dialogue.

## Goal

Complete v1.6 by ensuring the entire linear storytelling workflow works correctly across authoring, playback, export/import and standalone runtime.

No gameplay or branching systems.

## 1. End-to-end story acceptance

Create a test story with at least three scenes.

### Scene 1 — Forest Arrival

1. Add a forest background.
2. Add a character.
3. Animate walking into frame.
4. Play ambient forest audio.
5. Animate the camera.
6. Display narration.
7. Reach an advance-required dialogue.
8. Wait for Enter.
9. Resume cinematic playback.

### Scene 2 — Samurai Encounter

1. Add two characters.
2. Use existing reused/retargeted animations.
3. Animate them facing one another.
4. Display the first character's dialogue.
5. Wait for Enter.
6. Allow subtle breathing/idle animations during hold.
7. Advance to the second character's line.
8. Resume after the final dialogue.

### Scene 3 — Sword Demonstration

1. Use a sword-cut animation with root motion.
2. Play synchronized sword sound effects.
3. Animate a cinematic camera close-up.
4. Show a response dialogue.
5. Advance with Enter.
6. Fade out.
7. Complete the story.

These are acceptance examples, not hardcoded story content.

## 2. Dialogue advancement correctness

Verify:
- Enter advances exactly one dialogue step.
- Held dialogue remains visible.
- Key-repeat cannot skip lines.
- Rapid repeated input cannot skip unintended lines.
- Dialogue at time zero works.
- Consecutive dialogue holds work.
- Scene boundaries work.
- Restart resets consumed holds.
- Story completion is clean.

## 3. Clock ownership

Verify:
- Main scene clock pauses at dialogue holds.
- Actor choreography does not advance during holds.
- Root motion does not advance.
- Camera animation does not advance.
- Future cues do not fire.
- Hold-local idle animations may continue.
- Permitted ambient audio continues according to its policy.
- Resume does not catch up accumulated waiting time.

Avoid accidental independent authoritative scene clocks.

## 4. Deterministic seeking

Scene Editor scrubbing must remain deterministic.

At a given scene time, authored cinematic state should be reproducible independent of previous seeks.

Do not conflate pure time evaluation with viewer-specific dialogue hold consumption.

Preview seeking must not:
- Replay external cues
- Trigger unintended sound effects
- Consume dialogue advances
- Modify authored animation data

## 5. Source isolation

Verify Story Editor operations do not unexpectedly modify:
- Shared SceneDefinitions
- Character rigs
- Animations
- Root-motion tracks
- Mesh attachments
- Reusable choreography templates

Dialogue authoring should modify the intended scene document only.

## 6. Export/import

Verify a complete story survives:
- Autosave
- Browser recovery
- Project export
- Project import
- Standalone runtime loading

All required scene, character, image, mesh and audio references should remain portable.

## 7. Story Player lifecycle

Test:
- Start/stop
- Restart
- Scene switching
- Dialogue waiting
- Advance input
- Loading delays
- Missing assets
- Repeated player mounting/disposal
- Audio cleanup
- Phaser cleanup

No stale listeners, orphaned audio or duplicated cue callbacks.

## 8. Feature Guide Wizard

Extend existing tutorials.

### Creating a Story
- Open Story Editor
- Create story
- Add scenes
- Reorder
- Preview

### Dialogue Advancement
- Open Scene Editor dialogue track
- Select a line
- Set Wait for Enter
- Preview hold
- Advance

### Idle During Dialogue
- Configure hold-local idle animation
- Preview
- Configure permitted audio
- Resume

### Exporting a Story
- Validate story
- Resolve missing assets
- Export
- Preview in standalone player

Use existing Guide Wizard registry and actual UI anchors.

Do not rebuild the tutorial system.

## 9. Artist documentation

Write a concise guide:

**Creating a Linear Story in Paper Puppeteer Engine**

Explain:
- Scene assets versus stories
- Scene ordering
- Dialogue progression modes
- Enter-to-advance behavior
- Idle animations during dialogue
- Camera/audio hold semantics
- Scene transitions
- Story preview
- Export/import
- Standalone Story Player
- Common troubleshooting

Use actual UI terminology.

## 10. Performance

Measure representative scenarios:
- Multiple scenes
- Large backgrounds
- Complex deformable characters
- Camera animation
- Concurrent audio
- Long dialogue holds
- Repeated advance input
- Scene switching
- Story export

Optimize measured issues.

Avoid loading or decoding the entire story unnecessarily.

## 11. Regression matrix

### Rig Editor
- Rig authoring
- FK/IK
- Mesh deformation
- Skins
- Foot markers

### Animation Editor
- Timeline
- Root motion
- Graph Editor
- Environment Preview if present
- Retargeted animations
- Animation variations

### Scene Editor
- Actors
- Choreography
- Camera
- Cuts/fades
- Audio
- Dialogue
- Scene cues
- Dialogue holds

### Story Editor
- Story creation
- Ordering
- Scene references
- Preview
- Persistence

### Standalone Runtime
- Complete stories
- Keyboard advancement
- Transitions
- Audio lifecycle
- Resource cleanup

## 12. Automated tests

Expand tests for:
- Story sequencing
- Dialogue state machine
- Hold boundaries
- Advance input
- Key-repeat behavior
- Hold-local clocks
- Idle animation
- Audio policies
- Scene transitions
- Asset loading
- Deterministic scrubbing
- Undo/Redo
- Autosave/recovery
- Export/import
- Runtime lifecycle

Do not claim manual verification unless actually performed.

## 13. Scope restrictions

Do not implement:
- Branching narratives
- Dialogue choices
- Player-controlled characters
- Interactive combat
- Quest/inventory systems
- Player state machines
- General gameplay scripting
- Online collaboration

## 14. Verification

Run actual repository equivalents of:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint, browser/E2E and standalone consumer tests where available.

Fix failures.

## Final v1.6 definition of done

v1.6 is complete when:
- Stories contain ordered scene references.
- Artists can arrange stories visually.
- Scenes play automatically in order.
- Dialogue can require explicit advancement.
- Enter advances only the intended dialogue step.
- Main cinematic timing pauses correctly.
- Optional idle/ambient playback works during holds.
- Scene cues remain side-effect safe.
- Scene transitions are reliable.
- Assets load and unload correctly.
- Exported stories run in standalone consumers.
- Source assets remain isolated.
- Autosave and recovery work.
- Feature Guide tutorials are updated.
- Existing editors remain functional.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall v1.6 readiness verdict
2. Story data model
3. Scene sequencing
4. Dialogue progression
5. Hold and clock semantics
6. Idle/audio behavior
7. Story Editor
8. Story Player and input handling
9. Transitions/loading
10. Export/import
11. Performance
12. Files/APIs changed
13. Automated tests
14. Actual manual verification
15. Documentation
16. Exact command results
17. Known limitations
18. Recommended v1.7 priorities

Do not claim completion if required checks fail.
