# Paper Puppeteer Engine — v1.5.6
## Reusable Animation & Scene Assets — Integration and Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.5.5**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Implemented v1.5 features:
- Reusable Animation Library
- Rig Compatibility and Bone Mapping
- Animation Retargeting Engine
- Visual Retargeting Editor
- Character Variants and Templates
- Reusable Choreography and Scene Templates

Existing features include:
- Rig, Animation and Scene Editors
- Root motion and Environment Preview where available
- FK/IK and foot contact tools
- Mesh attachments, weight painting and corrective deformation
- Camera and scene composition
- Audio/dialogue
- Project Workspace
- Autosave/recovery and import/export
- Feature Guide Wizard

This application is used privately by myself and one artist friend.

Mukashi Monogatari is a linear cinematic story-viewing experience. Viewer input is limited to advancing dialogue. Do not implement gameplay or branching narrative systems.

## Goal

Complete **v1.5 — Reusable Animation & Scene Assets**.

Make asset reuse and cross-character animation workflows reliable enough for real production.

Do not introduce new major subsystems.

## 1. End-to-end workflow

Test this realistic example.

### Reusing a Sword Animation

1. Open a project with Samurai A.
2. Open its sword-cut animation.
3. Preview it in Animation Library.
4. Add Samurai B with a differently proportioned rig.
5. Compare rigs.
6. Create/review bone mapping.
7. Retarget the sword-cut animation.
8. Preview both characters.
9. Check root motion and foot contact.
10. Save the retargeted animation.
11. Make target-specific corrections.
12. Confirm original animation remains unchanged.
13. Create a character variant using another skin.
14. Open Scene Editor.
15. Add both samurai.
16. Create a sequence where Samurai A attacks.
17. Make Samurai B react.
18. Save this action group as choreography.
19. Create a new scene.
20. Insert the choreography with new Actor mappings.
21. Preview.
22. Save the scene as a template.
23. Create another scene from the template.
24. Modify it independently.
25. Autosave/recover.
26. Export/reload.
27. Test standalone scene playback.

## 2. Retargeting correctness

Verify:
- Source/target rest poses
- Bone hierarchy conversion
- Different bone proportions
- Rotation interpolation
- Translation scaling
- IK compatibility
- Root-motion ownership
- Facing and mirroring
- Foot contact positions
- Animation duration
- Events

Ensure incompatible data is not silently transferred.

## 3. Mesh deformation

v1.4 introduces mesh attachment and corrective vertex data.

Test retargeting between:
- Two rigs sharing compatible attachments
- Two rigs with different mesh topology
- Rigid-only source and mesh-based target
- Mesh-based source and rigid-only target

Corrective vertex tracks must not be applied to unrelated vertex IDs.

Target mesh skinning should continue responding correctly to retargeted bone animation.

## 4. Animation Library consistency

Verify:
- Search/filter
- Preview
- Existing asset reuse
- Independent copies
- Character-specific compatibility
- Animation variations
- Project references
- Deletion/dependency warnings

Avoid duplicated asset ownership.

## 5. Character variants

Verify:
- Shared rig references
- Independent rig copies
- Skin switching
- Mesh image compatibility
- Animation reuse
- Asset deletion safety
- Multiple variants in one scene

Do not allow editing one variant to silently corrupt another.

## 6. Choreography and scene templates

Verify:
- Relative action timing
- Actor role mappings
- Scene-local ID remapping
- Root-motion conflicts
- Scene camera tracks
- Audio clips
- Dialogue speakers
- Scene cues
- Missing dependencies
- Export/import

Original presets/templates must remain unchanged when their copies are edited.

## 7. Scene seeking

Test deterministic behavior after inserting reusable choreography.

At a given scene time, Actor poses/positions and camera state must not depend on previous preview positions.

Passive seeking must not trigger unrelated audio or gameplay callbacks.

Respect established scene event/audio behavior.

## 8. Autosave and recovery

