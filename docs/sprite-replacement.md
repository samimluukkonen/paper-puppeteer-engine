# Sprite import and replacement foundation

[All guides](../README.md#guides)

Milestone v0.5.8.1 uses package SemVer `0.5.8-1`. Both the Rig Editor and Animation Editor expose **Sprite replacement** in the inspector.

1. Open Sprite replacement and choose an artwork asset, such as `paper-left-forearm` in Demo puppet. The selector uses the existing manifest/Phaser texture key. References list associated bones, attachments, slots and skins.
2. Import a local static PNG or WebP. The comparison shows the original and replacement filenames and pixel dimensions. Importing alone does not change the canvas.
3. Click **Preview Replacement** to see the image on the existing puppet. Original transforms, origins, hierarchy, attachment assignments and animation keys remain intact. Different dimensions can change the artwork's apparent size; no origin migration occurs.
4. **Cancel** restores the artwork visible before this proposal, including an earlier applied replacement. Changing targets or importing another file cancels the current proposal.
5. **Apply Replacement** keeps the proposal as a pending asset change in this editor session. Preview is required before Apply. **Revert to Original** discards the selected asset's pending replacement and returns to its original cached texture.

Applied assets survive animation selection and rig JSON reloads within the current session. Pending artwork has its own status and navigation warning; animation/rig dirty flags, Undo/Redo, draft recovery and JSON downloads continue to describe authored data only. Exporting rig or animation JSON does not clear pending artwork changes. Navigating away, reloading the page or changing character discards replacements after the browser's unsaved-change warning. There is no binary draft recovery or persistence between editor pages.

## Working-copy and renderer APIs

`ArtworkController` owns the selected asset, one temporary proposal and a map of applied pending changes, indexed by original texture keys. Each resource holds an immutable metadata description, a binary Blob, one decoded HTML image, its object URL and (after preview) a private Phaser texture. No rig/animation/manifest JSON receives a Blob URL or temporary texture key.

`ArtworkPanel` is a shared React component subscribed to the controller. `RigEditorScene` and `AnimationEditorScene` bind its session to the current puppet and clear it before scene teardown. Rig reloads rebind applied artwork without changing the original character definition.

`Puppet.setArtworkTexture(assetKey, replacementKey?)` changes render-only artwork for bones and active slots that reference the original asset. Omit the replacement key to restore original texture/frame references. Future images created by skin/attachment switching inherit the override. The host owns temporary textures; it must restore or update every preview consumer before removing one. This foundation replaces the whole asset, so all references to a selected key share the preview. Per-attachment overrides and advanced propagation are deferred.

`AnimationEditorGhostLayer.refreshArtwork()` synchronizes retained hidden and visible onion skins before texture release. The animation scene also synchronizes existing mirror/bake overlays. Replacement textures use a per-controller namespace, a monotonic suffix and a cache collision check. Cleanup removes only the exact texture object created by this controller. Original cached textures are never removed. Cancel, superseding Apply, Revert and teardown revoke owned object URLs and release decoded images; repeated preview reuses the same decode and texture. Aborted or obsolete imports dispose late results instead of installing them.

## Validation and limits

Imports accept `.png` and `.webp` filenames with matching PNG/WebP contents and matching MIME type when provided. Validation rejects empty files, unsupported/mislabeled formats, unrecognized headers, nonpositive dimensions, animated WebP, corrupt/browser-unsupported decoding and mismatched decoded dimensions. PNG IHDR and WebP VP8X/VP8L/VP8 dimensions are checked before decoding. Browser decoding checks the actual image. Errors explain how to re-export or resize it.

Limits reuse `DEFAULT_CHARACTER_TEXTURE_LIMITS`: 10 MiB per file, 8192 pixels per side and 16 megapixels per image; the session's applied resources plus proposal are bounded to 50 MiB and 64 megapixels. A 15-second decode timeout and abort signal bound pending imports. No image-processing dependency was added. Transparency is preserved as supplied; opaque PNG/WebP is also valid. Atlas/frame targets explain their deferred status and cannot import replacements.

## Verification

Unit tests cover all static WebP header variants, PNG/WebP import metadata, unsupported/empty/corrupt/mislabeled images, byte/pixel bounds, decode failures and cancellation, preview/commit/cancel/revert, original and host texture ownership, concurrent texture namespaces, late imports, rig rebinding, shared bone/attachment references and unchanged rig/animation history/data. Local browser checks exercise real PNG/WebP decoding and Phaser rendering on the demo forearm in both editors, with canvas comparisons, cancel/apply/revert, invalid input and animation switching. These browser checks remain local-only.

```bash
npm run typecheck
npm run test
npm run build
npx playwright test tests/browser/artworkReplacement.spec.ts
```

Completed verification:

| Command                                                                                  | Result                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`                                                                      | Exit 0                                                                  |
| `npm run test`                                                                           | Exit 0; 2230 passed, 32 skipped; 131 files passed, 3 skipped            |
| `npm run build`                                                                          | Exit 0; demo, library, declarations and Node `/core` smoke check passed |
| `npm run check`                                                                          | Exit 0; formatting, lint and typecheck passed                           |
| `npm run check:version`                                                                  | Exit 0; `0.5.8-1` is valid SemVer                                       |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/artworkReplacement.spec.ts` | Exit 0; all 4 development/production checks passed in 34.4 seconds      |

The installed Chrome channel was used because the bundled Playwright Chromium executable was unavailable. The browser workflow verified forearm replacement, exact canvas restoration on Cancel, Apply/Revert, WebP preview, invalid PNG errors, independent dirty state, navigation protection and animation switching/playback. The replacement canvas screenshot was visually inspected. A human manual pass was not performed. The build retains the existing nonfatal `lucide-react` module-directive warnings. No CI browser steps were added.

For a manual check, follow steps 1–5 with your own forearm PNG, cancel once and confirm the original returns, import/apply again, switch animations, verify joints/hierarchy and playback, and try an invalid image. Automated browser verification is recorded separately from a human manual pass.

Deferred: dimension/origin migration, bulk replacement, full attachment/skin editing, Rig-Tweak mode, advanced propagation, production asset package export, file-system overwrite and scene choreography.
