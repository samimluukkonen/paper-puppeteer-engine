# Cinematic Camera

Open **Feature Guide → Scene → Cinematic Camera** for an eight-step tour of framing, numeric controls, Actor framing, audience preview, independent navigation and saving. It requires an open scene, works before adding Actors, and only reveals controls without editing the camera or switching preview modes.

Scene Editor has two independent cameras: free editor navigation (wheel zoom and middle/right/Alt-drag pan), and an authored audience frame. Open the initially collapsed **Cinematic Camera** inspector to edit the audience frame.

The optional scene-format-2 `camera` object stores `{ x, y, zoom }`. X/Y are the **frame center in scene pixels**, positive X right and positive Y down, matching Actors and artwork. They are never Phaser scroll offsets. Output is fixed at **1000 × 700 pixels (10:7)**, matching the existing Scene Editor FIT canvas. At zoom 1 the frame spans 1000 × 700 world pixels; at zoom 2 it spans 500 × 350. Zoom must be finite and between 0.1 and 8 inclusive. Centers must be finite. Scenes without camera data use center (0, 0), zoom 1 without inserting data into legacy JSON.

Use **Apply camera** to commit numeric values. **Select Cinematic Camera** makes the center cross a drag handle; the frame edges can also select and move it. Each drag is one scene Undo/Redo command. Escape, capture loss, blur or switching documents cancels an unfinished drag. **Reset Camera** commits the defaults. Selecting the camera retains the last selected Actor as the explicit target for **Frame Selected Actor**. That action fits the current Puppet container's rendered world bounds with 20% breathing room and bounded zoom. If reliable positive bounds are unavailable, it centers on the Actor's initial origin and retains zoom. It never guesses a head location or edits the Actor.

**Preview Through Camera** frames the scene through the authored camera using the same Phaser camera and scene objects, including background, foreground, layer visibility, parallax, Actor placement and choreography. Navigation is saved once and restored exactly on exit. Navigation input is disabled while looking through the camera. Playback and scrubbing remain independent, and camera-only edits preserve runtime Actors and playhead time. Editor overlays are hidden by default for audience framing; enable **Editor overlays** to use ground and selection controls. Camera frame dragging is available outside audience preview. Inspector and layer controls remain available throughout.

The existing **Preview camera X/Y** toolbar fields remain an additional, temporary parallax inspection offset outside audience preview. They are excluded from the audience view, history and persistence. **Reset view** clears that offset and editor navigation; it does not reset the authored camera. For an exact comparison between the visible camera frame and audience preview, leave that inspection offset at zero.

Artwork is rendered at `authoredPosition + (1 - parallax) * cameraCenter`, with normal Phaser scrolling. This makes the camera center the common parallax reference for the editor and runtime, independent of output viewport dimensions and zoom. Editor navigation alone never moves artwork relative to Actors. No new Actor/world transform system is introduced. Grid, handles, frame and ground guides are separate editor objects and are never written into artwork or exported assets.

Camera state participates in existing scene snapshots, history, project documents, recovery, JSON and scene ZIP serialization. There are no camera timeline keys, following, shake, cuts or camera blending.

## Runtime integration

Loading retains host ownership of the Phaser camera. Apply audience framing explicitly after loading; reapply with the **full host viewport** after a resize. `LoadedScene.applyCamera` applies the initial authored state (or legacy defaults) and synchronizes the shared image layer's parallax compensation. Without this opt-in, loading preserves the existing host camera and native image scroll-factor behavior.

```ts
const loaded = await SceneLoader.loadPackage(scene, packageUrl);
loaded.applyCamera(scene.cameras.main, {
  x: 0,
  y: 0,
  width: scene.scale.gameSize.width,
  height: scene.scale.gameSize.height,
});
// In the host's Phaser update: loaded.runner.update(delta).
// On teardown: loaded.dispose(). The host still owns its camera.
```

Use a centered, unrotated Phaser camera without follow/bounds effects. The adapter fits a 10:7 camera viewport inside the supplied rectangle, sets zoom to `authoredZoom * fitScale`, and calls `centerOn(x, y)`. This preserves framing without stretching. The host owns any background behind letterbox bars. It also owns camera restoration after the loaded scene is disposed. Applying a camera after disposal throws.

`applyCinematicCamera`, `cinematicFrame`, `cameraForBounds`, defaults, viewport and zoom constants are also exported from the renderer-independent core. The camera application helper accepts a small structural Phaser camera interface; it does not import Phaser or React. Hosts rendering their own artwork must also use the center-relative parallax convention above. `SceneRunner` owns only choreography and never implicitly changes a host camera.

## Local verification

Open a scene with artwork and Actors. Move/zoom the cinematic frame, frame a selected Actor, preview and exit, then navigate the editor separately. Confirm numeric camera settings stay unchanged during navigation. Export and reopen the scene JSON with its dependencies, or export a scene ZIP for runtime loading; confirm framing survives. Resize the desktop window and confirm the output aspect stays 10:7. Browser checks remain local-only.
