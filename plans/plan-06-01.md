# Paper Puppeteer Engine — v0.6.1
## Architecture & Public API Stabilization

Continue development of my Paper Puppeteer Engine project.

**Current completed version: v0.5.8.6**

Technology stack:
- React + TypeScript (strict) for editor UI
- Phaser for rendering
- Vite, npm, ES modules

The engine currently includes:
- Skeletal puppet runtime
- Rig Editor and Animation Editor
- IK animation and baking
- Onion skinning and mirroring
- Slots, attachments and skins
- Artwork import/replacement and Rig-Tweak mode
- CharacterLoader and character package export

This is a stabilization milestone. Do not implement unrelated features.

## Goal

Implement **v0.6.1 — Architecture & Public API Stabilization**.

Prepare the engine for reuse independently of its authoring application.

### 1. Architecture audit

Inspect the actual project structure and identify:
- Framework-independent types and utilities
- Runtime animation and IK systems
- Phaser rendering integration
- React editor components
- Editor controllers and working-copy state
- Serialization and validation
- Asset loading/packaging

Document the current dependency directions.

Avoid unnecessary large refactors.

### 2. Separate runtime from editor

The production runtime must not depend on:
- React components or hooks
- Editor selection/history state
- Browser file-import dialogs
- Editor-only debug handles
- Onion-skin UI
- Editor route/navigation state

Shared types and pure utilities may be used by both runtime and editor.

Keep Phaser-specific functionality in its existing appropriate layer.

### 3. Public API

Inspect existing exports and identify the intended public API for:
- Character loading
- Puppet creation
- Animation playback
- Animation transitions
- Skin and attachment selection
- Animation event subscriptions
- Relevant IK controls
- Resource cleanup

Prefer exposing existing APIs through clear module entry points.

Do not invent replacements for already-working functionality.

### 4. Module boundaries

Establish or clarify entry points for:
- Runtime
- Editor
- Shared data types
- Validation/serialization, where appropriate

Use current TypeScript module conventions.

Avoid cyclic dependencies.

Do not move large numbers of files merely to achieve cosmetic organization.

### 5. Public vs internal APIs

Make it clear which types and methods are:
- Supported public APIs
- Internal runtime implementation details
- Editor-only APIs

Avoid exposing mutable internal animation or rig state accidentally.

Retain backward compatibility wherever practical.

### 6. Lifecycle and ownership

Verify ownership of:
- Puppet instances
- Phaser GameObjects
- Loaded textures
- Character definitions
- Event subscriptions
- Runtime animation state

Public disposal/cleanup operations should prevent resource leaks.

### 7. Type safety

Review public interfaces for:
- Unnecessary `any`
- Unsafe casts
- Weakly typed identifiers
- Incorrect optional properties
- Accidental mutable references

Improve types incrementally without breaking supported behavior.

### 8. Integration test

Create or update a minimal example that imports the runtime through its intended public entry point.

Verify it can:
1. Load a character.
2. Create a Puppet.
3. Play an animation.
4. Switch an animation.
5. Select a skin where supported.
6. Release resources.

Avoid importing editor internals.

### 9. Tests

Add tests for:
- Public export availability
- Runtime/editor dependency isolation
- CharacterLoader integration
- Playback API compatibility
- Resource cleanup
- Existing consumer import paths where supported

### 10. Scope restrictions

Do not implement:
- New IK systems
- New animation tools
- New sprite editors
- Scene choreography
- Physics
- Mesh deformation

Do not publish to npm or introduce breaking public API changes without necessity and documentation.

### 11. Verification

Run and fix all failures:

- `npm run typecheck`
- `npm run test`
- `npm run build`

## Definition of done

- Runtime/editor dependency boundaries are clear
- Public runtime entry points are consistent
- Existing API behavior is preserved
- Internal state is appropriately encapsulated
- Runtime integration works without editor imports
- Resource ownership is documented
- Tests, typecheck and build pass

## Final report

Provide:
1. Architecture before/after
2. Public API and entry points
3. Changes to module boundaries
4. Compatibility implications
5. Files changed
6. Tests
7. Exact verification results
8. Remaining issues for v0.6.2

Do not claim completion unless required commands pass.
