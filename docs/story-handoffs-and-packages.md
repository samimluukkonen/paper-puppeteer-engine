# Scene handoffs and portable stories

[All guides](../README.md#guides) · [Story Editor](story-editor.md) · [Standalone player](standalone-story-player.md)

Version 1.6.5 adds entry transitions, current/next-scene preparation and portable story ZIPs. In **Project Workspace → Story Sequence**, select **Entry transition** on each entry. **Direct cut** is the default. **Fade through color** exposes a total duration in milliseconds and a six-digit color. These are arrival settings: moving or duplicating an entry preserves them. Changes use Project Undo/Redo; the source scene's own fades stay on its timeline.

**Preview Entire Story** uses the same package loader as a standalone consumer. **Download story package** exports the selected story and its referenced scenes, materialized characters/rigs, animation/mesh data, artwork and audio. Dialogue, camera keys, scene fades and entry transitions remain authored JSON. The download does not mark the whole project saved. Use **Export Project / Import Project** for editable workspace backups, including every story and source scene.

## Lifecycle and loading

`StoryPlayer` owns one active runner. While it plays, the optional `prepareScene` adapter prepares only the next entry. Preparation resolves/validates packages and loads character/background textures and audio samples; it creates no Actors, dialogue overlays or playing voices. The package is validated before playback, with image decoding and audio codec checks deferred to current/next preparation. A distant scene uses no GPU textures or decoded audio until it enters that window.

When the current runner completes, final dialogue holds must already have been advanced. A fade spends half its total duration covering the outgoing scene. At full opacity the player waits for preparation, releases the outgoing runner's Actors, movement controllers, cues, presentation and resource leases, then activates the incoming scene. The other half reveals its initial state. The incoming runner starts after the reveal, at time zero, so an opening dialogue hold is never consumed by loading or transition time. On the first entry, a fade uses only its reveal half. Excess frame time at every boundary is discarded.

The story owns a separate overlay above scene fades and subtitles. It follows the host's actual camera viewport. A cut swaps immediately when ready; if activation needs asynchronous work, the same overlay covers it in black and the viewer displays **Loading story scene...**. The previous completed scene's resource leases remain alive until next-scene preparation retains shared assets. No scene clock runs during loading or entry fades.

Character aliases and background textures use reference-counted leases. Shared assets survive adjacent handoffs; the last prepared/runtime consumer releases them. Every occurrence gets fresh Actors and a fresh runner. Source definitions remain immutable. Stop cancels active/pending work, releases scene leases and permits restart; source disposal also releases the archive caches, overlay, audio context and listeners. A loader finishing after cancellation is disposed without playing.

## Audio ownership

All effects, music, ambience and dialogue-hold loops are scene-owned and stop when their scene completes or is disposed. Entry fades add no implicit audio crossfade. The next scene's music starts at its authored time after the reveal. Continuous cross-scene music is not supported in this release.

The portable loader shares one audio context and content decoder through independent scene leases. Preloading decodes without resuming the context or starting voices. Unlock once from **Enable story audio** or a deliberate viewer gesture; later scenes reuse that context's permission. If the browser suspends it again, enable audio again. Equal samples share decoded data while current/next scenes retain them, and the final lease releases the samples. A track never inherits a previous scene's voice. Custom `loadScene` adapters still own their own audio policy and must not share an exclusively owned backend directly.

## Standalone consumer

The runtime has no React/editor imports. Mount in an active host-owned Phaser scene with a focusable container:

```ts
import { StandaloneStoryPlayer, StoryPackageLoader } from 'paper-puppeteer-engine/runtime';

const viewer = new StandaloneStoryPlayer(scene, host, {
  loadStory: (_id, signal) => StoryPackageLoader.load(scene, '/films/opening.story.zip', { signal }),
});
await viewer.load('opening');
await viewer.play();
host.focus();
// Enter advances one waiting line. An application button can call:
viewer.advanceDialogue();
// On removal (scene shutdown also disposes the viewer):
viewer.dispose();
```

`StoryPackageLoader.load` accepts a ZIP URL, ZIP bytes or a file map. It returns a `StandaloneStorySource`. The viewer owns and disposes that source after its sessions. Lower-level consumers may construct `new StoryPlayer(source.definition, source)`, apply each `LoadedScene` camera through their adapter and tick the player once per frame; they must dispose the player **before** `source.dispose()`.

`buildStoryPackage(story, { scenes, buildScene })` is available from `/core` and `/serialization`. Its callback returns existing scene-package files, so hosted consumers can use `buildScenePackage`. `validateStoryPackage(files)` imports and validates a story archive without a renderer. `storyScenePackage(imported, sceneId)` exposes an individual compatible scene file map. Editor export uses the project dependency inspector and character/scene packagers.

## Format and validation

`story.json` contains archive version 1, the version-1 `StoryDefinition`, scene ID/path registrations and a logical-to-physical binary alias table. Distinct referenced scenes are stored once; repeated entries remain references. Equal character packages share one folder. Identical artwork/audio bytes occupy one physical asset, including artwork reused by different characters. Aliases resolve only inside the archive; there is no network fallback.

The existing stored ZIP format, CRC checks, path rules and limits remain: 256 files, 10 MiB per file and 100 MiB total. Expanded aliases are bounded too, so a highly aliased package may hit the conservative expanded limit before its physical ZIP reaches 100 MiB. Split a larger film into smaller story packages.

Import rejects missing/mismatched scenes, missing characters/animations/mesh textures/audio, invalid fades, unsupported formats, invalid paths and broken dependencies. Audio codec or image decode failures during preparation surface as playback errors before the new clock starts. Fix the reported source asset and export again. No shaders, branching, remote streaming, cross-scene physics or video encoding are introduced.
