# Paper Puppeteer Engine — v1.0.5
## Stable Personal Production Workflow — Final Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.0.4**

Technology:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Completed milestones include:
- Rig Editor
- Animation Editor
- Scene Editor
- Character/animation/scene creation
- IK and animation tools
- Actor choreography
- Project Workspace
- Local autosave/recovery
- Asset validation
- Unified editor workflow

Inspect actual implementation status rather than assuming every optional feature exists.

This is a private tool for myself and my artist friend.

## Goal

Complete **v1.0.5 — Stable Personal Production Workflow**.

Ensure the application can reliably support real character and scene production from beginning to end.

Do not introduce major new features.

### 1. Establish release criteria

Create clear internal v1.0 readiness criteria.

The application should:
- Create and open projects.
- Support existing and new characters.
- Import artwork.
- Create/edit rigs and IK.
- Author animations.
- Build scenes.
- Autosave local drafts.
- Recover unsaved work.
- Validate dependencies.
- Export complete projects.
- Re-import exports.
- Play exported scenes in the standalone runtime.

Document any missing capabilities honestly.

### 2. Complete artist workflow

Test or automate the following:

1. Create a new project.
2. Create a new character.
3. Import sprite artwork.
4. Create the bone hierarchy.
5. Position joints and origins.
6. Assign sprites to slots.
7. Configure default skin.
8. Create IK constraints.
9. Create a new animation.
10. Add bone keyframes.
11. Animate an IK target.
12. Preview and refine motion.
13. Export character assets.
14. Create a scene.
15. Add the character as an Actor.
16. Schedule movement.
17. Schedule animations.
18. Preview and scrub.
19. Export the scene.
20. Export the complete project.
21. Re-import the project.
22. Play the scene through the standalone runtime.

Use actual existing UI controls and APIs.

If a feature is not implemented, report it as a gap rather than inventing behavior.

### 3. Recovery testing

Exercise crash-recovery scenarios:
- Refresh during rig editing
- Refresh after artwork import
- Refresh after keyframe authoring
- Refresh during scene editing
- Interrupt local persistence
- Simulate invalid/corrupt recovery data
- Storage quota failure

Verify the last valid snapshot remains recoverable.

### 4. Asset integrity

Test:
- Missing image
- Duplicate IDs
- Deleted animation referenced by scene
- Broken IK references
- Missing character dependency
- Unsupported data version
- Unsafe asset path

Ensure invalid production exports are blocked appropriately.

### 5. Import/export round trip

Create a project with multiple assets.

Export and re-import it.

Compare:
- Character definitions
- Rigs and joints
- IK constraints
- Animations and keyframes
- Skins and attachments
- Binary artwork
- Scene Actors
- Scene action timing
- Asset references

Verify equivalent authored behavior.

Do not require byte-identical archives when ordering or metadata legitimately differ.

### 6. Runtime integration

Use the standalone runtime to:
- Load exported characters.
- Create Puppet instances.
- Play animation.
- Apply IK.
- Run Actor movement.
- Execute choreography.
- Play exported scenes.
- Handle animation events.
- Dispose resources.

Do not import React/editor code into runtime consumers.

### 7. Regression matrix

Verify:

**Rig Editor**
- Joint manipulation
- Bone hierarchy
- IK constraint editing
- Sprite import/replacement
- Attachments and skins
- Undo/Redo

**Animation Editor**
- New Animation
- Keyframe editing
- Interpolation
- Timeline tools
- Mirroring
- Onion skinning
- IK animation/baking
- Export

**Scene Editor**
- Actor placement
- Action timeline
- Playback
- Scrubbing
- Import/export

**Project Workspace**
- Asset registration
- Navigation
- Autosave
- Recovery
- Validation
- Project export/import

### 8. Resource lifecycle

Test repeated:
- Project switching
- Character switching
- Animation switching
- Scene switching
- Sprite replacement
- Phaser scene creation/destruction
- React editor unmounting
- Timeline playback
- Preview scrubbing

Check for:
- Leaked subscriptions
- Orphaned GameObjects
- Stale texture references
- Unresolved promises
- Accumulated event handlers

### 9. Performance baseline

Measure representative operations:
- Opening a project
- Loading character artwork
- Timeline scrubbing
- Scene playback
- Five-Actor scene
- Autosave of a medium-sized project
- Complete project export

Report actual measurements.

Optimize verified problems only.

### 10. Documentation

Update practical documentation for:

**Artist**
- Starting a project
- Creating characters
- Importing artwork
- Rigging
- Animating
- Creating scenes
- Using Feature Guide
- Exporting
- Recovering unsaved work

**Developer**
- Project structure
- CharacterLoader
- Actor API
- Scene loading
- Runtime integration
- Supported file formats
- Asset dependencies

Keep guides concise and accurate.

### 11. Known issues

Prepare a short internal readiness report.

Separate:
- Blocking defects
- Non-blocking usability issues
- Deferred features

Do not call v1.0 ready if a defect can cause unrecoverable project loss or corrupt a normal export.

### 12. Release scope

v1.0 is an internal milestone.

Do not:
- Publish to npm
- Push tags
- Create GitHub releases
- Deploy services
- Add accounts
- Add analytics
- Introduce commercial licensing workflows

unless explicitly instructed.

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run available lint, browser/E2E and standalone runtime checks.

Fix failures.

Clearly separate automated tests from manually exercised behavior.

## Final v1.0 definition of done

v1.0 is ready when:

- The full character-to-scene workflow works.
- Project organization is reliable.
- Autosave and recovery work.
- Imported image assets remain recoverable.
- Dependency validation is useful.
- Export/import preserves authored data.
- Standalone runtime playback works.
- All three editors remain compatible.
- Undo/Redo and dirty states work.
- No data-loss or corruption blockers remain.
- Documentation is accurate.
- Tests, typecheck and build pass.

## Final report

Provide:

1. Overall v1.0 readiness verdict
2. Implemented fixes
3. Project architecture
4. Autosave/recovery results
5. Validation results
6. Artist workflow results
7. Export/import verification
8. Runtime integration results
9. Performance observations
10. Resource cleanup findings
11. Files/APIs changed
12. Automated tests
13. Actual manual verification
14. Exact command results
15. Known limitations
16. Recommended v1.1 priorities

Do not claim readiness unless the release criteria actually pass.
