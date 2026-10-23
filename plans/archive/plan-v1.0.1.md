# Paper Puppeteer Engine — v1.0.1
## Project Workspace & Asset Organization

Continue developing my Paper Puppeteer Engine.

**Current completed version: v0.9.6**

### Technology stack
- React + TypeScript (strict)
- Phaser
- Vite
- npm
- ES modules

Implemented capabilities include:
- Rig Editor
- Animation Editor
- Scene Editor
- CharacterLoader and character packages
- Sprite import/replacement
- IK constraints, animation authoring and baking
- Actor choreography and scene timelines
- Scene/character import and export
- Document working copies, validation and Undo/Redo

This project is a private tool for myself and one artist friend.

Keep implementation practical. Do not introduce enterprise-style systems.

## Goal

Implement **v1.0.1 — Project Workspace & Asset Organization**.

I want to manage complete Paper Puppeteer Engine projects instead of treating characters, animations and scenes as disconnected documents.

A project should organize its authored assets and make them easy to find, edit and export.

### 1. Inspect existing architecture

Before implementation, inspect:
- Current character workspace
- Scene Editor workspace
- Existing asset registries
- Character and scene manifests
- Document IDs and paths
- Import/export systems
- React application navigation
- Dirty-state and working-copy ownership

Extend existing infrastructure instead of creating a parallel project-management system.

### 2. Project model

Introduce a lightweight ProjectDefinition or equivalent.

Conceptually:

```ts
interface ProjectDefinition {
  id: string;
  name: string;
  version: number;
  // Character, scene and asset references
}
```

Adapt the structure to actual schemas.

A project should organize:
- Characters
- Character rigs
- Animations
- Sprite assets
- Skins and attachments
- Scenes
- Scene asset dependencies

Keep authored documents separate rather than duplicating all data into one enormous JSON file.

### 3. Project creation

Add a **New Project** action.

The user should be able to:
1. Enter a project name.
2. Create an empty project.
3. Add an existing character.
4. Create a new character using existing tools, if implemented.
5. Create a new scene.
6. Navigate between project assets.

A new project must not require copying demo assets.

### 4. Project workspace UI

Build a simple React project workspace.

Conceptual layout:

```text
PROJECT: My Animation Project

CHARACTERS
  Hero
  Guard
  [+ New Character]
  [Import Character]

SCENES
  First Encounter
  Training
  [+ New Scene]
  [Import Scene]

ASSETS
  Images
  Animations
  Skins

[Project Settings] [Export Project]
```

Reuse existing React layout and navigation conventions.

Avoid an elaborate file-explorer clone.

### 5. Asset registration

Provide one reliable way to register and resolve project assets.

Use stable IDs and explicit references.

Avoid identifying assets solely by display name or filename.

Handle duplicate IDs and filename collisions safely.

Do not duplicate imported binary files unnecessarily.

### 6. Cross-editor navigation

A user should be able to:
- Open a character in Rig Editor.
- Open its animation in Animation Editor.
- Return to the project workspace.
- Open a scene using that character in Scene Editor.

Preserve appropriate working state.

Do not silently discard unsaved changes.

### 7. Existing assets

Support importing or registering existing compatible characters and scenes.

Preserve their original schemas and IDs where possible.

Do not mutate source assets simply because they were added to a project.

Ensure demo puppet and random-paperdoll-sketch remain usable.

### 8. Project export/import

Reuse existing character/scene packaging infrastructure.

Support a portable project manifest and referenced authored assets.

A ZIP or equivalent package is suitable if existing tooling supports it.

Validate relative paths and prevent unsafe traversal.

Do not serialize temporary Blob URLs, React state or Phaser objects.

Do not assume a browser download overwrites local repository files.

### 9. Document ownership

Establish clear ownership of:
- Project metadata
- Character definitions
- Rig documents
- Animation documents
- Scene documents
- Binary artwork

Avoid independent conflicting working copies when switching editors.

Keep project dirty state distinct from document dirty states.

### 10. Undo/Redo and safety

Asset registration/removal should follow existing history patterns where appropriate.

Deleting or removing an asset with dependents must not silently corrupt scenes or characters.

Detailed dependency diagnostics will be improved in v1.0.3.

### 11. Tests

Cover:
- New empty project
- Add existing character
- Add scene
- Duplicate ID rejection
- Asset lookup
- Cross-editor navigation
- Project switching
- Dirty-state preservation
- Independent project instances
- Import/export
- Existing asset compatibility
- No source mutation

### 12. Out of scope

Do not implement:
- Autosave yet
- Cloud storage
- Authentication
- Collaboration
- User accounts
- Asset marketplace
- Git integration
- Full dependency repair system
- New animation features

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

Use actual package scripts if the repository differs, and explain any unavailable commands.

## Definition of done

- Projects can be created.
- Characters and scenes can be organized.
- Existing assets can be registered.
- Editors can be opened from a project.
- IDs and references are stable.
- Working copies remain consistent.
- Project export/import works through supported mechanisms.
- Existing characters and scenes continue working.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Project architecture
2. New Project workflow
3. Asset registration model
4. Cross-editor navigation
5. Import/export design
6. Working-copy ownership
7. Files/APIs changed
8. Tests
9. Exact verification results
10. Deferred v1.0.2 work

Do not claim completion unless required checks pass.
