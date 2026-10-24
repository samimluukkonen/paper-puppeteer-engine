# Creating Your First Cinematic Scene

[All guides](../README.md#guides) · [Scene Editor](scene-editor.md) · [Camera reference](cinematic-camera.md)

Start in Project Workspace. Create/open a project, register an existing character with **Add Existing Character** (or import its character ZIP), then use **+ New Scene** and open **Scene Editor**. This walkthrough uses a six-second scene; choose a longer duration if you need more room. Inspector sections begin collapsed.

1. **Import a background.** Open **Scene Artwork**, choose **+ Add Background** and import a PNG or static WebP. Use **Position X/Y**, scale and **Apply image transform** to place it. Image positions describe their centers in scene pixels. Add a mountains image and a foreground tree the same way. **+ Add Image From Project** reuses registered artwork.
2. **Arrange the layers.** Open **Scene Layers**. Add a Mountains layer and a Foreground layer, rename each with **Apply layer**, and assign artwork using its row’s **Layer** menu. Move Mountains behind Actors and Foreground in front. The hierarchy lists frontmost layers first. Visibility hides a layer; Lock protects artwork during editing. Whole Actors stay together in the Actors band.
3. **Set parallax.** Try 0.2 for Mountains, 1 for ordinary scenery and 1.2 for Foreground. Commit with **Apply layer**. A factor of 0 ignores camera scrolling; 1 follows the scene normally. Actors always use 1. **Preview camera X/Y** temporarily inspects scrolling outside audience preview; **Reset view** clears that inspection offset.
4. **Place two Actors.** Use **+ Add Actor** twice. Stop playback, select each Actor, and drag it or edit **Initial X/Y** in Actor properties and apply. Give them different positions. Add a **Move to position** action and a **Play animation** action on the same Actor at time 0; open Action properties to set their destinations, animation IDs and durations. Movement and animation have separate channels. Author character animation keys in Animation Editor.
5. **Frame the opening shot.** Open **Cinematic Camera**. Set Center X/Y and Camera zoom, then **Apply camera**, or select an Actor and use **Frame Selected Actor**. The blue rectangle is the audience frame: 1000 × 700, centered at the saved coordinates. **Preview Through Camera** displays audience framing; **Exit Camera Preview** restores your editor navigation.
6. **Animate a pan and zoom.** At Playhead 0, choose **Set Camera Key**. It captures X, Y and Zoom and enables **Camera Key Edit mode**. At 2 seconds, change Center X/Y and zoom, then **Apply camera key**. Select a Camera diamond and open **Selected camera key** to choose Linear, Stepped, Smooth or Bézier interpolation. A key’s curve controls its outgoing interval. Keep the preview offset at zero when judging composition.
7. **Make a cut.** At 3 seconds choose **Set Camera Cut**, then edit the new shot and **Apply camera key**. The preceding keys become Stepped: the old shot holds until exactly 3 seconds. Add a pan key before the cut if the shot should move first. Cut diamonds on the Transitions row help locate the boundary.
8. **Fade in and out.** At 0 seconds choose **Effect type → Fade in**, then **Add effect**. At 5 seconds choose Fade out and add another effect. New fades last up to one second. Select each clip, open **Transition properties**, and apply timing/type/color edits. Fade intervals cannot overlap. A finished fade holds its final opacity until another fade starts; leave a gap between fade-out and fade-in for a color hold.
9. **Preview and scrub.** Choose **Preview Through Camera**, then Play. Pause and seek backward/forward using **Playhead (s)** or the ruler. Check 2.999 seconds and exactly 3 seconds around the cut, and halfway through each fade. Returning to the same time reconstructs the same supported Actor pose, camera, parallax and fade without dispatching gameplay cues. Stop returns to authored placement. Undo/Redo restores authored changes; preview and navigation do not create edits.
10. **Save and hand off.** **Export Project** downloads the complete editable project, including artwork and character binaries. **Download scene package** produces a portable runtime ZIP containing the scene and its dependencies. **Download scene JSON** saves references and settings; keep its files resolvable. Local autosave is browser recovery, separate from downloaded files. After recovering a draft, export again to create a durable file.

The **editor viewport** is your working view: wheel zoom and middle/right/Alt-drag pan do not author camera keys or move Actors. The **Cinematic Camera** is the saved audience framing. **Reset view** restores editor navigation. **Reset Camera** is an authored, undoable framing change (or a key at the playhead in Key Edit mode). Editor grid, ground reference, selection handles, locks and disclosure states are excluded from exported scenes. Camera preview hides editor overlays initially.

Feature Guide → Scene offers **Adding Background Artwork**, **Managing Layers**, **Understanding Parallax**, **Framing a Scene**, **Editing Cinematic Camera**, **Camera Keyframes**, **Creating Camera Cuts**, **Adding Fade Transitions** and **Previewing a Scene**. Tours reveal actual controls and preserve authored data, selection, clock, preview mode and history. Exit a tour before trying its editing instructions.

For a standalone Phaser host, load the downloaded scene ZIP with the public API:

```ts
import { SceneLoader } from 'paper-puppeteer-engine';

// In an active Phaser Scene; retain the handle for cleanup.
const loaded = await SceneLoader.loadPackage(scene, 'opening.scene.zip');
loaded.applyCamera(scene.cameras.main, { x: 0, y: 0, width: 1000, height: 700 });
loaded.runner.play();
// In the host update: loaded.runner.update(deltaMilliseconds).
// After resize: call loaded.applyCamera(...) with the full available viewport.
// On teardown: loaded.dispose(); scene shutdown also disposes it.
```

Camera application is explicit. `applyCamera` opts into synchronized camera/parallax sampling and fits the fixed output aspect without stretching. Supply one runner update per host frame. See [runtime integration](runtime-integration.md) for ownership and [the v1.2 report](cinematic-scene-readiness.md) for verified scope and deferred features.

[Desktop authoring screenshot](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/docs/research/cinematic-scene/first-cinematic-scene.png): two separately placed Actors, sky/midground/foreground color fixtures, camera-key controls and shared action/camera timeline, sampled halfway through the opening fade. Captured from the local automated workflow.

## Pixel artwork

Editors currently use smooth filtering (`antialias: true`) and Phaser FIT scaling for mixed painted/cutout artwork. There is no saved pixel-art scene flag or editor filter toggle. Pixel-perfect final output is a host rendering choice; it does not change exported scene data.

For a pixel-art runtime, configure Phaser when creating the host game:

```ts
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1000,
  height: 700,
  render: { pixelArt: true, roundPixels: true, antialias: false, antialiasGL: false },
  scene: [MyScene],
});
```

The installed Phaser renderer supports nearest-neighbor filtering through `pixelArt`; camera `roundPixels` controls rounding too. For mixed art, keep smooth defaults and use `scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)` on selected host-owned textures. Never depend on private ZIP texture aliases. Use CSS `image-rendering: pixelated` when enlarging a canvas; size the displayed 1000 × 700 canvas to integer multiples where practical. FIT can produce fractional scaling in a smaller desktop window, and arbitrary camera zoom, fractional parallax, rotation and skeletal transforms can still shimmer or shift pixels. Rounding does not make those operations pixel-perfect. Choose integer camera zoom/placement for deliberate pixel shots; smooth art remains supported.

Automatic camera tracking, advanced shake, scene-to-scene transitions, dialogue, audio timelines, lighting/shaders and physics backgrounds are deferred. Cuts change framing inside one scene; fades cover one output frame.
