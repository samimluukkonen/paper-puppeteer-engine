# Paper Puppeteer Engine — v1.2.6
## Scene Composition & Camera System — Integration and Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.2.5**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Completed v1.2 features:
- Scene backgrounds and image assets
- Layers, depth and parallax
- Cinematic Camera
- Camera timeline
- Camera cuts and fades

Existing systems:
- Project Workspace
- Rig Editor
- Animation Editor
- Scene Editor
- v0.7 animation runtime
- v0.8 choreography
- Pose Library and Graph Editor
- Autosave/recovery
- Feature Guide Wizard
- Scene/character import/export

Inspect the repository and verify actual feature availability.

This is a private tool for myself and my artist friend. Prioritize practical reliability over commercial product features.

## Goal

Complete **v1.2 — Scene Composition & Camera System**.

Integrate all v1.2 features, verify runtime correctness, and make the cinematic Scene Editor comfortable for everyday use.

Do not add new major subsystems.

## 1. End-to-end cinematic authoring

Exercise this workflow:

1. Open a project.
2. Create or open a scene.
3. Import a background.
4. Add distant mountains.
5. Add a foreground object.
6. Create/reorder scene layers.
7. Configure parallax.
8. Add two Actors.
9. Place the Actors.
10. Define a cinematic camera.
11. Preview framing.
12. Schedule Actor movement and animations.
13. Create camera pan/zoom keyframes.
14. Add a camera cut.
15. Add fade-in/out.
16. Preview entire scene.
17. Scrub forward/backward.
18. Undo/Redo edits.
19. Autosave and recover.
20. Export/reload project.
21. Play scene through standalone runtime.

Use actual public APIs and UI controls.

## 2. Camera consistency

Verify editor viewport and cinematic camera remain separate.

Check:
- Editor navigation
- Cinematic camera selection
- Camera frame visibility
- Camera keyframe authoring
- Camera preview
- Reset/revert
- Export/import

Editing a camera must not move scene Actors unintentionally.

## 3. Deterministic scrubbing

Test camera and scene evaluation at arbitrary times.

Given identical scene data and time, the preview should produce equivalent:
- Actor positions
- Actor animation poses
- Camera framing
- Parallax presentation
- Fade opacity

Independent of the previous seek position.

Do not dispatch gameplay cues during passive scrubbing.

## 4. Visual layering

Check:
- Far backgrounds
- Midground artwork
- Actors
- Foreground objects
- Ground reference
- Editor gizmos
- Fade overlay

Ensure correct ordering in camera preview and standalone runtime.

## 5. Pixel-art friendliness

Paper Puppeteer Engine may be used for pixel-art characters and scenes.

Inspect existing Phaser rendering options.

Where supported, document or offer appropriate settings for:
- Nearest-neighbor texture filtering
- Pixel rounding
- Integer scaling where appropriate
- Avoiding unwanted texture smoothing

Do not force all content to be pixel art.

Keep these settings lightweight.

## 6. Asset persistence and packaging

Verify all scene artwork is included or resolvable after project export.

Check:
- Image binaries
- Stable asset IDs
- Layer order
- Parallax values
- Camera configuration
- Camera keyframes
- Transition effects
- Scene Actor references

No temporary object URLs or absolute development-machine paths.

## 7. Backward compatibility

Verify:
- Old scenes without backgrounds
- Old scenes without camera tracks
- Existing Actor choreography
- Existing animations and IK
- Existing character packages

Use documented defaults for new optional scene fields.

Avoid unnecessary breaking changes.

## 8. Feature Guide Wizard

Extend the existing Guide Wizard with accurate Scene Editor tutorials:

- Adding Background Artwork
- Managing Layers
- Understanding Parallax
- Framing a Scene
- Editing Cinematic Camera
- Camera Keyframes
- Creating Camera Cuts
- Adding Fade Transitions
- Previewing the Scene

Use actual stable React/Phaser guide anchors.

Do not rebuild the wizard.

Tour navigation must not modify authored scene data.

## 9. Autosave and recovery

Verify:
- Background import recovery
- Layer changes
- Camera edits
- Camera timeline keyframes
- Fades
- Scene switching
- Project switching

Distinguish local autosave from exported files.

Do not lose image binaries during recovery.

## 10. Performance

Measure representative scenarios:
- Large background images
- Multiple parallax layers
- Two Actors
- Five Actors
- IK-enabled characters
- Camera zooming
- Rapid scrubbing
- Frequent timeline keyframe edits
- Scene export

Check for texture leaks and unnecessary React rerenders.

Only optimize observed bottlenecks.

## 11. Regression matrix

**Rig Editor**
- Bones and joints
- IK constraints
- Foot markers
- Sprite alignment
- Skins

**Animation Editor**
- Keyframes
- Graph Editor
- Pose Library
- IK
- Mirroring
- Onion skinning
- Animation variations
- Motion diagnostics

**Scene Editor**
- Actor placement
- Action timeline
- Playback
- Scrubbing
- Backgrounds
- Layers
- Parallax
- Camera
- Cuts/fades
- Import/export

**Project Workspace**
- Assets
- Autosave
- Recovery
- Validation
- Project export/import

## 12. Documentation

Write or update a short artist-facing guide:

**Creating Your First Cinematic Scene**

Explain:
1. Background import
2. Foreground layering
3. Parallax
4. Actor placement
5. Cinematic camera framing
6. Camera animation
7. Cuts
8. Fades
9. Preview/scrubbing
10. Exporting

Include screenshots where practical using existing project documentation conventions.

Document the distinction between editor viewport and cinematic camera.

## 13. Known limitations

Document unsupported or deferred features.

Examples:
- Automatic camera tracking
- Advanced camera shake
- Scene-to-scene transitions
- Dialogue
- Audio timeline
- Lighting/shaders
- Physics-based backgrounds

Do not implement these as part of hardening.

## 14. Automated tests

Extend existing tests for:
- Asset lifecycle
- Layer ordering
- Parallax
- Camera transforms
- Camera curve evaluation
- Scene time seeking
- Fade opacity
- Undo/Redo
- Autosave/recovery
- Import/export
- Standalone playback
- React/Phaser cleanup

Run browser integration tests where available.

Do not claim manual checks were performed unless actually exercised.

## 15. Required verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint, browser/E2E and consumer-example builds where available.

Fix all failures.

## Final v1.2 definition of done

v1.2 is complete when:
- Scenes support image backgrounds.
- Layers and depth ordering work.
- Parallax works consistently.
- Cinematic Camera can be positioned and previewed.
- Camera movement can be keyframed.
- Camera cuts and fades work.
- Camera and Actor playback remain synchronized.
- Scrubbing is deterministic for supported features.
- Exported scenes reproduce intended results.
- Existing characters and scenes remain compatible.
- Autosave and recovery preserve new data.
- Feature Guide tutorials are updated.
- No data-loss or serious playback regressions remain.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall v1.2 readiness verdict
2. Scene artwork and layering
3. Parallax implementation
4. Cinematic Camera architecture
5. Timeline and interpolation
6. Cuts and fades
7. Runtime preview parity
8. Persistence/export results
9. Performance findings
10. Files/APIs changed
11. Automated tests
12. Actual manual verification
13. Documentation
14. Exact command results
15. Known limitations
16. Recommended v1.3 work

Do not claim completion if important verification or release-readiness criteria fail.
