# Cinematic Camera

Start with [Creating Your First Cinematic Scene](creating-your-first-cinematic-scene.md) for the complete artist workflow, runtime handoff and optional pixel-art rendering settings.

Open **Feature Guide → Scene → Cinematic Cuts, Fades & Transitions** for a nine-step tour of instant shot changes, fade authoring, timing and color, holds/conflicts, deterministic preview and saving. An open scene is enough; Actors, cuts and fades are optional. The guide reveals controls without changing authored data, selection, playback, preview settings or Undo/Redo.

Open **Feature Guide → Scene → Cinematic Camera** for an eight-step tour of framing, numeric controls, Actor framing, audience preview, independent navigation and saving. It requires an open scene, works before adding Actors, and only reveals controls without editing the camera or switching preview modes.

Open **Feature Guide → Scene → Camera Timeline & Keyframes** for a nine-step tour of key capture, Key Edit mode, timing, camera values, timeline diamonds, key properties, outgoing curves, deterministic preview and saving. It works with an empty scene and shows guidance when no key is selected. The tour preserves keys, selection, mode, playhead, camera preview and Undo/Redo; try the authored actions after exiting.

Scene Editor has two independent cameras: free editor navigation (wheel zoom and middle/right/Alt-drag pan), and an authored audience frame. Open the initially collapsed **Cinematic Camera** inspector to edit the audience frame.

The optional scene-format-2 `camera` object stores `{ x, y, zoom }`. X/Y are the **frame center in scene pixels**, positive X right and positive Y down, matching Actors and artwork. They are never Phaser scroll offsets. Output is fixed at **1000 × 700 pixels (10:7)**, matching the existing Scene Editor FIT canvas. At zoom 1 the frame spans 1000 × 700 world pixels; at zoom 2 it spans 500 × 350. Zoom must be finite and between 0.1 and 8 inclusive. Centers must be finite. Scenes without camera data use center (0, 0), zoom 1 without inserting data into legacy JSON.

Use **Apply camera** to commit numeric values. **Select Cinematic Camera** makes the center cross a drag handle; the frame edges can also select and move it. Each drag is one scene Undo/Redo command. Escape, capture loss, blur or switching documents cancels an unfinished drag. **Reset Camera** commits the defaults. Selecting the camera retains the last selected Actor as the explicit target for **Frame Selected Actor**. That action fits the current Puppet container's rendered world bounds with 20% breathing room and bounded zoom. If reliable positive bounds are unavailable, it centers on the Actor's initial origin and retains zoom. It never guesses a head location or edits the Actor.

**Preview Through Camera** frames the scene through the authored camera using the same Phaser camera and scene objects, including background, foreground, layer visibility, parallax, Actor placement and choreography. Navigation is saved once and restored exactly on exit. Navigation input is disabled while looking through the camera. Playback and scrubbing remain independent, and camera-only edits preserve runtime Actors and playhead time. Editor overlays are hidden by default for audience framing; enable **Editor overlays** to use ground and selection controls. Camera frame dragging is available outside audience preview. Inspector and layer controls remain available throughout.

The existing **Preview camera X/Y** toolbar fields remain an additional, temporary parallax inspection offset outside audience preview. They are excluded from the audience view, history and persistence. **Reset view** clears that offset and editor navigation; it does not reset the authored camera. For an exact comparison between the visible camera frame and audience preview, leave that inspection offset at zero.

Artwork is rendered at `authoredPosition + (1 - parallax) * cameraCenter`, with normal Phaser scrolling. This makes the camera center the common parallax reference for the editor and runtime, independent of output viewport dimensions and zoom. Editor navigation alone never moves artwork relative to Actors. No new Actor/world transform system is introduced. Grid, handles, frame and ground guides are separate editor objects and are never written into artwork or exported assets.

Camera state participates in existing scene snapshots, history, project documents, recovery, JSON and scene ZIP serialization. Camera following, shake and blending remain outside this milestone.

## Camera timeline authoring

The Scene timeline includes Camera X, Y and Zoom rows even in scenes without Actors. **Set Camera Key** captures the evaluated camera at the current playhead on all three rows and enables **Camera Key Edit mode**. Seek to another time, edit Center X/Y and Camera zoom, then **Apply camera key**. In this mode, Reset Camera, Frame Selected Actor and frame dragging also explicitly author keys at the playhead. Frame dragging pauses playback and pins the edit time for the entire gesture. Frame Selected Actor samples rendered bounds once; it never enables continuous tracking. Outside this mode numeric controls edit initial settings; enter Key Edit mode before dragging an animated frame.

Click a diamond to select a key and pause playback. Open **Cinematic Camera → Selected camera key** (both disclosures start collapsed) to edit its time in seconds, value or outgoing interpolation. Drag a diamond to move its time using the same ruler, frame grid, key/clip-edge/playhead snapping and zoom as Actor tracks; Alt bypasses snapping. Escape, blur, capture loss, scene switching and Undo cancel a provisional drag. One completed drag is one scene history entry. Duplicate at an explicit time or delete the selected key; Delete/Backspace also removes a selected diamond. Moving/duplicating onto another key in the same channel is rejected, retaining the previous valid document; capture at an existing time replaces that channel's value and retains its curve.

Choose **Linear**, **Stepped**, **Smooth / eased preset**, or **Bézier**. Smooth is a Bézier preset with handles (0.42, 0) and (0.58, 1). Bézier exposes all four normalized handle coordinates. Controls must satisfy `0 <= control1.x <= control2.x <= 1`, with both Y coordinates in [0, 1]. Zoom keys must be in [0.1, 8]. These bounded curves cannot overshoot the endpoint range; the evaluated zoom is additionally clamped to [0.1, 8] for numerical safety. Invalid values/curves are rejected without replacing the current snapshot.

