# Visual attachment and skin management

[All guides](../README.md#guides)

v0.5.8.4 adds **Attachments & skins** to the Rig Editor and Animation Editor. The panel lists slots, resolved attachment IDs, texture/frame references, slot depth, visibility, skins, and available artwork. It shares the Rig Editor selection, artwork alignment inspector, working data, validation, draft recovery and history.

Select **Attachment slot**, then choose **Assigned attachment**. The result appears immediately. **Clear assignment** writes `null` to hide that slot. **Remove override** deletes the mapping; the slot inherits the character's default skin again. Selecting a slot also selects it in the existing inspector, where offsets and origins remain editable. Referenced attachments cannot be deleted: **Remove definition** reports every skin/slot mapping that must be cleared or replaced first.

**Active skin** previews existing skins, including manifest files, during animation playback. Each selection resolves the default skin followed by that skin's partial override. Switching repeatedly never accumulates mappings from a previously selected skin. Selection is a preview preference and creates no history entry. Appearance changes keep the existing puppet, joints, slot mounts, render hierarchy, facing, player clock, and IK constraints. Authoring in the Animation Editor uses **Rig Tweak** mode and its separate rig history; animation keys, events and history remain unchanged.

## Create artwork assignments and skins

Enter an **Attachment ID**, choose **Attachment artwork**, optionally supply a string or numeric **Frame**, and click **Create attachment**. Choose that new ID in the selected slot's assignment selector, then align it using the existing inspector. IDs are artist-defined logical identifiers, independent of physical image filenames. PNG/WebP replacements imported through **Sprite replacement** retain their character texture key, so attachments can use imported working artwork without storing browser URLs or private Phaser keys.

The existing sprite schema is the only supported attachment type. Duplicate IDs, missing textures, invalid frames, unsupported fields/types, and invalid slot/attachment references fail before installation. Missing artwork remains referenced and produces an actionable error directing the artist to update `character.json` or choose an available frame. JSON export also reports unresolved artwork. Binary replacement data stays session-local until exported. Use **Character package → Download character ZIP** to include it with the rig, skins and manifest; see the [production asset workflow](artist-workflow.md). Individual rig/skin JSON downloads still omit binaries.

Enter a **Skin name** and click **Create skin**. New skins start with empty mappings and inherit default artwork. Author only the slots that differ. **Rename skin** preserves its partial mappings; names referenced by the manifest (including the default skin) remain fixed, so create a new skin to use another name. Assigning, clearing, removing overrides, creating/removing attachments, and creating/renaming skins each create one logical rig history operation. Undo/Redo restores both embedded and standalone skin data without mutating loaded sources.

## Save and reload

**Download rig.json** saves attachments and embedded skins using the existing version-1 schema. New embedded skins export even if the original rig omitted the `skins` field. An embedded skin is immediately available in both editors on reload, without adding a manifest skin-file entry.

Manifest skins override same-name embedded skins. Their edits remain in their own documents, so **Download skin JSON** saves the active skin using the existing version-1 skin schema. Replace the corresponding file referenced by `character.json`. Downloading rig JSON does not mark modified standalone skins saved. Downloading a standalone skin marks only that skin saved. Rig file reload/import uses the character's loaded standalone files; discard confirmations protect unsaved skin edits. To verify a separately exported skin, place it at its existing manifest path and reload the character. Manifest paths/names are not rewritten by this panel.

Source-bound browser drafts retain attachment catalog changes and standalone skin edits alongside the existing rig geometry and remembered directions. Recovery still requires unchanged bone and slot topology, bone texture references, and IK definitions. Compatible Rig Tweak imports may now contain attachment and embedded skin changes.

## APIs and implementation

- `RigEditorState`: `createAttachment`, `removeAttachment`, `assignAttachment`, `createSkin`, `renameSkin`, `selectSkin`, `resolvedAttachment`, `exportSkinJson`, and standalone skin dirty baselines.
- `AttachmentController` / React `AttachmentPanel`: shared selection and logical commands, asset catalog, diagnostics and skin downloads.
- `Puppet.updateSlotDefinitions(attachments, skins)` / `SlotState.updateDefinitions`: validated owned catalog installation without replacing the rig, bones, player, or constraints. Clear active assignments to removed IDs first. Unchanged definitions retain image identity; changed definitions refresh artwork geometry. Runtime skin APIs retain their existing full-replacement/partial-application semantics.
- `PuppetRenderer`: preserves slot mounts and image presentation (visibility, alpha, depth) when replacing artwork. Attachment offsets, origins, rotations and scales come from the selected definition.

## Verification

`tests/attachmentManagement.test.ts` covers assignment, removal, stable IDs, attachment creation, serialization, skin selection/renaming, partial overrides, missing textures/frames, unsupported data, atomic failure, immutable sources, standalone exports, recovery and Undo/Redo. Real Puppet tests assert retained player/IK/bone identities, exact animated pose and time, facing, mount identity, draw order, depths and refreshed geometry.

Local-only `tests/browser/attachmentManagement.spec.ts` exercises the demo character's hand/head assignments, shared artwork inspector, alternate skin, undo/redo, bind-pose animation preview, canvas changes, rig export/reload, standalone skin export, and skin switching during playback. It compares exported bones/IK/slot definitions and animation JSON before and after artwork authoring. Run these scenarios locally against development and production with the existing browser commands in the [development guide](development.md#local-browser-checks).

Implementation verification: `npm run typecheck`, `npm run test`, `npm run build`, `npm run check`, `npm run check:version`, and `npm run test:package` passed. Vitest reported 2,245 passing tests and 32 existing skipped tests. All 12 local Chrome scenarios passed against development and production: four new attachment/skin scenarios plus eight existing rig-tweak recovery and sprite-replacement regressions. The artist checklist was exercised through browser automation; no separate hands-on verification is claimed.

For manual verification, load the demo character, select a hand slot, create an alternate skin, assign another hand, preview Walk, change headwear/clothing, switch skins, Undo/Redo, and export/reload the definitions. Confirm bone animation is identical. For imported replacement artwork, save a complete character ZIP before reloading the character.

Complete production asset packaging is available in v0.5.8.6 through the [artist workflow](artist-workflow.md). New rigging algorithms, automatic skins, atlas packing, deformation and choreography remain deferred.
