# Cinematic Camera

Open **Feature Guide → Scene → Cinematic Camera** for an eight-step tour of framing, numeric controls, Actor framing, audience preview, independent navigation and saving. It requires an open scene, works before adding Actors, and only reveals controls without editing the camera or switching preview modes.

Open **Feature Guide → Scene → Camera Timeline & Keyframes** for a nine-step tour of key capture, Key Edit mode, timing, camera values, timeline diamonds, key properties, outgoing curves, deterministic preview and saving. It works with an empty scene and shows guidance when no key is selected. The tour preserves keys, selection, mode, playhead, camera preview and Undo/Redo; try the authored actions after exiting.

Scene Editor has two independent cameras: free editor navigation (wheel zoom and middle/right/Alt-drag pan), and an authored audience frame. Open the initially collapsed **Cinematic Camera** inspector to edit the audience frame.

The optional scene-format-2 `camera` object stores `{ x, y, zoom }`. X/Y are the **frame center in scene pixels**, positive X right and positive Y down, matching Actors and artwork. They are never Phaser scroll offsets. Output is fixed at **1000 × 700 pixels (10:7)**, matching the existing Scene Editor FIT canvas. At zoom 1 the frame spans 1000 × 700 world pixels; at zoom 2 it spans 500 × 350. Zoom must be finite and between 0.1 and 8 inclusive. Centers must be finite. Scenes without camera data use center (0, 0), zoom 1 without inserting data into legacy JSON.

Use **Apply camera** to commit numeric values. **Select Cinematic Camera** makes the center cross a drag handle; the frame edges can also select and move it. Each drag is one scene Undo/Redo command. Escape, capture loss, blur or switching documents cancels an unfinished drag. **Reset Camera** commits the defaults. Selecting the camera retains the last selected Actor as the explicit target for **Frame Selected Actor**. That action fits the current Puppet container's rendered world bounds with 20% breathing room and bounded zoom. If reliable positive bounds are unavailable, it centers on the Actor's initial origin and retains zoom. It never guesses a head location or edits the Actor.

**Preview Through Camera** frames the scene through the authored camera using the same Phaser camera and scene objects, including background, foreground, layer visibility, parallax, Actor placement and choreography. Navigation is saved once and restored exactly on exit. Navigation input is disabled while looking through the camera. Playback and scrubbing remain independent, and camera-only edits preserve runtime Actors and playhead time. Editor overlays are hidden by default for audience framing; enable **Editor overlays** to use ground and selection controls. Camera frame dragging is available outside audience preview. Inspector and layer controls remain available throughout.

The existing **Preview camera X/Y** toolbar fields remain an additional, temporary parallax inspection offset outside audience preview. They are excluded from the audience view, history and persistence. **Reset view** clears that offset and editor navigation; it does not reset the authored camera. For an exact comparison between the visible camera frame and audience preview, leave that inspection offset at zero.

Artwork is rendered at `authoredPosition + (1 - parallax) * cameraCenter`, with normal Phaser scrolling. This makes the camera center the common parallax reference for the editor and runtime, independent of output viewport dimensions and zoom. Editor navigation alone never moves artwork relative to Actors. No new Actor/world transform system is introduced. Grid, handles, frame and ground guides are separate editor objects and are never written into artwork or exported assets.

Camera state participates in existing scene snapshots, history, project documents, recovery, JSON and scene ZIP serialization. Camera following, shake, cuts and blending remain outside this milestone.

## Camera timeline authoring

The Scene timeline includes Camera X, Y and Zoom rows even in scenes without Actors. **Set Camera Key** captures the evaluated camera at the current playhead on all three rows and enables **Camera Key Edit mode**. Seek to another time, edit Center X/Y and Camera zoom, then **Apply camera key**. In this mode, Reset Camera, Frame Selected Actor and frame dragging also explicitly author keys at the playhead. Frame dragging pauses playback and pins the edit time for the entire gesture. Frame Selected Actor samples rendered bounds once; it never enables continuous tracking. Outside this mode numeric controls edit initial settings; enter Key Edit mode before dragging an animated frame.