### Data and time semantics

Scene format remains 2. Optional `cameraTracks` contains independent `x`, `y` and `zoom` arrays of `{ id, time, value, curve? }` scalar keys. IDs are stable within each channel; times are strictly increasing, nonnegative **milliseconds**, bounded by scene duration. Curves have the same outgoing property format as character animation keys. No animation document or character rig is copied or modified. Empty/missing channels fall back to `camera` or (0, 0, 1); keyed channels hold their first value before the first key and their last value after the last key. Unkeyed channels retain their independent initial values.

`evaluateCameraAtTime(scene, milliseconds)` uses the existing `sampleProperty` binary search and curve solver. It clamps time to scene duration, rejects nonfinite time and never depends on previous preview time. Editor and runtime camera, Actors and parallax all sample the runner's scene clock, including speed changes, pause, restart and backwards seeks. Camera edits preserve that clock and existing Actor previews. Navigation, mode selection, playhead and inspector disclosure state never enter scene history or exported JSON. Camera tracks persist through scene JSON, project snapshots, autosave/recovery and portable packages; legacy static scenes do not gain synthetic keys.

## Shot cuts and fades

At the desired playhead time, choose **Set Camera Cut**, then edit the new shot's Center X/Y and zoom using **Apply camera key**. This captures all three camera channels and makes their preceding keys **Stepped**. The previous shot holds until the cut time; at the exact boundary the new shot appears immediately. If a channel has no earlier key, the command adds a time-zero baseline with its previous evaluated framing. The whole command is one Undo/Redo entry. Existing keys before/after the cut remain editable; stepping changes the interval from the preceding key to the cut. A cut at zero sets the opening shot.

The compact **Transitions** track shows fades on its upper row and derived cut diamonds below. Click a cut diamond to seek to it and select its camera key; edit timing and values in **Cinematic Camera → Selected camera key** or drag the channel diamonds. Cut markers derive from stepped incoming intervals, so changing the preceding curve updates the marker too. Camera channels remain the only camera owner.

Choose **Effect type → Fade in / Fade out**, then **Add effect** at the playhead. This works without Actors. Select the fade clip and open the initially collapsed **Transition properties** inspector to edit its start, positive duration, direction and color. Apply commits one scene history entry. Delete transition or Delete/Backspace removes it; Undo/Redo restores it. New effects use black and up to one second of remaining scene time. Overlaps are rejected with validation feedback; shorten or move the effect before adding another. Ruler snapping includes fade edges. Timeline labels and inspector fields use seconds; authored values use milliseconds.

Scene format 2 gains an optional `transitions` array (at most 1000), with `{ id, time, duration, type, color }`. IDs must be unique; times must be nonnegative and durations positive and finite, with each end inside scene duration. Supported types are `fade-in` and `fade-out`; colors are six-digit `#rrggbb` values. Fade intervals are half-open for ownership: adjacent intervals are valid and the later fade owns their exact shared boundary. Stored array order does not affect evaluation. Legacy scenes remain unchanged.

`evaluateTransitionAtTime(scene, milliseconds)` returns `{ color, opacity }` with linear progress. Fade in goes from 1 to 0, fade out from 0 to 1. Before the first effect, the overlay is clear. Each fade holds its final opacity until the next effect begins: fade out, leave a gap for a color hold, then fade in with the same color to reveal the scene. The new effect's color and starting opacity take effect at its start, so different colors or consecutive same-direction fades can intentionally jump. There is no wall-clock tween, implicit replay or external event dispatch. Seeks in either direction, pause/resume and speed changes use the existing scene clock; camera cuts and Actor choreography continue beneath fades.

During playback/scrubbing or **Preview Through Camera**, the overlay covers the authored output frame above every background, Actor and foreground band, below ground/selection guides. Audience preview hides guides by default; React controls remain accessible. Stop outside audience preview returns to unobscured placement editing. Fade edits, selection and Undo/Redo preserve preview time and Actor identity. Fades persist in JSON, scene/project ZIPs and recovery. These are transitions within one scene; they do not load another scene.

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

`SceneLoader` creates and owns a `SceneTransitionOverlay` when the loaded document contains fades. It samples the runner's clock and camera frame on playback and seeks; disposing the session or shutting down Phaser destroys it. For a custom host, create `new SceneTransitionOverlay(phaserScene)` and pass it as `transitionOverlay` to `SceneRunner`, using `onCamera: state => overlay.setCamera(state)` to synchronize its world frame. The host owns disposal of that overlay; the runner clears it on cancellation, interruption, failure and disposal. Completion retains the final fade sample. Alternatively, use `runner.transition` or `onTransition(state)` to render a custom overlay. These render notifications also run on seek and are separate from playback-only scene cues. The built-in overlay uses depth 8000, above the scene's layer bands and below editor guides; with multiple output cameras, restrict its visibility to the intended output camera. The overlay creates no tweens or independent update listeners.

## Local verification

Open a scene with artwork and Actors. Move/zoom the cinematic frame, frame a selected Actor, preview and exit, then navigate the editor separately. Confirm numeric camera settings stay unchanged during navigation. Export and reopen the scene JSON with its dependencies, or export a scene ZIP for runtime loading; confirm framing survives. Resize the desktop window and confirm the output aspect stays 10:7. Browser checks remain local-only.
