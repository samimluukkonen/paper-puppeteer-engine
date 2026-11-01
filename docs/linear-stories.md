# Linear stories

Version 1.6.1 adds an authored story format and a sequencing service for complete linear films. A story references existing project scenes in array order. There is no Story Editor in this milestone; use the TypeScript APIs or project metadata to define the sequence.

```ts
import type { StoryDefinition } from 'paper-puppeteer-engine/data';

const story: StoryDefinition = {
  version: 1,
  id: 'mukashi-monogatari',
  name: 'Mukashi Monogatari',
  description: 'Opening chapter',
  scenes: [
    { id: 'opening', sceneAssetId: 'village' },
    { id: 'encounter', sceneAssetId: 'forest' },
    { id: 'return', sceneAssetId: 'village' },
  ],
};
```

`sceneAssetId` is the stable ID in the project's scene registry. It is neither the scene's file path nor its display name. `id` on an entry identifies that occurrence within the story. Reusing `village` above creates two independent runtime sessions. Stories contain no embedded scene definitions or live playback state. Array position is the only ordering field; sparse arrays, extra order fields and transition metadata are rejected. Existing scene-authored fade-in/fade-out transitions continue to run on each scene's clock. There is no crossfade or transition clock between entries.

`storyDefinitionSchema`, `storySceneEntrySchema`, `validateStoryDefinition`, `parseStoryDefinition`, `parseStoryJson`, and `serializeStoryDefinition` are exported from `/core` and `/serialization`. The types are also available from `/data`. Standalone files use format version 1; `schemas/story.schema.json` describes their shape.

## Validate and save a sequence

```ts
import { parseStoryDefinition, validateStoryDefinition } from 'paper-puppeteer-engine/core';

// Map keys must match the scene documents' IDs.
const sceneAssets = new Map([
  ['village', villageScene],
  ['forest', forestScene],
]);
const issues = validateStoryDefinition(story, {
  scenes: sceneAssets,
  requirePlayable: true,
  // Supply authoritative character/image/audio catalogs through sceneOptions
  // when validating dependencies before loading.
});
const authoredStory = parseStoryDefinition(story, { scenes: sceneAssets });
```

Validation checks stable identities, unique entry IDs, supported fields and format, scene existence, document/asset ID agreement, and existing scene validation rules. IDs are compared without case for uniqueness; scene lookups use exact registered IDs. An empty story produces a warning and can be parsed, saved, exported and recovered. `requirePlayable: true` makes emptiness an error. Standalone validation without a scene catalog checks the authored story only; the scene loader still validates actual resources before constructing runtime objects.

In the repository's Project Workspace API, call `workspace.setStory(authoredStory)` to add or replace by exact story ID and `workspace.removeStory(id)` to remove it. Both share project Undo/Redo, dirty tracking, autosave revisions and notifications. References must point at registered scenes. A scene used by a story cannot be removed until its story entries are removed or replaced. Project inspection adds project → story → scene dependency edges and reports broken transitive dependencies on the story as well as their original assets.

Stories are stored in the optional `stories` array of the existing version-1 project metadata. Older projects need no migration and retain their original shape. Project ZIP exports, browser drafts, recovery and reopening preserve the array without copying scene documents. Standalone scene ZIPs remain scene-only. Runtime instances, clocks, AbortSignals and resource caches are never serialized. A project with an empty story can be exported as a draft; that story cannot start playback.

## Play through existing scene sessions

`StoryPlayer` is exported from `/core` and the root/runtime entry points. It depends on no React or Phaser runtime. Its `loadScene` adapter returns a session with an existing runner and `dispose()`; `SceneLoader.fromDefinition` already returns this shape. The small `ScenePlayback` interface and `SceneRunnerStatus` type are exported from `/core` without importing renderer declarations.

