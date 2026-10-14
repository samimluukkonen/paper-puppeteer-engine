# v0.5.8.6 production asset verification

[Artist workflow](artist-workflow.md) · [Development guide](development.md)

## 1. Implemented functionality

Both editors expose complete character ZIP export, per-domain package checkpoint status, exact exported-ZIP reload and saved-ZIP import into an isolated runtime preview. Export/import report actionable failures without replacing authored working data. Package version is `0.5.8-6`.

## 2. Complete artist workflow

The [artist guide](artist-workflow.md) covers artwork preparation, initial manual placement, rig joint/hierarchy editing, artwork alignment, attachment/skin assignment, bone and IK animation, onion skinning, mirroring, sprite replacement, elbow correction in Rig Tweak, final package download, runtime verification and manual deployment. Initial skeleton creation and movement of downloaded files into a served directory remain manual.

## 3. Asset and rig architecture

Source character definitions and manifests remain immutable. Rig, animation and artwork histories remain independent. Standalone manifest skins retain precedence over embedded skins; attachment definitions remain in the existing rig format. Export captures detached authored rig/skins/clips and immutable applied image blobs before asynchronous reads. It validates the resulting manifest/files through `CharacterLoader` before generating a ZIP.

## 4. Sprite replacement guarantees and limitations

Shared replacement retains its texture identity; individual replacement assigns an image resource while preserving logical bone/attachment IDs, slots and skins. Existing keys/timing, joint hierarchy, depth, authored IK and baked suppression data remain unchanged. Pixel pivots migrate into ordinary origins/offsets, including out-of-image pivots on rotated/scaled attachments. Unapplied proposals block export. Atlas frames are rejected. Binary drafts and editor-to-editor transfer remain session-limited; use saved files and manual placement between editor pages.

## 5. Package export/import architecture

The archive contains version-1 character/rig/skin/animation/pose JSON and image binaries using existing relative paths where possible. A small dependency-free stored ZIP encoder/decoder provides CRC32 integrity checks and bounded entries. Unsupported archive features, unsafe paths, path collisions, missing references, invalid JSON/versions, duplicate identities, invalid images and incompatible static frames fail validation. Browser validation also decodes images before a download is produced. Node tooling validates headers/metadata; actual browser/runtime loading performs decoding.

Import verifies editor-produced ZIPs and opens a runtime preview; it does not replace the authored editor session. The preview reads metadata through `CharacterLoader`, uses the shared cancelable scene artwork loader and creates a regular `Puppet` with the loaded definition. Its temporary image URLs belong only to the preview lease.

## 6. Runtime compatibility

Unit regressions export all shipped demo clips plus authored IK and a baked result, encode/decode ZIP bytes, reload via `CharacterLoader`, and compare every bone's sampled local pose and world position with the source `Puppet` in both facings. Other runtime suites retain coverage for skins, attachments, events, interpolation, crossfades, animation layers and disposal.

## 7. React/Phaser lifecycle findings

Preloaded local metadata still needs an asynchronous boundary before checking Phaser scene activity because `Scene.create()` precedes the active flag. The shared scene loader preserves that boundary. Each runtime preview owns a separate game/texture manager and releases its puppet/load resources on shutdown, then revokes its image URLs on game destruction. Decode failure/cancellation revokes proposal URLs. Package/controller teardown cancels pending work and releases subscriptions. Existing handles, pointer listeners, IK gizmos and ghost/overlay ownership are unchanged and covered by their regression suites.

Package dirty status also needs refreshes from numeric rig inspector status callbacks: these can update authored data without a full workspace render. Both editor adapters now deliver those updates. Package fingerprints use canonical SHA-256 source identities and skip unchanged immutable snapshots during playback. Package checkpoints never mark a repository source file saved or reset document histories.

## 8. Files and APIs changed