Click a diamond to select a key and pause playback. Open **Cinematic Camera → Selected camera key** (both disclosures start collapsed) to edit its time in seconds, value or outgoing interpolation. Drag a diamond to move its time using the same ruler, frame grid, key/clip-edge/playhead snapping and zoom as Actor tracks; Alt bypasses snapping. Escape, blur, capture loss, scene switching and Undo cancel a provisional drag. One completed drag is one scene history entry. Duplicate at an explicit time or delete the selected key; Delete/Backspace also removes a selected diamond. Moving/duplicating onto another key in the same channel is rejected, retaining the previous valid document; capture at an existing time replaces that channel's value and retains its curve.

Choose **Linear**, **Stepped**, **Smooth / eased preset**, or **Bézier**. Smooth is a Bézier preset with handles (0.42, 0) and (0.58, 1). Bézier exposes all four normalized handle coordinates. Controls must satisfy `0 <= control1.x <= control2.x <= 1`, with both Y coordinates in [0, 1]. Zoom keys must be in [0.1, 8]. These bounded curves cannot overshoot the endpoint range; the evaluated zoom is additionally clamped to [0.1, 8] for numerical safety. Invalid values/curves are rejected without replacing the current snapshot.

### Data and time semantics

Scene format remains 2. Optional `cameraTracks` contains independent `x`, `y` and `zoom` arrays of `{ id, time, value, curve? }` scalar keys. IDs are stable within each channel; times are strictly increasing, nonnegative **milliseconds**, bounded by scene duration. Curves have the same outgoing property format as character animation keys. No animation document or character rig is copied or modified. Empty/missing channels fall back to `camera` or (0, 0, 1); keyed channels hold their first value before the first key and their last value after the last key. Unkeyed channels retain their independent initial values.

`evaluateCameraAtTime(scene, milliseconds)` uses the existing `sampleProperty` binary search and curve solver. It clamps time to scene duration, rejects nonfinite time and never depends on previous preview time. Editor and runtime camera, Actors and parallax all sample the runner's scene clock, including speed changes, pause, restart and backwards seeks. Camera edits preserve that clock and existing Actor previews. Navigation, mode selection, playhead and inspector disclosure state never enter scene history or exported JSON. Camera tracks persist through scene JSON, project snapshots, autosave/recovery and portable packages; legacy static scenes do not gain synthetic keys.

## Runtime integration

Loading retains host ownership of the Phaser camera. Apply audience framing explicitly after loading; reapply with the **full host viewport** after a resize. `LoadedScene.applyCamera` opts the host camera into the current runner-clock sample and synchronizes the shared image layer's parallax compensation. Subsequent runner updates, seeks, restarts and stops reapply that camera and parallax together. Without this opt-in, loading preserves the existing host camera and native image scroll-factor behavior.

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

`applyCinematicCamera`, `cinematicFrame`, `cameraForBounds`, defaults, viewport and zoom constants are also exported from the renderer-independent core. The camera application helper accepts a small structural Phaser camera interface; it does not import Phaser or React. Hosts rendering their own artwork must also use the center-relative parallax convention above. A standalone `SceneRunner` exposes `cinematicCamera` and `applyCamera(camera, viewport)` at its current clock time. It can receive an explicit `camera: { target, viewport?: () => rectangle }` option and an `onCamera(state)` render callback. Without that opt-in, it leaves host cameras untouched.

## Local verification

Open a scene with artwork and Actors. Move/zoom the cinematic frame, frame a selected Actor, preview and exit, then navigate the editor separately. Confirm numeric camera settings stay unchanged during navigation. Export and reopen the scene JSON with its dependencies, or export a scene ZIP for runtime loading; confirm framing survives. Resize the desktop window and confirm the output aspect stays 10:7. Browser checks remain local-only.