```ts
import { SceneLoader, StoryPlayer } from 'paper-puppeteer-engine';

const player = new StoryPlayer(authoredStory, {
  scenes: sceneAssets,
  loadScene: async (definition, context) => {
    const loaded = await SceneLoader.fromDefinition(phaserScene, definition, {
      // Resolve relative resource references against this entry's scene.json URL.
      baseUrl: sceneUrls.get(context.entry.sceneAssetId)!,
      signal: context.signal,
      // An optional host loadCharacter cache can share immutable definitions.
    });
    loaded.applyCamera(phaserScene.cameras.main);
    return loaded;
  },
});

await player.start();
// In the host's update callback, deliver each frame once:
void player.update(deltaMilliseconds).catch(reportPlaybackError);
// On explicit stop or teardown:
player.stop();
player.dispose();
```

The example assumes the host has loaded the authored scene documents and mapped their IDs to hosted URLs. Runtime loading uses those documents through the ordinary [scene runtime APIs](scene-editor.md) and [resource ownership contract](runtime-integration.md). Authoring project ZIPs are not hosted URL catalogs; extract/resolve their assets with a host adapter when playing from an archive.

`start()` resolves when the first scene is loaded and playing. `update(delta)` delegates milliseconds to the current runner. On natural completion it disposes that session, loads the next entry and starts it at time zero. It resolves after that handoff. Only one scene session is active at a time. Time during loading and excess delta at the previous scene's end are discarded, so no entry is skipped. The final scene is disposed on completion and status becomes `completed`; `currentEntry` and `currentSession` become undefined. `index` is zero-based while active and equals the entry count after completion.

`status` is `stopped`, `loading`, `playing`, `completed`, `failed` or `disposed`. `error` exposes loader/runtime failures, which also reject `start()` or `update()`. An interrupted/cancelled/paused scene fails sequencing instead of silently skipping to the next entry. Calling `start()` while loading/playing does nothing; after completion, failure or stop it starts from entry zero. No update promise needs to be held before delivering another frame: ticks during loading do nothing, and the service changes state before awaiting the next load.

`stop()` aborts loading, disposes the active session, clears the cursor and permits a fresh start. `dispose()` does the same permanently and is idempotent. A loader that finishes after cancellation has its returned session disposed without starting. Pending load commands resolve when that cancelled load settles; inspect `status` to distinguish cancellation from a successful start. Each context has its own `signal`, entry/index and unique `instanceId`. Session disposal must be idempotent, as it is for `SceneLoader` and `SceneRunner`, because abort listeners may also release the session. Connect the story's disposal to the host's teardown; the sequencer itself installs no global listeners. Do not update the session runner separately or seek it to completion: the story owns session playback.

## Shared resources

The player takes detached, frozen snapshots of the story and its referenced scene definitions at construction. Source edits and subsequent project reopening do not mutate an in-flight player; construct a new one to play newer authored data. Every entry loads fresh Actors, runner clocks, choreography, dialogue presentation, camera and audio control. No Actor or mutable playback state is shared between repeated references.

The host may cache complete immutable `CharacterDefinition` objects through `SceneAssetOptions.loadCharacter`, keyed by resolved manifest URL. Forward the provided load options to `CharacterLoader` on cache misses to retain scene resource guards. Hosted character textures remain owned by the host's Phaser texture manager and are not removed by ordinary scene session disposal. Keep texture keys consistent across shared characters; use the existing package loader's private aliases for isolated ZIP sessions. Scene artwork, ZIP URL leases, transition overlays and Actors keep the existing session disposal rules. The story never destroys the host's texture manager or clears a shared project asset registry.

Audio backends passed to `SceneLoader` are exclusively session-owned: create a backend per session, or use its default backend. Do not pass the same disposable backend to consecutive entries. Custom shared caches require host-owned lifetime management; this milestone adds no preload/cache manager. Unlock audio according to the existing [audio playback guide](scene-audio-playback.md) before expecting audible playback.

Scenes finish on their authored duration after any pending [Advance Required dialogue](scene-dialogue.md#runtime-advancement-and-clock-semantics) has been consumed. `StoryPlayer.advanceDialogue()` forwards one command to the current scene; updates while waiting retain the session and advance only optional [hold-local presentation](dialogue-hold-presentation.md); cinematic time stays frozen. An ending hold delays scene completion, then the next story update loads the next entry. A paused scene also retains its session. A visual Story Editor, advanced preloading, keyboard input, branching and choices remain outside this milestone.
