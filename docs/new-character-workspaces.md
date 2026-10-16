# New character workspaces

[All guides](../README.md#guides) · [Artist workflow](artist-workflow.md)

Choose **+ New Character** from the shared character header. The React dialog is available while character loading is pending or has failed. Names are trimmed, must contain 1–100 characters and cannot contain control characters. IDs contain at most 64 lowercase ASCII letters/numbers with single hyphens between words. Suggestions normalize the name and add a numeric suffix on collision; artists can edit them. Creation rejects IDs already used by either shipped character or another draft in this browser tab. The existing version-1 manifest has no description field, so the dialog does not offer one.

`createNewCharacter(options, existingIds)` is the centralized, renderer-independent editor factory in `src/devtools/shared/newCharacter.ts`. It builds a new immutable `CharacterDefinition`, one `RigEditorState` and one `AnimationEditorState`. It never takes an existing character as input. `createCharacterDocuments()` supplies those same document owners for characters loaded through the existing scene loader. Both editor views continue sharing one scene and one working owner per document domain.

Every new definition has its own `character.json` manifest, a named `rig.json` with only `{ id: 'root' }`, and `skins/default.json` with an empty slot map. Textures, animations, poses, slots and attachments start empty. No sample artwork, tracks, IK chains or additional bones are generated. The name lives in the supported rig name field; the manifest retains the unique character ID.

`CharacterDraftStore` atomically records validated initial name/ID options in `sessionStorage`. Creation completes validation and initializes documents before writing. Validation or storage failures leave the current editing documents untouched. Editor character selection includes these drafts and uses the existing full-page character-switch lifecycle and unsaved browser guard. Rig/Animation Editor navigation retains live documents and history. Compatible rig/animation edits use the existing JSON draft recovery controls after reload or character switching; Undo/Redo history is session-only. Draft identities survive refreshes and character switching in the same browser tab. They are not a durable project directory or a cross-tab catalog.

New characters show **New / Unsaved** even with no edits. A rig or skin JSON export does not save the entire character. The package controller clears the character-level unsaved flag only after a complete ZIP download starts successfully; failed validation, encoding or download leaves it unsaved. Existing individual rig, skin, animation and artwork checkpoints keep their existing behavior. Reopening a draft from its initial stored identity starts another unsaved editing session and offers compatible JSON recovery. Save the ZIP yourself before closing the tab. Images remain in memory and are not stored in JSON recovery.

The normal rig, manifest, skin, cross-file and package validators accept the minimal skeleton. A draft is artistically incomplete but structurally valid and exportable, including as an empty package containing only the manifest, rig and default skin. No relaxed runtime schema or dummy image is necessary. Invalid references still fail the normal production checks. Unknown editor character IDs report load failures instead of opening an unrelated example.

**Import new artwork** uses the existing sprite decoder and session image budgets, registers a unique logical texture, and adds it to the library without inventing rig references. Imported assets can supply new attachment definitions. Complete package export allocates image paths and includes their real bytes through the existing `CharacterLoader` validation boundary. Replacements continue using their existing preview/apply and history lifecycle. Importing a library asset does not create a rig history action; its resources are released on workspace teardown.

Regression coverage is in `tests/newCharacter.test.ts`, the artwork/package tests and local-only `tests/browser/newCharacter.spec.ts`. These cover empty creation, creation alongside an edited source, duplicates, invalid input, independent documents/history, recovery, character switching, unsaved guards, transactional failures, first artwork import and package round trips. Required verification is `npm run typecheck`, `npm run test`, and `npm run build`. Browser checks use the local commands in the [development guide](development.md#local-browser-checks).

The [v0.6.6.2 rig-building workflow](rig-building.md) adds bone/slot creation and artwork assignment onto newly created structure. Automatic skeleton generation, templates, AI artwork generation, new animation systems and scene choreography remain outside this workflow. Durable project persistence and importing ZIPs as editable workspaces are separate work; ZIP import continues to open an isolated runtime preview.

## Changed files and APIs

| Area                       | Files and APIs                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Creation and draft catalog | `newCharacter.ts`: `createNewCharacter`, `createCharacterDocuments`, `suggestCharacterId`, `CharacterWorkspace`, `CharacterDraftStore`                 |
| React creation UI          | `NewCharacterDialog.tsx`, `viewShell.tsx`, `characterSelection.ts`, `workspace.css`                                                                    |
| Scene and lifecycle        | `AnimationEditorScene.ts`: optional prevalidated `definition`; `main.tsx`: draft startup, character status and unsaved guard                           |
| First artwork import       | `ArtworkController.ts`: `importAsset`, `ArtworkExport.newAsset`, `ArtworkSnapshot.ready`; `ArtworkPanel.tsx`                                           |
| Complete export            | `characterPackage.ts`: new library image paths/bytes; `PackageFingerprints.ts`: new asset identity; `PackageController.ts`: character-level checkpoint |
| Regression coverage        | `newCharacter.test.ts`, `artworkReplacement.test.ts`, `characterPackage.test.ts`, local `browser/newCharacter.spec.ts`                                 |

No runtime schema, shipped example character, dependency, version, or CI workflow was changed.

## Verification results

| Command                | Result                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck`    | Exit 0                                                                              |
| `npm run test`         | Exit 0; 152 test files passed, 4 skipped; 2,682 tests passed, 44 skipped            |
| `npm run build`        | Exit 0; demo and library builds, declaration generation and Node core checks passed |
| `npm run format:check` | Exit 0                                                                              |
| `npm run lint`         | Exit 0                                                                              |

`PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/newCharacter.spec.ts` exited 0: all 6 scenarios passed across development and production.

The demo build emits two `lucide-react` module-level `use client` directive warnings. They do not fail either build. Browser tests remain local-only and use the installed Chrome because the Playwright-managed Chromium binary is absent on this machine.
