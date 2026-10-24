# Paper Puppeteer Engine — v1.2.2
## Visual Layers, Depth & Parallax

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.2.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Scene Editor now supports imported background images and scene artwork.

It also already supports Actors, timelines, playback, scrubbing and scene import/export.

Do not rebuild existing systems.

## Goal

Implement **v1.2.2 — Visual Layers, Depth & Parallax**.

Allow my artist friend to organize background, character and foreground elements visually.

Example scene:

```text
Far Mountains      (parallax 0.2)
Forest Background  (parallax 0.5)
Actors             (normal scene movement)
Foreground Trees   (parallax 1.2)
```

Values are illustrative, not fixed defaults.

## 1. Inspect existing rendering

Review:
- Scene image elements
- Phaser depth/display-list logic
- Actor rendering
- Scene object selection
- Scene camera/viewport transformations
- Current scene document schema
- Project workspace persistence

Reuse existing depth mechanisms.

## 2. Scene layer organization

Introduce lightweight scene layers or extend existing scene object ordering.

Allow:
- Creating a layer
- Renaming
- Reordering
- Assigning images to a layer
- Moving images between layers
- Visibility toggle
- Optional editor-only locking

Avoid creating a generic Photoshop-style image editor.

## 3. Layer panel

Suggested React UI:

```text
SCENE LAYERS

[+ Add Layer]

Foreground Trees
  tree-left
  tree-right

Actors
  Hero
  Guard

Background
  forest

Far Background
  mountains
```

Support moving elements through the hierarchy using simple controls.

Drag-and-drop is optional if existing UI patterns make it easy.

## 4. Actor depth

Define how Actors participate in visual ordering.

An Actor should remain one logically coherent Puppet object for standard scene composition.

Do not arbitrarily split its bones across different scene layers.

If actor interleaving with arbitrary foreground objects is supported, document the exact depth semantics.

## 5. Parallax

Support per-layer or per-image parallax factors.

Use existing camera/viewport scroll information.

A typical convention is:
- 0 = fixed relative to viewport for scrolling purposes
- 1 = normal world scrolling
- between 0 and 1 = slower background scrolling
- greater than 1 = faster foreground scrolling

Confirm exact Phaser conventions and implement consistently.

Parallax changes visual rendering, not authored Actor movement paths.

## 6. Editor viewport versus cinematic camera

Prepare the parallax architecture for the cinematic camera introduced in v1.2.3.

Do not accidentally make editor panning permanently modify image positions.

Distinguish:
- Authored image transform
- Layer parallax factor
- Editor viewport navigation
- Cinematic camera scroll

Use the existing camera abstraction if one already exists.

## 7. Ground reference

Preserve the Scene Editor ground guide.

Ground is a reference overlay, not ordinary scene artwork.

Do not let background layers obscure important editor handles or guide controls.

## 8. Selection and editing

Support selecting elements even when:
- Layers overlap
- Foreground images partially obscure Actors
- Camera zoom is changed
- Parallax is enabled

Locked editor layers should not receive unintended authored edits.

## 9. Undo/Redo

Layer creation, deletion, reassignment and ordering changes must integrate with existing history.

Deleting a layer must not silently delete all of its image assets.

Use a clear policy, with confirmation for destructive operations.

## 10. Persistence

Store layer identities, order and parallax properties in scene documents.

Do not persist editor-only selections or hover state.

Old scenes should receive backward-compatible defaults.

## 11. Tests

Cover:
- Render order
- Actor/image ordering
- Layer reassignment
- Visibility
- Locking
- Parallax calculations
- Zoom/pan
- Selection hit testing
- Undo/Redo
- Scene export/import
- Existing scenes
- No Actor transform mutations

## 12. Manual verification

1. Create a scene with forest artwork.
2. Add mountains behind the forest.
3. Add a foreground tree.
4. Put an Actor between forest and tree.
5. Reorder layers.
6. Pan the viewport.
7. Preview parallax behavior.
8. Play Actor choreography.
9. Export/reload the scene.

## 13. Out of scope

Do not implement:
- Camera animation
- Camera shots
- Scene transitions
- Lighting
- Particle effects
- Terrain
- Physics

## 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Scene artwork and Actors have predictable visual ordering.
- Layers can be managed in React.
- Parallax factors work consistently.
- Authoring transforms remain separate from camera movement.
- Existing choreography is unaffected.
- Serialization and Undo/Redo work.
- Tests, typecheck and build pass.

## Final report

Describe render ordering, parallax semantics, Actor depth handling, React UI, files changed, tests and exact verification results.
