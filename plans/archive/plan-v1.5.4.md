# Paper Puppeteer Engine — v1.5.4
## Character Variants & Reusable Templates

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.5.3.2**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing:
- Rig Editor
- Character definitions
- Skins and attachments
- Rigid sprites and mesh attachments
- Animation Library
- Animation retargeting
- CharacterLoader
- Project asset registry
- Undo/Redo, autosave and export/import

## Goal

Allow the artist to create variations of characters without rebuilding the same rig, artwork relationships and animation setup.

For example:
- Samurai with different armor colors
- Same character with different clothing
- Generic soldiers sharing a rig
- Character with alternate weapon artwork
- Different visual appearances using the same animations

Keep variants simple and predictable.

## 1. Inspect existing features

Review:
- Character creation
- Skins and attachment mappings
- Character IDs
- Rig ownership
- Animation associations
- Sprite replacement
- Mesh attachment data
- Character package export
- Project Workspace

Do not rebuild an existing skin system.

## 2. Character variant concept

Support a lightweight variant that reuses an existing compatible character rig.

A variant may reference:
- Shared rig identity
- Selected skin
- Compatible attachment choices
- Shared compatible animations
- Optional display name/metadata

Use the existing project asset model where appropriate.

Do not create a complex inheritance framework.

## 3. New Variant workflow

Provide:

**Create Character Variant**

Suggested UI:

SOURCE CHARACTER
[ Generic Samurai ]

NEW VARIANT
Name: [ Blue Armor Samurai ]

Base Rig:
[ Shared Rig ]

Appearance:
[ Blue Armor Skin ]

[Create Variant]

The UI must distinguish:
- Reusing an existing rig
- Creating an independent character copy
- Changing appearance only

Do not silently duplicate the entire rig when a skin-based variant is sufficient.

## 4. Shared rig behavior

When multiple variants deliberately share the same rig:
- Preserve stable rig references.
- Reuse compatible animation assets.
- Clearly indicate shared ownership.
- Detect invalid changes to shared rig dependencies.

Do not allow editing a shared rig without making its shared impact understandable.

An independent-copy action should be available when a variant needs a different skeleton.

## 5. Appearance customization

Reuse existing:
- Skins
- Slots
- Attachment mappings
- Sprite image assets
- Mesh attachments

Support practical appearance changes without converting artwork unnecessarily.

Do not mutate the original character's skin when editing another variant's selected appearance.

## 6. Mesh compatibility

v1.4 includes weighted meshes and corrective deformation.

A different image/skin may not match the source mesh's geometry.

Validate:
- Attachment compatibility
- Texture references
- Mesh topology
- Existing bone weights
- Corrective deformation tracks

Do not silently reuse incompatible vertex corrections.

Provide warnings when an appearance change requires different geometry.

## 7. Animation reuse

Variants sharing a compatible rig should be able to reuse the same animations directly.

For variants with independent rigs, use the v1.5.2–v1.5.3 compatibility and retargeting workflow.

Do not automatically retarget on every animation playback.

## 8. Character templates

Provide an action to create a new character from an existing reusable template.

Initially, a template can be a well-defined project character/rig preset.

Support:
- Select template
- Choose new character name
- Assign new stable identity
- Reuse or copy appropriate assets explicitly
- Open in Rig Editor

Avoid deeply nested live template inheritance.

## 9. Dependency safety

Check:
- Shared rig deletion
- Referenced skin removal
- Animation asset removal
- Mesh image replacement
- Template deletion

Avoid corrupting existing variants.

Use current dependency validation.

## 10. Persistence

Verify variants survive:
- Project autosave
- Crash recovery
- Export/import
- CharacterLoader
- Scene Actor creation
- Standalone runtime playback

No duplicate binary image files unless deliberately required.

## 11. Tests

Cover:
- Variant creation
- Shared rig
- Independent character copy
- Skin switching
- Animation reuse
- Mesh compatibility
- Template creation
- Source immutability
- Dependency deletion warnings
- Multiple variants in one scene
- Export/import

## 12. Manual acceptance

1. Open Generic Samurai.
2. Create Blue Armor Samurai.
3. Reuse the original rig.
4. Select different skin artwork.
5. Use an existing sword-cut animation.
6. Add both character variants to a scene.
7. Play their animations.
8. Create an independent rig copy for another variation.
9. Confirm shared versus independent ownership is clear.
10. Export/reload the project.

## 13. Out of scope

Do not implement:
- Procedural character generation
- AI-generated equipment
- Live multi-level inheritance
- Network asset synchronization
- Character leveling/stats
- Equipment inventory gameplay systems

## 14. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

Artists can create character variants and reusable templates using existing rigs, skins and animations while preserving correct ownership, dependencies and export compatibility.

## Final report

Describe variant model, shared assets, character templates, mesh handling, animation reuse, files changed, tests and exact results.
