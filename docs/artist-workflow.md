# Artist workflow and production character packages

[All guides](../README.md#guides)

Milestone v0.5.8.6 is packaged as `0.5.8-6`. Both editors offer **Character package** above the command bar. This combines current authored data with applied artwork into a downloadable ZIP, validates the result, and provides an isolated production runtime preview.

## Preparing artwork

Export separate transparent body parts as static PNG or WebP. Keep padding deliberate, use descriptive filenames, and plan each pivot around the joint where that piece rotates. Consistent image dimensions simplify replacement; different dimensions are supported through explicit pivot policies. Limits are 10 MiB, 8192 pixels per side and 16 megapixels per image; a character may contain at most 50 MiB and 64 megapixels of images.

Keep `character.json`, the rig, skins, animations, optional poses and images in one character folder. Paths are relative to `character.json`. Nested folders are supported. Use plain paths without absolute URLs, parent traversal, backslashes, percent escapes, queries, fragments or ambiguous trailing dots/spaces. Paths must also be distinct ignoring case for portable extraction. Texture keys identify image resources; bone, slot, attachment and skin identifiers identify authored objects. Keep these identifiers stable when changing filenames.

Start from an existing character or create the initial version-1 rig/manifest following [character loading](characters.md). The Rig Editor adjusts an existing bone hierarchy; initial artwork files and the initial rig/manifest need manual placement in a served character directory. The editors do not create an arbitrary skeleton from empty artwork or write repository files.

## Rig and attachment authoring

Use [Rig Editor](rig-editor.md) to select joints and adjust their placement relative to parents. Moving a joint changes the hierarchy's bind geometry. **Artwork Offset Editing** and **Sprite Origin Editing** align artwork independently of joint placement; **Slot Transform Editing** aligns attachment mounts. Inspect bone parentage in the hierarchy. Numeric fields and canvas drags use rig Undo/Redo. See [artwork alignment](visual-artwork-alignment.md) for exact pixel pivots and offsets.

In [slots, attachments and skins](visual-attachment-skins.md), create attachment entries from available textures, assign them to slots, and create or edit skins. Slots name stable mounts on bones; attachments name stable artwork entries. Skin overrides can inherit, select an attachment or explicitly clear a slot. Standalone manifest skins keep their runtime precedence over embedded rig skins. Package export includes both embedded skins and current standalone skin files.

**Download rig.json** remains useful for transferring the rig between editors. Save that download and place it at the manifest's rig path yourself. Standalone skin downloads require the same manual placement. A rig download does not include replacement images.

## Animation authoring and sprite replacement

Open the Animation Editor for the character. Choose a clip, select a bone/property, place the playhead and commit keys. Timeline navigation, interpolation, playback mode/FPS, events and key operations are documented in [animation authoring](animation-editor.md). [IK authoring](ik-animation-authoring.md) supplies target/mix keys; [IK baking](ik-bake-commit.md) converts authored IK to ordinary bone rotations with clip-local suppression. [Onion skinning](onion-skin-controls.md) previews neighboring runtime poses. [Mirroring](mirrored-keyframe-authoring.md) operates on authored pose/key data.

To replace a forearm, choose its artwork asset and explicitly select shared or individual scope. Import the image, compare dimensions, select normalized/pixel/manual alignment, Preview, then Apply. See [sprite replacement](sprite-replacement.md). Preserve the attachment ID so every skin and slot continues to refer to the same logical piece. With a differently sized image, inspect the pivot and adjust artwork origins/offsets as needed. Existing animation keys are unchanged.

Switch to [Rig Tweak](animation-rig-tweak.md) at a paused animation pose to correct the elbow joint. Rig history and animation history stay separate. Return to Animation mode and scrub or play the existing keys. Artwork history is a third, independent session history. Download a complete package from this editor to combine the rig tweak, current clip, other session clips, skins and replacement binaries.

Edits and binary replacements do not automatically travel between the Rig Editor and Animation Editor. Export/save the Rig Editor's files and place them in the served character folder before opening the Animation Editor, or make replacement/alignment/rig tweaks directly in the Animation Editor for a single-session final export. ZIP import currently opens a runtime verification preview; it does not replace either editor's authored session.

## Exporting and verifying a package

1. Finish focused numeric fields and gestures. Apply or cancel every artwork proposal; proposals are never silently exported.
2. Expand **Character package** and choose **Download character ZIP**. Export captures committed authored data and applied artwork once, before asynchronous asset reads. It includes the manifest, rig, embedded/standalone skins, animations, optional poses and every manifest image, including inactive attachment artwork. Attachments remain in the rig as required by the existing format.
3. Resolve reported issues and retry. Metadata uses existing runtime validation: missing rigs/skins/clips, duplicate IDs/names, unknown bones/attachments/textures, unsupported versions and invalid JSON fail. Package checks reject unsafe/colliding paths, missing/invalid image headers and atlas/frame references other than the static whole-image `__BASE` frame. Export failure leaves working data and checkpoints intact.
4. Save the ZIP in your chosen location. Browsers can initiate a download but cannot confirm that you retained it on disk. No repository file was overwritten.
5. Choose **Reload exported package** to decode the exact exported ZIP snapshot into an isolated runtime preview. Choose animation, skin and facing. This uses the existing `CharacterLoader`, texture-loading pipeline and `Puppet` playback, including authored IK and baked animation data. Preview errors are shown inside the dialog; close it to return to your unchanged editor session.
6. Reopen a saved editor ZIP using **Import ZIP for runtime preview**. This validates it before opening the preview. Invalid/interrupted imports retain the existing authored editor session. The importer accepts the UTF-8 stored ZIP subset emitted by this editor; re-compressed, encrypted, ZIP64 and general third-party archives are unsupported. Standard ZIP tools can extract exported archives.
7. Extract the ZIP into a character directory in your application's public/served assets, then load its `character.json`. This file placement and any source-control commit are manual. Paths inside the ZIP start at `character.json`; the downloaded filename supplies the character name.

Existing relative metadata/image paths are retained when possible. A shared replacement keeps its texture key and image path when the extension matches and no other texture key uses that path. Replacing an aliased source image or switching PNG/WebP generates a distinct matching image path. Individual overrides get distinct deterministic texture keys/image paths while bone/attachment/slot/skin identities remain unchanged. Generated clip, skin and image filenames receive numeric suffixes when they collide after sanitization or case folding. Conflicts between existing manifest paths still block export. Pixel-preserving pivots serialize into ordinary normalized origins; pivots outside 0..1 use an equivalent artwork offset, including attachment rotation/scale, to preserve rendering without extending the format.

```ts
import { CharacterLoader, Puppet, queueCharacterTextures } from 'paper-puppeteer-engine';

const definition = await CharacterLoader.load('/characters/my-puppet/character.json');
// In your Phaser scene, queue artwork before creating the puppet:
const release = queueCharacterTextures(scene, definition, { allowWebp: true });
scene.load.once('complete', () => {
  release();
  const puppet = new Puppet(scene, { definition, x: 400, y: 500 });
  puppet.play(definition.animations[0]!.name);
});
scene.load.start();
```

Use `allowWebp: true` when the package contains static WebP. PNG and WebP dimensions are checked before decoding; animated WebP and other formats remain rejected. Runtime texture-key uniqueness across characters remains the host application's responsibility. Scene hosts should follow the cancelable loading pattern in the development guide for shutdown/error handling. Runtime facing is a host option; the package retains authored transforms and animation/mirroring results, not editor-only facing, camera, onion, mirror or IK preview settings. Add preview-only IK chains to the authored rig if production clips need them.

## Checkpoints and losing a session

The package panel reports **Rig**, **Animations**, **Assets** and **Skins** independently. Initial clean values mean “matches loaded source.” A successful ZIP download initiation records a package checkpoint for exactly the captured authored data and blobs. Edits made during the download stay modified. Undoing back to that checkpoint becomes clean; a failed download does not establish one. A file-only rig/skin/animation download never establishes a complete-package checkpoint. Individual JSON checkpoints retain their existing navigation behavior; the package status can still show Modified after all edited JSON files have been individually exported.

Package checkpoints do not change per-document Undo/Redo, source definitions or the original artwork. Individual editor dirty labels continue to use their own saved/exported baselines. Consequently an editor can still warn on navigation after downloading a package: session-only artwork/history and document edits would be lost, and download completion cannot prove source files were updated. Save the ZIP before accepting that warning.

Character changes, editor-route navigation, browser refresh and closing use the browser's existing unsaved-session protection where supported. Pending image decode/proposals are protected too. Rig import/reload checks pending artwork before canceling proposals; compatible rig reloads retain applied artwork. JSON drafts can recover compatible rig/animation edits, but binary artwork/history remains session-only. ZIP preview/import does not discard authoring, so it needs no discard confirmation.

## Architecture and verification

`CharacterDefinition.manifest` retains an immutable original manifest alongside `rigFile`, standalone skins and animation paths. `ArtworkController.exportReplacements()` exposes applied immutable blobs and logical scopes without temporary Phaser keys/URLs. `AnimationEditorDocument.packageAnimations()` supplies the active authored clip and other committed session clips without changing selection/history.

`buildCharacterPackage()` snapshots inputs, assembles detached version-1 JSON and images, and runs `CharacterLoader` over an isolated in-memory file map. ZIP encoding is dependency-free and uses stored entries because PNG/WebP are already compressed. Editor downloads and ZIP imports run encoding, decoding and table-based CRC32 checks in a dedicated module worker. The worker transfers completed buffers back to the editor; caller inputs retain their ownership. A 60-second deadline bounds package operations, and session replacement or teardown terminates pending workers so late results cannot install checkpoints or previews. Bounded file counts/sizes, path checks and strict local/central directory agreement guard import. Preview object URLs are generated only after package validation, belong to a disposable runtime lease, and never enter exported metadata. Each preview owns a separate Phaser game; shutdown releases puppets and texture loading before URL revocation. Controller teardown cancels pending requests and releases subscriptions. Existing rig handles, IK gizmos and ghost/overlay lifetimes are retained.

The [production verification report](production-asset-verification.md) records changed APIs, regression scope and exact command results. Automated coverage is in `tests/characterPackage.test.ts`, the existing sprite/rig/animation/runtime suites and local `tests/browser/characterPackage.spec.ts`. It covers full-file/binary round trips, source immutability, shared/individual replacement precedence, normalized/pixel origins, paths, bad JSON/versions/IDs/images/ZIPs, snapshot races, checkpoints, cancellation, URL disposal, unchanged poses and runtime playback with IK/baked data and both facings. Local browser scenarios exercise artwork import, elbow correction, ZIP download/import, animation/skin/facing playback and repeated preview teardown in both editors against development and production builds. Browser checks remain local-only.

For a representative human manual workflow, follow the preparation, rig, animation and export sections in order: import transparent parts; assign slots; adjust the existing hierarchy/joints; align origins/offsets; export/place the rig; open Animation Editor; author bone and IK keys; enable onion skinning; replace/align a forearm; tweak the elbow; return to Animation mode and verify earlier keys; download the package; reload/import it; play its clips through the runtime preview; extract it and load it in the host application. Include Undo/Redo, all skins, facing, crossfades/layers in the host, and repeated character/editor changes. This is a documented manual checklist, not a claim that a human manual pass was performed.

Scene choreography, physics, ragdolls, mesh deformation, automatic artwork generation/rigging, advanced retargeting and a general image editor remain deferred.
