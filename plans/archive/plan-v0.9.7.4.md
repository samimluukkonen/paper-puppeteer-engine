# Paper Puppeteer Engine — v0.9.7.4
## Ground Reference Integration & Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.7.3**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Ground reference guides have been implemented in:
- Animation Editor
- Scene Editor

This phase completes v0.9.7.

This engine is a private authoring tool for myself and one artist friend.

## Goal

Ensure ground guides work reliably across both editors and survive normal authoring workflows.

Focus on correctness, usability, persistence and regression testing.

## 1. Coordinate-system audit

Review the ground guide implementations in both editors.

Ensure there is a documented distinction between:

**Animation Editor**
- Character authoring/preview coordinate space
- Fixed reference ground Y
- Bone and IK target transforms

**Scene Editor**
- Scene-world coordinate space
- Scene ground Y
- Actor world positions and contact offsets

Do not directly equate the two Y values without converting between coordinate systems.

## 2. Persistent settings

Verify that ground guide settings survive:
- Switching animations
- Switching characters
- Switching scenes
- Closing and reopening an editor
- Export/re-import where the chosen authored metadata format supports it
- Local draft recovery, if implemented

Avoid temporary UI-only state when the user expects a persisted setting.

Do not serialize Phaser GameObjects, DOM references or guide handles.

## 3. Dirty state and Undo/Redo

Ground-guide changes must affect the appropriate metadata/document state, not unrelated animation files.

Verify:
- Moving guide line
- Numeric changes
- Show/hide toggle
- Reset
- Snap toggles
- Explicit IK alignment
- Explicit Actor snap

Make sure real authored IK/Actor changes are undoable through their existing editors.

Simply displaying a guide must not dirty authored data.

## 4. Performance

Check rendering while:
- Animation plays
- Timeline scrubs
- Camera zooms
- Scene playback runs
- Multiple Actors are visible

Avoid rebuilding Phaser overlay objects every frame.

Only update geometry when necessary.

## 5. Feature Guide Wizard

Inspect the existing Feature Guide Wizard.

If implemented, add two short tutorials:

**Animation Editor — Using Ground Reference**
1. Enable the line.
2. Position ground Y.
3. Inspect foot contact.
4. Use IK alignment where supported.
5. Hide or reset the guide.

**Scene Editor — Aligning Actors to Ground**
1. Enable ground guide.
2. Adjust Y.
3. Select an Actor.
4. Use Snap to Ground.
5. Preview scene movement.

Highlight the actual React controls using existing stable guide anchors.

Do not rebuild the wizard.

If unavailable, document tutorials as deferred.

## 6. UI consistency

The ground controls in both editors should use:
- Consistent terminology
- Similar icons
- Similar show/hide behavior
- Similar numeric input conventions
- Clear distinctions between guide changes and real transform edits

Add tooltips explaining that the ground reference is not a physics floor.

## 7. Edge cases

Verify:
- New empty character
- Existing character without IK
- Character with IK
- Animation without keyframes
- Scene without Actors
- Multiple Actors
- Flying/jumping character
- Non-humanoid rigs
- Negative coordinates
- Non-default zoom
- Root translation
- Character scaling/facing
- Missing contact marker

Do not force ground snapping when reliable contact placement is unavailable.

## 8. Regression matrix

**Rig Editor**
- Joint editing
- IK constraints
- Artwork alignment
- Attachments
- Export

**Animation Editor**
- Keyframes
- IK targets
- Playback
- Scrubbing
- Mirroring
- Onion skinning
- IK baking
- Undo/Redo

**Scene Editor**
- Actor positioning
- Timeline clips
- Movement
- Scene playback
- Scrubbing
- Import/export

**Runtime**
- Puppet playback
- Actor movement
- Scene choreography

Guide overlays must not change these systems.

## 9. Manual acceptance test

Run a representative workflow:

1. Open a character with legs and foot IK.
2. Enable the Animation Editor ground line.
3. Position it at the desired floor.
4. Preview an existing walk animation.
5. Make an explicit IK key adjustment.
6. Save/export the animation.
7. Open a scene using that character.
8. Enable the Scene Editor ground line.
9. Snap the Actor to the scene floor.
10. Add another differently sized character.
11. Align it.
12. Play and scrub the scene.
13. Export/reload.
14. Verify guide positions and authored changes.
15. Confirm no unintended rig/animation edits.

Record exactly which checks were manually performed.

## 10. Automated tests

Add or extend tests for:
- Persisted ground settings
- Coordinate conversions
- Non-destructive guide movement
- IK alignment semantics
- Actor snapping
- Undo/Redo
- Export/import
- Playback/scrubbing
- Guide Wizard integration
- Phaser cleanup
- Existing runtime compatibility

## 11. Scope restrictions

Do not add:
- Physics engine
- Gravity
- Collision detection
- Terrain editing
- Automatic footstep generation
- Advanced ground-contact solvers
- New animation evaluators

## 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Run additional existing browser/E2E tests where available.

Fix all failures.

## Final v0.9.7 definition of done

- Ground reference can be enabled in Animation Editor.
- Ground reference can be enabled in Scene Editor.
- Each guide has correct coordinate ownership.
- Ground Y can be edited visually and numerically.
- Guides remain stable during playback and scrubbing.
- Settings persist when reopening projects.
- Explicit IK alignment uses existing IK authoring.
- Explicit Actor snapping handles contact offsets safely.
- No unintended bone/animation/scene edits occur.
- Undo/Redo behaves correctly.
- Feature Guide integration works where implemented.
- No runtime regressions.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall v0.9.7 readiness
2. Animation Editor integration
3. Scene Editor integration
4. Coordinate systems
5. Persistence design
6. IK alignment behavior
7. Actor snapping behavior
8. Undo/Redo
9. Guide Wizard integration
10. Files/APIs changed
11. Automated tests
12. Actual manual verification
13. Exact command results
14. Remaining limitations

Do not claim completion unless required checks pass.
