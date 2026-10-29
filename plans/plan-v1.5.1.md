# Paper Puppeteer Engine — v1.5.1
## Reusable Animation Asset Library

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.4.6**

### Technology
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing features include:
- Rig, Animation and Scene Editors
- Project Workspace and asset management
- Pose Library and Animation Variations
- Animation timeline and Graph Editor
- Root Motion
- FK/IK and foot contact tools
- Mesh deformation and corrective mesh animation
- Scene choreography, camera and audio/dialogue
- Autosave, Undo/Redo, import/export

This is a private application for myself and one artist friend.

Mukashi Monogatari is a linear cinematic storytelling project. Do not implement gameplay, branching narratives or interactive dialogue choices.

## Goal

Implement **v1.5.1 — Reusable Animation Asset Library**.

Make it convenient to find, preview and reuse existing animations throughout the project.

For example, I may create animations such as:
- Idle
- Walking
- Running
- Sword ready
- Sword cut
- Bowing
- Kneeling
- Falling

These are examples, not required categories.

## 1. Inspect current architecture

Review existing:
- Animation asset registry
- Animation/character ownership
- Animation Variations
- Pose Library
- Project Workspace UI
- Scene Editor animation selection
- CharacterLoader
- Animation IDs
- Autosave and project export

Avoid creating a second independent animation document system.

## 2. Animation Library

Provide a library browser accessible from the project workspace and appropriate animation-selection workflows.

Support:
- Browsing existing animations
- Searching by name
- Optional tags or categories
- Filtering by compatible character/rig
- Previewing an animation
- Locating the original asset
- Reusing the asset

Use existing UI conventions.

## 3. Animation metadata

Introduce only lightweight metadata where needed:
- Display name
- Description (optional)
- Tags (optional)
- Source character/rig identity
- Animation duration
- Stable asset reference

Do not duplicate animation keyframes into a metadata index.

Do not require manually assigning categories.

## 4. Animation preview

Allow selecting an animation and previewing it using the actual runtime evaluator.

The preview should support:
- Play/Pause
- Stop/Restart
- Loop where appropriate
- Existing skeletal animation
- IK
- Root motion
- Mesh deformation

Reuse existing preview/rendering infrastructure.

Preview must not change the source animation or create keyframes.

If the existing Environment Preview is implemented, reuse it where practical.

## 5. Reuse operations

Distinguish two actions:

**Use Existing Animation**
- Reference an existing compatible animation asset.
- Avoid unnecessary copies.
- Preserve the source asset identity.

**Create Independent Copy**
- Create a new animation asset with a unique ID.
- Deep-copy all supported authored animation data.
- Make the copy independently editable.
- Never share mutable keyframe objects.

Reuse the existing Animation Variations functionality if it already supports the second operation.

## 6. Compatibility awareness

Initially, direct reuse can be limited to characters with compatible rig identities.

Do not silently reuse an animation on an incompatible rig.

Display a clear compatibility status or explanation.

Advanced cross-rig retargeting comes in v1.5.2–v1.5.3.

## 7. Source isolation

Editing a copied animation must not modify its original.

Editing a shared animation should clearly communicate that references to the same asset may reflect those changes.

Do not implement complex live inheritance.

## 8. Scene Editor integration

Extend existing animation selection to use the library.

Do not create a second Scene Editor animation system.

Preserve:
- Actor animation references
- Root-motion ownership
- Animation events
- Scene timeline timing

## 9. Persistence

Verify:
- Library metadata survives autosave
- Stable IDs persist
- Export/import preserves references
- Character packages remain compatible
- Shared assets are not unnecessarily duplicated
- Deleting referenced assets triggers existing dependency warnings

## 10. Tests

Cover:
- Search and filter
- Preview
- Direct reuse
- Independent copy
- Copy immutability
- Root-motion preservation
- IK preservation
- Mesh deformation preservation
- Missing/incompatible rig
- Scene references
- Undo/Redo
- Autosave/recovery
- Project export/import

## 11. Manual acceptance

1. Open a project with several characters and animations.
2. Open Animation Library.
3. Search for a sword-cut animation.
4. Preview it.
5. Use it with a compatible character.
6. Create an independent variation.
7. Modify the variation.
8. Verify the original is unchanged.
9. Place the variation in Scene Editor.
10. Export/reload the project.

## 12. Out of scope

Do not implement:
- Cross-rig retargeting yet
- Automatic animation generation
- AI tagging
- Cloud asset libraries
- Public publishing
- Multiplayer collaboration
- Gameplay systems

## 13. Verification

Inspect actual npm scripts and run the equivalent of:

```bash
npm run typecheck
npm run test
npm run build
```

Also run lint and existing integration tests where available.

Fix failures.

## Definition of done

Artists can browse, preview, organize and reuse existing compatible animations without manually copying JSON or accidentally modifying source assets.

## Final report

Explain:
1. Asset ownership and reuse model
2. Library UI
3. Preview implementation
4. Copy/reference behavior
5. Compatibility handling
6. Persistence
7. Files/APIs changed
8. Tests and exact verification results
