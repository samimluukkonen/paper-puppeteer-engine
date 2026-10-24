# Paper Puppeteer Engine — v1.2.1
## Scene Backgrounds & Image Assets

Continue developing my Paper Puppeteer Engine project.

**Current completed version: v1.1.5**

### Technology stack
- React + TypeScript (strict)
- Phaser for rendering
- Vite, npm, ES modules

Implemented features:
- Rig Editor, Animation Editor and Scene Editor
- Project Workspace and asset management
- Character/scene creation and export/import
- Scene Actors, movement and choreography
- Visual scene timeline and deterministic scrubbing
- Autosave, recovery, Undo/Redo and validation
- Feature Guide Wizard
- Ground reference and foot contact tools, if present

This is a private application used by myself and one artist friend.

Do not add unnecessary infrastructure or rewrite existing systems.

## Goal

Implement **v1.2.1 — Scene Backgrounds & Image Assets**.

I want to import background images into Scene Editor and visually arrange them behind animated characters.

Example workflow:

1. Open Scene Editor.
2. Select a scene.
3. Click "Add Background".
4. Import a PNG/WebP image or select an existing project image.
5. Position and scale it.
6. Preview the scene with Actors.
7. Save/export the scene and its required assets.

## 1. Inspect existing architecture

Review:
- SceneDefinition format and versioning
- Project asset registry
- Existing image import/replacement tools
- Scene Editor React/Phaser integration
- Scene preview coordinate transforms
- Existing render ordering
- Scene package exporter and loader
- Undo/Redo and autosave

Reuse existing services wherever possible.

## 2. Background/image element model

Introduce an optional scene image/background element model.

Each element should have:
- Stable ID
- Referenced image asset ID/path
- Scene-world position
- Scale and/or dimensions
- Visibility
- Render ordering information
- Optional opacity if already supported

Reuse existing scene object models where appropriate.

Do not serialize Phaser objects or Blob URLs.

Existing scenes without backgrounds must load unchanged.

## 3. Import artwork

Allow importing local PNG/WebP images.

Use the existing project asset import system.

Validate:
- Decodable image
- Supported format
- Non-empty content
- Image dimensions
- Duplicate IDs and path collisions

Use stable project asset references, not temporary URLs.

Avoid unnecessary image-processing libraries.

## 4. Scene Editor UI

Add a simple Scene Artwork panel:

```text
SCENE ARTWORK

[+ Add Background]
[+ Add Image From Project]

Backgrounds:
  forest-background
  distant-mountains

Selected image:

Position X: [ 0 ]
Position Y: [ 0 ]
Scale X:    [ 1 ]
Scale Y:    [ 1 ]
Visible:    [x]

[Replace Image]
[Remove Element]
```

Use actual project conventions.

## 5. Visual manipulation

Allow:
- Selecting an image
- Dragging to reposition
- Numeric transform editing
- Scaling with existing editor handles where practical
- Showing image boundaries
- Resetting transforms

Respect stage zoom/pan and world-coordinate conversion.

One completed gesture should create one Undo operation.

Escape should cancel active editing.

## 6. Rendering

Render imported images through the existing Phaser scene.

Initially, background artwork should render behind Actors.

Avoid:
- Reloading textures every frame
- Destroying shared textures
- Duplicating images on React rerenders
- Conflicting texture keys

Do not alter Puppet or Actor transforms when editing backgrounds.

## 7. Independent image assets

A scene image is separate from character sprites.

The scene must not use or alter a character's rig attachments to display background artwork.

Allow scene artwork to use the same project image registry without duplicating binary assets unnecessarily.

## 8. Persistence

Ensure:
- Scene JSON stores valid image references
- Project export includes required image binaries
- Autosave recovers imported artwork
- Scene import/reload restores appearance
- No temporary URL is serialized

Do not pretend downloads overwrite repository files.

## 9. Validation

Detect:
- Missing image reference
- Invalid transforms
- Unsupported image format
- Broken asset paths
- Invalid scene element IDs

Incomplete drafts may remain editable.

Prevent invalid production exports.

## 10. Tests

Add tests for:
- Adding background
- Selecting existing project image
- Position/scale
- Visibility
- Undo/Redo
- Missing image
- Asset cleanup
- Scene serialization
- Project export/import
- Autosave/recovery
- Existing scenes without images
- Actor data immutability

## 11. Manual verification

1. Open a scene containing an Actor.
2. Import a background PNG.
3. Position it behind the Actor.
4. Resize the image.
5. Scrub and play the scene.
6. Undo/Redo artwork placement.
7. Export and reopen the project.
8. Confirm background and Actor remain correct.

## 12. Out of scope

Do not implement:
- Parallax
- Camera animation
- Advanced layer editor
- Image painting
- Lighting
- Physics
- Scene transitions
- Dialogue/audio

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures. If scripts differ, use actual repository scripts and report the differences.

## Definition of done

- Scene images can be imported.
- Backgrounds appear behind Actors.
- Images can be positioned and scaled.
- Existing asset management is reused.
- Undo/Redo works.
- Autosave and export/import preserve artwork.
- Existing scenes and Actors remain compatible.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Scene artwork architecture
2. Import workflow
3. React and Phaser integration
4. Persistence and packaging
5. Files/APIs changed
6. Tests
7. Actual manual verification
8. Exact verification results
9. Deferred v1.2.2 work

Do not claim completion unless required checks pass.