- `src/engine/CharacterDefinition.ts`: immutable original `manifest` retention.
- `src/devtools/shared/package/characterPackage.ts`: `capturePackage`, `buildCharacterPackage`, `validatePackage`, `loadPackageDefinition`, `openPackageRuntime`, and package file/snapshot types.
- `src/devtools/shared/package/packageZip.ts`: bounded relative-path validation and stored ZIP encoding/decoding.
- `src/devtools/shared/package/PackageController.ts`: per-domain checkpoints, asynchronous download/import ownership and runtime-preview state.
- `src/devtools/shared/package/PackagePanel.tsx`: shared React export/import panel and isolated runtime preview.
- `ArtworkController.ts`: detached applied binary export and pending decode/proposal navigation state.
- `AnimationEditorDocument.ts` / `AnimationEditorState.ts`: all-session animation snapshot query.
- Both editor scenes, entry points and view markup: package integration and cleanup; rig session/controller adapters: pending-artwork confirmations and status refresh.
- `src/shared/downloadJson.ts`: shared blob download helper; `loadSceneCharacter.ts`: immutable preloaded metadata option; `src/ui/workspace.css`: package panel/preview presentation.
- Package manifests, README, changelog, artist guide, sprite guide and new/expanded unit/local browser tests.

## 9. Automated tests

New coverage checks complete file/binary inclusion, relative paths, source immutability, shared/individual overrides, pivot conversion, delayed snapshots, path traversal, damaged/truncated/unsupported ZIPs, invalid manifests/JSON/versions/IDs/images, frames, stale targets, checkpoint domains, failed downloads, interrupted requests, URL disposal and runtime playback equivalence. Artwork tests confirm applied-only binary snapshots, detached metadata, unchanged authored rig and revert/undo behavior.

## 10. Manual verification

A human manual artist pass was not performed. The representative 18-step workflow is documented in the artist guide; automated unit and local browser verification are reported separately. No repository files are claimed to have been saved by browser downloads.

## 11. Documentation

Added the complete artist guide and this implementation/verification report. README and changelog describe v0.5.8.6; the rig, animation, attachment/skin and sprite replacement guides now point to complete package export. The guide explains checkpoints, supported ZIP subset, PNG/WebP runtime loading, manual placement, source protection and deferred features.

## 12. Verification command results

| Command                 | Result                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run typecheck`     | Passed (exit 0).                                                            |
| `npm run test`          | Passed: 2,294 tests; 32 existing skips. 135 files passed; 3 skipped.        |
| `npm run build`         | Passed: demo, library, declarations and Node `/core` verification (exit 0). |
| `npm run check`         | Passed: formatting, lint and typecheck (exit 0).                            |
| `npm run check:version` | `0.5.8-6` is valid SemVer.                                                  |

`npm run test:package` passed (exit 0): packed documentation links, Node `/core` imports, public declarations and browser bundling in an isolated consumer. A stored archive also passed the system `unzip -t` interoperability check. The final local Chrome regression selection passed **92/92 scenarios** in 6.4 minutes (exit 0), across development and production:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/characterPackage.spec.ts \
  tests/browser/rigEditor.spec.ts \
  tests/browser/animationRigTweak.spec.ts \
  tests/browser/artworkReplacement.spec.ts \
  tests/browser/animationProductionWorkflow.spec.ts \
  tests/browser/animationIKBaking.spec.ts \
  tests/browser/characterSelection.spec.ts \
  tests/browser/animationMirroring.spec.ts \
  --trace off --max-failures=3
```

An earlier trace-enabled run overlapped the unit suite and hit the existing arm-bake scenario's 60-second total limit during its final page reload. The final run disabled trace recording; assertions and test timeouts were unchanged, and both development and production arm-bake scenarios passed. Browser checks remain local-only; no CI browser steps or scheduled dependency audits were added.

## 13. Deferred features

Scene choreography, physics, ragdolls, mesh deformation, automatic artwork generation, automatic rigging, advanced retargeting and a general image editor remain deferred. Atlas packing, arbitrary ZIP ingestion, binary draft persistence, source-repository overwrites and importing ZIPs as editable sessions are outside this phase's implementation. The existing file formats and runtime playback remain the production boundary.
