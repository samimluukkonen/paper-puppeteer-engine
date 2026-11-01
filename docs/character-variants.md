# Character variants and reusable templates (v1.5.4)

[All guides](../README.md#guides) · [Project Workspace](project-workspace.md)

Use a variant when several characters need the same skeleton and motion with different existing skin artwork. Use an independent character copy when the skeleton, artwork catalog or animations need private edits. These actions operate on the current committed project documents, including unexported edits.

## Create an appearance variant

1. Add or import the source character in Project Workspace. In its Rig Editor, prepare named skins using the existing slots and attachment mappings. Create a new skin for alternate clothing or weapons instead of changing a skin already used by another character.
2. Return to Project and choose **Create Character Variant** on the source row. Enter a new character name, keep **Reuse shared rig and animations**, and choose an **Appearance skin**.
3. Choose **Create Variant**. The row identifies its stable shared rig owner and selected appearance. **Appearance only** switches that variant’s skin without modifying the source or another variant. Project Undo/Redo restores the selection.
4. **Edit Shared Rig** and **Edit Shared Animations** open the original owner. The shared application header names all affected characters. Rig, attachment, image, skin-catalog and animation edits affect the whole group. Keep existing skin names and mappings intact when adding new appearances.

Variants own their character identity, display name and selected skin. They share the complete rig, attachments, textures, skins, animations and poses with one independent owner. Choosing another variant as a source resolves to that same owner; there are no nested live inheritance chains. A partial appearance skin keeps mappings inherited from the source default skin. Explicit hidden slots remain hidden.

**Create Independent Character Copy**, or the independent ownership option in the variant dialog, takes a detached snapshot with a new stable identity. It opens in Rig Editor. Copying a variant retains its selected default appearance. Future edits to the source do not change the copy. Original image bytes are interned in the project; replacing artwork later is explicit.

## Templates

Enable **Reusable template** on an independent character. Choose **New from Template**, select the preset and enter a name. **Create Character** copies the current rig, attachments, skins, animations and poses into a new independent character and opens Rig Editor. The preset flag itself uses Project Undo/Redo.

A template is a project character preset. Instances have no live dependency on that preset, so later edits, unchecking the flag or deleting the preset leave copies intact. Templates can also own shared variants; those references must be removed before deleting the owner. Template creation always copies editable metadata and reuses original image binaries explicitly; use Create Character Variant for ongoing shared rig ownership.

## Mesh appearance and animation reuse

Skins select existing rigid sprites or mesh attachments without converting artwork. Each mesh retains its own topology, UVs, vertex IDs, bone weights and bind pose. Corrective deformation tracks stay with their original attachment and vertex IDs. Selecting a different mesh does not transfer those corrections, even when it has similarly named vertices. The creation dialog explains these limits for mesh characters.

Existing validators check skin/slot/attachment references, textures, mesh topology, weights, bind data and corrective tracks. Mesh image replacement requires the original dimensions and pivot. Equal image dimensions do not prove that new artwork fits the geometry; inspect the silhouette and weights. For different proportions, make an independent copy and deliberately rebuild geometry and review corrections. Invalid corrections are rejected rather than silently remapped.

Animation Library recognizes the explicit shared rig identity for direct reuse. Variants use the same animation names and current source motion without playback retargeting. Independent copies have their own rig identity; later cross-character motion transfers use [compatibility and bone mapping](rig-compatibility.md) and [visual animation retargeting](animation-retargeting.md).

## Scenes, persistence and dependencies

Add the source and its variants as separate Scene Actors. Each starts with its character’s default appearance; clocks, poses, facing and placement are independent. The Scene Animation Library accepts animations from their shared rig group. Reopen the scene after changing appearance or shared assets to load fresh runtime definitions.

**Validate Project** checks current dependencies. Removing a shared owner is blocked while variants reference it. Renaming a selected skin, or using Rig Undo/reset to remove it, is blocked with its dependent characters. Project history refuses to restore a variant whose skin has since been removed; restore the skin first. Scene references retain the existing deletion guards. Texture and animation replacements include affected variants in their dependency confirmation. Individual animation asset deletion has no UI action; invalid programmatic removals are reported by normal scene/export validation.

Project autosave, crash recovery and export/import preserve shared references, selected skins and template flags. **Export Project** stores identical image binaries once. Character metadata is materialized per exported identity for the existing version-1 CharacterLoader and runtime. No runtime inheritance resolver or automatic retargeting is needed.

Use **Download Character ZIP** on a variant row to export that identity and selected appearance as a complete standalone character. The shared editor’s package controls export the shared owner shown in its header. Standalone scene packages include complete referenced characters and work with the ordinary SceneRunner/Puppet APIs. Importing a standalone variant character ZIP creates an independent character because it contains no project ownership metadata; use project ZIPs to retain sharing.

## Desktop acceptance

1. Open a project with Generic Samurai and a Blue Armor skin. Create Blue Armor Samurai with the shared rig and that skin.
2. Confirm both rows show the intended ownership. Switch Appearance only and undo it; check that the original skin stays unchanged.
3. Add both characters to a scene, select the existing sword-cut animation and play. Confirm different appearances with matching motion and independent Actor positions.
4. Open Edit Shared Rig and check the affected-character notice. Make a harmless rig edit and undo it.
5. Create an independent character copy, edit its skeleton and confirm the source is unchanged.
6. Mark the original as Reusable template, use New from Template, and confirm its new identity and Rig Editor opening.
7. For mesh characters, inspect alternate attachments, corrective vertex IDs and image compatibility. Attempt to rename a referenced appearance and remove its owner; expect actionable dependency feedback.
8. Export/import the project, recover a local draft, and download a variant character/scene package. Confirm appearances, animation playback, sharing and independent copies survive.

Implementation is in `ProjectWorkspace`, `ProjectDefinition`, `CharacterVariantDialog`, the shared package snapshot/serializer and the existing project inspector/host/library boundaries. Automated coverage is in `characterVariants.test.ts`, `projectEditorHosts.test.ts`, `projectGuides.test.ts` and the local-only `characterVariants.spec.ts` workflow.

## Verification

| Check                        | Result                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| `npm run typecheck`          | Passed                                                         |
| `npm run test`               | 245 files passed, 8 skipped; 4,249 tests passed, 59 skipped    |
| `npm run build`              | Application, library, declarations and Node core checks passed |
| `npm run check`              | Formatting, lint and typecheck passed                          |
| `npm run check:version`      | Package, lockfile and changelog agree at 1.5.4                 |
| Local desktop smoke workflow | 2 passed: development and production                           |

The build retains the existing non-failing Lucide `use client` directive warnings. Run the desktop workflow locally with one worker:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/characterVariants.spec.ts --workers=1
```

The variant regressions cover live shared ownership, source immutability, independent copies and template deletion, inherited skin mappings, shared animation reuse, skin rename/reset/history protection, malformed shared references, mismatched imported rigs, missing animations, mesh topology/weights/corrections and incompatible image dimensions. Project ZIP and local-draft round trips then exercise distinct appearances through ordinary SceneRunner Actors. The desktop workflow checks the real creation dialogs, appearance Undo, shared header, deletion feedback, standalone ZIP identity and automatic template-instance opening in Rig Editor.
