# Paper Puppeteer Engine — v0.9.2
## Visual Stage & Actor Placement

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.9.1**

Stack: React, TypeScript (strict), Phaser, Vite, npm and ES modules.

v0.9.1 introduced a Scene Editor, SceneDefinition, scene document lifecycle and validation.

Do not rebuild these systems.

## Goal

Allow my artist friend to construct a scene visually by adding characters and placing them on a Phaser stage.

The implementation must work with any compatible character package, not only the demo characters.

### 1. Scene stage

Create a Phaser-backed Scene Editor viewport.

Reuse existing React/Phaser embedding conventions.

Support:
- Stage preview
- Actor rendering
- Selection
- Zoom and pan
- Optional stage grid
- Basic transform handles

Do not add a second character renderer.

### 2. Add Actor

Implement an **Add Actor** action.

Show available character packages from the existing workspace.

The artist should be able to select a character and instantiate it in the scene.

Example:

```text
SCENE ACTORS

[+ Add Actor]

Actor A → Character: hero
Actor B → Character: guard
```

Use the actual character registry/loader conventions.

Allow multiple actors to use the same character definition while having independent runtime instances.

### 3. Actor identity

Each scene actor needs a stable scene-local ID.

Do not confuse:
- Actor ID
- Character definition ID
- Animation ID

Validate duplicate IDs.

### 4. Visual positioning

The artist can select and drag an Actor.

Changes must update:
- SceneDefinition working copy
- Numeric React inspector
- Phaser preview

Use world/stage coordinates rather than screen coordinates.

Respect zoom/pan and existing transform utilities.

### 5. Initial Actor properties

Provide an inspector for:
- Scene actor ID/name
- Character reference
- Initial X/Y
- Facing
- Initial animation where supported
- Initial skin where supported

Display only properties supported by the existing runtime.

### 6. Actor management

Support:
- Add Actor
- Select Actor
- Duplicate Actor
- Remove Actor
- Reorder preview depth where supported

Deletion must inspect future/actual SceneAction references when present.

Do not silently leave broken action references.

### 7. Rendering and lifecycle

Use CharacterLoader and Puppet/Actor runtime APIs.

Avoid:
- Reloading textures on every React render
- Duplicate Phaser objects
- Shared mutable Puppet instances
- Leaked Actor instances
- Disposing shared textures still in use

Release preview instances when actors are removed or the scene closes.

### 8. Working-copy and Undo/Redo

One drag should create one history transaction.

Cancel with Escape where consistent with existing editors.

Actor placement must not change the character rig, animation keyframes or source package.

### 9. Tests

Cover:
- Add Actor
- Two instances of one character
- Drag position
- Coordinate conversion
- Facing
- Skin selection
- Duplicate/remove
- Undo/Redo
- Source isolation
- Resource cleanup

### 10. Manual verification

1. Create a scene.
2. Add two character instances.
3. Position them on opposite sides.
4. Change facing.
5. Select different animations.
6. Duplicate one Actor.
7. Remove it.
8. Undo/Redo.
9. Switch scenes and confirm cleanup.

### 11. Out of scope

Do not implement:
- Timeline authoring
- Movement paths
- Scene playback
- Physics/collision
- Navigation meshes
- Camera animations

### 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

The artist can add existing characters to a new scene, position them visually, configure their initial appearance and preserve those settings as SceneDefinition data.

## Final report

Report the React/Phaser architecture, Actor placement and lifecycle, coordinate system, files changed, tests and command results.
