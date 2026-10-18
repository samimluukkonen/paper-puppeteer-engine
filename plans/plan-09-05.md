# Paper Puppeteer Engine — v0.9.5
## Scene Import/Export & Packaging

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.4**

Stack: React, TypeScript (strict), Phaser, Vite, npm and ES modules.

The project now has:
- SceneDefinition
- Visual Actor placement
- Scene action timeline
- Scene playback and scrubbing
- CharacterLoader
- Existing character package export/import

Do not replace these systems.

## Goal

Allow authored scenes to be exported, imported and played in a standalone runtime application without loading the Scene Editor.

### 1. Scene serialization

Use one canonical serializer for SceneDefinition.

Output must be:
- Deterministic
- Human-readable
- JSON-compatible
- Validated before export
- Versioned using existing conventions

Exclude editor-only state such as timeline zoom, selection, panel layout and preview handles.

### 2. Export actions

Add:
- Validate Scene
- Copy Scene JSON
- Download Scene JSON

Use current React editor export conventions.

Prefer filenames derived safely from scene IDs.

### 3. Import

Support:
- Paste JSON
- Select a local JSON file
- Parse and validate
- Load into a fresh editor working copy

Failed imports must not corrupt the current scene.

After a valid import, reset transient playback, selection and history appropriately.

### 4. Character dependencies

A scene must refer to characters through stable package references.

Validate:
- Referenced characters exist
- Character packages can load
- Animation IDs referenced by actions exist
- Skin references are valid
- Relative asset paths are safe

Do not embed unnecessary full copies of every character into each scene file.

### 5. Scene package

Where useful, support exporting a scene together with its necessary character dependencies.

An example structure:

```text
scene-package/
  scene.json
  characters/
    character-a/
      character.json
      rig.json
      animations/
      skins/
      images/
    character-b/
      character.json
      rig.json
      animations/
      skins/
      images/
```

Use the actual character packaging conventions.

Avoid duplicate binary artwork when existing package support can share assets safely.

### 6. Standalone scene loading

Provide an optional runtime-facing SceneLoader or equivalent adapter.

It should:
- Validate authored scene data
- Resolve character references
- Construct the needed Actors
- Use the v0.9.4 scene runner

Do not import React editor components.

Preserve the ability to use Puppet and Actor independently.

### 7. Browser limitations

Do not assume browser file exports automatically modify repository files.

Use existing download/export mechanisms.

A ZIP package is appropriate if the project already supports one or if a minimal justified dependency is needed.

### 8. Round-trip verification

Test:

```text
Scene Editor
    ↓
Export scene.json
    ↓
Import scene.json
    ↓
Equivalent scene document
    ↓
Same runtime behavior
```

Also test loading a packaged scene through the standalone runtime example.

### 9. Validation and security

Reject:
- Unsupported versions
- Invalid actor IDs
- Broken character references
- Invalid action times
- Invalid paths
- Unsupported action types
- Invalid numeric values

Never execute arbitrary code from imported scene JSON.

### 10. Tests

Cover:
- Stable serialization
- Import/export round trip
- Missing dependencies
- Unsupported versions
- Duplicate Actors
- Scene package resolution
- Runtime loading
- Playback equivalence
- Working-copy isolation

### 11. Out of scope

Do not implement:
- Cloud storage
- Collaboration
- Public scene sharing
- Marketplace
- Arbitrary script execution
- Game-specific dialogue systems

### 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run the actual standalone runtime example build where available.

Fix failures.

## Definition of done

Scene definitions can be saved and reloaded, their character dependencies resolve correctly, and exported scenes can run without the Scene Editor.

## Final report

Provide scene format/export architecture, dependency handling, runtime loader, files changed, tests and exact command results.
