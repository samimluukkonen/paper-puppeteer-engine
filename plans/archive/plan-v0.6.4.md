# Paper Puppeteer Engine — v0.6.4
## Character Packaging & Runtime Integration

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.6.3**

Technology stack:
- React + TypeScript (strict) for editor UI
- Phaser for runtime rendering
- Vite, npm, ES modules

Existing capabilities:
- Complete character package export
- Rig, animation and skin data
- Sprite image assets
- Character manifests
- CharacterLoader
- Puppet runtime animation playback

Do not replace working packaging or loading systems.

## Goal

Implement **v0.6.4 — Character Packaging & Runtime Integration**.

Prove that a character exported from the editors can be used in another application without editor-specific code.

### 1. Package audit

Inspect the existing package export format.

Verify exported characters include all required:
- Rig files
- Animation files
- Skins
- Attachment definitions/references
- Sprite binaries
- Manifest metadata

Preserve established paths and identifiers.

### 2. Portable paths

Ensure all asset references work relative to the exported package.

Never serialize:
- Temporary Blob URLs
- Absolute local development-machine paths
- Phaser runtime texture objects
- React editor state

Check path normalization and rejection of unsafe traversal.

### 3. Export validation

Before package export, validate:
- Required files exist
- Manifest references resolve
- Images decode
- Referenced texture frames exist
- Rig/animation compatibility
- Skin/attachment compatibility
- Supported format versions

Invalid packages must not be silently exported as successful.

### 4. Standalone consumer example

Create or update a minimal consumer application/example using only the intended public runtime API.

This may live in an examples directory.

The consumer should demonstrate:
1. Importing/initializing Paper Puppeteer Engine.
2. Loading an exported character.
3. Creating a Puppet.
4. Playing idle.
5. Switching to walk.
6. Playing an attack or another animation.
7. Receiving an animation event.
8. Switching skins or attachments.
9. Cleaning up.

Use actual public API names.

Do not invent APIs solely for the documentation.

### 5. Phaser integration

Reuse existing Phaser runtime integration.

Document:
- Asset loading sequence
- Scene lifecycle
- Texture ownership
- Puppet creation/destruction
- Coordinate conventions
- Animation update behavior
- Event subscription cleanup

Keep the editor unnecessary for production playback.

### 6. Cross-project reuse

Verify that external code does not need to import:
- React editor components
- Timeline controllers
- Rig-Tweak controls
- Editor-specific asset managers

A character package should be consumable by the runtime alone.

### 7. Dependency packaging

Review existing build/package configuration.

Ensure the intended runtime entry point and TypeScript declarations resolve correctly.

If publishing is not yet configured, prepare or document what is missing.

Do NOT publish to npm or create a remote release automatically.

### 8. Round-trip integration test

Test:

**Editor → Export → Package → Load → Puppet → Play**

Include at least one representative character containing:
- Several bone animations
- Animation events
- IK/baked IK where supported
- Multiple attachments or skins
- Replacement sprite artwork

Compare expected authored behavior after loading.

### 9. Documentation

Create or update two clear guides.

**Artist guide**
- Prepare sprite pieces
- Import and align them
- Rig the character
- Animate
- Replace artwork
- Export character package

**Developer guide**
- Install/build runtime
- Load character packages
- Create Puppets
- Play animations
- Subscribe to events
- Swap appearances
- Clean up resources

Include actual verified code snippets from the consumer example.

### 10. Tests

Add/extend:
- Package validation tests
- Relative-path resolution tests
- Binary asset presence tests
- Standalone consumer build test
- CharacterLoader integration tests
- Animation playback tests
- Resource cleanup tests

### 11. Scope restrictions

Do not implement:
- New scene choreography system
- Custom game-specific behavior
- Automatic content generation
- Physics
- Mesh deformation

### 12. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Also build/test the standalone consumer example using its actual project commands.

Fix failures.

## Definition of done

- Exported packages are portable
- All references resolve
- Runtime loads packages without editor code
- Consumer example builds and runs where verifiable
- Animation, events and skins work
- Type declarations and entry points are correct
- Artist/developer documentation exists
- Tests, typecheck and build pass

## Final report

Provide:
1. Package structure
2. Standalone integration architecture
3. Runtime public API usage
4. Consumer example
5. Package validation results
6. Documentation
7. Files changed
8. Tests and exact command results
9. Any unverified manual behavior
10. Remaining v0.6.5 release work

Do not claim completion unless required commands pass.
