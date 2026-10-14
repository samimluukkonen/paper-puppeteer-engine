# Safe sprite replacement and hot reload

[All guides](../README.md#guides)

Milestone v0.5.8.5 uses package SemVer `0.5.8-5`. Both editors expose **Sprite replacement** in the inspector. Replacing artwork keeps logical attachment IDs, slots, bones, skin mappings, render order, facing, IK and animation keyframes intact. Imported filenames describe image resources; they never become attachment IDs.

## Artist workflow

1. Choose an **Artwork asset**. Its references list the current bones, attachments, slots and skins, including attachments created in this session.
2. Choose **Replacement scope** explicitly. **Replace shared artwork asset** changes every use of that asset. **Replace only attachment:…** changes that logical attachment across every slot and skin using it; other attachments keep their artwork. Bones also support individual replacement. Individual replacements take precedence over shared replacements. To give just one skin different artwork, create a distinct attachment with the existing attachment tools first.
3. Import a local static PNG or WebP. Decoding and preflight happen before changing the preview. The comparison retains the original image and shows replacement metadata. **Old size** describes the current artwork for the selected scope, including an earlier applied replacement; **New size** describes the proposal.
4. If dimensions differ, choose an **Alignment policy**. Preview is disabled until this choice is explicit. Same-size images default to normalized preservation.
5. Click **Preview Replacement**. Inspect the pivot on the animated character. Changing the policy restores the previous working artwork and requires another preview before Apply. **Cancel** restores the previous applied revision, including its pivot.
6. **Apply Replacement** keeps the revision in this editor session. **Undo Artwork** and **Redo Artwork** restore artwork snapshots independently of rig/animation history. **Revert to Original** removes the selected scope's override. For an individual override, this reveals any shared replacement underneath it; revert the shared scope as well to return entirely to the source artwork. Revert itself can be undone.

Applied assets survive animation selection and compatible rig reloads during this session. Pending artwork has its own status and navigation warning. Rig/animation dirty flags, Undo/Redo, draft recovery and JSON downloads still describe authored data. JSON exports neither embed binary assets nor mark artwork saved. Navigation, character changes and page reloads discard replacement data and artwork history. There is no binary draft recovery or persistence between editor pages.

## Dimensions and pivots

Phaser stores origins as normalized coordinates, separately from sprite offsets and bone positions. A texture-local pixel pivot is `originX × width, originY × height`. For an origin of `(0.25, 0.5)` on a `256 × 256` image:

| Policy                                 | Replacement `320 × 320` origin | Texture-local pivot                                           |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| Preserve normalized origin             | `(0.25, 0.5)`                  | `(80, 160)` pixels                                            |
| Preserve texture-local pivot in pixels | `(0.2, 0.4)`                   | `(64, 128)` pixels                                            |
| Manually realign afterward             | Starts at `(0.25, 0.5)`        | Starts at `(80, 160)` pixels; use alignment tools after Apply |

Normalized preservation keeps the current fractional origin. Pixel preservation keeps the current pixel pivot. These policies compose across repeated replacements, including a normalized replacement following a pixel-preserving replacement. Smaller images may put a preserved pivot outside the new image. Sprite offsets and scale remain unchanged, so a larger image appears larger at the same scale. Artwork content/padding changes can still require manual offset/origin alignment. No policy automatically retargets animations or moves bones.

Session origin multipliers project the authored normalized pivot onto the replacement. Rig refreshes, skin switching and alignment proposals use the same multipliers. Pixel inspector fields and pointer conversion account for them. Alignment edits remain ordinary authored rig edits; reverting artwork preserves those authored edits. Cancel/Undo/Revert restore the prior artwork policy without modifying animation keyframes.

## Replacement architecture and APIs

`ArtworkController` owns proposals, applied snapshots, imported binary resources and an independent `SnapshotHistory` with 20 undo operations. Stable scope keys contain the original asset key and an optional `bone:ID` or `attachment:ID`. `ArtworkPanel` subscribes through React's external store. The attachment panel uses the same resource previews, including individual attachment replacements.

`Puppet.getArtworkUsages()` inspects the current validated catalog, including inactive attachments and skin/slot references. `getArtworkReplacement(assetKey, reference?)` returns the effective shared or individual override. `validateArtworkReplacement()` preflights a host transaction. `setArtworkReplacement(assetKey, replacement?, reference?)` accepts an `ArtworkReplacement` with a loaded `textureKey` and positive finite `originScaleX/Y`. Omit the replacement to clear that scope. `setArtworkOrigin()` projects authored origins for editor alignment. The existing `setArtworkTexture(assetKey, replacementKey?)` remains the shared normalized-origin convenience API.

`ArtworkReference`, `ArtworkReplacement`, `ArtworkUsage` and `ArtworkAlignmentPolicy` are public types in the browser library entry point. The renderer never changes authored definitions. Individual keys include both the asset key and logical reference, so an attachment explicitly reassigned to another asset does not inherit an unrelated old override.

## Preflight, frames and failure handling

Imports validate filenames, MIME/header agreement, dimensions, static PNG/WebP contents and browser decoding. Limits remain 10 MiB per file, 8192 pixels per side and 16 megapixels per image. The 50 MiB/64-megapixel session budget now includes retained undo resources and the proposal. Decode timeout and cancellation still bound pending work.

Static images supply only the whole-image `__BASE` frame. Named and numeric atlas frames block shared replacement; a whole-image individual reference on the same asset can still be replaced. Select an existing whole-image reference or explicitly resolve the frame in the attachment editor. Atlas packing and atlas imports are deferred. The runtime API preserves original frame names and checks the replacement's catalog, including inactive attachments, before mutation. It never silently switches to the base or an unrelated frame.

A transaction registers private textures and validates all affected scopes before changing images. Renderer installation snapshots active texture/frame/origin values and rolls back failures. The controller refreshes all preview consumers before releasing displaced textures, and revalidates at Apply if the catalog changed after Preview. Decode, frame, texture registration, image installation and appearance synchronization failures keep the previous applied document and report an actionable error. If synchronization and its rollback both fail, resources remain retained for recovery rather than being destroyed under a consumer.

## Texture ownership and history

Each controller has a unique namespace and monotonic revision suffix. Repeated Preview reuses the registered texture; animation playback and skin switching never decode or reload it. The active puppet, hidden/visible onion pool, mirror overlay and baked-pose overlay refresh together through the existing scene callbacks.

Original textures remain host-owned. Cancel, superseding Apply, Revert, Undo and Redo release inactive controller textures only after consumers move away. Cleanup checks the exact registered texture object so a host taking over a temporary key keeps ownership. Undo data retains the Blob, object URL and decoded image; an undo/redo lazily recreates its private texture. Unreachable history branches and bounded-history eviction dispose images and revoke URLs. Teardown clears all resources. Rebinding restores the old puppet before it can retain a released texture.

## Verification

Unit coverage includes same/different dimensions, all policies, repeated revisions, policy re-preview, shared and individual scope precedence, multiple skins, stable slots/depth/facing, current catalogs, named/numeric frame rejection, commit-time frame validation, decode/registration/installation/refresh rollback, bounded independent history, resource ownership, late imports, hidden overlays and source immutability. Motion regressions compare every sampled joint during idle, walk, attack, IK, baked IK and mirrored playback, and verify that repeated playback does not register textures.

Local browser scenarios use real PNG/WebP decoding and Phaser rendering in both editors, against development and production builds. They compare shared/individual and normalized/pixel previews, exact Cancel and artwork Undo/Redo restoration, repeated replacement, skin switching, onion skinning, facing, IK playback, validation and independent dirty status. Browser checks remain local-only.

```bash
npm run typecheck
npm run test
npm run build
npm run check
npm run check:version
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/artworkReplacement.spec.ts
```

Completed verification for v0.5.8.5:

| Check                              | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| `npm run typecheck`                | Passed                                                      |
| `npm run test`                     | 2262 passed, 32 existing skips; 134 files passed, 3 skipped |
| `npm run build`                    | Demo, library, declarations and Node `/core` check passed   |
| `npm run check`                    | Formatting, lint and typecheck passed                       |
| `npm run check:version`            | `0.5.8-5` is valid SemVer                                   |
| Local Chrome artwork browser suite | All 6 development/production scenarios passed               |

The production individual-replacement screenshot was visually inspected. A human manual pass was not performed. The build retains the existing nonfatal `lucide-react` module-directive warnings. No CI browser steps were added.

For a human manual pass: load a character with several animations; replace the forearm with same-size artwork; play/scrub; replace it with different dimensions; inspect each pivot policy before Apply; switch skins; enable onion skinning and IK; revert both individual and shared scopes; undo/redo; replace again and inspect for cache artifacts. Automated checks are reported separately from human manual verification.

Deferred functionality: atlas import/packing, bulk replacement, binary persistence/package export, source-file overwrite, automatic sprite generation, image painting, animation retargeting, mesh deformation and scene choreography.
