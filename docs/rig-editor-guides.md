# Rig Editor guided tutorials

The v0.7.6.4 catalog is available from **Feature Guide → Rig Editor**. It uses the shared [selection modal and spotlight](feature-guide-architecture.md). Steps explain the actual controls; exit the tour to perform the task. No step creates or deletes bones, moves joints, changes artwork or skins, or saves/exports data.

## Implemented catalog

| Guide                          | Steps | Main controls                                                                                |
| ------------------------------ | ----: | -------------------------------------------------------------------------------------------- |
| Creating Foot Contact Markers  |     5 | New contact bone, Add Contact Marker, local coordinates, Ground reference, Download rig.json |
| Creating a New Character       |     3 | + New Character, Character, Character package                                                |
| Creating Bones                 |     5 | Hierarchy, Build skeleton, + Add Bone, Edit, canvas                                          |
| Editing Joint Positions        |     6 | Hierarchy, Joint Editing, Bind pose, canvas, Selection details, Undo/Redo                    |
| Importing Artwork              |     5 | Import new artwork, Artwork asset, Import sprite, Create sprite attachment, package          |
| Aligning Sprites               |     5 | Hierarchy, Edit modes, canvas, Selection details, Undo/Redo                                  |
| Slots and Attachments          |     5 | Hierarchy, + Add Slot, Create sprite attachment, Attachment slot, Edit                       |
| Creating and Changing Skins    |     5 | Active skin, Skin authoring, Attachment slot                                                 |
| IK Constraints                 |     8 | + Add IK Constraint, chain labels, bend arrow, targets, solver feedback, Enabled, Undo/Redo  |
| Exporting the Rig or Character |     4 | Validation, File tools, Download rig.json, Character package                                 |

There are 51 steps in total. Copy distinguishes skeleton joints, sprite origins (artwork pivots), sprite offsets (position relative to a bone/slot), slots (attachment locations), skins (appearance mappings), and default rig IK targets. It also distinguishes rig downloads from complete character ZIPs and the separate artwork replacement history.

## Availability and preparation

Creating a New Character works without a loaded character, including after a failed load. Other tasks require a loaded or newly created character. Joint editing also requires successful rig validation. Alignment requires an authored bone sprite or sprite attachment; its unavailable reason directs the artist to importing and attachment creation. IK requires an existing authored constraint; its reason directs the artist to create three connected bones and use **+ Add IK Constraint**. No character or bone names are hardcoded in the definitions.

The other eight tasks are available on a valid root-only character. Import and attachment tutorials explain how to populate empty libraries and slots. Selecting a bone, slot, skin or constraint remains the artist's action after exiting the tour. The eight-step IK guide explains creation and validation, chain-role labels, enabled/preview/influence controls, signed bend direction and facing, default-target dragging, coordinate commitment/cancellation, reachability/transform diagnostics, runtime ownership restrictions and undo/export. Its dedicated bend and feedback steps cover the v1.4.1 workflow without changing solver state or authored data during the tour.

Preparation expands ancestor disclosures, reveals the inspector and scrolls the target into view using the existing UI-only resolver. It does not change selection, edit modes, preview poses or solver state. Inspector disclosures still start collapsed. File tools and New Character steps point to their opening buttons and describe the dialog workflow without opening another modal over the tour.

## Stable anchors

`src/devtools/shared/guides/anchors.ts` declares the contract. The original milestone added 22 `data-guide-id` anchors; contact authoring adds `rig-contact-bone`, `rig-contact-create`, `rig-contact-position` and independent `rig-ground-*` anchors:

- Header: `rig-new-character`, `rig-character-selection`.
- Skeleton: `rig-build-skeleton`, `rig-add-bone`, `rig-add-slot`.
- Editing/preview: `rig-edit-mode`, `rig-preview-pose`, `rig-history`, `rig-ik-preview`.
- Images: `rig-import-artwork`, `rig-artwork-asset`, `rig-replace-artwork`.
- Attachments/skins: `rig-attachment-slot`, `rig-create-attachment`, `rig-active-skin`, `rig-skin-authoring`.
- IK: `rig-ik-constraints`, `rig-add-ik`.
- Export: `rig-validation`, `rig-file-tools`, `rig-download`, `rig-character-package`.

