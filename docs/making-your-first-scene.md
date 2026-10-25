# Making Your First Scene

[All guides](../README.md#guides) · [Scene Editor reference](scene-editor.md)

Scene Editor arranges existing character packages into a scripted scene. Rig Editor builds the skeleton, artwork, skins and attachments; Animation Editor authors the character’s bone and IK clips. Scene Editor places independent **Actors** and schedules those existing clips, movement, facing and optional cues. You can author the whole scene without writing TypeScript.

## Create the scene and add two Actors

1. Open **Scene Editor** from the header, or visit `/scene-editor/` on your local server.
2. Choose **New Scene**. Use `first-scene` as the **Scene ID**, choose a name, set **Duration (seconds)** to `5`, and choose **Create scene**. IDs stay stable after creation.
3. Open **Scene actors** in the inspector and choose **+ Add Actor**. Select **Demo puppet** in **Workspace character**, then **Add actor**. Repeat with **Random paperdoll sketch**, or add the same package again. Each instance has its own position, skin, pose and playback clock.
4. Expand **Actor properties** for the selected Actor. Set **Initial X** to `180` and **Initial Y** to `0`, then **Apply actor properties**. Set **Initial animation** to `idle` and **Facing** to `Left`.
5. Select `actor-1` using its timeline track label, expand **Actor properties**, and set **Initial X** to `-180`, **Initial Y** to `0`, **Initial animation** to `idle`, and **Facing** to `Right`.

Inspector sections start collapsed. Expand only the section you need. For another hosted character, enter its permanent `character.json` path or URL in the Add Actor dialog. Export and host unsaved character drafts before referencing them; Scene Editor reads the package, not another editor’s live draft.

You can also drag an Actor on the stage while stopped. The red handle moves X, the green handle moves Y, and the center moves both. **Escape** cancels a drag. Wheel zooms; middle/right/Alt-drag pans; **Reset view** restores the default camera. Position values use scene coordinates, not browser pixels. Actor array order controls drawing depth; expand **Scene actors** for **Send backward**, **Bring forward**, duplicate and remove commands.

## Make both Actors walk toward each other

Select `actor-1` in the timeline. Set **Playhead (s)** to `1`. Choose **Move to position** in **Action type**, then **Add action**. Expand **Action properties · move**, set **Destination X** to `-40`, **Destination Y** to `0`, and **Action duration (seconds)** to `2`. Choose **Apply action properties**.

Set the playhead to `1` again, choose **Play animation**, and **Add action**. In **Action properties · animation**, select `walk` in **Animation ID**, set **Action duration (seconds)** to `2`, enable **Loop within duration**, and apply. Leave **Playback speed** at `1`.

Repeat these two actions for `actor-2`, using destination X `40`. The two Actors now walk simultaneously from seconds 1 to 3.

Movement and animation are independent: a move travels in a straight line over its duration; the animation changes the local character pose. A move does not automatically choose a walk animation or change facing. Pair them explicitly. **Playback speed** changes the animation’s source clock; it does not change its scene window or a move’s duration. A non-looping animation holds its last pose if it finishes before the scene window ends. At the window end its pose stays held until another clip changes it. Add an `idle` animation at second 3 if you want the walk pose to return to idle.

## Add facing and an optional cue

For each Actor, set the playhead to `0`, choose **Change facing**, and add an action. Expand its properties, set **Facing target** to **Actor**, choose the other Actor in **Target Actor**, and apply. You can also choose a fixed direction or point. This evaluates once at the scheduled time; it does not continuously track a moving target.

For an optional cue, set the playhead to `3.5`, choose **Scene cue**, and add an action. Set **Cue name** to `arrived`. **Payload (JSON, optional)** can hold metadata such as `{"location":"meeting"}`. Cues are delivered to the runtime host’s `onCue` callback during playback. The editor’s visual preview does not execute a gameplay callback or author dialogue/audio from a cue.

## Arrange timing and use Undo

Each Actor has a track. Animation clips occupy the first lane, movement clips the second, and facing/cue markers and waits use additional lanes. Clip widths show their finite duration; markers show a single instant. **Start (seconds)** and **Action duration (seconds)** provide exact timing in the selected action’s inspector.

Drag a clip to move it; drag its right edge to resize. **Snap** uses frame positions, other clip edges and the playhead. Hold **Alt** to bypass it. **Zoom** expands the timeline; scroll the track area horizontally to pan. Drag the workspace dividers to resize the inspector and timeline.

Each completed stage or timeline drag is one **Undo** step. **Escape**, pointer cancellation or losing window focus cancels an unfinished gesture. **Redo** restores a completed edit. Preview and scrubbing create no history entries. Editing the scene resets playback to its initial state.

Animations on the same Actor cannot overlap, nor can two moves on the same Actor. Adjacent windows are allowed. Different Actors may share times; one Actor may move and animate together. Equal-time facing commands for one Actor are rejected. **Wait / hold** is a timeline interval that owns no channel; it does not delay actions with explicitly scheduled starts. Validation rejects invalid proposals without changing the document.

## Preview and scrub

**Play** starts the scene once artwork is ready. **Pause** freezes the scene clock. **Restart** begins at zero; **Stop** restores authored initial placement for stage editing. **Speed** changes the whole scene clock. Completion freezes the final supported pose at the scene duration. Play after completion starts again; Play after a paused seek resumes from that time.

Change **Playhead (s)** or drag the ruler to scrub forward or backward. Seeking always pauses and rebuilds isolated Actors from the scene’s initial data. Reaching the same time gives the same supported movement, facing and animation pose, regardless of where you scrubbed from. Animation gameplay events and scene cues are suppressed while seeking; resuming delivers future events only. Restart is a new playback and can deliver the cues again.

Expand **Runtime preview** to inspect the selected Actor’s current position, facing, animation and clip time. These observations do not change **Initial X/Y**. Use **Stop** before editing placement on the stage.

## Save, reload and play outside the editor

Choose **Validate Scene** to check the document and all referenced character metadata. **Download scene JSON** saves canonical version-2 JSON and checkpoints that snapshot. **Copy Scene JSON** copies the same format without marking it saved. **Open scene JSON** and **Paste scene JSON** reload it after dependency validation. Replacing a dirty scene asks before discarding its working copy; failed or canceled imports retain it.

JSON stores references and Actor/action configuration. It does not embed or modify source rigs, animation/IK tracks, skins, attachments or sprite binaries. Relative references in file/paste imports resolve from the editor page URL because the browser cannot recover a chosen file’s original hosting directory. In the runtime, they resolve from the hosted scene JSON URL. Keep referenced character paths available when moving JSON.

For a portable handoff, choose **Download scene package**. The ZIP contains `scene.json` and each referenced character package once, including artwork. Its references are rewritten inside a detached export; the working document and source packages stay unchanged.

Extract the archive into your Phaser application's `public/my-scene/` folder and load its `scene.json` in a host Phaser scene:

```ts
import { SceneLoader } from 'paper-puppeteer-engine/runtime';

const loaded = await SceneLoader.load(scene, 'my-scene/scene.json');
loaded.runner.play();
// In the Phaser host's update(_time, delta):
loaded.runner.update(delta);
// On replacement or when finished:
loaded.dispose();
```

The host supplies one delta update per frame. `SceneLoader.loadPackage(scene, zipBytes)` accepts an exported ZIP directly. Actor ownership, cancellation, package texture lifetimes and API details are in the [Scene Editor reference](scene-editor.md#runtime-scene-loading).

Download every scene before leaving the page. Switching the **Scene** selector retains in-memory documents and independent histories, but there is no automatic scene draft recovery. The editor imports JSON; the standalone runtime also imports scene ZIPs.

## Feature Guide and deliberate limits

Choose **Feature Guide** in Scene Editor for eight short tours: creation, adding/positioning Actors, animation clips, movement, timing, preview and export. The catalog explains missing scene/selection prerequisites. Tours reveal existing panels and leave scene data and history untouched. Character editor tours are available from their own workspaces.

Scenes support finite, declarative linear timelines. Pathfinding/obstacle avoidance, physics movement, branching story logic, dialogue authoring, camera choreography and timeline-controlled audio are deliberately unsupported. Scene animation windows use hard cuts: there are no overlapping base clips, authored scene crossfades, animation layers, or scene-level IK editing. Author IK inside character clips or bake it in Animation Editor. Arbitrary choreography callbacks, state-controller policies and gameplay scripts are not deterministic seek inputs. Very dense scenes may take noticeably longer to reconstruct when scrubbing; test your own characters and timeline sizes.
