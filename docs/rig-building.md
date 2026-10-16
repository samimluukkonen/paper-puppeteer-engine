# Build a character from scratch

[Artist workflow](artist-workflow.md) · [New character workspaces](new-character-workspaces.md)

The v0.6.6.2 workflow builds a usable character entirely through the existing Rig Editor. New characters retain the existing minimal root and empty default skin. No character template, demo texture or generated artwork is inserted. The runtime requires one root, which can be renamed but cannot be removed or parented.

## Artist workflow

1. Choose **+ New Character**, then enter the character's name and ID.
2. Select `root` in **Hierarchy**. Under **Build skeleton**, edit **Bone ID / name** and choose **Rename bone** if desired.
3. Select a parent, enter **New bone ID**, and choose **+ Add Bone**. Repeat for arbitrary nested or branching skeletons. A new child starts at the parent's length, or 40 local units when no length is specified.
4. Use **Joint Editing** to drag joint markers directly in the Phaser canvas. The inspector edits local position, rotation, scale, length and depth. Parent length constrains the distance of direct children using the engine's existing length rules. Joint edits change rig bind data and create no animation keys. Rotate a parent in Bind pose to test the hierarchy without an animation.
5. Select a bone, enter **New slot ID**, and choose **+ Add Slot**. Empty slots are valid and render without artwork.
6. Expand **Artwork import & replacement** and use **Import new artwork** to choose your own transparent PNG/WebP files.
7. Under **Attachments & skins**, enter an independent **Attachment ID**, select the imported artwork and choose **Create attachment**. Select the new slot and assign the attachment with **default** as the active skin. Repeat incrementally; missing assignments remain empty.
8. Align artwork through existing normalized/pixel origins, artwork offsets and slot transforms. Edit slot depth to control draw order. Facing, visibility and joint markers help inspect the result. Additional skins can inherit, replace or hide default slot artwork.
9. Download the complete character ZIP to retain skeleton, default skin and imported image bytes together. Individual JSON downloads do not save images. Imported artwork remains in memory until teardown; browser JSON recovery cannot restore its image bytes.

**Parent bone** changes retain local transforms and ask for confirmation with affected children, slots, IK and animation references. World placement can change. Cycles, self-parenting, missing parents, duplicate IDs and invalid transforms are rejected before installing a structural edit. Invalid IK topology also rejects the edit.

**Remove bone** removes an unreferenced leaf after confirmation. Children, slots, legacy bone artwork, authored/preview IK constraints and tracks in every workspace animation block removal. Resolve those dependencies explicitly; no authored references are cascaded away. **Remove empty slot** requires removing all skin overrides, including explicit hidden mappings, first. Renaming updates children and slot references atomically; animation/IK and legacy bone-artwork references block renaming to preserve their stable identities.

## React, Phaser and history

`RigStructurePanel` uses the existing React attachment adapter and the shared rig selection. `HierarchyController` rebuilds its buttons only when topology changes, releasing old handlers. The numeric inspector and canvas retain their current ownership and local/world conversions.

Structural commands validate a complete candidate with `Rig` and standalone skin reference checks before installing one rig history entry. Geometry, assignments and alignment reuse existing history operations. Undo/Redo restores hierarchy indexes and reconciles removed selections. Live animation reference checks also prevent rig undo/reset from removing a bone that acquired animation tracks after creation; keyboard history reports a blocked action in the existing feedback area.

`RigEditor` reconstructs its preview puppet only when bone/slot topology changes, retaining placement, facing and camera. `AnimationEditorScene` rebinds artwork and replaces preview sampling, ghosts and IK handles around that runtime skeleton. Rig and animation documents, authored clips, animation history and playhead remain shared. A failed rebuild retains the previous puppet and can be undone or retried.

Browser recovery envelopes now use version 2 to retain newly authored skeletons, slots and remembered zero-length directions. Legacy version-1 envelopes and raw compatible rigs remain supported. Raw JSON import/reload requires the current workspace topology, bone artwork identities and original IK definitions. Exported engine files remain ordinary version-1 rig/skin/manifest data. Recovery validates live animation references and available images before replacing authored data.

Serialization matches original bones, slots and attachments by ID when comparing numeric baselines. Deleting an earlier array entry preserves untouched precision on the remaining entries.

## Files and APIs

| Area                         | Files / APIs                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural document commands | `RigEditorState.ts`: `createBone`, `renameBone`, `reparentBone`, `removeBone`, `boneDependencies`, `createSlot`, `removeSlot`; optional live `boneReferences` |
| React controls               | `RigStructurePanel.tsx`, `editorMarkup.tsx`, `AttachmentController.ts`                                                                                        |
| Hierarchy and preview        | `HierarchyController.ts`, `RigEditor.ts` (`onRebuild`, `actionError`), shared `boneHierarchy.ts` (`sameRigTopology`)                                          |
| Shared workspace             | `newCharacter.ts`, `AnimationEditorScene.ts`, `AnimationEditorSelection.ts`, `SessionController.ts`                                                           |
| Recovery                     | `rigDraftRecovery.ts`, `RigEditorState.createRecoveryDraft`                                                                                                   |
| Serialization                | `rigSerialization.ts`: `serializeRigData` retains original numeric baselines by stable ID                                                                     |
| Regression coverage          | `rigBuilding.test.ts`, `animationEditorRigTweak.test.ts`, local-only `browser/rigBuilding.spec.ts` and `browser/newCharacter.spec.ts`                         |

The runtime schema, package API, sample characters, dependencies and CI configuration stay unchanged.

## Verification

`tests/rigBuilding.test.ts` covers arbitrary nested skeletons, unique IDs, parent/cycle validation, safe deletion/reparenting, slot creation, default assignment, origins/offsets, empty states, selection, live animation references, reset, recovery, serialization, preview reconstruction, cancellation and Undo/Redo. Shared-scene tests cover existing-character animation/IK compatibility and listener/subscriber ownership across reconstruction. The local browser scenario creates and recovers a skeleton, imports a real PNG file, assigns/aligns artwork, switches views and validates the exported ZIP through `CharacterDefinition`.

| Command                | Result                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`    | Exit 0                                                              |
| `npm run test`         | Exit 0; 153 files passed, 4 skipped; 2,696 tests passed, 44 skipped |
| `npm run build`        | Exit 0; demo, library, declarations and Node core checks passed     |
| `npm run lint`         | Exit 0                                                              |
| `npm run format:check` | Exit 0                                                              |
| `git diff --check`     | Exit 0                                                              |

`PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/rigBuilding.spec.ts tests/browser/newCharacter.spec.ts` exited 0: all 8 scenarios passed across development and production. Local integration scenarios allow 60 seconds for scene transitions, imports and downloads, with 15 seconds for loading a sample character.

The demo build retains the existing two non-fatal `lucide-react` module-level `use client` directive warnings. Browser checks remain local-only and use installed Chrome; no browser setup or tests were added to CI.

## Complete character workflow

[Creating Your First Character](creating-your-first-character.md) continues this workflow through first-animation authoring, complete package export and loading in another application. The [workflow verification report](first-character-verification.md) records v0.6.6.3 coverage. Durable image/project persistence, ZIP import into an editable workspace, and coordinated migration of existing animation/IK references when renaming bones remain follow-up work. Automatic rigging/joint detection, AI artwork, meshes, new IK solver types and scene choreography remain outside this plan.