The guides reuse `rig-bone-hierarchy`, `rig-selection-details`, and `rig-canvas`. Phaser joint, artwork-pivot and IK-crosshair instructions highlight the existing canvas panel and the relevant React tools. The Rig Editor does not register guide geometry for individual Phaser handles; no DOM selectors are used to find rendered handles. The existing optional geometry-provider contract remains covered by unit tests.

All ten feature families are implemented. There are no fictional or omitted feature entries. Alignment and IK are conditionally unavailable when their resource prerequisites are absent; interactive practice remains deferred.

The v1.4.2.1 [mesh foundation](mesh-attachments.md#using-this-milestone) adds a documented data workflow, with a developer quick start and troubleshooting. It adds no mesh tour because visual creation, editing and rendering are deferred. Existing attachment/skin tours continue to teach the available rigid artwork controls; imported mesh selections remain unrendered.

## Verification

`tests/rigGuides.test.ts` checks registration and counts, declared targets, unloaded/root-only/existing rigs, live capability changes, all guide navigation, finish, exit at every step, and preservation of authored data, selections, skins, dirty flags and history. Existing controller/registry tests now follow the six-step joint tour. Resolver/observer tests cover React panels, scroll clipping, UI-only reveal, Phaser geometry providers and cleanup.

`tests/browser/rigGuides.spec.ts` walks every available step on an existing character and a new root-only draft, verifies one visible target per step and spotlight placement, checks Back/Next/Finish/Escape, and compares full rig exports before/after the tours. It also checks retained unsaved edits, Undo/Redo, one retained Phaser canvas, no automatic downloads, and the New Character tour after loading fails. `featureGuide.spec.ts` retains focus, keyboard/pointer blocking, desktop resizing, missing-target recovery and cross-editor unsaved-preview coverage.

Verified locally on 2026-10-17:

| Command                                                                                                                                                                             | Result                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                 | Exit 0                                                               |
| `npm run test`                                                                                                                                                                      | Exit 0; 164 files passed, 4 skipped; 2,820 tests passed, 44 skipped  |
| `npm run build`                                                                                                                                                                     | Exit 0; demo/library builds, declarations and Node core check passed |
| `npm run lint`                                                                                                                                                                      | Exit 0                                                               |
| `npm run format:check`                                                                                                                                                              | Exit 0                                                               |
| `git diff --check`                                                                                                                                                                  | Exit 0                                                               |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/featureGuide.spec.ts tests/browser/rigGuides.spec.ts --project=production`                                             | Exit 0; 11 passed                                                    |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/featureGuide.spec.ts --project=development -g 'pending animation previews' --output=/tmp/rig-guide-preview-regression` | Exit 0; 1 passed                                                     |

The full development command, `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/featureGuide.spec.ts tests/browser/rigGuides.spec.ts --project=development`, initially completed with 10 passed and one failure in an older assertion that expected a single guide button. Updating that assertion to check every catalog button fixed it; the targeted rerun above passed. Every scenario has therefore passed in both development and production. No application failure remained. The build emitted the existing two lucide-react `use client` bundler warnings.

The local browser runs traversed all 44 steps on the existing character and all 33 available steps on the new root-only draft. Every target resolved without Skip, panels revealed through the existing resolver, and full rig comparison, unsaved status and Undo/Redo checks passed. The production walkthrough captured one screenshot per step under `test-results/` (local ignored artifacts).

Manual visual review sampled 13 production screenshots across all nine guides at 1440 × 1000. The sampled spotlights identified their controls/panels and the cards and Exit actions were readable within the viewport. Full per-step target/navigation verification was automated; no separate hands-on authoring pass was performed. Existing browser checks additionally covered desktop widths 1280, 1440 and 1920, focus containment, scrolling, layout zoom, missing-target recovery and reduced motion. Browser checks remain local-only; no browser installation or smoke test was added to CI.