Test:
- New animation asset
- Saved bone mapping
- Retargeted animation
- Character variant
- Choreography preset
- Scene template
- Shared artwork and audio references

Browser recovery must preserve valid authored data.

Avoid writing source assets over unrelated files.

## 9. Performance

Measure practical scenarios:
- Large animation libraries
- Multiple rigs
- Complex retargeted animations
- Mesh-deformed characters
- Several scene Actors
- Reusable choreography insertion
- Rapid animation switching
- Project import/export

Optimize measured problems rather than adding complexity preemptively.

## 10. Feature Guide Wizard

Extend existing tutorials:

**Reusing Animations**
- Open library
- Preview
- Select compatible character
- Reuse or copy

**Retargeting an Animation**
- Select source
- Select target
- Review bone mapping
- Preview result
- Accept and save

**Character Variants**
- Choose base character
- Select shared rig
- Choose appearance
- Create variant

**Reusable Choreography**
- Select actions
- Save preset
- Insert into another scene
- Assign Actor roles
- Preview

**Scene Templates**
- Save current scene as template
- Create scene from template
- Edit independently

Use actual React/Phaser guide targets.

Do not rebuild the wizard.

## 11. Artist documentation

Write or update a concise guide:

**Reusing Animations and Scenes**

Explain:
- Animation Library
- Shared versus copied assets
- Rig compatibility
- Bone mapping
- Animation retargeting
- Root motion and IK limitations
- Mesh deformation compatibility
- Character variants
- Choreography presets
- Scene templates
- Export/import
- Common troubleshooting

Use actual UI terminology.

## 12. Regression tests

### Rig Editor
- Bones and joints
- IK
- Mesh geometry/weights
- Skins
- Foot markers
- Shared rig dependencies

### Animation Editor
- Keyframes
- Graph Editor
- Root motion
- IK
- Mirroring
- Pose Library
- Animation Variations
- Retargeted animations
- Corrective mesh keys

### Scene Editor
- Actors
- Choreography
- Camera
- Cuts/fades
- Audio/dialogue
- Reusable presets
- Templates
- Deterministic seeking

### Project Workspace
- Asset references
- Dependency validation
- Autosave/recovery
- Export/import

## 13. Browser and standalone tests

Run available automated UI tests and standalone consumer examples.

Do not claim visual/manual verification unless actually performed.

Confirm reused and retargeted animation data can be loaded outside the editor.

## 14. Out of scope

Do not implement:
- Interactive story branching
- Gameplay
- Player-controlled characters
- Automatic AI retargeting
- Physics-driven correction
- Complex live asset inheritance
- Online collaboration
- Public asset marketplace

## 15. Required verification

Run actual repository equivalents of:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint, UI/E2E and standalone consumer checks where available.

Fix failures.

## Final v1.5 definition of done

v1.5 is complete when:
- Animations can be browsed and reused.
- Compatible rigs are identified correctly.
- Bone mappings are saved and validated.
- Animations can be retargeted between compatible rigs.
- Retargeting can be previewed visually.
- Source animations remain unchanged.
- IK and root-motion policies are explicit.
- Incompatible mesh corrections are not transferred silently.
- Character variants and templates work.
- Choreography can be reused across scenes.
- Scene templates create independent scenes.
- Asset references remain valid.
- Undo/Redo and autosave/recovery work.
- Export/import preserves everything.
- Standalone playback remains compatible.
- Feature Guide tutorials are updated.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall v1.5 readiness verdict
2. Animation Library implementation
3. Rig mapping and compatibility
4. Retargeting mathematics and limitations
5. Visual retargeting workflow
6. Character variants and templates
7. Reusable choreography and scene templates
8. Mesh/IK/root-motion compatibility
9. Persistence and export/import
10. Performance findings
11. Files/APIs changed
12. Automated tests
13. Actual manual verification
14. Documentation
15. Exact command results
16. Known limitations
17. Recommended v1.6 priorities

Do not claim completion if required checks fail.
