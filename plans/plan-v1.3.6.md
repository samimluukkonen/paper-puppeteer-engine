# Paper Puppeteer Engine — v1.3.6
## Audio, Dialogue & Cinematic Timing — Integration and Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.3.5**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Implemented v1.3 functionality:
- Audio asset management
- Visual audio timeline
- Synchronized audio playback
- Dialogue/subtitle authoring
- Dialogue presentation
- Scene cue integration

Existing functionality:
- Rig Editor
- Animation Editor
- Scene Editor
- Project Workspace
- Root motion
- Scene backgrounds and parallax
- Cinematic camera
- Cuts and fades
- Undo/Redo
- Autosave and crash recovery
- Feature Guide Wizard
- Runtime import/export

This is a private tool used by myself and one artist friend.

## Goal

Complete **v1.3 — Audio, Dialogue & Cinematic Timing**.

Prioritize reliability and everyday artist usability.

Do not introduce another major subsystem.

## 1. Complete cinematic workflow

Test an end-to-end scene:

1. Open an existing project.
2. Create a new scene.
3. Add a background and foreground artwork.
4. Add two Actors.
5. Position the Actors.
6. Add background music.
7. Add an ambient sound clip.
8. Schedule Actor A walking toward Actor B.
9. Animate a camera pan.
10. Add a dialogue line.
11. Add a sword attack with root motion.
12. Add a sword-swing sound.
13. Add an impact sound.
14. Add an appropriate existing scene cue.
15. Add Actor B's response.
16. Add a camera close-up.
17. Add fade-out.
18. Play the scene.
19. Pause and resume.
20. Scrub backward and forward.
21. Undo/Redo several authored changes.
22. Autosave and recover the project.
23. Export the complete project.
24. Re-import it.
25. Play the exported scene in the standalone runtime.

No TypeScript scripting should be necessary for ordinary scene authoring.

## 2. Timeline synchronization

Verify:
- Actor movement
- Root motion
- Animation clips
- Camera keyframes
- Cinematic cuts
- Fades
- Audio clips
- Dialogue
- Scene cues

All must follow the same scene time model.

Avoid independent clocks that drift from one another.

## 3. Audio correctness

Test:
- Music playback
- Ambient sound
- Simultaneous SFX
- Volume
- Fade-in/out
- Audio trimming
- Clip looping
- Playback speed
- Pause/resume
- Repeated restart
- Seek to an active audio clip
- Missing audio
- Browser autoplay restrictions
- Scene teardown

Document backend limitations clearly.

## 4. Dialogue correctness

Test:
- Short lines
- Long lines
- Multiple speakers
- Narration
- Unicode
- Japanese text
- Speaker deletion
- Overlapping intervals
- Timing edits
- Camera movement
- Fade effects
- Exact subtitle boundaries

Ensure text remains readable at intended output resolutions.

## 5. Seeking and side effects

The editor should support repeated seeking without:
- Duplicated sound effects
- Accidental scene cues
- Hanging audio instances
- Replayed dialogue side effects
- Actor state corruption
- Camera state drift

Keep state evaluation deterministic and side effects controlled.

## 6. Persistence and project packages

Verify full round trips for:
- Audio binary assets
- Audio clip definitions
- Clip source offsets
- Fades and volume
- Dialogue lines
- Actor speaker references
- Generic scene cues
- Existing camera and Actor data

Check project export/import and autosave/recovery.

Do not persist temporary Blob URLs or browser-only audio objects.

## 7. Feature Guide Wizard

Add accurate tutorials:

**Scene Editor — Importing Audio**
- Open project audio library
- Import audio
- Preview audio
- Return to Scene Editor

**Scene Editor — Audio Timeline**
- Add music clip
- Move clip
- Adjust trim and volume
- Preview playback

**Scene Editor — Creating Dialogue**
- Add dialogue line
- Choose speaker
- Edit text
- Adjust timing
- Preview subtitles

**Scene Editor — Audio and Scene Timing**
- Align sound effect to animation
- Adjust timing
- Preview
- Scrub without triggering SFX
- Restart playback

Use existing guide registry and spotlight anchors.

Do not rebuild the wizard.

## 8. Artist-facing documentation

Create or update a concise guide:

**Creating an Audiovisual Scene**

Explain:
- Audio asset imports
- Music and SFX tracks
- Audio trimming
- Volume and fading
- Playback synchronization
- Dialogue/subtitle authoring
- Speaker associations
- Scene cues
- Previewing and scrubbing
- Exporting a complete scene

Use actual UI terminology.

## 9. Performance and resource lifecycle

Measure representative scenarios:
- Several concurrent audio clips
- Long music tracks
- Rapid timeline scrubbing
- Multiple Actors
- Camera animation
- Large backgrounds
- Scene switching
- Repeated play/stop
- Project export

Inspect:
- Decoded audio buffer retention
- Audio playback handles
- Phaser resources
- React subscriptions
- Object URLs
- Timers/listeners

Only optimize demonstrated bottlenecks.

## 10. Regression matrix

**Rig Editor**
- Bone/joint editing
- IK
- Artwork
- Foot markers

**Animation Editor**
- Keyframes
- Graph Editor
- Pose Library
- Root motion
- Environment Preview
- IK
- Export/import

**Scene Editor**
- Actor placement
- Choreography
- Layers/parallax
- Camera
- Cuts/fades
- Audio
- Dialogue
- Cues

**Project Workspace**
- Binary asset management
- Validation
- Autosave
- Recovery
- Export/import

## 11. Automated tests

Extend coverage for:
- Audio scheduling
- Clip lifecycle
- Audio trim/loop/fade
- Pause/resume
- Seek correctness
- Event suppression
- Dialogue evaluation
- Cue dispatch
- Missing assets
- Undo/Redo
- Autosave/recovery
- Scene import/export
- Standalone runtime
- Resource cleanup

Use existing testing infrastructure.

Do not claim manual verification unless actually performed.

## 12. Out of scope

Do not implement:
- Voice synthesis
- Lip synchronization
- Dialogue branching
- Quest/choice systems
- 3D spatial audio
- Audio recording/editing studio
- Commercial plugin infrastructure
- Online collaboration

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run available lint, browser/E2E tests and standalone consumer builds.

Fix failures.

## Final v1.3 definition of done

v1.3 is complete when:
- Audio assets can be imported and managed.
- Audio clips can be authored visually.
- Music and SFX play at the intended times.
- Pause/resume/restart work.
- Passive scrubbing does not trigger unwanted sound.
- Dialogue lines can be authored.
- Speaker association works.
- Subtitles render during playback.
- Scene cues remain deterministic and side-effect safe.
- Camera, Actors, audio and dialogue stay synchronized.
- Autosave and project export/import preserve everything.
- Standalone scene playback works.
- Feature Guide tutorials are updated.
- Existing editors remain functional.
- No serious regressions remain.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall v1.3 readiness verdict
2. Audio asset architecture
3. Audio timeline and scheduler
4. Playback synchronization
5. Dialogue authoring and rendering
6. Scene cue integration
7. Persistence/export results
8. Performance measurements
9. Files/APIs changed
10. Automated tests
11. Actual manual verification
12. Documentation
13. Exact verification command results
14. Known limitations
15. Recommended next milestone

Do not claim completion if required checks fail.
