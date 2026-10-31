# Character packages in a standalone Phaser application

[All guides](../README.md#guides)

For direct playback, FIFO requests, named states, one-shot actions, safe async handling and disposal, see the [v0.7 runtime controller guide and readiness report](runtime-controller-readiness.md).

The optional [v0.8.1 Actor foundation](actors.md) wraps an existing Puppet with instance identity, position access, delegated playback/state/appearance calls and explicit borrowed or owned lifecycle management.

v0.6.4 verifies the existing editor export and runtime loading pipeline in a separate application. Follow the [artist workflow](artist-workflow.md) to prepare transparent pieces, align artwork and pivots, rig, animate, replace artwork and download the complete character ZIP. Extract the ZIP with a standard ZIP tool into your application's served assets. Production playback needs the runtime package and Phaser; React, timeline controllers, Rig Tweak and editor asset managers are unnecessary.

## Build and install

Use Node 24 or newer. From this repository, `npm run build` produces the authoring application and the library. `npm pack --pack-destination dist` also runs the prepack version check and library build, producing `dist/paper-puppeteer-engine-1.1.1.tgz`. Install that tarball into another project with `npm install /path/to/paper-puppeteer-engine-1.1.1.tgz phaser@4.2.1`.

The root and `/runtime` entries expose the same browser runtime. `/core` supports metadata loading, validation, animation evaluation and IK tooling without Phaser/browser globals; `/data` provides authored types; `/serialization` exposes versioned parsers/serializers. All entries include declarations and source maps. Phaser 4.2.1 is an external peer, Zod is a package dependency, and React remains a development dependency. `npm run test:package` verifies the tarball's exports, declarations, documentation links, editor isolation and browser bundling.

The former standalone examples project has been removed. Import the installed public runtime by package name in your own Phaser application; no source aliases are needed. The snippets below describe loading, playback and cleanup.

## Project and scene handoff

The [Project Workspace](project-workspace.md) owns project metadata and registration; retained character documents own rig/skins/artwork/clips, and `SceneEditorDocument` owns scene data. These authoring modules stay outside runtime entry points. Dependencies use stable character manifest references and animation/skin/Actor IDs; [project validation](project-asset-integrity.md) blocks broken production dependencies before export.

A complete project ZIP is an **editor archive** with `project.json`, character file mappings, shared binary artwork and scene JSON. Reopen it with **Import Project**. To play a project scene elsewhere, open that scene and choose **Download scene package**, then use the public runtime adapter:

```ts
import { SceneLoader } from 'paper-puppeteer-engine/runtime';

const loaded = await SceneLoader.loadPackage(phaserScene, sceneZipBytes, {
  onCue: (cue) => console.log(cue.name),
});
loaded.runner.play();
// In the host Phaser update, supply delta once: loaded.runner.update(delta).
// On leaving the scene: loaded.dispose();
```

`SceneLoader.load(scene, url)` loads scene JSON with hosted relative character dependencies. `SceneLoader.loadPackage` loads ZIP bytes, a package file map or a ZIP URL, creates Puppets/Actors, isolates texture keys and releases ZIP textures/URLs on disposal. Renderer-independent `CharacterLoader` loads metadata; `loadSceneCharacter` additionally decodes artwork for Phaser. `Puppet` plays clips and applies IK; `Actor` adds movement/facing and `Choreography` coordinates Actor operations. See [Actors](actors.md), [scene loading](scene-editor.md), [choreography](choreography-sequences.md) and the [format matrix](schema-compatibility.md).

Character, rig, skin, animation and project formats remain version **1**; scenes use **2**. ZIP support is the stored UTF-8 subset emitted by these exporters. The [v1.0.5 report](personal-production-readiness.md) records exact workflow/runtime verification and limits.

Scene background resolution uses the same aggregate artwork budget as the editor: 100 MiB encoded image bytes and 128 megapixels, with the existing per-image limits. Referenced encoded audio has a separate 100 MiB scene total and a 10 MiB per-file limit. Hosted audio is counted while streaming, and an overflow cancels the response before retaining it or requesting further assets. Host-provided audio caches follow the same total. The decoded-audio budget remains separate from these transfer limits.

Scene loading also enforces the [metadata and instance workload limits](scene-editor.md#visual-stage) before allocating Actors. JSON bytes and animation rows accumulate across character packages; mesh geometry, skinning influences and IK work count every instance. A custom `SceneAssetOptions.loadCharacter(url, reference, loadOptions)` that fetches metadata should forward `loadOptions` to `CharacterLoader.load` to preserve streaming guards and cancellation. Already cached immutable definitions receive retained metadata and instance checks, and their workload reserves scene capacity before later streamed loads.

## Exported package layout and validation

```text
character.json                 version, id, defaultSkin, relative resource paths
rig.json                       bones, IK, slots, attachments, optional embedded skins
skins/*.json                   standalone skin maps
animations/*.json              bone keys, events, IK channels, baked IK suppression
poses/*.json                   optional static authored poses
images/*.{png,webp}             exact sprite binaries, including replacement artwork
```

This layout illustrates a character export; existing manifest directories, filenames and identifiers are retained. `character.json` is the root and every resource path is relative to it, even when a rig or skin is nested elsewhere. The manifest maps texture keys to image files, and rig sprites/attachments refer to those keys. Attachments are definitions within the rig, rather than separate documents. Baked IK uses ordinary bone keys and the existing clip-local suppression field. Authored format versions remain `1`; the package version in `package.json` is independent of file format versions.

Before download/import, the existing exporter checks complete file presence, metadata references, supported versions, rig/animation/skin compatibility and image headers/budgets. Browser export also decodes every distinct image, verifies decoded dimensions and releases its temporary decode URLs. Node validation checks headers/metadata without claiming full image decoding. Missing or incompatible data fails the export before success/checkpoints. Static PNG/WebP packages support only the whole-image frame (`undefined` or `__BASE`); resolve atlas/spritesheet frames to separate static images before exporting.

Paths use plain relative names. Validation rejects absolute paths/URLs, traversal, backslashes, percent escapes, queries, fragments, control characters, empty/dot segments, ambiguous trailing dots/spaces, case-insensitive duplicates and file/directory collisions. It rejects missing binaries and metadata/image collisions. Shared texture aliases include, budget and decode one physical image once. ZIP encoding and pre-preview validation apply the same file-count, per-file and aggregate limits. Runtime blob URLs/private texture keys, Phaser objects and React state are absent from exported data; temporary preview URLs belong to disposable preview leases.

## Scene lifecycle and playback

Use the public runtime inside a Phaser scene:

```ts
import { loadSceneCharacter, Puppet } from 'paper-puppeteer-engine/runtime';
import Phaser from 'phaser';
```

Inside its scene's asynchronous initialization:

```ts
const url = new URL('character/character.json', document.baseURI).href;
const definition = await loadSceneCharacter(this, url, { allowWebp: true });
if (!definition) return; // Shutdown while fetching metadata or decoding images.
const puppet = new Puppet(this, { definition, x: 380, y: 380 });
const unsubscribe = puppet.onAnimationEvent((event) => {
  eventLog.textContent = `${event.clip}: ${event.name} ${JSON.stringify(event.data ?? null)}`;
});
puppet.play('idle');
```

`eventLog` is the example's HTML event display. `loadSceneCharacter` first uses `CharacterLoader` for the manifest and all JSON, then queues and decodes missing textures with the existing scene loader, then returns the immutable definition. Scene shutdown cancels metadata/artwork work and resolves with `undefined`; other failures reject and the consumer displays them. Wait for this promise before constructing the puppet. PNG is accepted by default; `allowWebp: true` enables static WebP packages with header/dimension limits. `CharacterLoader.load` alone loads metadata, so a host using it directly must finish texture loading before constructing a puppet.

Buttons call `puppet.play(clip, { fadeDuration: 150 })` with the actual loaded clip name, so idle can switch to walk, sword, reach or baked. The sample sword clip emits `weapon-ready`; walk emits footstep payloads and reach/baked emit `reach-marker`. Event listeners receive `clip`, `layer`, `name`, `time` and optional `data`. Scrubbing/sampling does not deliver playback crossing events.

The sample's skin button calls `puppet.setSkin(definition.defaultSkin).applySkin(skins[skinIndex]!)` from the loaded skin list. Resetting to the default before each overlay matches the editor's sparse-skin preview and prevents previous overrides from accumulating. `setSkin` replaces the full selection, making omitted slots empty; `applySkin` overlays a partial skin, and explicit `null` assignments still clear a slot. Use `setAttachment(slotId, attachmentId)` or `clearAttachment(slotId)` for individual mounts. IDs must exist in the rig. These calls retain animation clocks, joints and IK state; the integration test also verifies individual head attachment changes and replacement texture selection.

Puppets update automatically from Phaser scene `UPDATE` by default and apply animation/IK/render synchronization. Do not also advance them manually in a scene update. A host with its own clock may construct with `autoUpdate: false` and call `puppet.update(deltaMilliseconds)`. Times and durations are milliseconds. Bone positions are local pixels relative to parents, rotations are radians (positive clockwise with downward Y), sprite origins are normalized and the outer puppet position is in scene coordinates. Facing mirrors the puppet root; camera transforms stay host-owned.

For static puppets, opt into `idleSync: 'dirty'` at construction. When animation evaluation reports no work (including paused, stopped and completed playback), unchanged puppets skip bone transforms, render projection, IK, meshes and debug refreshes. Animation evaluation and `onUpdate` callbacks continue normally. The default `idleSync: 'always'` preserves automatic synchronization of directly mutable poses on every update.

In dirty mode, call `puppet.markPoseDirty()` after directly editing bone poses, constraint properties or the puppet/ancestor transforms; multiple invalidations coalesce into one synchronization on the next update. Call `syncPose()` instead for immediate projection. `preparePose()` also invalidates before manual editing, and Puppet setters such as `setIKTarget()` invalidate deferred work. Setters that already synchronize immediately retain that behavior. `syncIK()` retains any pending full pose synchronization.

```ts
const puppet = new Puppet(this, { definition, idleSync: 'dirty' });
puppet.preparePose();
puppet.getBone('root').pose.rotation = 0.2;
puppet.markPoseDirty(); // Project on the next scene update; syncPose() projects immediately.
```

IK target providers continue to run on idle updates, including providers currently returning `undefined`. External IK animation and mesh deformation sources also keep synchronization active because their values may change independently. After changing a constraint directly (for example `puppet.getIK('arm').enabled = false`), invalidate or synchronize explicitly. Debug overlays follow the same contract; use `refreshDebugViews()` when only their host presentation changes.

## Resource ownership and cleanup

The scene owns each puppet, which subscribes to scene update and shutdown. The host's Phaser texture manager owns loaded textures and may share them across puppets/scenes. Destroying a puppet releases its render objects, animation subscriptions, IK constraints and providers; it retains shared textures. Character definitions/compiled clips are immutable and can be reused with independent puppet clocks. Different characters using the same texture key must refer to the same artwork or use unique keys; loading conflicting URLs under a live key fails.

The consumer registers this cleanup after loading:

```ts
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  listeners.abort();
  unsubscribe();
  puppet.destroy();
  for (const button of [...clipButtons, skinButton]) button.disabled = true;
  // This example owns the entire game. Game destruction below releases its texture manager.
  status.textContent = 'Disposed';
});
```

`listeners` is an `AbortController` for DOM button handlers. Its **Clean up** action calls `game.scene.stop('character')` before `game.destroy(true)`, so pending loads cancel, the puppet and listeners dispose, and the exclusive game releases textures/canvas. `pagehide` uses the same idempotent cleanup. In a shared game, remove specific character textures only after all users release them; do not destroy another scene's textures. Unsubscribe callbacks are safe to call before puppet destruction. See [runtime API ownership](runtime-api.md) for full contracts.

## Verification and remaining release work

The representative editor fixture has several bone tracks, an edited idle key, event payloads, authored IK, baked IK, three skins, multiple attachments and replacement head artwork. Integration tests export it, encode/decode the ZIP, load it under another application's nested URL, create a public-runtime Puppet, compare authored/loaded bone poses and events during playback, swap appearances and verify explicit/scene-shutdown disposal. The standalone Node test uses installed `/core` declarations/runtime and checks all image files. Its build compiles the actual browser application against installed `/runtime`; optional local browser tests play all example clips, receive events, switch skin, destroy the game and cancel a pending load under `/consumer/`.

Browser tests remain local-only. See [development checks](development.md#checks-and-profiling) and the example README for commands. A human artwork/alignment review, broader browser/device review and publication/legal metadata decisions remain release follow-up work for v0.6.5; no new animation or game systems are required by this integration milestone.

See the [integration verification report](character-runtime-integration-verification.md) for the package audit, changed files, exact command results and unverified manual behavior.
