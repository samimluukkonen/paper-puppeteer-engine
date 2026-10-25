# Paper Puppeteer Engine — v1.1.6.4
## Animation Environment Preview — Integration & Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.1.6.3**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The Animation Editor now supports:
- Environment Preview with static background artwork
- Motion-agnostic preview displacement
- Fixed and following preview cameras
- Ground reference
- Deterministic playback and scrubbing

This is a private tool for myself and one artist friend.

This phase completes v1.1.6.

## Goal

Make Environment Preview reliable for everyday use with any character animation, without introducing new scene-authoring or animation-runtime behavior.

## 1. Inspect actual implementation

Review all v1.1.6 additions and existing:
- Project persistence
- Autosave/recovery
- Working-copy ownership
- Asset registry
- Character/animation export
- Scene Editor dependencies
- Feature Guide Wizard
- React/Phaser lifecycle

Fix integration issues rather than rebuilding completed systems.

## 2. Preview-settings persistence

Persist useful Environment Preview preferences.

Recommended ownership:

**Shared character/project preferences**
- Background asset selection
- Background transform
- Ground guide visibility/reference
- Default preview camera

**Animation-specific preview preferences**
- Optional preview displacement trajectory
- Motion mode
- Loop behavior

Use actual document/project architecture.

Avoid forcing every animation to duplicate identical background settings.

## 3. Preview-only data

Do not insert this configuration into skeletal animation keyframe tracks.

Separate preview settings from production animation behavior.

If storing settings alongside animation metadata is unavoidable, keep that metadata explicitly editor-only and ensure runtime playback does not interpret it as authored movement.

The Animation Editor's preview trajectory must not silently become a Scene Editor movement action.

A future explicit conversion tool could do that, but it is out of scope.

## 4. Asset persistence

Backgrounds must survive:
- Editor switching
- Animation switching
- Browser refresh
- Local autosave/recovery
- Project export/import
- Reopening the project

Use actual project image assets.

Do not persist temporary object URLs.

Preserve referenced images when removing only a preview configuration, unless the user explicitly deletes the shared asset.

## 5. Missing backgrounds

If a referenced background is unavailable:
- Preserve the animation.
- Show an actionable missing-asset message.
- Allow selecting another image.
- Do not crash.
- Do not replace the character's sprite attachments.

Environment Preview must remain optional.

## 6. Source-data isolation

Verify that none of these operations changes AnimationDefinition:
- Loading a preview background
- Switching preview modes
- Dragging the background
- Changing camera
- Editing preview displacement points
- Scrubbing
- Playback
- Looping
- Resetting the preview

Do not create animation Undo entries from preview-only settings.

Use appropriate project/preferences history if persistent settings are undoable.

## 7. Feature Guide Wizard

Extend the existing guide system with one or more concise guides:

**Using Environment Preview**
1. Enable Environment Preview.
2. Choose a background.
3. Align it with the ground reference.
4. Play the animation.
5. Switch between Fixed and Follow camera.

**Previewing Animation Displacement**
1. Enable preview displacement.
2. Add position points.
3. Preview a sword step, dodge or jump.
4. Scrub and inspect movement.
5. Reset simulated displacement.

Use actual guide registry and stable UI anchors.

Do not rebuild the wizard.

## 8. Cross-editor compatibility

Verify:
- Rig Editor is unaffected.
- Animation Editor remains authoritative for skeletal animation.
- Scene Editor continues loading exported animations normally.
- CharacterLoader ignores preview-only settings unless explicitly designed to support them.
- Scene choreography is not changed.

If v1.2 scene-background features exist, reuse shared image-loading utilities where beneficial without coupling Animation Editor to Scene Editor UI.

## 9. Performance and resources

Check:
- Large PNG/WebP backgrounds
- Rapid animation switching
- Rapid scrubbing
- Camera zoom
- Repeated preview toggling
- Sprite/skin switching
- Project switching
- Phaser scene destruction

Avoid:
- Duplicate texture loads
- Unreleased object URLs
- Leaked observers
- Repeated Phaser GameObject creation
- Unnecessary React updates every frame

## 10. Complete artist workflow

Test the following:

### Sword Cut with Step

1. Open the sword-cut animation.
2. Enable Environment Preview.
3. Select a suitable background.
4. Align the visual ground.
5. Preview the animation as authored.
6. If necessary, add preview-only forward displacement during the step.
7. Play and scrub.
8. Check foot positioning and movement.
9. Switch camera modes.
10. Verify animation keyframes remain unchanged.

### Jump or Dodge

1. Open another animation.
2. Reuse the same background.
3. Configure vertical or sideways preview movement.
4. Preview its timing.
5. Scrub backward and forward.
6. Reset preview movement.
7. Verify authored animation data is preserved.

### Animation Without Translation

1. Open an idle or stationary attack.
2. Keep preview displacement disabled.
3. Confirm it renders correctly against the background without forced movement.

## 11. Persistence acceptance test

1. Configure a background.
2. Create an animation-specific preview trajectory.
3. Save a local draft.
4. Refresh the browser.
5. Recover the project.
6. Confirm preview settings and background artwork are restored.
7. Export the project.
8. Re-import it.
9. Verify the settings survive where project export supports editor preferences.
10. Confirm exported production animations play exactly as before.

## 12. Automated regression tests

Cover:
- Preview configuration persistence
- Background asset references
- Missing image handling
- Existing animation compatibility
- Deterministic preview displacement
- Playback/seek equivalence
- Loop reset
- Camera coordinate transforms
- Ground guide
- Foot contact marker visualization
- No unexpected animation edits
- Autosave/recovery
- Project export/import
- Feature Guide targets
- React/Phaser cleanup

## 13. Scope restrictions

Do not implement:
- Physics
- Collision
- Automatic foot locking
- New animation solvers
- Scene choreography authoring
- Background layer animation
- Camera keyframe authoring
- Audio/dialogue
- AI-generated movement

## 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing lint, browser/E2E and runtime consumer checks where available.

Fix failures.

Do not claim manual testing unless the actions were actually performed.

## Final v1.1.6 definition of done

- Environment Preview works for arbitrary animations.
- Static background artwork is supported.
- Backgrounds use existing project assets.
- The artist can align background and ground reference.
- Existing animation playback is reused.
- Optional 2D displacement works.
- Root motion is not unintentionally duplicated.
- Fixed and following camera modes work.
- Scrubbing is deterministic.
- Looping behaves according to explicit settings.
- Preview controls do not alter authored animation keys.
- Settings persist appropriately.
- Autosave and project import/export work.
- Existing character/scene runtime remains compatible.
- Feature Guide tutorials are updated.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Overall readiness verdict
2. Environment Preview architecture
3. Background asset handling
4. Motion and transform semantics
5. Preview trajectory model
6. Camera behavior
7. Playback and seeking
8. Loop behavior
9. Persistence
10. Cross-editor compatibility
11. Performance findings
12. Files/APIs changed
13. Automated tests
14. Actual manual verification
15. Exact command results
16. Remaining limitations

Do not claim completion if required checks fail.
