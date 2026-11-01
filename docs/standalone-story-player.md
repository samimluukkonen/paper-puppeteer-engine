# Standalone linear story player

[All guides](../README.md#guides) · [Story authoring](story-editor.md) · [Runtime integration](runtime-integration.md)

`StandaloneStoryPlayer` plays an authored linear story in a host-owned Phaser scene. It uses the existing `StoryPlayer`, `SceneLoader`, Actors, skeletal/mesh animation, root motion, camera, fades, audio and camera-relative subtitles. It imports no React components. The viewer's only narrative command is dialogue advancement; there are no gameplay actions or route choices.

## Connect an application's story catalog

Create the player in an active Phaser scene, typically its `create()` method. Give it a focusable desktop container that contains the Phaser canvas. The container receives a small live advance hint and an **Enable story audio** button when needed. Style the host and its controls to match your application. The viewer never moves focus on load or play; the application chooses when to focus it.

```ts
import type Phaser from 'phaser';
import {
  SceneLoader,
  StandaloneStoryPlayer,
  type SceneDefinition,
  type StoryDefinition,
} from 'paper-puppeteer-engine/runtime';

// Resolve these from your application's project/catalog data.
declare const scene: Phaser.Scene;
declare const story: StoryDefinition;
declare const scenes: ReadonlyMap<string, SceneDefinition>;
declare const sceneUrls: ReadonlyMap<string, string>;
declare const host: HTMLElement; // Phaser's canvas is inside this element.
host.tabIndex = 0;
host.setAttribute('aria-label', 'Story player');

const viewer = new StandaloneStoryPlayer(scene, host, {
  loadStory: async (storyId, signal) => {
    signal.throwIfAborted();
    if (storyId !== story.id) throw new Error(`Unknown story: ${storyId}`);
    return {
      definition: story,
      scenes,
      loadScene: (definition, context) => {
        const baseUrl = sceneUrls.get(context.entry.sceneAssetId);
        if (!baseUrl) throw new Error('Missing scene URL');
        return SceneLoader.fromDefinition(scene, definition, {
          baseUrl,
          signal: context.signal,
        });
      },
    };
  },
});

await viewer.load(story.id);
await viewer.play();
host.focus();
```

`loadStory` is the application's asset-catalog boundary. It receives the requested ID and an abort signal, and returns the story, scene documents keyed by their asset IDs, and a scene-loading adapter. Forward both abort signals to your asynchronous I/O. Project Workspace remains an authoring application; importing its React components into a viewer is unnecessary. For portable scene ZIPs, the adapter can return `SceneLoader.loadPackage(scene, scenePackageUrl, { signal: context.signal })` instead. Keep the scene catalog consistent with those packages. Hosted character textures remain shared and host-owned; package textures and temporary URLs belong to each loaded session.

## Controller and lifecycle

| API                                              | Behavior                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(storyId): Promise<void>`                   | Stop/release the previous session, resolve and validate the selected story, and leave it stopped. No scene or audio starts yet.                   |
| `play(): Promise<void>`                          | Load/play the first scene, or restart after completion/Stop. Calling during playback is harmless. Await failures.                                 |
| `advanceDialogue(): AdvanceResult`               | Consume one current hold. Returns `{ advanced: false }` when no hold is waiting. Suitable for an application-supplied button or equivalent input. |
| `unlockAudio(): Promise<void>`                   | Unlock/decode current-scene audio. Call directly from a deliberate user gesture; this method never advances dialogue.                             |
| `stop(): void`                                   | Abort pending loads, dispose the current scene and retain the loaded story for replay. Stopping before a story resolves leaves the player empty.  |
| `dispose(): void`                                | Idempotently remove input, Phaser listeners, hint/button and all owned session resources.                                                         |
| `status`, `error`, `index`, `waitingForDialogue` | Inspect lifecycle, playback failure, zero-based scene position and input availability.                                                            |

Phaser's `update` event supplies frame deltas automatically. **Do not also call the underlying runner's update.** The host still owns game creation/destruction, resizing and shared assets. Scene shutdown or destruction disposes the viewer; dispose it explicitly when removing its container before shutdown. Construct a fresh viewer when mounting again.

Only one scene session exists at a time. A completed scene is disposed before the next is loaded; excess frame time is discarded. Completing a final dialogue hold allows transition on the next Phaser update. Holding Enter through that transition cannot advance the next scene's first line. Stop, replacement loads, errors and disposal invalidate pending work; late sessions are released even when an application loader ignores cancellation.

The default camera framing uses SceneLoader's output viewport. Supply `viewport` for a fixed custom output rectangle. Recreate the viewer with the updated viewport if the application's output geometry changes.

## Keyboard, focus and presentation

**Enter** advances exactly one waiting dialogue hold per deliberate press. It never starts playback, skips a scene, triggers cues or acts during ordinary timed playback. Repeat keydowns, consumed events, modifier combinations and IME composition are ignored. Focus must be within the configured host; text inputs, selects, textareas, content-editable regions, buttons, links and disclosure summaries retain their native keyboard behavior. Hidden/inert hosts are inactive. No window/document keyboard listeners are installed.

For an equivalent keyboard input, set `advanceKeys: [' ']` and `advanceLabel: 'Space'`. Values follow `KeyboardEvent.key`; Space is the literal space character. Set `advanceKeys: []` to disable keyboard advancement and supply an application control that calls `advanceDialogue()`. Set `advanceLabel` to the name of that control so the hint describes it. The public `DialogueKeyboardInput` adapter is also available for hosts using the lower-level `StoryPlayer` directly. Dispose a binding before replacing it; the editor's story preview uses this same adapter.

The live hint says **Press Enter to continue** only while waiting, and announces completion or playback failure. It is independent of the Phaser subtitle overlay. Speaker, Unicode/Japanese and multiline text retain the existing font, layout, wrapping and camera-relative position. Waiting text stays visible until advancement. No typewriter effect is added.

## Browser audio activation

Playback does not assume audio autoplay permission. Locked audio exposes **Enable story audio**. Clicking it calls the normal scene audio unlock API and returns focus to the viewer without advancing a line. While a dialogue hold is waiting, the first configured key press can also unlock audio. **That entire press belongs to audio activation; the current line remains visible.** Release and press again to advance after audio is ready. Enter before `play()` does nothing, so a host's initial start gesture cannot also consume the first line.

Audio activation applies to the current scene session. A later scene may require another activation because it owns another audio backend. Cinematic playback can continue silently before activation; unlock resumes eligible sound from the current scene/hold position. To guarantee that the opening is read/heard before the cinematic timeline proceeds, author an advance-required opening line. Hosts calling `unlockAudio()` directly must do so from the actual click/key handler, before awaiting unrelated work. Unsupported media/permission failures leave the enable control available to retry. Host-supplied `advanceDialogue()` remains independent from audio permission.

The existing [dialogue hold presentation](dialogue-hold-presentation.md) policy controls idle animation and hold-safe music/ambience. The standalone player adds no clocks or animation evaluators.

Local regressions include `tests/standaloneStoryPlayer.test.ts`, `tests/storyPlayer.test.ts`, `tests/browser/standaloneStoryPlayer.spec.ts` and `tests/browser/storySequence.spec.ts`. Browser tests exercise real Phaser rendering, native focus/typing and Web Audio in both development and production; they remain local-only.
