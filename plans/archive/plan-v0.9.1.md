# Paper Puppeteer Engine — v0.9.1
## Scene Document & Editor Foundation

Continue development of my Paper Puppeteer Engine project.

**Current completed version: v0.8.6**

Technology:
- React + TypeScript (strict) for the editors
- Phaser for runtime rendering
- Vite, npm, ES modules

The engine includes:
- Rig Editor and Animation Editor
- CharacterLoader and reusable character packages
- Puppet animation, IK and skins
- v0.7 animation lifecycle, states and queues
- v0.8 Actors, movement, facing and choreography sequences
- Existing validation, import/export and Undo/Redo infrastructure

This is a private tool for myself and one artist friend. Keep the architecture clean but avoid enterprise-level complexity.

## Goal

Implement the foundation of a new **Visual Scene Editor**.

A Scene is an authored document describing characters, initial placement and scheduled actions. It should be editable visually and executable by the existing runtime.

This phase does not implement scene timelines or playback yet.

### 1. Inspect existing architecture

Review:
- Actor and choreography APIs
- Character package format
- Existing editor navigation and document ownership
- Shared timeline components
- Serialization and versioning conventions
- Validation and Undo/Redo infrastructure

Reuse existing patterns. Do not rewrite Actors or Puppets.

### 2. SceneDefinition

Introduce a typed, JSON-serializable scene document.

Conceptually:

```ts
interface SceneDefinition {
  version: number;
  id: string;
  name: string;
  duration: number;
  actors: SceneActorDefinition[];
  actions: SceneActionDefinition[];
}
```

These types are illustrative. Adapt them to the codebase.

A scene actor should contain:
- Stable scene-local actor ID
- Reference to an existing character definition/package
- Initial position
- Initial facing where supported
- Optional starting animation/skin

Keep the format generic.

Define a typed, extensible action union for later milestones, without prematurely implementing every possible action.

### 3. Scene data versus runtime state

Scene JSON must not contain:
- Phaser GameObjects
- React state
- Live Actor/Puppet instances
- Functions
- Promise objects
- Editor selection/zoom/history
- Temporary texture URLs

Use stable references to character assets.

### 4. New Scene workflow

Add a **Scene Editor** destination to the existing React application.

Provide:
- New Scene
- Open/select scene
- Scene name/ID
- Duration
- Empty stage
- Empty scene timeline placeholder

A new scene must not require existing scene JSON.

### 5. Document lifecycle

Reuse existing:
- Immutable source definition
- Editable working copy
- Dirty state
- Undo/Redo
- Revert
- Unsaved-change protection

Creating a scene should establish an independent draft.

Scene edits must not mutate source rig, animation or character definitions.

### 6. Validation

Implement or extend validators for:
- Unique actor IDs
- Valid scene IDs
- Finite positions
- Valid duration
- Valid character references
- Supported action types
- Valid action times and actor references

Keep the validator independently testable.

### 7. Architectural boundary

The Scene Editor is React-based.

The scene data format and future runtime playback adapter must remain usable without React.

Do not make Puppet or Actor depend on Scene Editor components.

### 8. Tests

Cover:
- Empty scene creation
- Multiple scene documents
- Valid and invalid scene definitions
- Stable actor IDs
- Scene working-copy isolation
- Undo/Redo
- Dirty state
- Switching scenes
- Serialization foundations
- No character data mutation

### 9. Out of scope

Do not implement:
- Visual Actor placement
- Timeline clip editing
- Scene playback
- Camera director
- Dialogue editor
- Branching stories
- Physics or pathfinding

### 10. Verification

Run and fix failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

A user can create a new Scene document through React, inspect its basic properties, and manage it safely as a separate authored workspace.

## Final report

Provide:
1. Scene schema and architecture
2. React workspace
3. Document lifecycle
4. Validation
5. Files/APIs changed
6. Tests
7. Exact command results
8. Work deferred to v0.9.2

Do not claim completion unless required checks pass.
